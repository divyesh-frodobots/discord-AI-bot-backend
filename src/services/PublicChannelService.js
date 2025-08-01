import botRules from '../config/botRules.js';
import constants from '../config/constants.js';
import redis from './redisClient.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

/**
 * Public Channel Service - Clean Command-Based Bot
 * 
 * Flow:
 * 1. User triggers with command/mention → Bot asks for product selection
 * 2. User selects product → Bot fetches content and stores context
 * 3. User asks question → Bot responds in public with @user tag
 * 4. Complex questions → Auto-create thread for follow-up
 * 5. Redis persistence for server restarts
 */
class PublicChannelService {
  constructor() {
    // User context tracking
    this.userProductContext = new Map(); // userId → { productKey, channelId, timestamp, articles, systemPrompt }
    this.activeThreads = new Map();       // userId → threadId
    this.threadTimeouts = new Map();      // threadId → timeout handle
    
    // Configuration
    this.PRODUCT_SELECTION_TIMEOUT = 60 * 60 * 1000; // 1 hour
    this.THREAD_INACTIVE_TIMEOUT = 15 * 60 * 1000;   // 15 minutes
    this.COMPLEX_MESSAGE_THRESHOLD = 100; // Characters that trigger thread creation
    
    // Trigger patterns
    this.COMMAND_TRIGGERS = [
      '/ask', '!help', '!question', '?help', '!product', '/help'
    ];
    
    this.HUMAN_HELP_TRIGGERS = [
      'human help', 'talk to human', 'need human', 'speak to human', 'contact team'
    ];
  }

  /**
   * Check if bot should respond to a message
   */
  async shouldRespond(message, botUserId) {
    const userId = message.author.id;
    const content = message.content.toLowerCase().trim();

    // THREAD MESSAGES: Check if in our threads (memory first, then Redis)
    if (message.channel.isThread()) {
      let isUserThread = this.activeThreads.get(userId) === message.channel.id;
      
      if (!isUserThread) {
        // Check Redis for active thread
        const activeThreadId = await this.loadActiveThreadFromRedis(userId);
        if (activeThreadId === message.channel.id) {
          // Restore to memory for fast access
          this.activeThreads.set(userId, activeThreadId);
          isUserThread = true;
          console.log(`🔄 Restored active thread from Redis for ${message.author.username}`);
        }
      }
      
      if (isUserThread) {
        return { shouldRespond: true, reason: 'in_user_thread' };
      }
    }

    // PUBLIC CHANNEL: Only respond to triggers
    if (!message.channel.isThread()) {
      // Check for bot mention
      if (this._isBotMentioned(content, botUserId)) {
        return { shouldRespond: true, reason: 'bot_mentioned' };
      }

      // Check for command triggers
      if (this._hasCommandTrigger(content)) {
        return { shouldRespond: true, reason: 'command_triggered' };
      }

      // Check for human help requests
      if (this._hasHumanHelpTrigger(content)) {
        return { shouldRespond: true, reason: 'human_help_requested' };
      }
    }

    return { shouldRespond: false, reason: 'no_trigger' };
  }

  /**
   * Handle the main public channel flow
   */
  async handlePublicChannelMessage(message, articleService, conversationService) {
    const userId = message.author.id;
    const channelId = message.channel.id;
    const content = message.content.toLowerCase().trim();

    try {
      // Handle human help requests
      if (this._hasHumanHelpTrigger(content)) {
        await this.handleHumanHelpRequest(message);
        return;
      }

      // Check if user has product context (memory first, then Redis)
      let userContext = this.userProductContext.get(userId);
      
      if (!userContext) {
        // Try to restore from Redis
        userContext = await this.loadUserContextFromRedis(userId, articleService);
        if (userContext) {
          // Restore to memory for fast access
          this.userProductContext.set(userId, userContext);
          console.log(`🔄 Restored user context from Redis for ${message.author.username}`);
        }
      }
      
      if (!userContext || this._isContextExpired(userContext) || userContext.channelId !== channelId) {
        // No context or expired - ask for product selection
        await this.requestProductSelection(message);
        return;
      }

      // User has valid product context - generate response
      await this.generateProductResponse(message, userContext, articleService, conversationService);

    } catch (error) {
      console.error('❌ Error handling public channel message:', error);
      await message.reply('❌ Sorry, I encountered an error. Please try again or type `human help` for support.');
    }
  }

