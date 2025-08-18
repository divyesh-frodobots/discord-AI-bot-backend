import { buildSystemPrompt, buildHumanHelpPrompt } from './ArticleService.js';
import { getServerConfig, getServerFallbackResponse } from '../config/serverConfigs.js';
import botRules from '../config/botRules.js';
 import shopifyIntegrator from '../shopify/ShopifyIntegrator.js';

/**
 * TicketChannelService - Handles message processing in ticket channels
 * 
 * This service manages:
 * - Message validation and routing
 * - AI response generation
 * - Human escalation detection
 * - Staff message filtering
 * 
 * STEP 4: Message Processing & AI Responses
 */
class TicketChannelService {
  constructor(ticketSelectionService, articleService, aiService) {
    this.ticketSelectionService = ticketSelectionService;
    this.articleService = articleService;
    this.aiService = aiService;
    this.loggingService = null;
  }

  /**
   * Set required services
   * @param {Object} conversationService - Conversation management service
   * @param {Object} aiService - AI service for responses
   */
  setServices(conversationService, aiService) {
    this.conversationService = conversationService;
    this.aiService = aiService;
  }

  /**
   * Set logging service
   * @param {Object} loggingService - Logging service
   */
  setLoggingService(loggingService) {
    this.loggingService = loggingService;
  }

  /**
   * Check if a channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    // Get server-specific configuration
    const serverConfig = getServerConfig(channel.guild.id);
    
    // If no server config found, this server is not configured for tickets
    if (!serverConfig) {
      console.log(`⚠️ Server ${channel.guild.name} (${channel.guild.id}) is not configured in serverConfigs.js - skipping ticket channel check`);
      return false;
    }
    
    // Only return true for threads whose parent is the server's support ticket channel
    return channel.isThread && channel.isThread() && channel.parentId === serverConfig.ticketChannelId;
  }

  /**
   * Check if message is from staff member
   * @param {Object} message - Discord message object
   * @returns {boolean} True if message is from staff
   */
  isStaffMessage(message) {
    // Get server-specific configuration
    const serverConfig = getServerConfig(message.guild.id);
    
    // Use server-specific staff roles if configured, otherwise fall back to global config
    const staffRoles = serverConfig ? serverConfig.staffRoles : botRules.TICKET_CHANNELS.STAFF_ROLES;
    const staffRoleIds = serverConfig ? serverConfig.staffRoleIds : botRules.TICKET_CHANNELS.STAFF_ROLE_IDS;
    const staffPermissions = botRules.TICKET_CHANNELS.STAFF_PERMISSIONS;
    
    // Check staff roles by name
    const hasStaffRoleByName = message.member.roles.cache.some(role => 
      staffRoles.includes(role.name)
    );
    
    // Check staff roles by ID
    const hasStaffRoleById = message.member.roles.cache.some(role => 
      staffRoleIds.includes(role.id)
    );
    
    // Check staff permissions
    const hasStaffPermissions = message.member.permissions && 
      staffPermissions.some(permission => 
        message.member.permissions.has(permission)
      );
    
    return hasStaffRoleByName || hasStaffRoleById;
  }

  /**
   * Main message handler for ticket channels
   * @param {Object} message - Discord message object
   */
  async handleMessage(message) {
    // Only process messages in valid ticket threads
    if (!this.isTicketChannel(message.channel)) {
      return;
    }
    const channelId = message.channel.id;
    
    // Step 1: Get current ticket state
    const ticketState = await this.ticketSelectionService.get(channelId);
    console.log(`📋 Current ticket state for ${channelId}:`, JSON.stringify(ticketState, null, 2));

    // Step 2: Check if AI should respond
    if (!(await this.shouldAIRespond(ticketState, message))) {
      return;
    }

    // Step 3: If category is Order Status, route strictly to Shopify and stop
    if (ticketState.category === 'category_orders') {
      try {
        const shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
        if (shopifyResponse) {
          await message.reply({ content: shopifyResponse.content, flags: ['SuppressEmbeds'] });
          
          // Update ticket state if needed (for follow-up tracking)
          if (shopifyResponse.updateTicketState) {
            const updatedState = { ...ticketState, ...shopifyResponse.updateTicketState };
            await this.ticketSelectionService.set(channelId, updatedState);
          }

          // Log the interaction
          if (this.loggingService) {
            const isEscalation = shopifyResponse.type === 'shopify_escalation';
            await this.loggingService.logTicketInteraction(message, shopifyResponse.content, ticketState.product, isEscalation);
          }
          return; // Never let general AI reply in Order Status category
        }
        // If no shopify response, prompt for both fields
        await message.reply({ content: 'Please provide BOTH your order number (e.g., #1234) and the email used for the purchase.', flags: ['SuppressEmbeds'] });
        return;
      } catch (e) {
        console.error('❌ Order Status handling failed:', e.message);
        await message.reply({ content: 'Sorry, I could not process the order status right now. Please try again.', flags: ['SuppressEmbeds'] });
        return;
      }
    }

    // Step 4: Handle categories that require immediate human escalation (Hardware, Bug, Billing)
    if (this.isCategoryQuestionFlow(ticketState)) {
      await this.handleCategoryQuestions(message, ticketState);
      return;
    }

    // Step 5: Check for human help request
    if (await this.detectHumanHelpRequest(message)) {
      await this.escalateToHuman(message, ticketState);
      return;
    }

    // Step 6: Validate category selection first
    if (!ticketState.category) {
      // Don't send duplicate messages - the welcome message already has buttons
      const noCategoryResponse = 'Please select a category using the buttons above to get started.';
      await message.reply({ content: noCategoryResponse, flags: ['SuppressEmbeds'] });
      return;
    }

    // Step 7: Validate product selection (skip for order status category)
    if (!ticketState.product) {
      await this.requestProductSelection(message);
      return;
    }

    // Step 8: Generate AI response
    await this.generateAIResponse(message, ticketState);
  }

