import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { buildSystemPrompt } from './ArticleService.js';
import { getServerConfig, getServerFallbackResponse } from '../config/serverConfigs.js';

/**
 * TicketButtonHandler - Handles all button interactions in ticket channels
 * 
 * This service manages:
 * - Product selection buttons
 * - Human help request buttons
 * - Category selection buttons
 * - Button interaction validation
 * - State updates after button clicks
 * 
 * STEP 3: Button Interactions & State Management
 */
class TicketButtonHandler {
  constructor(ticketSelectionService, articleService, conversationService, loggingService) {
    this.ticketSelectionService = ticketSelectionService;
    this.articleService = articleService;
    this.conversationService = conversationService;
    this.loggingService = loggingService;
  }

  /**
   * Main button interaction handler
   * @param {Object} interaction - Discord button interaction
   */
  async handleButtonInteraction(interaction) {
    // Step 1: Validate this is a ticket channel
    if (!this.isTicketChannel(interaction.channel)) {
      return;
    }

    const channelId = interaction.channel.id;
    
    try {
      // Step 2: Route to appropriate handler based on button type
      if (interaction.customId.startsWith('category_')) {
        await this.handleCategorySelection(interaction);
      } else if (interaction.customId.startsWith('product_')) {
        await this.handleProductSelection(interaction);
      } else {
        await this.handleUnknownButton(interaction);
      }
    } catch (error) {
      console.error('❌ Error handling ticket button interaction:', error);
      await this.handleError(interaction, error);
    }
  }