  /**
   * Request product selection from user
   */
  async requestProductSelection(message) {
    const components = this.createProductSelectionButtons();
    
    const selectionMessage = `Hi **${message.author.username}**! 👋 

Please select which product you need help with:

🚗 **EarthRover** - Drive-to-earn robots, activation, driving
🥊 **UFB** - Ultimate Fighting Bots, robot combat, battles  
🤖 **SAM** - Small Autonomous Mofo robots
🎓 **EarthRover School** - Learning platform, missions
🌟 **Getting Started** - Account setup, basics

*Select a product, then ask your question!*`;

    await message.reply({
      content: selectionMessage,
      components: components
    });

    console.log(`📦 Requested product selection from ${message.author.username}`);
  }

  /**
   * Create product selection buttons
   */
  createProductSelectionButtons() {
    const row1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('select_earthrover')
          .setLabel('🚗 EarthRover')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('select_ufb')
          .setLabel('🥊 UFB')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('select_sam')
          .setLabel('🤖 SAM')
          .setStyle(ButtonStyle.Primary)
      );

    const row2 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('select_school')
          .setLabel('🎓 EarthRover School')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('select_general')
          .setLabel('🌟 Getting Started')
          .setStyle(ButtonStyle.Secondary)
      );

    return [row1, row2];
  }

  /**
   * Handle product selection button click (SAME AS TICKET BOT)
   */
  async handleProductSelection(interaction, articleService) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const productKey = interaction.customId.replace('select_', '');
      const productMap = {
        'earthrover': { key: 'earthrover', name: 'EarthRover', emoji: '🚗' },
        'ufb': { key: 'ufb', name: 'UFB', emoji: '🥊' },
        'sam': { key: 'sam', name: 'SAM', emoji: '🤖' },
        'school': { key: 'earthrover_school', name: 'EarthRover School', emoji: '🎓' },
        'general': { key: 'getting_started', name: 'Getting Started', emoji: '🌟' }
      };

      const product = productMap[productKey];
      if (!product) {
        await interaction.editReply({ content: '❌ Unknown product selection.' });
        return;
      }

      // ✅ FETCH PRODUCT-SPECIFIC CONTENT (Same as ticket bot)
      console.log(`📦 Fetching ${product.name} content for ${interaction.user.username}...`);
      const articles = await articleService.getArticlesByCategory(product.key);
      console.log(`✅ Fetched content for ${product.name}`);

      // Build product-specific system prompt
      const systemPrompt = this.buildProductSystemPrompt(articles, product.name);

      // Store user's product context WITH the fetched content
      const userContext = {
        productKey: product.key,
        productName: product.name,
        productEmoji: product.emoji,
        channelId: interaction.channel.id,
        timestamp: Date.now(),
        articles: articles,
        systemPrompt: systemPrompt
      };

      // Save to both memory and Redis for persistence
      this.userProductContext.set(interaction.user.id, userContext);
      await this.saveUserContextToRedis(interaction.user.id, userContext);

      await interaction.editReply({
        content: `✅ Selected **${product.emoji} ${product.name}**! 

📚 **Content loaded and ready** - I now have all the ${product.name} knowledge available.

💬 **Ask your ${product.name} question** in the channel and I'll provide focused, detailed answers.

*This selection will expire in 1 hour if unused.*`
      });

      console.log(`📦 ${interaction.user.username} selected ${product.name} with content ready`);

    } catch (error) {
      console.error('❌ Error handling product selection:', error);
      await interaction.editReply({ content: '❌ Error selecting product. Please try again.' });
    }
  }

  /**
   * Generate product-focused response in public channel
   */
  async generateProductResponse(message, userContext, articleService, conversationService) {
    const userId = message.author.id;
    const isComplexQuestion = message.content.length > this.COMPLEX_MESSAGE_THRESHOLD || 
                             message.content.includes('\n') ||
                             message.content.split('?').length > 2;

    // Send typing indicator
    await message.channel.sendTyping();

    try {
      // Use pre-fetched content from user context
      let systemPrompt = userContext.systemPrompt;
      
      // Fallback: fetch content if not pre-fetched (shouldn't happen with new flow)
      if (!systemPrompt) {
        console.log(`⚠️ No pre-fetched content for ${userContext.productName}, fetching now...`);
        const articles = await articleService.getArticlesByCategory(userContext.productKey);
        systemPrompt = this.buildProductSystemPrompt(articles, userContext.productName);
        
        // Update context with fetched content
        userContext.articles = articles;
        userContext.systemPrompt = systemPrompt;
        this.userProductContext.set(userId, userContext);
      } else {
        console.log(`✅ Using pre-fetched ${userContext.productName} content for fast response`);
      }

      // Generate AI response using pre-fetched content
      const aiMessages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: message.content }
      ];

      const aiService = new (await import('../services/AIService.js')).default();
      const aiResponse = await aiService.generateResponse(aiMessages);

      if (isComplexQuestion) {
        // Create thread for complex questions
        await this.handleComplexQuestion(message, userContext, aiResponse.response);
      } else {
        // Respond in public channel with user tag
        const response = `${message.author}, here's your answer regarding **${userContext.productEmoji} ${userContext.productName}**:

${aiResponse.response}

*Need more help? Ask follow-up questions or type \`human help\` for support.*`;

        await message.reply(response);
      }

      // Update user context timestamp (keep the content cached)
      userContext.timestamp = Date.now();
      this.userProductContext.set(userId, userContext);
      
      // Update Redis with new timestamp
      await this.saveUserContextToRedis(userId, userContext);

      console.log(`🎯 Answered ${userContext.productName} question for ${message.author.username} using pre-fetched content`);

    } catch (error) {
      console.error('❌ Error generating product response:', error);
      await message.reply(`${message.author}, sorry, I encountered an error. Please try again or type \`human help\` for support.`);
    }
  }

  /**
   * Handle complex questions by creating a thread
   */
  async handleComplexQuestion(message, userContext, aiResponse) {
    try {
      // Create thread for detailed discussion
      const threadName = `${userContext.productEmoji} ${userContext.productName} - ${message.author.username}`;
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60, // 1 hour
        reason: `${userContext.productName} support thread`
      });

      // Track the thread
      this.activeThreads.set(message.author.id, thread.id);
      await this.saveActiveThreadToRedis(message.author.id, thread.id);

      // Send response in thread
      const threadResponse = `# ${userContext.productEmoji} ${userContext.productName} Support

Hi **${message.author.username}**! I've created this thread for your detailed ${userContext.productName} question.

**Your question:** ${message.content}

**My answer:**
${aiResponse}

*Continue asking questions here. This thread will auto-close after 15 minutes of inactivity.*`;

      await thread.send(threadResponse);

      // Send public notification
      await message.reply(`${message.author}, I've created a thread above for your detailed ${userContext.productName} question. Check it out! 🧵`);

      // Set inactivity timeout
      this.setThreadTimeout(thread.id, message.author.id);

      console.log(`🧵 Created ${userContext.productName} thread for ${message.author.username}`);

    } catch (error) {
      console.error('❌ Error creating thread:', error);
      // Fallback to public response
      await message.reply(`${message.author}, here's your ${userContext.productName} answer:

${aiResponse}

*Need more help? Ask follow-up questions or type \`human help\` for support.*`);
    }
  }

  /**
   * Handle thread message (for active threads)
   */
  async handleThreadMessage(message, articleService, conversationService) {
    const userId = message.author.id;
    const threadId = message.channel.id;

    // Reset thread timeout on activity
    this.resetThreadTimeout(threadId, userId);

    // Check if user has product context (memory first, then Redis)
    let userContext = this.userProductContext.get(userId);
    
    if (!userContext) {
      // Try to restore from Redis
      userContext = await this.loadUserContextFromRedis(userId, articleService);
      if (userContext) {
        // Restore to memory for fast access
        this.userProductContext.set(userId, userContext);
        console.log(`🔄 Restored user context from Redis in thread for ${message.author.username}`);
      }
    }
    
    if (!userContext) {
      await message.reply('Your product context has expired. Please mention me in the main channel to start a new conversation.');
      return;
    }

    // Generate response using the stored product context
    await this.generateProductResponse(message, userContext, articleService, conversationService);
  }

  /**
   * Handle human help requests
   */
  async handleHumanHelpRequest(message) {
    const supportMessage = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
    await message.reply(`${message.author}, ${supportMessage}`);
    console.log(`🚨 Human help requested by ${message.author.username}`);
  }

  /**
   * Build product-specific system prompt
   */
  buildProductSystemPrompt(articles, productName) {
    return `You are FrodoBots AI assistant responding in a public Discord channel.

PRODUCT FOCUS: ${productName.toUpperCase()}

KNOWLEDGE BASE:
${articles}

INSTRUCTIONS:
- Provide focused answers about ${productName} only
- Keep responses concise but helpful (public channel context)
- Be conversational and friendly
- If asked about other products, suggest they select the appropriate product
- Don't mention threads or channel management
- Focus purely on answering the ${productName} question

RESPONSE FORMAT:
- Direct, helpful answers
- Use bullet points for lists
- Include specific steps when applicable
- End naturally without generic closings`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // REDIS PERSISTENCE - Survive server restarts
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Save user product context to Redis
   */
  async saveUserContextToRedis(userId, userContext) {
    try {
      const redisKey = `public_user_context:${userId}`;
      const contextData = {
        ...userContext,
        // Don't store large articles in Redis, just the key to refetch
        articles: null,
        systemPrompt: null
      };
      
      await redis.set(redisKey, JSON.stringify(contextData));
      await redis.expire(redisKey, Math.floor(this.PRODUCT_SELECTION_TIMEOUT / 1000));
      
      console.log(`💾 Saved user context to Redis: ${userId} -> ${userContext.productName}`);
    } catch (error) {
      console.error('❌ Error saving user context to Redis:', error);
    }
  }

  /**
   * Load user product context from Redis
   */
  async loadUserContextFromRedis(userId, articleService = null) {
    try {
      const redisKey = `public_user_context:${userId}`;
      const data = await redis.get(redisKey);
      
      if (!data) return null;

      const contextData = JSON.parse(data);
      
      // Check if context has expired
      if (this._isContextExpired(contextData)) {
        await redis.del(redisKey);
        console.log(`🗑️ Expired context removed from Redis: ${userId}`);
        return null;
      }

      // Refetch articles and rebuild system prompt if service is provided
      if (articleService) {
        try {
          const articles = await articleService.getArticlesByCategory(contextData.productKey);
          const systemPrompt = this.buildProductSystemPrompt(articles, contextData.productName);
          
          contextData.articles = articles;
          contextData.systemPrompt = systemPrompt;
          
          console.log(`📚 Restored user context from Redis: ${userId} -> ${contextData.productName}`);
          return contextData;
        } catch (fetchError) {
          console.error('❌ Error refetching content during restore:', fetchError);
          await redis.del(redisKey);
          return null;
        }
      } else {
        // Return context without articles/systemPrompt - will be fetched later
        console.log(`📚 Restored user context from Redis (no service): ${userId} -> ${contextData.productName}`);
        return contextData;
      }
    } catch (error) {
      console.error('❌ Error loading user context from Redis:', error);
      return null;
    }
  }

  /**
   * Save active thread to Redis
   */
  async saveActiveThreadToRedis(userId, threadId) {
    try {
      const redisKey = `public_active_thread:${userId}`;
      await redis.set(redisKey, threadId);
      await redis.expire(redisKey, Math.floor(this.THREAD_INACTIVE_TIMEOUT / 1000));
      
      console.log(`💾 Saved active thread to Redis: ${userId} -> ${threadId}`);
    } catch (error) {
      console.error('❌ Error saving active thread to Redis:', error);
    }
  }

  /**
   * Load active thread from Redis
   */
  async loadActiveThreadFromRedis(userId) {
    try {
      const redisKey = `public_active_thread:${userId}`;
      const threadId = await redis.get(redisKey);
      
      if (threadId) {
        console.log(`📚 Restored active thread from Redis: ${userId} -> ${threadId}`);
      }
      
      return threadId;
    } catch (error) {
      console.error('❌ Error loading active thread from Redis:', error);
      return null;
    }
  }

  /**
   * Clear user data from Redis
   */
  async clearUserFromRedis(userId) {
    try {
      await redis.del(`public_user_context:${userId}`);
      await redis.del(`public_active_thread:${userId}`);
      console.log(`🗑️ Cleared user data from Redis: ${userId}`);
    } catch (error) {
      console.error('❌ Error clearing user data from Redis:', error);
    }
  }

  /**
   * Restore all user contexts from Redis on bot startup
   */
  async restoreFromRedis(client, articleService) {
    console.log('🔄 Restoring public channel data from Redis...');
    
    try {
      // Get all user context keys
      const contextKeys = await redis.keys('public_user_context:*');
      const threadKeys = await redis.keys('public_active_thread:*');
      
      let restoredContexts = 0;
      let restoredThreads = 0;

      // Restore user contexts
      for (const key of contextKeys) {
        const userId = key.replace('public_user_context:', '');
        const userContext = await this.loadUserContextFromRedis(userId, articleService);
        
        if (userContext) {
          this.userProductContext.set(userId, userContext);
          restoredContexts++;
        }
      }

      // Restore active threads
      for (const key of threadKeys) {
        const userId = key.replace('public_active_thread:', '');
        const threadId = await this.loadActiveThreadFromRedis(userId);
        
        if (threadId) {
          // Verify thread still exists and is active
          try {
            const thread = await client.channels.fetch(threadId);
            if (thread && !thread.archived) {
              this.activeThreads.set(userId, threadId);
              // Restart thread timeout
              this.setThreadTimeout(threadId, userId);
              restoredThreads++;
            } else {
              // Thread no longer exists or is archived
              await redis.del(`public_active_thread:${userId}`);
            }
          } catch (error) {
            // Thread doesn't exist
            await redis.del(`public_active_thread:${userId}`);
          }
        }
      }

      console.log(`✅ Restored ${restoredContexts} user contexts and ${restoredThreads} active threads from Redis`);
      
    } catch (error) {
      console.error('❌ Error restoring from Redis:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // THREAD TIMEOUT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Set thread inactivity timeout
   */
  setThreadTimeout(threadId, userId) {
    // Clear existing timeout
    if (this.threadTimeouts.has(threadId)) {
      clearTimeout(this.threadTimeouts.get(threadId));
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.closeInactiveThread(threadId, userId);
    }, this.THREAD_INACTIVE_TIMEOUT);

    this.threadTimeouts.set(threadId, timeout);
  }

  /**
   * Close inactive thread
   */
  async closeInactiveThread(threadId, userId) {
    try {
      // Remove from tracking
      this.activeThreads.delete(userId);
      this.threadTimeouts.delete(threadId);
      await this.clearUserFromRedis(userId); // Clear from Redis on timeout
      
      console.log(`⏰ Auto-closed inactive thread ${threadId} for user ${userId}`);
    } catch (error) {
      console.error('❌ Error closing inactive thread:', error);
    }
  }

  /**
   * Reset thread timeout on activity
   */
  resetThreadTimeout(threadId, userId) {
    if (this.threadTimeouts.has(threadId)) {
      this.setThreadTimeout(threadId, userId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if bot is mentioned anywhere in message
   */
  _isBotMentioned(content, botUserId) {
    if (!botUserId) return false;
    
    // Check for direct bot mentions
    const hasDirectMention = content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
    
    // Check for bot-related role mentions
    const botRoleId = botRules.PUBLIC_CHANNELS.TRIGGERS.BOT_ROLE_ID;
    const hasBotRoleMention = botRoleId && content.includes(`<@&${botRoleId}>`);
    
    return hasDirectMention || hasBotRoleMention;
  }

  /**
   * Check if message contains command triggers
   */
  _hasCommandTrigger(content) {
    return this.COMMAND_TRIGGERS.some(trigger => 
      content.startsWith(trigger.toLowerCase())
    );
  }

  /**
   * Check if message contains human help triggers
   */
  _hasHumanHelpTrigger(content) {
    return this.HUMAN_HELP_TRIGGERS.some(trigger => 
      content.includes(trigger.toLowerCase())
    );
  }

  /**
   * Check if user's product context has expired
   */
  _isContextExpired(userContext) {
    return (Date.now() - userContext.timestamp) > this.PRODUCT_SELECTION_TIMEOUT;
  }

  /**
   * Check if channel is approved for bot operation
   */
  isApprovedChannel(channelName) {
    return botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(channelName);
  }
}

export default PublicChannelService;