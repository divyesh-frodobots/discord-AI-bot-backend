import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

// Import EarthRovers-specific services
import BotActivationArticleService from "./services/BotActivationArticleService.js";
import ConversationService from "./services/ConversationService.js";
import AIService from "./services/AIService.js";

/**
 * EarthRovers Bot - Specialized Discord bot for EarthRovers Personal Bots support
 * 
 * Features:
 * - Channel-based activation (responds to threads in target channel)
 * - Human help detection with support team tagging
 * - AI stops responding after escalation to prevent interference
 * - Cached knowledge base with daily refresh
 * - Per-user rate limiting (5 queries/min, 30/hour, 10s cooldown)
 * - Automatic cleanup of old rate limit data
 * 
 * To configure a different support role ID for EarthRovers:
 * 1. Change this.config.supportRoleId in the constructor, OR
 * 2. Call earthRoversBot.setSupportRoleId("your_role_id") after creating the bot
 */

class ActivationBot {
  constructor() {
    // Initialize EarthRovers-specific services
    this.botActivationArticleService = new BotActivationArticleService();
    this.conversationService = new ConversationService(this.botActivationArticleService);
    this.aiService = new AIService();

    // Configuration
    this.config = {
      targetChannelId: process.env.ACTIVATION_TARGET_CHANNEL_ID || "1206794672375205939", // Channel where EarthRovers threads are created
      refreshInterval: parseInt(process.env.ACTIVATION_REFRESH_INTERVAL) || 24 * 60 * 60 * 1000, // 24 hours
      supportRoleId: process.env.ACTIVATION_SUPPORT_ROLE_ID || "1217016478193422406", // EarthRovers support team role ID
      
      // Rate limiting configuration
      rateLimits: {
        maxQueriesPerMinute: parseInt(process.env.ACTIVATION_MAX_QUERIES_PER_MINUTE) || 5,        // Maximum AI queries per user per minute
        maxQueriesPerHour: parseInt(process.env.ACTIVATION_MAX_QUERIES_PER_HOUR) || 30,         // Maximum AI queries per user per hour
        cooldownSeconds: parseInt(process.env.ACTIVATION_COOLDOWN_SECONDS) || 10,           // Cooldown between messages from same user
        windowSizeMinutes: parseInt(process.env.ACTIVATION_WINDOW_SIZE_MINUTES) || 1,          // Time window for rate limit tracking (minutes)
        windowSizeHours: parseInt(process.env.ACTIVATION_WINDOW_SIZE_HOURS) || 1,            // Time window for hourly rate limit tracking
        cleanupIntervalMinutes: parseInt(process.env.ACTIVATION_CLEANUP_INTERVAL_MINUTES) || 5      // How often to clean up old rate limit data
      }
    };

    // Create Discord client with thread intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration, // For thread management
      ],
    });

    // Track processed threads to avoid duplicates
    this.processedThreads = new Set();
    
    // Track escalated threads where AI should no longer respond
    this.escalatedThreads = new Set();
    
    // Rate limiting tracking
    this.userRateLimits = new Map(); // userId -> { queries: [{timestamp}], lastMessage: timestamp }
    this.rateLimitCleanupInterval = null;
    
    // Cache for ready-to-use content
    this.cachedSystemPrompt = null;
    this.contentRefreshInterval = null;
  }

  async start() {
    this.setupEventListeners();
    await this.client.login(process.env.ACTIVATION_DISCORD_TOKEN);
    console.log("🌍 EarthRovers Bot started successfully!");
  }

  // Cleanup method for graceful shutdown
  async shutdown() {
    console.log("🛑 EarthRovers Bot: Shutting down gracefully...");
    
    // Show escalation statistics before shutdown
    const stats = this.getEscalationStats();
    console.log(`📊 Escalation stats: ${stats.escalatedThreadsCount} threads escalated, ${stats.processedThreadsCount} threads processed`);
    
    // Show rate limiting statistics before shutdown
    const rateLimitStats = this.getRateLimitStats();
    console.log(`📊 Rate limit stats: ${rateLimitStats.totalTrackedUsers} users tracked, ${rateLimitStats.activeUsersThisMinute} active this minute`);
    
    // Clear the daily refresh interval
    if (this.contentRefreshInterval) {
      clearInterval(this.contentRefreshInterval);
      console.log("⏰ Daily refresh interval cleared");
    }
    
    // Clear rate limit cleanup interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      console.log("⏰ Rate limit cleanup interval cleared");
    }
    
    // Disconnect from Discord
    if (this.client) {
      await this.client.destroy();
      console.log("🔌 Discord client disconnected");
    }

    console.log("✅ Activation Bot shutdown complete");
  }

  setupEventListeners() {
    this.client.once("ready", async () => {
      console.log(`🌍 Activation Bot is ready! Logged in as ${this.client.user.tag}`);
      console.log("🤖 Specialized for Activation support");
      console.log("🚫 Escalation tracking enabled - AI stops responding after support team tagged");
      
      // Set bot activity specific to EarthRovers
      this.client.user.setActivity('EarthRovers Personal Bots | AI Support', {
        type: 0, // Playing
      });
      
      // Set bot status
      this.client.user.setStatus('online');
      
      // Initialize EarthRovers articles once on startup
      console.log("🚀 EarthRovers Bot: Initializing comprehensive knowledge base...");
      console.log(`🎯 Target channel for EarthRovers threads: ${this.config.targetChannelId}`);
      console.log(`👥 EarthRovers support role ID: ${this.config.supportRoleId}`);
      console.log(`⏱️ Rate limits: ${this.config.rateLimits.maxQueriesPerMinute}/min, ${this.config.rateLimits.maxQueriesPerHour}/hour, ${this.config.rateLimits.cooldownSeconds}s cooldown`);
      
      try {
        await this.initializeEarthRoversContent();
        console.log("✅ EarthRovers knowledge base ready for immediate use");
        
        // Set up daily refresh (24 hours = 24 * 60 * 60 * 1000 ms)
        this.setupDailyRefresh();
        
        // Set up rate limiting cleanup
        this.setupRateLimitCleanup();
        
      } catch (error) {
        console.error("❌ Failed to initialize EarthRovers content:", error.message);
        console.log("⚠️ Bot will continue with fallback responses");
      }
    });

    // Handle thread creation - now just registers threads without fetching
    this.client.on("threadCreate", async (thread) => {
      console.log(`🧵 Thread detected: "${thread.name}" (ID: ${thread.id})`);
      await this.handleThreadCreation(thread);
    });

    // Handle messages in threads that were created in the target channel
    this.client.on("messageCreate", async (message) => {
      // Ignore messages from bots
      if (message.author.bot) return;

      // Only handle messages in threads
      if (message.channel.type !== ChannelType.PublicThread && 
          message.channel.type !== ChannelType.PrivateThread) {
        return;
      }

      // Check if this thread was created in the target EarthRovers channel
      if (this.isEarthRoversActivationThread(message.channel)) {
        await this.handleEarthRoversThreadMessage(message);
      }
    });

    // Handle errors
    this.client.on('error', error => {
      console.error("🚨 EarthRovers Bot error:", error);
    });

    this.client.on('warn', warning => {
      console.warn("⚠️ EarthRovers Bot warning:", warning);
    });
  }

  // Initialize EarthRovers content once and cache system prompt
  async initializeEarthRoversContent() {
    console.log("📚 Fetching comprehensive EarthRovers articles...");
    const earthRoversArticles = await this.botActivationArticleService.getAllEarthRoversArticles();
    
    if (earthRoversArticles && earthRoversArticles !== "EarthRovers article content unavailable") {
      // Pre-build and cache the system prompt for immediate use
      this.cachedSystemPrompt = this.buildEarthRoversSystemPrompt(earthRoversArticles);
      console.log("✅ EarthRovers system prompt cached and ready");
      
      // Show detailed diagnostics
      const diagnostics = this.botActivationArticleService.getDiagnostics();
      console.log(`📊 Token Usage: ${diagnostics.tokenUsage.current}/${diagnostics.tokenUsage.maximum} (${diagnostics.tokenUsage.percentage}%)`);
      console.log(`📄 Articles: ${diagnostics.cacheInfo.totalArticles} cached, ${diagnostics.cacheInfo.freshArticles} fresh`);
      console.log(`⚖️ Content Limits: ${diagnostics.contentLimits.maxUrls} URLs, depth ${diagnostics.contentLimits.maxDepth}`);
      
      return true;
    } else {
      throw new Error("Failed to load EarthRovers articles");
    }
  }

  // Set up daily refresh for content updates
  setupDailyRefresh() {
    this.contentRefreshInterval = setInterval(async () => {
      console.log("🔄 Daily EarthRovers content refresh starting...");
      try {
        await this.refreshEarthRoversContent();
        console.log("✅ Daily refresh completed successfully");
      } catch (error) {
        console.error("❌ Daily refresh failed:", error.message);
      }
    }, this.config.refreshInterval);
    
    console.log("⏰ Daily refresh scheduled (every 24 hours)");
  }

  // Refresh EarthRovers content (used by daily refresh)
  async refreshEarthRoversContent() {
    console.log("🔄 Refreshing EarthRovers content...");
    const refreshedContent = await this.botActivationArticleService.refreshContent();
    
    if (refreshedContent && refreshedContent !== "EarthRovers article content unavailable") {
      // Update cached system prompt with fresh content
      this.cachedSystemPrompt = this.buildEarthRoversSystemPrompt(refreshedContent);
      console.log("✅ EarthRovers content refreshed and system prompt updated");
      
      // Show updated diagnostics
      const diagnostics = this.botActivationArticleService.getDiagnostics();
      console.log(`📊 Updated Token Usage: ${diagnostics.tokenUsage.current}/${diagnostics.tokenUsage.maximum} (${diagnostics.tokenUsage.percentage}%)`);
      console.log(`📄 Updated Articles: ${diagnostics.cacheInfo.totalArticles} cached, ${diagnostics.cacheInfo.freshArticles} fresh`);
      
      return true;
    } else {
      console.log("⚠️ Refresh failed, keeping existing cached content");
      return false;
    }
  }

  // Check if a thread was created in the target EarthRovers channel
  isEarthRoversActivationThread(thread) {
    if (!thread || !thread.parentId) {
      console.log(`❌ Invalid thread object or missing parent channel:`, thread?.parentId);
      return false;
    }

    const isTargetChannel = thread.parentId === this.config.targetChannelId;
    console.log(`🔍 Channel check: Thread in channel ${thread.parentId} -> ${isTargetChannel ? '✅ MATCH' : '❌ NO MATCH'}`);
    console.log(`🎯 Target channel: ${this.config.targetChannelId}`);
    
    if (isTargetChannel) {
      console.log(`👤 Thread: "${thread.name}" (ID: ${thread.id})`);
    }
    
    return isTargetChannel;
  }

  // Handle new thread creation
  async handleThreadCreation(thread) {
    try {
      // Check if thread was created in the target channel
      if (!this.isEarthRoversActivationThread(thread)) {
        return; // Not in target channel, ignore
      }

      // Check if already processed
      if (this.processedThreads.has(thread.id)) {
        console.log(`♻️ Thread already processed: ${thread.id}`);
        return;
      }

      this.processedThreads.add(thread.id);
      
      console.log(`🌍 New EarthRovers thread detected in target channel!`);
      console.log(`📝 Thread: "${thread.name}" (ID: ${thread.id})`);
      console.log(`📍 Channel: ${thread.parentId}`);
      console.log(`🚀 Ready for EarthRovers support questions...`);

      // Content is already cached from startup - no need to fetch again
      if (this.cachedSystemPrompt) {
        console.log(`✅ EarthRovers knowledge base ready for thread: ${thread.name}`);
      } else {
        console.log(`⚠️ EarthRovers knowledge base not yet available for thread: ${thread.name}`);
        console.log(`📚 Content will be available once initialization completes`);
      }

    } catch (error) {
      console.error("🚨 Error handling thread creation:", error);
    }
  }

  // Handle messages in EarthRovers activation threads
  async handleEarthRoversThreadMessage(message) {
    const userId = message.author.id;
    const username = message.author.username;
    const threadId = message.channel.id;
    let typingInterval;

    try {
      // FIRST: Check if this thread has been escalated to human support
      if (this.escalatedThreads.has(threadId)) {
        console.log(`🚫 Thread ${threadId} has been escalated to human support - AI will not respond`);
        return; // Stop processing - human support is handling this thread
      }

      // SECOND: Check rate limits before processing
      const rateLimitCheck = this.isUserRateLimited(userId);
      if (rateLimitCheck.limited) {
        await this.handleRateLimitExceeded(message, rateLimitCheck);
        return; // Stop processing - user is rate limited
      }

      console.log(`🤖 Processing EarthRovers question from ${username} in thread: ${message.channel.name}`);
      console.log(`❓ Question: ${message.content.substring(0, 100)}...`);

      // Check if user is requesting human help BEFORE generating AI response
      if (await this.detectHumanHelpRequest(message)) {
        await this.escalateToSupportTeam(message);
        return;
      }

      // Record this query for rate limiting (only for AI responses, not escalations)
      this.recordUserQuery(userId);
      
      // Log rate limit status
      const userStatus = this.getUserRateLimitStatus(userId);
      console.log(`📊 Rate limit: ${username} - ${userStatus.queriesThisMinute}/${this.config.rateLimits.maxQueriesPerMinute} per min, ${userStatus.queriesThisHour}/${this.config.rateLimits.maxQueriesPerHour} per hour`);

      // Start typing indicator
      typingInterval = setInterval(() => message.channel.sendTyping(), 5000);
      message.channel.sendTyping();

      // Use cached system prompt for immediate response
      if (!this.cachedSystemPrompt) {
        console.log("⚠️ System prompt not cached, attempting to initialize...");
        await this.initializeEarthRoversContent();
      }

      if (this.cachedSystemPrompt) {
        // Initialize conversation with cached EarthRovers context
        await this.conversationService.initializeConversation(userId, this.cachedSystemPrompt, false);
        this.conversationService.addUserMessage(userId, message.content, false);
        
        // Get conversation history
        const conversationHistory = this.conversationService.getConversationHistory(userId, false);

        // Generate AI response using cached EarthRovers knowledge
        const aiResponse = await this.aiService.generateResponse(conversationHistory);
        
        // Clear typing indicator
        if (typingInterval) clearInterval(typingInterval);

        if (aiResponse.isValid) {
          await message.reply(aiResponse.response);
          this.conversationService.addAssistantMessage(userId, aiResponse.response, false);
          
          console.log(`✅ EarthRovers response sent to ${username}`);
          
        } else {
          const fallbackMessage = "I'm sorry, I'm having trouble processing your request right now. Please try rephrasing your question or ask for human support by typing 'talk to team'.";
          await message.reply(fallbackMessage);
          console.log(`❌ Failed to generate valid response for ${username}`);

        }
      } else {
        // Fallback if system prompt still not available
        const fallbackMessage = "I'm currently loading my EarthRovers knowledge base. Please try again in a moment, or ask for human support by typing 'talk to team'.";
        await message.reply(fallbackMessage);
        
        if (typingInterval) clearInterval(typingInterval);
        console.log(`⚠️ System prompt unavailable for ${username}, sent fallback`);
      }

    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      console.error("🚨 Error processing EarthRovers thread message:", error);
      
      try {
        const errorMessage = "I apologize, but I'm experiencing technical difficulties. Please try again or request human assistance by typing 'talk to team'.";
        await message.reply(errorMessage);
        
      } catch (replyError) {
        console.error("🚨 Error sending error message:", replyError);
      }
    }
  }

  // Detect if user is requesting human help using AI (custom for EarthRovers)
  async detectHumanHelpRequest(message) {
    try {
      // Create a custom prompt that focuses on intent detection without role-specific responses
      const systemContent = `
You are an advanced customer support AI for EarthRovers Personal Bots. Your task is to determine if a user is requesting human assistance.

Analyze the user's message and respond with ONLY "ESCALATE" if they are requesting human help, or "CONTINUE" if they want AI assistance.

ESCALATE if the user:
- Explicitly asks to talk to a human, person, or team
- Uses phrases like "talk to team", "speak to someone", "human help", "support team"
- Shows frustration with AI responses
- Asks for "real person", "live person", "human support"
- Requests escalation or wants to speak to management
- Says they want to contact support or need team help

CONTINUE if the user:
- Asks normal EarthRovers questions about features, setup, or troubleshooting
- Wants information about Drive to Earn, wallet, activation, etc.
- Is asking follow-up questions about EarthRovers functionality

Respond with ONLY one word: "ESCALATE" or "CONTINUE"
      `.trim();

      const messages = [
        { role: "system", content: systemContent },
        { role: "user", content: message.content }
      ];

      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(messages);
      
      // Check if AI detected escalation intent
      const isEscalationRequest = aiResponse && 
             aiResponse.isValid && 
             aiResponse.response.trim().toUpperCase() === "ESCALATE";

      if (isEscalationRequest) {
        console.log(`🚨 EarthRovers human help request detected from ${message.author.username}: "${message.content}"`);
      }

      return isEscalationRequest;

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      // Fallback: escalate if AI fails to be safe
      return true;
    }
  }

  // Escalate to EarthRovers support team with custom role tagging
  async escalateToSupportTeam(message) {
    try {
      const threadId = message.channel.id;
      console.log(`📞 Escalating EarthRovers thread to support team for user: ${message.author.username}`);
      
      // Mark this thread as escalated - AI will no longer respond
      this.escalatedThreads.add(threadId);
      console.log(`🚫 Thread ${threadId} marked as escalated - AI responses disabled`);

      // Create custom support message with EarthRovers-specific role
      const supportMessage = `Thanks for reaching out!  
<@&${this.config.supportRoleId}> will review your EarthRovers request and get back to you as soon as possible. 

**Support Hours:** Mon-Fri, 10am-6pm SGT. 
(*EarthRovers AI bot will no longer respond to messages in this thread.*)`;

      await message.reply(supportMessage);
      
      console.log(`✅ EarthRovers support team (${this.config.supportRoleId}) tagged in thread: ${message.channel.name}`);
      console.log(`🤖 AI will now stop responding in thread: ${threadId}`);
      
    } catch (error) {
      console.error("🚨 Error escalating to EarthRovers support team:", error);
      
      try {
        // Fallback message if tagging fails
        const fallbackMessage = "I'll connect you with our EarthRovers support team. Please wait for assistance.";
        await message.reply(fallbackMessage);
        
        // Still mark as escalated even if there was an error
        this.escalatedThreads.add(message.channel.id);
        console.log(`⚠️ Thread ${message.channel.id} marked as escalated despite error`);
        
      } catch (replyError) {
        console.error("🚨 Error sending escalation fallback message:", replyError);
      }
    }
  }

  // Build comprehensive EarthRovers system prompt
  buildEarthRoversSystemPrompt(earthRoversArticles) {
    return `EarthRovers Personal Bots specialist. Use documentation below:

${earthRoversArticles}

DISCORD CONTEXT:
- You are running as a Discord bot within the FrodoBots Discord server
- Users can request human support by typing "talk to team" or similar phrases

CRITICAL URL FORMATTING:
- NEVER format URLs as markdown links [text](url)
- ALWAYS use plain URLs like: https://rovers.frodobots.com/ 
- Discord will automatically make plain URLs clickable
- Do NOT add any brackets, parentheses, or markdown formatting around URLs

Help with: activation, Drive to Earn, wallet, FBP, bot management, troubleshooting.
For complex issues: suggest "talk to team"
Be friendly, direct, actionable.`;
  }


  // Helper method to configure EarthRovers support role ID
  setSupportRoleId(roleId) {
    this.config.supportRoleId = roleId;
    console.log(`🔧 EarthRovers support role ID updated to: ${roleId}`);
  }

  // Get current configuration
  getConfig() {
    return {
      targetChannelId: this.config.targetChannelId,
      supportRoleId: this.config.supportRoleId,
      refreshInterval: this.config.refreshInterval
    };
  }

  // Check if a thread is escalated to human support
  isThreadEscalated(threadId) {
    return this.escalatedThreads.has(threadId);
  }

  // Get escalation statistics
  getEscalationStats() {
    return {
      escalatedThreadsCount: this.escalatedThreads.size,
      escalatedThreadIds: Array.from(this.escalatedThreads),
      processedThreadsCount: this.processedThreads.size
    };
  }

  // Reset escalation for a specific thread (for development/testing)
  resetThreadEscalation(threadId) {
    const wasEscalated = this.escalatedThreads.delete(threadId);
    if (wasEscalated) {
      console.log(`🔄 Escalation reset for thread: ${threadId} - AI can respond again`);
    } else {
      console.log(`⚠️ Thread ${threadId} was not escalated`);
    }
    return wasEscalated;
  }

  // Clear all escalated threads (for development/testing)
  clearAllEscalations() {
    const count = this.escalatedThreads.size;
    this.escalatedThreads.clear();
    console.log(`🧹 Cleared ${count} escalated threads - AI can respond in all threads again`);
    return count;
  }

  // =================================================================
  // RATE LIMITING METHODS
  // =================================================================

  // Check if user has exceeded rate limits
  isUserRateLimited(userId) {
    const now = Date.now();
    const userLimits = this.userRateLimits.get(userId);
    
    if (!userLimits) {
      return { limited: false };
    }

    const { queries, lastMessage } = userLimits;
    const { rateLimits } = this.config;

    // Check cooldown period
    if (lastMessage && (now - lastMessage) < (rateLimits.cooldownSeconds * 1000)) {
      const remainingCooldown = Math.ceil((rateLimits.cooldownSeconds * 1000 - (now - lastMessage)) / 1000);
      return { 
        limited: true, 
        reason: 'cooldown',
        remainingSeconds: remainingCooldown
      };
    }

    // Filter queries within time windows
    const oneMinuteAgo = now - (rateLimits.windowSizeMinutes * 60 * 1000);
    const oneHourAgo = now - (rateLimits.windowSizeHours * 60 * 60 * 1000);
    
    const recentQueries = queries.filter(timestamp => timestamp > oneMinuteAgo);
    const hourlyQueries = queries.filter(timestamp => timestamp > oneHourAgo);

    // Check per-minute limit
    if (recentQueries.length >= rateLimits.maxQueriesPerMinute) {
      const oldestQuery = Math.min(...recentQueries);
      const resetTime = Math.ceil((oldestQuery + (rateLimits.windowSizeMinutes * 60 * 1000) - now) / 1000);
      return { 
        limited: true, 
        reason: 'per_minute',
        current: recentQueries.length,
        limit: rateLimits.maxQueriesPerMinute,
        resetInSeconds: resetTime
      };
    }

    // Check per-hour limit
    if (hourlyQueries.length >= rateLimits.maxQueriesPerHour) {
      const oldestQuery = Math.min(...hourlyQueries);
      const resetTime = Math.ceil((oldestQuery + (rateLimits.windowSizeHours * 60 * 60 * 1000) - now) / 60);
      return { 
        limited: true, 
        reason: 'per_hour',
        current: hourlyQueries.length,
        limit: rateLimits.maxQueriesPerHour,
        resetInMinutes: resetTime
      };
    }

    return { limited: false };
  }

  // Record a query for rate limiting
  recordUserQuery(userId) {
    const now = Date.now();
    
    if (!this.userRateLimits.has(userId)) {
      this.userRateLimits.set(userId, { queries: [], lastMessage: 0 });
    }

    const userLimits = this.userRateLimits.get(userId);
    userLimits.queries.push(now);
    userLimits.lastMessage = now;

    // Clean up old queries to prevent memory bloat
    const oneHourAgo = now - (this.config.rateLimits.windowSizeHours * 60 * 60 * 1000);
    userLimits.queries = userLimits.queries.filter(timestamp => timestamp > oneHourAgo);
  }

  // Get rate limit status for a user
  getUserRateLimitStatus(userId) {
    const userLimits = this.userRateLimits.get(userId);
    if (!userLimits) {
      return { 
        queriesThisMinute: 0, 
        queriesThisHour: 0, 
        lastMessage: null 
      };
    }

    const now = Date.now();
    const oneMinuteAgo = now - (this.config.rateLimits.windowSizeMinutes * 60 * 1000);
    const oneHourAgo = now - (this.config.rateLimits.windowSizeHours * 60 * 60 * 1000);

    return {
      queriesThisMinute: userLimits.queries.filter(t => t > oneMinuteAgo).length,
      queriesThisHour: userLimits.queries.filter(t => t > oneHourAgo).length,
      lastMessage: userLimits.lastMessage ? new Date(userLimits.lastMessage) : null
    };
  }

  // Clean up old rate limit data
  cleanupRateLimitData() {
    const now = Date.now();
    const oneHourAgo = now - (this.config.rateLimits.windowSizeHours * 60 * 60 * 1000);
    let cleanedUsers = 0;

    for (const [userId, userLimits] of this.userRateLimits.entries()) {
      // Remove old queries
      const oldQueriesLength = userLimits.queries.length;
      userLimits.queries = userLimits.queries.filter(timestamp => timestamp > oneHourAgo);
      
      // Remove users with no recent activity
      if (userLimits.queries.length === 0 && userLimits.lastMessage < oneHourAgo) {
        this.userRateLimits.delete(userId);
        cleanedUsers++;
      }
    }

    if (cleanedUsers > 0) {
      console.log(`🧹 Rate limit cleanup: removed ${cleanedUsers} inactive users`);
    }
  }

  // Setup rate limit cleanup interval
  setupRateLimitCleanup() {
    const cleanupInterval = this.config.rateLimits.cleanupIntervalMinutes * 60 * 1000;
    this.rateLimitCleanupInterval = setInterval(() => {
      this.cleanupRateLimitData();
    }, cleanupInterval);
    
    console.log(`⏰ Rate limit cleanup scheduled every ${this.config.rateLimits.cleanupIntervalMinutes} minutes`);
  }

  // Get rate limiting statistics
  getRateLimitStats() {
    const totalUsers = this.userRateLimits.size;
    const now = Date.now();
    const oneMinuteAgo = now - (this.config.rateLimits.windowSizeMinutes * 60 * 1000);
    
    let activeUsers = 0;
    let totalQueriesThisMinute = 0;
    
    for (const userLimits of this.userRateLimits.values()) {
      const recentQueries = userLimits.queries.filter(t => t > oneMinuteAgo);
      if (recentQueries.length > 0) {
        activeUsers++;
        totalQueriesThisMinute += recentQueries.length;
      }
    }

    return {
      totalTrackedUsers: totalUsers,
      activeUsersThisMinute: activeUsers,
      totalQueriesThisMinute,
      maxQueriesPerMinute: this.config.rateLimits.maxQueriesPerMinute,
      maxQueriesPerHour: this.config.rateLimits.maxQueriesPerHour,
      cooldownSeconds: this.config.rateLimits.cooldownSeconds
    };
  }

  // Handle rate limit exceeded with user-friendly messages
  async handleRateLimitExceeded(message, rateLimitCheck) {
    const username = message.author.username;
    
    let responseMessage = "⏱️ **Rate Limit Exceeded**\n\n";
    
    if (rateLimitCheck.reason === 'cooldown') {
      responseMessage += `Please wait **${rateLimitCheck.remainingSeconds} seconds** before sending another message.\n\n`;
      responseMessage += `🚀 This cooldown helps prevent spam and ensures quality responses for everyone!`;
    } else if (rateLimitCheck.reason === 'per_minute') {
      responseMessage += `You've reached your limit of **${rateLimitCheck.limit} questions per minute**.\n\n`;
      responseMessage += `Please wait **${Math.ceil(rateLimitCheck.resetInSeconds / 60)} minute(s)** before asking another question.\n\n`;
      responseMessage += `💡 For urgent issues, you can ask to "**talk to team**" to reach human support.`;
    } else if (rateLimitCheck.reason === 'per_hour') {
      responseMessage += `You've reached your limit of **${rateLimitCheck.limit} questions per hour**.\n\n`;
      responseMessage += `Please wait **${rateLimitCheck.resetInMinutes} minute(s)** before asking another question.\n\n`;
      responseMessage += `💡 For urgent issues, you can ask to "**talk to team**" to reach human support.`;
    }

    try {
      await message.reply(responseMessage);
      console.log(`⚠️ Rate limit exceeded for ${username}: ${rateLimitCheck.reason} (${rateLimitCheck.current}/${rateLimitCheck.limit})`);
    } catch (error) {
      console.error(`🚨 Error sending rate limit message to ${username}:`, error);
    }
  }
}

// Create and start the EarthRovers bot
const activationBot = new ActivationBot();

// OPTIONAL: Configure a different support role ID for EarthRovers
// Example: earthRoversBot.setSupportRoleId("1234567890123456789");

// OPTIONAL: Escalation management (for development/testing)
// Check escalation stats: console.log(earthRoversBot.getEscalationStats());
// Reset specific thread: earthRoversBot.resetThreadEscalation("thread_id");
// Clear all escalations: earthRoversBot.clearAllEscalations();

// OPTIONAL: Rate limiting management (for development/testing)
// Check rate limit stats: console.log(earthRoversBot.getRateLimitStats());
// Check user status: console.log(earthRoversBot.getUserRateLimitStatus("user_id"));
// Check if user is limited: console.log(earthRoversBot.isUserRateLimited("user_id"));
// Clean up rate limit data: earthRoversBot.cleanupRateLimitData();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT (Ctrl+C), shutting down gracefully...');
  await activationBot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await activationBot.shutdown();
  process.exit(0);
});

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  activationBot.shutdown().then(() => process.exit(1));
});

// Start the bot
activationBot.start().catch((error) => {
  console.error("🚨 Failed to start Activation Bot:", error);
  process.exit(1);
});

export default activationBot;