  /**
   * Handle category selection buttons
   * @param {Object} interaction - Discord button interaction
   */
  async handleCategorySelection(interaction) {
    const channelId = interaction.channel.id;

    try {
      // Acknowledge immediately to avoid 3s timeout
      await interaction.deferUpdate();

      // Build response content and components
      let responseContent = '';
      let components = [];

      switch (interaction.customId) {
        case 'category_general': {
          responseContent = "✅ **General Questions** selected!\n\nSelect a product to get assistance:";
          const generalButtons = this.createProductButtons(interaction.guild.id);
          components = Object.values(generalButtons).filter(Boolean);
          break;
        }
        case 'category_software': {
          responseContent = "✅ **Software/Setup** selected!\n\nSelect a product for software assistance:";
          const softwareButtons = this.createProductButtons(interaction.guild.id);
          components = Object.values(softwareButtons).filter(Boolean);
          break;
        }
        case 'category_hardware': {
          responseContent = "✅ **Hardware Issue** selected!\n\n**Hardware Support Instructions:**\nFor hardware issues, our support team will need to assist you directly. Please provide:\n\n**1. Bot ID (3-word code)** - Provide the 3-word code of your bot (e.g., silver fox echo) (required)\n**2. Problem Description** - Describe your hardware problem in detail\n\nOnce you provide this information, we'll get you connected with a technician.";
          break;
        }
        case 'category_bug': {
          responseContent = "✅ **Bug Report** selected!\n\n🐛 **Bug Report Instructions:**\n\nTo help us fix bugs quickly, please provide:\n1. **What happened?** (describe the bug)\n2. **What were you doing?** (steps to reproduce)\n3. **What should have happened?** (expected behavior)\n4. **Device/browser info** (if applicable)";
          break;
        }
        case 'category_billing': {
          responseContent = "✅ **Billing/Account** selected!\n\n💳 **Billing Support:**\n\nOur billing team will assist you with account and payment issues. Please describe your billing question or concern.";
          break;
        }
        case 'category_orders': {
          responseContent = "✅ **Order Status** selected!\n\n📦 **Order Status Help:**\n\nI can help you check your order status! Please provide:\n- Your **order number** (e.g., #1234)\n- Your **email address** used for the order\n";
          break;
        }
        default: {
          responseContent = '❌ Unknown category selection.';
          break;
        }
      }

      // Send a normal channel message (not tied to the interaction anymore)
      await interaction.channel.send({
        content: responseContent,
        components: components,
      });

      // Background: update state and log (non-blocking)
      this.updateTicketState(channelId, {
        category: interaction.customId,
        humanHelp: false,
        questionsAnswered: false,
      }).catch(err => console.error('❌ State update error:', err));

      this.logCategorySelection(interaction).catch(err =>
        console.error('❌ Logging error:', err)
      );

    } catch (error) {
      console.error('❌ Error handling category selection:', error);
      // If deferUpdate failed (rare), try replying ephemerally once
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Error processing category selection. Please try again.', flags: ['Ephemeral'] });
        }
      } catch (replyError) {
        console.error('❌ Could not send error reply:', replyError.message);
      }
    }
  }

  /**
   * Handle product selection buttons
   * @param {Object} interaction - Discord button interaction
   */
  async handleProductSelection(interaction) {
    const channelId = interaction.channel.id;

    try {
      // Acknowledge immediately to avoid timeout
      await interaction.deferUpdate();

      // Step 1: Get product info from button ID
      const productInfo = this.getProductInfo(interaction.customId);
      if (!productInfo) {
        await interaction.channel.send({ content: '❌ Unknown product selection.' });
        return;
      }

      // Step 2: Send thinking message while fetching articles
      const loadingText = this.getProductLoadingMessage(productInfo);
      const thinkingMessage = await interaction.channel.send({
        content: loadingText
      });

      try {
        // Step 3: Get product articles and setup conversation
        const articles = await this.articleService.getArticlesByCategory(productInfo.key);
        this.conversationService.clearConversation(channelId, false);

        const systemContent = this.buildSystemPrompt(articles, productInfo.name);
        await this.conversationService.initializeConversation(channelId, systemContent, false);

        // Step 4: Update ticket state
        await this.updateTicketState(channelId, {
          product: productInfo.key,
          humanHelp: false,
        });

        // Step 5: Delete thinking message and send ready message
        await thinkingMessage.delete();
        await interaction.channel.send({
          content: this.getProductReadyMessage(productInfo)
        });

      } catch (articleError) {
        console.error('❌ Error fetching articles:', articleError);
        // Delete thinking message and send error message
        try {
          await thinkingMessage.delete();
          await interaction.channel.send({
            content: `❌ **Sorry, I'm having trouble setting up ${productInfo.displayName} support right now.**\nPlease try selecting the product again, or ask to talk to team for immediate help.`
          });
        } catch (deleteError) {
          // If delete fails, edit instead
          await thinkingMessage.edit({
            content: `❌ **Sorry, I'm having trouble setting up ${productInfo.displayName} support right now.**\nPlease try selecting the product again, or ask to talk to team for immediate help.`
          });
        }
        throw articleError; // Re-throw to be caught by outer try-catch
      }

      // Step 6: Log product selection
      await this.logProductSelection(interaction, productInfo);

    } catch (error) {
      console.error('❌ Error handling product selection:', error);
      // Best-effort user message - only if we haven't already sent a thinking message
      try {
        await interaction.channel.send({ content: '❌ **Something went wrong with your product selection.**\nPlease try clicking the product button again, or ask to talk to team for help.' });
      } catch {}
    }
  }

  /**
   * Handle human help request
   * @param {Object} interaction - Discord button interaction
   */
  async handleHumanHelp(interaction) {
    const channelId = interaction.channel.id;
    
    try {
      await interaction.deferReply();

      // Step 1: Clear conversation and set human help
      this.conversationService.clearConversation(channelId, false);
      await this.updateTicketState(channelId, {
        product: null,
        humanHelp: true
      });

      // Step 2: Send human help message
      const helpMessage = getServerFallbackResponse(interaction.guild.id);
      await interaction.editReply({ content: helpMessage });

      // Step 3: Log human help request
      await this.logHumanHelpRequest(interaction);

    } catch (error) {
      console.error('❌ Error handling human help:', error);
      await this.handleError(interaction, error);
    }
  }

  /**
   * Show product selection buttons for general questions
   * @param {Object} interaction - Discord button interaction
   */
  async showProductSelection(interaction) {
    const productButtons = this.createProductButtons(interaction.guild.id);
    const components = Object.values(productButtons).filter(Boolean); // Only non-null rows
    await interaction.editReply({
      content: "Select a product to get assistance:",
      components
    });
  }

  /**
   * Show product selection buttons for software issues
   * @param {Object} interaction - Discord button interaction
   */
  async showSoftwareProductSelection(interaction) {
    const productButtons = this.createProductButtons(interaction.guild.id);
    const components = Object.values(productButtons).filter(Boolean); // Only non-null rows
    await interaction.editReply({
      content: "Select the product you're having software/setup issues with:",
      components
    });
  }

  /**
   * Show hardware issue instructions
   * @param {Object} interaction - Discord button interaction
   */
  async showHardwareInstructions(interaction) {
    const embed = new EmbedBuilder()
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

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Show bug report instructions
   * @param {Object} interaction - Discord button interaction
   */
  async showBugReportInstructions(interaction) {
    const embed = new EmbedBuilder()
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

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Show billing issue instructions
   * @param {Object} interaction - Discord button interaction
   */
  async showBillingInstructions(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('💳 Billing & Account Support')
      .setDescription('Please provide us with the details of your billing or account issue, and our team will handle it ASAP.')
      .setFooter({ text: 'FrodoBots Support Team' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Show order status instructions
   * @param {Object} interaction - Discord button interaction
   */
  async showOrderStatusInstructions(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🛍️ Order Status')
      .setDescription('Please provide your order number to check the status of your purchase.')
      .addFields(
        { name: '**1. Order Number:**', value: 'Your order number (e.g., 1234567890123456789012345678901234567890)', inline: false },
        { name: '**2. Email:**', value: 'Your email address associated with the order.', inline: false }
      )
      .setFooter({ text: 'FrodoBots Support Team' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Create product selection buttons
   * @param {string} guildId - Discord guild ID to get server-specific configuration
   * @returns {Object} Button rows object
   */
  createProductButtons(guildId = null) {
    // Use server configuration instead of environment variable
    const serverConfig = getServerConfig(guildId);
    const hideSpecial = serverConfig?.name === 'frodobots_owner';
    const row1 = new ActionRowBuilder();
    let row2 = null;
    if (!hideSpecial) {
      row1.addComponents(
        new ButtonBuilder().setCustomId('product_ufb').setLabel('UFB').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('product_earthrover_school').setLabel('EarthRover School').setStyle(ButtonStyle.Primary)
      );
    }
    row1.addComponents(
      new ButtonBuilder().setCustomId('product_robotsfun').setLabel('Robots.Fun').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_earthrover').setLabel('EarthRover (Personal Bot)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('product_et_fugi').setLabel('ET Fugi').setStyle(ButtonStyle.Primary)
    );

    if (!hideSpecial) {
      row2 = new ActionRowBuilder();
      row2.addComponents(
        new ButtonBuilder().setCustomId('product_sam').setLabel('SAM').setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setLabel('Documentation')
          .setStyle(ButtonStyle.Link)
          .setURL('https://intercom.help/frodobots/en')
      );
    } else {
      // If hiding special, add Documentation to row1
      row1.addComponents(
        new ButtonBuilder()
          .setLabel('Documentation')
          .setStyle(ButtonStyle.Link)
          .setURL('https://intercom.help/frodobots/en')
      );
    }

    return row2 ? { row1, row2 } : { row1 };
  }

  /**
   * Get product information from button ID
   * @param {string} buttonId - Button custom ID
   * @returns {Object|null} Product info object
   */
  getProductInfo(buttonId) {
    const productMap = {
      'product_ufb': { key: 'ufb', name: 'UFB', displayName: 'UFB (Ultimate Fighting Bots)' },
      'product_earthrover': { key: 'earthrover', name: 'Earthrover', displayName: 'Earthrover (Drive to Earn)' },
      'product_earthrover_school': { key: 'earthrover_school', name: 'Earthrover School', displayName: 'Earthrover School' },
      'product_sam': { key: 'sam', name: 'SAM', displayName: 'SAM (Small Autonomous Mofo)' },
      'product_robotsfun': { key: 'robotsfun', name: 'Robots Fun', displayName: 'Robots Fun' },
      'product_et_fugi': { key: 'et_fugi', name: 'ET Fugi', displayName: 'ET Fugi' }
    };
    
    return productMap[buttonId] || null;
  }

  /**
   * Get product-specific loading message
   * @param {Object} productInfo - Product information object
   * @returns {string} Loading message
   */
  getProductLoadingMessage(productInfo) {
    return `🔄 Fetching ${productInfo.displayName} knowledge base… please wait a moment.`;
  }

  /**
   * Get product-specific ready message
   * @param {Object} productInfo - Product information object
   * @returns {string} Ready message
   */
  getProductReadyMessage(productInfo) {
    return `You selected ${productInfo.displayName}! Please ask your ${productInfo.displayName}-related question.`;
  }

  /**
   * Update ticket state
   * @param {string} channelId - Discord channel ID
   * @param {Object} updates - State updates to apply
   */
  async updateTicketState(channelId, updates) {
    const currentState = await this.ticketSelectionService.get(channelId);
    await this.ticketSelectionService.set(channelId, { ...currentState, ...updates });
  }

  /**
   * Check if channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    // Get server-specific configuration
    const serverConfig = getServerConfig(channel.guild?.id);    
    // Only return true for threads whose parent is the server's support ticket channel
    return channel.isThread && channel.isThread() && channel.parentId === serverConfig.ticketChannelId;
  }

  /**
   * Build system prompt for conversation
   * @param {Array} articles - Product articles
   * @param {string} productName - Product name
   * @returns {string} System prompt
   */
  buildSystemPrompt(articles, productName) {
    // Use the centralized buildSystemPrompt method from ArticleService for consistency
    return buildSystemPrompt(articles, productName);
  }

  /**
   * Log category selection
   * @param {Object} interaction - Discord button interaction
   */
  async logCategorySelection(interaction) {
    if (!this.loggingService) return;

    const logMessage = {
      author: { tag: interaction.user.tag, id: interaction.user.id },
      channel: interaction.channel,
      guild: interaction.guild, // Add the guild property
      content: `Category selected: ${interaction.customId}`
    };
    
    await this.loggingService.logTicketInteraction(
      logMessage, 
      `Category selected: ${interaction.customId}`, 
      null, 
      false
    );
  }

  /**
   * Log product selection
   * @param {Object} interaction - Discord button interaction
   * @param {Object} productInfo - Product information
   */
  async logProductSelection(interaction, productInfo) {
    if (!this.loggingService) return;

    const logMessage = {
      author: { tag: interaction.user.tag, id: interaction.user.id },
      channel: interaction.channel,
      guild: interaction.guild, // Add the guild property
      content: `Product selected: ${productInfo.name}`
    };
    
    await this.loggingService.logTicketInteraction(
      logMessage, 
      `Product selected: ${productInfo.name}`, 
      productInfo.key, 
      false
    );
  }

  /**
   * Log human help request
   * @param {Object} interaction - Discord button interaction
   */
  async logHumanHelpRequest(interaction) {
    if (!this.loggingService) return;

    const logMessage = {
      author: { tag: interaction.user.tag, id: interaction.user.id },
      channel: interaction.channel,
      guild: interaction.guild, // Add the guild property
      content: 'Human help requested via button'
    };
    
    await this.loggingService.logEscalation(logMessage, 'User requested human help via button');
  }

  /**
   * Handle unknown button
   * @param {Object} interaction - Discord button interaction
   */
  async handleUnknownButton(interaction) {
    await interaction.deferReply();
    await interaction.editReply({ content: '❌ Unknown button interaction.' });
  }

  /**
   * Handle errors in button interactions
   * @param {Object} interaction - Discord button interaction
   * @param {Error} error - Error object
   */
  async handleError(interaction, error) {
    console.error('❌ Error in button handler:', error);
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ 
          content: '❌ An error occurred while processing your selection. Please try again.' 
        });
      } else {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your selection. Please try again.', 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      console.error('❌ Error sending error reply:', replyError);
    }
  }
}

export default TicketButtonHandler; 