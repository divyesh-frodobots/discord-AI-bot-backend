import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import constants from "../config/constants.js";
import botRules from "../config/botRules.js";
import { buildSystemPrompt, buildHumanHelpPrompt } from './ArticleService.js';

/**
 * TicketFlowOrchestrator - Unified ticket flow management system
 * 
 * This service consolidates and coordinates ALL ticket-related operations:
 * - Channel lifecycle management (creation, deletion)
 * - User interactions (buttons, messages)
 * - State management and transitions
 * - AI response generation
 * - Escalation handling
 * - Logging and monitoring
 * 
 * BENEFITS:
 * - Single source of truth for ticket flow
 * - Simplified state management
 * - Reduced code duplication
 * - Better error handling
 * - Easier to understand and maintain
 * - Improved performance
 */
class TicketFlowOrchestrator {
  constructor(services) {
    // Core services
    this.ticketStateManager = services.ticketStateManager; // Updated to use TicketStateManager
    this.articleService = services.articleService;
    this.aiService = services.aiService;
    this.conversationService = services.conversationService;
    this.loggingService = services.loggingService;

    // Ticket state machine configurations
    this.TICKET_STATES = {
      CREATED: 'created',           // Just created, waiting for category
      CATEGORY_SELECTED: 'category_selected', // Category chosen, may need product
      PRODUCT_SELECTED: 'product_selected',   // Ready for questions
      ESCALATED: 'escalated',       // Human help requested
      CLOSED: 'closed'              // Ticket closed
    };

    // Categories that immediately escalate to human
    this.IMMEDIATE_ESCALATION_CATEGORIES = [
      'category_hardware',
      'category_bug', 
      'category_billing'
    ];

    // Product information mapping
    this.PRODUCT_MAP = {
      'product_ufb': { key: 'ufb', name: 'UFB', displayName: 'UFB (Ultimate Fighting Bots)' },
      'product_earthrover': { key: 'earthrover', name: 'Earthrover', displayName: 'Earthrover (Drive to Earn)' },
      'product_earthrover_school': { key: 'earthrover_school', name: 'Earthrover School', displayName: 'Earthrover School' },
      'product_sam': { key: 'sam', name: 'SAM', displayName: 'SAM (Small Autonomous Mofo)' },
      'product_robotsfun': { key: 'robotsfun', name: 'Robots Fun', displayName: 'Robots Fun' },
      'product_et_fugi': { key: 'et_fugi', name: 'ET Fugi', displayName: 'ET Fugi' }
    };
  }

  /**
   * =================================================================
   * CHANNEL LIFECYCLE MANAGEMENT
   * =================================================================
   */

  /**
   * Handle new ticket channel creation
   * @param {Object} channel - Newly created Discord channel
   */
  async handleChannelCreation(channel) {
    if (!this.isTicketChannel(channel)) {
      return;
    }

    console.log(`🎫 New ticket created: ${channel.name} (${channel.id})`);

    try {
      // Initialize ticket state
      await this.initializeTicket(channel.id);
      
      // Log ticket creation
      await this.logTicketCreation(channel);

      // Send welcome message after delay (let Ticket Tool send first)
      setTimeout(async () => {
        await this.sendWelcomeMessage(channel);
      }, 2000);

    } catch (error) {
      console.error('❌ Error handling ticket creation:', error);
      await this.logError(error, `Ticket creation failed for ${channel.name}`);
    }
  }

  /**
   * Handle ticket channel deletion/closure
   * @param {Object} channel - Discord channel being deleted
   */
  async handleChannelDeletion(channel) {
    if (!this.isTicketChannel(channel)) {
      return;
    }

    console.log(`🔒 Ticket closed: ${channel.name} (${channel.id})`);

    try {
      // Update state to closed
      await this.updateTicketState(channel.id, { state: this.TICKET_STATES.CLOSED });
      
      // Log ticket closure
      await this.logTicketClosure(channel);

      // Clean up ticket state after logging
      this.ticketStateManager.clear(channel.id);

    } catch (error) {
      console.error('❌ Error handling ticket deletion:', error);
    }
  }

  /**
   * =================================================================
   * USER INTERACTION HANDLING
   * =================================================================
   */