  /**
   * Check if support team has messaged in this thread
   * @param {Object} channel - Discord channel object
   * @returns {Promise<boolean>} True if support team has messaged
   */
  async hasSupportTeamMessaged(channel) {
    try {
      // Fetch recent messages to check for support team activity
      const messages = await channel.messages.fetch({ limit: 100 });
      
      for (const [id, message] of messages) {
        if (!message.author.bot && this.isStaffMessage(message)) {
          console.log(`👥 Support team member ${message.author.tag} has messaged in ${channel.id} - bot will stop responding`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('❌ Error checking for support team messages:', error);
      return false;
    }
  }

  /**
   * Check if AI should respond to this message
   * @param {Object} ticketState - Current ticket state
   * @param {Object} message - Discord message object
   * @returns {Promise<boolean>} True if AI should respond
   */
  async shouldAIRespond(ticketState, message) {
    // Don't respond if human help is requested
    if (ticketState.humanHelp) {
      return false;
    }

    // Don't respond to staff messages
    if (this.isStaffMessage(message)) {
      console.log(`👥 Ignoring staff message from ${message.author.tag} in ticket ${message.channel.id}`);
      return false;
    }

    // Check if support team has messaged in this thread - if so, bot should stop responding
    if (await this.hasSupportTeamMessaged(message.channel)) {
      console.log(`🔇 AI staying silent: Support team has messaged in ${message.channel.id} - human support is active`);
      return false;
    }

    // Check if this ticket has bot interaction data (new flow) or no data (old flow)
    const hasBotInteraction = await this.ticketSelectionService.has(message.channel.id);
    if (!hasBotInteraction) {
      console.log(`🔇 AI staying silent: No bot interaction data found - this appears to be an old flow ticket handled by staff in ${message.channel.id}`);
      return false;
    }

    return true;
  }

  /**
   * Check if this is a category question flow
   * @param {Object} ticketState - Current ticket state
   * @returns {boolean} True if in category question flow
   */
  isCategoryQuestionFlow(ticketState) {
    // Only certain categories should immediately escalate to human
    const immediateEscalationCategories = [
      'category_hardware',
      'category_bug', 
      'category_billing'
    ];
    
    return ticketState.category && 
           !ticketState.questionsAnswered && 
           immediateEscalationCategories.includes(ticketState.category);
  }

  /**
   * Handle category-specific question flows that require immediate human escalation
   * (Hardware, Bug, Billing categories)
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async handleCategoryQuestions(message, ticketState) {
    const channelId = message.channel.id;
    
    // Mark questions as answered and escalate to human
    await this.ticketSelectionService.updateField(channelId, 'questionsAnswered', true);
    await this.ticketSelectionService.escalateToHuman(channelId);
    const supportMessage = getServerFallbackResponse(message.guild.id);
    await message.reply({ content: supportMessage, flags: ['SuppressEmbeds'] });

    // Log escalation
    if (this.loggingService) {
      const categoryName = this.getCategoryDisplayName(ticketState.category);
      await this.loggingService.logEscalation(message, `${categoryName} category - requires human support`);
      await this.loggingService.logTicketInteraction(message, supportMessage, null, true);
    }
  }

  /**
   * Detect if user is requesting human help
   * @param {Object} message - Discord message object
   * @returns {boolean} True if human help is requested
   */
  async detectHumanHelpRequest(message) {
    try {
      const systemContent = buildHumanHelpPrompt();
      const messages = [
        { role: "system", content: systemContent },
        { role: "user", content: message.content }
      ];

      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(messages, message.guild.id);
      
      // Check if AI detected escalation intent
      const isEscalationRequest = aiResponse && 
             aiResponse.isValid && 
             aiResponse.response.trim().toUpperCase() === "ESCALATE";

      if (isEscalationRequest) {
        console.log(`🚨 Human help request detected from ${message.author.username}: "${message.content}"`);
      }

      return isEscalationRequest;

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      // Fallback: escalate if AI fails to be safe
      return true;
    }
  }

  /**
   * Escalate ticket to human support
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async escalateToHuman(message, ticketState) {
    const channelId = message.channel.id;
    
    // Mark for human help
    await this.ticketSelectionService.escalateToHuman(channelId);
            const supportMessage = getServerFallbackResponse(message.guild.id);
        await message.reply({ content: supportMessage, flags: ['SuppressEmbeds'] });

    // Log escalation
    if (this.loggingService) {
      await this.loggingService.logEscalation(message, 'AI detected escalation intent');
      await this.loggingService.logTicketInteraction(message, supportMessage, ticketState?.product, true);
    }
  }

  /**
   * Request category selection from user
   * @param {Object} message - Discord message object
   */
  async requestCategorySelection(message) {
    const noCategoryResponse = 'Please select a category to get started with your support request using the buttons above.';
    await message.reply({ content: noCategoryResponse, flags: ['SuppressEmbeds'] });

    // Log interaction
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, noCategoryResponse, null, false);
    }
  }

  /**
   * Request product selection from user
   * @param {Object} message - Discord message object
   */
  async requestProductSelection(message) {
    const noProductResponse = 'Please select a product (UFB, Earthrover, Earthrover School, SAM, or Robots Fun) using the buttons above before asking your question.';
    await message.reply({ content: noProductResponse, flags: ['SuppressEmbeds'] });

    // Log interaction
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, noProductResponse, null, false);
    }
  }

  /**
   * Generate AI response for user message
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async generateAIResponse(message, ticketState) {
    try {
      console.log(`🤖 Generating AI response for product: ${ticketState.product}`);
      
      // 🛍️ SHOPIFY INTEGRATION - Check for order-related queries first
      try {
        const shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
        if (shopifyResponse) {
          console.log('🛍️ Shopify handled ticket message');
          await message.reply({ content: shopifyResponse.content, flags: ['SuppressEmbeds'] });
          
          // Log Shopify interaction
          if (this.loggingService) {
            await this.loggingService.logTicketInteraction(message, shopifyResponse.content, ticketState.product, false);
          }
          
          // Always stop after a Shopify response to avoid double replies
          console.log('✅ Stopping after Shopify response to prevent duplicate replies');
          return;
        }
      } catch (shopifyError) {
        console.error('❌ Shopify integration error (continuing to AI):', shopifyError.message);
      }
      // END SHOPIFY INTEGRATION
      
      // Step 1: Start typing indicator and get product-specific articles
      const channelId = message.channel.id;
      await message.channel.sendTyping();
      
      // Get product articles for the selected product
      const articles = await this.articleService.getArticlesByCategory(ticketState.product);
      const productDisplayName = this.getProductDisplayName(ticketState.product);
      const systemContent = buildSystemPrompt(articles, productDisplayName);
      
      // Initialize conversation with product-specific content
      await this.conversationService.initializeConversation(channelId, systemContent, false);
      this.conversationService.addUserMessage(channelId, message.content, false);
      
      // Step 2: Get conversation history (includes product-specific system message)
      const aiMessages = this.conversationService.getConversationHistory(channelId, false);
      
      // Step 3: Generate response (continue typing indicator)
      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(aiMessages, message.guild.id);

      // Step 4: Send response
      if (aiResponse && aiResponse.isValid) {
        await message.reply({ content: aiResponse.response, flags: ['SuppressEmbeds'] });
        
        // Add assistant response to conversation history
        this.conversationService.addAssistantMessage(channelId, aiResponse.response, false);
        
        // Log successful interaction
        if (this.loggingService) {
          await this.loggingService.logTicketInteraction(message, aiResponse.response, ticketState.product, false);
        }
      } else {
        await this.sendFallbackResponse(message, ticketState);
      }

    } catch (error) {
      console.error('❌ Error generating AI response:', error);
      await this.sendFallbackResponse(message, ticketState);
      
      // Log error
      if (this.loggingService) {
        await this.loggingService.logError(error, 'Ticket message handling failed');
      }
    }
  }

  /**
   * Send fallback response when AI fails
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async sendFallbackResponse(message, ticketState) {
          const fallbackResponse = getServerFallbackResponse(message.guild.id);
    await message.reply({ content: fallbackResponse, flags: ['SuppressEmbeds'] });

    // Log fallback response
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, fallbackResponse, ticketState?.product, false);
    }
  }

  /**
   * Get display name for category
   * @param {string} category - Category key
   * @returns {string} Display name
   */
  getCategoryDisplayName(category) {
    const categoryNames = {
      'category_hardware': 'Hardware Issue',
      'category_bug': 'Bug Report', 
      'category_billing': 'Billing/Account',
      'category_general': 'General Questions',
      'category_software': 'Software/Setup Issue',
      'category_orders': 'Order Status'
    };
    return categoryNames[category] || 'Support';
  }

  /**
   * Get display name for product
   * @param {string} product - Product key
   * @returns {string} Display name
   */
  getProductDisplayName(product) {
    const productNames = {
      'ufb': 'UFB',
      'earthrover': 'Earthrover',
      'earthrover_school': 'Earthrover School',
      'sam': 'SAM',
      'robotsfun': 'Robots.Fun',
      'et_fugi': 'ET Fugi'
    };
    return productNames[product] || 'FrodoBots Product';
  }
}

export default TicketChannelService; 