  /**
   * Handle button interactions (category/product selection)
   * @param {Object} interaction - Discord button interaction
   */
  async handleButtonInteraction(interaction) {
    if (!this.isTicketChannel(interaction.channel)) {
      return;
    }

    const channelId = interaction.channel.id;
    
    try {
      if (interaction.customId.startsWith('category_')) {
        await this.handleCategorySelection(interaction);
      } else if (interaction.customId.startsWith('product_')) {
        await this.handleProductSelection(interaction);
      } else {
        await this.handleUnknownButton(interaction);
      }
    } catch (error) {
      console.error('❌ Error handling button interaction:', error);
      await this.handleInteractionError(interaction, error);
    }
  }

  /**
   * Handle user messages in ticket channels
   * @param {Object} message - Discord message object
   */
  async handleMessage(message) {
    const channelId = message.channel.id;
    
    try {
      // Get current ticket state
      const ticketState = this.getTicketState(channelId);

      // Validate if AI should respond
      const shouldRespond = await this.shouldAIRespond(ticketState, message);
      if (!shouldRespond.allowed) {
        console.log(`🚫 AI response blocked: ${shouldRespond.reason}`);
        return;
      }

      // Handle different message scenarios
      if (await this.detectHumanHelpRequest(message)) {
        await this.escalateToHuman(message, ticketState, 'AI detected escalation intent');
        return;
      }

      if (!ticketState.product) {
        await this.requestProductSelection(message);
        return;
      }

      // Generate AI response
      await this.generateAIResponse(message, ticketState);

    } catch (error) {
      console.error('❌ Error handling message:', error);
      await this.sendFallbackResponse(message);
      await this.logError(error, 'Message handling failed');
    }
  }

  /**
   * =================================================================
   * CATEGORY AND PRODUCT SELECTION
   * =================================================================
   */

  /**
   * Handle category selection button
   * @param {Object} interaction - Discord button interaction
   */
  async handleCategorySelection(interaction) {
    const channelId = interaction.channel.id;
    
    try {
      await interaction.deferReply();

      const category = interaction.customId;
      const categoryName = this.getCategoryDisplayName(category);

      // Check if this category requires immediate escalation
      if (this.IMMEDIATE_ESCALATION_CATEGORIES.includes(category)) {
        await this.handleImmediateEscalationCategory(interaction, category, categoryName);
        return;
      }

      // Handle categories that need product selection
      if (category === 'category_general' || category === 'category_software') {
        await this.showProductSelection(interaction, categoryName);
        
        // Update ticket state
        await this.updateTicketState(channelId, {
          category: category,
          state: this.TICKET_STATES.CATEGORY_SELECTED
        });
      }

      // Log category selection
      await this.logCategorySelection(interaction, categoryName);

    } catch (error) {
      console.error('❌ Error handling category selection:', error);
      await this.handleInteractionError(interaction, error);
    }
  }

  /**
   * Handle product selection button
   * @param {Object} interaction - Discord button interaction
   */
  async handleProductSelection(interaction) {
    const channelId = interaction.channel.id;
    
    try {
      await interaction.deferReply();

      const productInfo = this.getProductInfo(interaction.customId);
      if (!productInfo) {
        await interaction.editReply({ content: '❌ Unknown product selection.' });
        return;
      }

      // Setup product-specific conversation
      await this.setupProductConversation(channelId, productInfo);

      // Update ticket state
      await this.updateTicketState(channelId, {
        product: productInfo.key,
        state: this.TICKET_STATES.PRODUCT_SELECTED
      });

      // Send confirmation
      await interaction.editReply({ 
        content: `✅ You selected **${productInfo.displayName}**! Please ask your ${productInfo.name}-related question.`
      });

      // Log product selection
      await this.logProductSelection(interaction, productInfo);

    } catch (error) {
      console.error('❌ Error handling product selection:', error);
      await this.handleInteractionError(interaction, error);
    }
  }

  /**
   * =================================================================
   * AI RESPONSE GENERATION
   * =================================================================
   */

  /**
   * Generate AI response for user message
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async generateAIResponse(message, ticketState) {
    try {
      // Get product-specific articles
      const combinedContent = await this.articleService.getCombinedProductAndGettingStartedArticles(ticketState.product);
      const systemContent = buildSystemPrompt(combinedContent, ticketState.product);

      // Build conversation messages
      const aiMessages = [
        { role: "system", content: systemContent },
        { role: "user", content: message.content }
      ];

      // Generate response
      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(aiMessages);

      if (aiResponse && aiResponse.isValid) {
        await message.reply({ content: aiResponse.response, flags: ['SuppressEmbeds'] });
        
        // Log successful interaction
        await this.logTicketInteraction(message, aiResponse.response, ticketState.product, false);
      } else {
        await this.sendFallbackResponse(message);
      }

    } catch (error) {
      console.error('❌ Error generating AI response:', error);
      await this.sendFallbackResponse(message);
      await this.logError(error, 'AI response generation failed');
    }
  }

  /**
   * =================================================================
   * ESCALATION HANDLING
   * =================================================================
   */

  /**
   * Escalate ticket to human support
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   * @param {string} reason - Escalation reason
   */
  async escalateToHuman(message, ticketState, reason) {
    const channelId = message.channel.id;
    
    try {
      // Update state to escalated
      await this.updateTicketState(channelId, {
        humanHelp: true,
        state: this.TICKET_STATES.ESCALATED
      });

      // Send escalation message
      const supportMessage = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
      await message.reply({ content: supportMessage, flags: ['SuppressEmbeds'] });

      // Log escalation
      await this.logEscalation(message, reason);
      await this.logTicketInteraction(message, supportMessage, ticketState?.product, true);

    } catch (error) {
      console.error('❌ Error escalating to human:', error);
      await this.logError(error, 'Escalation failed');
    }
  }

  /**
   * Handle categories that immediately escalate to human
   * @param {Object} interaction - Discord button interaction
   * @param {string} category - Category ID
   * @param {string} categoryName - Category display name
   */
  async handleImmediateEscalationCategory(interaction, category, categoryName) {
    const channelId = interaction.channel.id;

    // Show category-specific instructions
    await this.showCategoryInstructions(interaction, category);

    // Update state and escalate
    await this.updateTicketState(channelId, {
      category: category,
      humanHelp: true,
      questionsAnswered: true,
      state: this.TICKET_STATES.ESCALATED
    });

    // Log escalation
    await this.logEscalation(
      { author: interaction.user, channel: interaction.channel, content: `Category selected: ${category}` },
      `${categoryName} category - requires human support`
    );
  }

  /**
   * =================================================================
   * STATE MANAGEMENT
   * =================================================================
   */

  /**
   * Initialize ticket state
   * @param {string} channelId - Discord channel ID
   */
  async initializeTicket(channelId) {
    this.ticketStateManager.set(channelId, {
      product: null,
      category: null,
      humanHelp: false,
      questionsAnswered: false,
      state: this.TICKET_STATES.CREATED,
      createdAt: Date.now()
    });
  }

  /**
   * Get current ticket state
   * @param {string} channelId - Discord channel ID
   * @returns {Object} Ticket state
   */
  getTicketState(channelId) {
    return this.ticketStateManager.get(channelId);
  }

  /**
   * Update ticket state
   * @param {string} channelId - Discord channel ID
   * @param {Object} updates - State updates
   */
  async updateTicketState(channelId, updates) {
    const currentState = this.getTicketState(channelId);
    const newState = { ...currentState, ...updates, lastUpdated: Date.now() };
    this.ticketStateManager.set(channelId, newState);
    
    console.log(`🔄 Ticket state updated: ${channelId} -> ${JSON.stringify(updates)}`);
  }

  /**
   * =================================================================
   * VALIDATION AND UTILITIES
   * =================================================================
   */

  /**
   * Check if AI should respond to this message
   * @param {Object} ticketState - Current ticket state
   * @param {Object} message - Discord message object
   * @returns {Object} Response decision with reason
   */
  async shouldAIRespond(ticketState, message) {
    // Don't respond if escalated
    if (ticketState.humanHelp || ticketState.state === this.TICKET_STATES.ESCALATED) {
      return { allowed: false, reason: 'ticket_escalated' };
    }

    // Don't respond to staff messages
    if (this.isStaffMessage(message)) {
      return { allowed: false, reason: 'staff_message' };
    }

    // Don't respond if in immediate escalation category and not yet escalated
    if (this.IMMEDIATE_ESCALATION_CATEGORIES.includes(ticketState.category) && !ticketState.questionsAnswered) {
      return { allowed: false, reason: 'awaiting_escalation' };
    }

    return { allowed: true, reason: 'approved' };
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
      const aiResponse = await this.aiService.generateResponse(messages);
      
      return aiResponse && 
             aiResponse.isValid && 
             aiResponse.response.includes(constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM));

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      return true; // Escalate on error
    }
  }

  /**
   * Check if channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    return channel.name.startsWith('ticket-') || 
           channel.name.startsWith('support-') || 
           channel.name.includes('ticket');
  }

  /**
   * Check if message is from staff member
   * @param {Object} message - Discord message object
   * @returns {boolean} True if message is from staff
   */
  isStaffMessage(message) {
    const staffRoles = botRules.TICKET_CHANNELS.STAFF_ROLES;
    const staffRoleIds = botRules.TICKET_CHANNELS.STAFF_ROLE_IDS;
    const staffPermissions = botRules.TICKET_CHANNELS.STAFF_PERMISSIONS;
    
    const hasStaffRoleByName = message.member.roles.cache.some(role => 
      staffRoles.includes(role.name)
    );
    
    const hasStaffRoleById = message.member.roles.cache.some(role => 
      staffRoleIds.includes(role.id)
    );
    
    const hasStaffPermissions = message.member.permissions && 
      staffPermissions.some(permission => 
        message.member.permissions.has(permission)
      );
    
    return hasStaffRoleByName || hasStaffRoleById || hasStaffPermissions;
  }

  /**
   * =================================================================
   * UI COMPONENTS AND MESSAGES
   * =================================================================
   */

  /**
   * Send welcome message with category selection buttons
   * @param {Object} channel - Discord channel
   */
  async sendWelcomeMessage(channel) {
    try {
      const categoryButtons = this.createCategoryButtons();

      await channel.send({
        content: "🎫 **Welcome to FrodoBots Support!**\n\nPlease select a category to get started with your support request:",
        components: [categoryButtons]
      });

      console.log(`✅ Welcome message sent to ticket: ${channel.name}`);
    } catch (error) {
      console.error('❌ Error sending welcome message:', error);
      await this.logError(error, `Welcome message failed for ${channel.name}`);
    }
  }

  /**
   * Show product selection buttons
   * @param {Object} interaction - Discord interaction
   * @param {string} categoryName - Category display name
   */
  async showProductSelection(interaction, categoryName) {
    const productButtons = this.createProductButtons();
    const message = categoryName === 'Software/Setup' 
      ? "Select the product you're having software/setup issues with:"
      : "Select a product to get assistance:";

    await interaction.editReply({
      content: message,
      components: [productButtons.row1, productButtons.row2]
    });
  }

  /**
   * Show category-specific instructions
   * @param {Object} interaction - Discord interaction
   * @param {string} category - Category ID
   */
  async showCategoryInstructions(interaction, category) {
    let embed;

    switch (category) {
      case 'category_hardware':
        embed = new EmbedBuilder()
          .setColor(0xFF6B35)
          .setTitle('🔧 Hardware Support')
          .setDescription('Got it! Please share some details so our team can assist quickly.')
          .addFields(
            { name: '**1. Bot Code:**', value: 'Your bot\'s 3-word code (e.g., silver fox echo).', inline: false },
            { name: '**2. Issue Description:**', value: 'What\'s happening? Any error messages or strange behavior?', inline: false },
            { name: '**3. When It Started:**', value: 'Approximate time or after an event (e.g., after setup, after update).', inline: false },
            { name: '**4. What You Tried:**', value: 'Any troubleshooting steps so far (restart, reset, etc.).', inline: false },
            { name: '**5. Photo/Video:**', value: 'Attach an image or video showing the issue.', inline: false }
          )
          .setFooter({ text: 'FrodoBots Support Team' })
          .setTimestamp();
        break;

      case 'category_bug':
        embed = new EmbedBuilder()
          .setColor(0xFF4444)
          .setTitle('🐛 Bug Report')
          .setDescription('Thanks for reporting this! Please share some details so our team can assist quickly:')
          .addFields(
            { name: '**1. Product:**', value: 'UFB, EarthRover, EarthRover School, SAM, or Robots.Fun, etc', inline: false },
            { name: '**2. Issue:**', value: 'Brief description of what happened', inline: false },
            { name: '**3. Device/OS:**', value: 'Example: Windows 10 (Chrome) or iPhone 13 (iOS 17)', inline: false },
            { name: '**4. Steps to Reproduce:**', value: 'What steps did you take before the issue occurred?', inline: false },
            { name: '**5. Media (Optional):**', value: 'Screenshots or videos help us investigate faster', inline: false }
          )
          .setFooter({ text: 'FrodoBots Support Team' })
          .setTimestamp();
        break;

      case 'category_billing':
        embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('💳 Billing & Account Support')
          .setDescription('Please provide us with the details of your billing or account issue, and our team will handle it ASAP.')
          .setFooter({ text: 'FrodoBots Support Team' })
          .setTimestamp();
        break;
    }

    if (embed) {
      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Create category selection buttons
   * @returns {ActionRowBuilder} Button row component
   */
  createCategoryButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('category_general')
        .setLabel('General Questions')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('❓'),
      new ButtonBuilder()
        .setCustomId('category_software')
        .setLabel('Software/Setup')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💻'),
      new ButtonBuilder()
        .setCustomId('category_hardware')
        .setLabel('Hardware Issue')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔧'),
      new ButtonBuilder()
        .setCustomId('category_bug')
        .setLabel('Bug Report')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🐛'),
      new ButtonBuilder()
        .setCustomId('category_billing')
        .setLabel('Billing/Account')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💳')
    );
  }

  /**
   * Create product selection buttons
   * @returns {Object} Button rows object
   */
  createProductButtons() {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('product_ufb').setLabel('UFB').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_earthrover_school').setLabel('EarthRover School').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_robotsfun').setLabel('Robots.Fun').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_earthrover').setLabel('EarthRover (Personal Bot)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_et_fugi').setLabel('ET Fugi').setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('product_sam').setLabel('SAM').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setLabel('Documentation')
        .setStyle(ButtonStyle.Link)
        .setURL('https://intercom.help/frodobots/en')
    );

    return { row1, row2 };
  }

  /**
   * =================================================================
   * HELPER METHODS
   * =================================================================
   */

  /**
   * Get product information from button ID
   * @param {string} buttonId - Button custom ID
   * @returns {Object|null} Product info object
   */
  getProductInfo(buttonId) {
    return this.PRODUCT_MAP[buttonId] || null;
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
      'category_software': 'Software/Setup Issue'
    };
    return categoryNames[category] || 'Support';
  }

  /**
   * Setup product-specific conversation
   * @param {string} channelId - Channel ID
   * @param {Object} productInfo - Product information
   */
  async setupProductConversation(channelId, productInfo) {
    try {
      const articles = await this.articleService.getArticlesByCategory(productInfo.key);
      this.conversationService.clearConversation(channelId, false);
      
      const systemContent = buildSystemPrompt(articles, productInfo.name);
      await this.conversationService.initializeConversation(channelId, systemContent, false);
    } catch (error) {
      console.error('❌ Error setting up product conversation:', error);
      throw error;
    }
  }

  /**
   * Send fallback response when AI fails
   * @param {Object} message - Discord message object
   */
  async sendFallbackResponse(message) {
    try {
      const fallbackResponse = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
      await message.reply({ content: fallbackResponse, flags: ['SuppressEmbeds'] });
      
      const ticketState = this.getTicketState(message.channel.id);
      await this.logTicketInteraction(message, fallbackResponse, ticketState?.product, false);
    } catch (error) {
      console.error('❌ Error sending fallback response:', error);
    }
  }

  /**
   * Request product selection from user
   * @param {Object} message - Discord message object
   */
  async requestProductSelection(message) {
    const noProductResponse = 'Please select a product (UFB, Earthrover, Earthrover School, SAM, or Robots Fun) using the buttons above before asking your question.';
    await message.reply({ content: noProductResponse, flags: ['SuppressEmbeds'] });

    await this.logTicketInteraction(message, noProductResponse, null, false);
  }

  /**
   * Handle unknown button interaction
   * @param {Object} interaction - Discord button interaction
   */
  async handleUnknownButton(interaction) {
    await interaction.deferReply();
    await interaction.editReply({ content: '❌ Unknown button interaction.' });
  }

  /**
   * Handle interaction errors
   * @param {Object} interaction - Discord interaction
   * @param {Error} error - Error object
   */
  async handleInteractionError(interaction, error) {
    try {
      const errorMessage = '❌ An error occurred while processing your selection. Please try again.';
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error('❌ Error sending error reply:', replyError);
    }

    await this.logError(error, `Button interaction error: ${interaction.customId}`);
  }

  /**
   * =================================================================
   * LOGGING METHODS
   * =================================================================
   */

  async logTicketCreation(channel) {
    if (this.loggingService) {
      await this.loggingService.logTicketCreation(channel);
    }
  }

  async logTicketClosure(channel) {
    if (this.loggingService) {
      await this.loggingService.logTicketClosure(channel);
    }
  }

  async logTicketInteraction(message, botResponse, product, escalation) {
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, botResponse, product, escalation);
    }
  }

  async logEscalation(message, reason) {
    if (this.loggingService) {
      await this.loggingService.logEscalation(message, reason);
    }
  }

  async logCategorySelection(interaction, categoryName) {
    if (this.loggingService) {
      const logMessage = {
        author: { tag: interaction.user.tag, id: interaction.user.id },
        channel: interaction.channel,
        content: `Category selected: ${categoryName}`
      };
      
      await this.loggingService.logTicketInteraction(logMessage, `Category selected: ${categoryName}`, null, false);
    }
  }

  async logProductSelection(interaction, productInfo) {
    if (this.loggingService) {
      const logMessage = {
        author: { tag: interaction.user.tag, id: interaction.user.id },
        channel: interaction.channel,
        content: `Product selected: ${productInfo.name}`
      };
      
      await this.loggingService.logTicketInteraction(logMessage, `Product selected: ${productInfo.name}`, productInfo.key, false);
    }
  }

  async logError(error, context) {
    if (this.loggingService) {
      await this.loggingService.logError(error, context);
    }
  }

  /**
   * =================================================================
   * DEBUGGING AND MONITORING
   * =================================================================
   */

  /**
   * Get ticket statistics for monitoring
   * @param {string} channelId - Channel ID (optional)
   * @returns {Object} Statistics object
   */
  getTicketStats(channelId = null) {
    if (channelId) {
      const state = this.getTicketState(channelId);
      return {
        channelId,
        state: state.state,
        product: state.product,
        category: state.category,
        escalated: state.humanHelp,
        age: Date.now() - (state.createdAt || 0)
      };
    }

    // Return stats for all tickets
    // This would require iterating over all stored states
    // Implementation depends on how ticketSelectionService stores data
    return {
      message: "Use channelId parameter for specific ticket stats"
    };
  }

  /**
   * Get system health status
   * @returns {Object} Health status
   */
  getSystemHealth() {
    const baseHealth = {
      timestamp: new Date().toISOString(),
      services: {
        articleService: !!this.articleService,
        aiService: !!this.aiService,
        conversationService: !!this.conversationService,
        loggingService: !!this.loggingService,
        ticketStateManager: !!this.ticketStateManager
      },
      status: 'operational'
    };

    // Include enhanced metrics from TicketStateManager
    if (this.ticketStateManager) {
      const stateManagerHealth = this.ticketStateManager.getHealthStatus();
      return { ...baseHealth, enhancedMetrics: stateManagerHealth };
    }

    return baseHealth;
  }

  /**
   * Get comprehensive ticket metrics
   * @returns {Object} Ticket metrics
   */
  getTicketMetrics() {
    if (this.ticketStateManager) {
      return this.ticketStateManager.getMetrics();
    }
    return { error: 'TicketStateManager not available' };
  }

  /**
   * Get tickets in a specific state
   * @param {string} state - State to filter by
   * @returns {Array} Array of tickets
   */
  getTicketsByState(state) {
    if (this.ticketStateManager) {
      return this.ticketStateManager.getTicketsByState(state);
    }
    return [];
  }

  /**
   * Get inactive tickets
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Array} Array of inactive tickets
   */
  getInactiveTickets(timeoutMs) {
    if (this.ticketStateManager) {
      return this.ticketStateManager.getInactiveTickets(timeoutMs);
    }
    return [];
  }

  /**
   * Export ticket data for analysis
   * @returns {Array} Array of ticket data
   */
  exportTicketData() {
    if (this.ticketStateManager) {
      return this.ticketStateManager.exportData();
    }
    return [];
  }

  /**
   * Clean up old tickets
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {number} Number of tickets cleaned up
   */
  cleanupOldTickets(maxAge) {
    if (this.ticketStateManager) {
      return this.ticketStateManager.cleanup(maxAge);
    }
    return 0;
  }
}

export default TicketFlowOrchestrator; 