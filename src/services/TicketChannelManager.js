import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import constants from "../config/constants.js";

/**
 * TicketChannelManager - Handles ticket lifecycle events
 * 
 * This service manages:
 * - Ticket creation (welcome messages, initial setup)
 * - Ticket deletion (cleanup)
 * - Channel identification
 * 
 * STEP 2: Channel Lifecycle Management
 */
class TicketChannelManager {
  constructor(ticketSelectionService, loggingService) {
    this.ticketSelectionService = ticketSelectionService;
    this.loggingService = loggingService;
  }

  /**
   * Check if a channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    // If it's a thread, check parent and name
    if (channel.isThread && channel.isThread()) {
      return channel.parentId === constants.ROLES.SUPPORT_TICKET_CHANNEL_ID;
    }
    // Otherwise, check for legacy channel
    return channel.name;
  }

  /**
   * Handle new ticket channel creation
   * @param {Object} channel - Newly created Discord channel
   */
  async handleChannelCreation(channel) {
    // Step 1: Validate this is a ticket channel
    if (!this.isTicketChannel(channel)) {
      return;
    }

    console.log(`🎫 New ticket created: ${channel.name} (${channel.id})`);

    // Step 2: Initialize ticket state
    this.ticketSelectionService.set(channel.id, {
      product: null,
      humanHelp: false,
      category: null,
      questionsAnswered: false
    });

    // Step 3: Log ticket creation
    if (this.loggingService) {
      await this.loggingService.logTicketCreation(channel);
    }

    // Step 4: Send welcome message after delay (let Ticket Tool send first)
    setTimeout(async () => {
      await this.sendWelcomeMessage(channel);
    }, 2000);
  }

  /**
   * Handle ticket channel deletion/closure
   * @param {Object} channel - Discord channel being deleted
   */
  async handleChannelDeletion(channel) {
    // Step 1: Validate this is a ticket channel
    if (!this.isTicketChannel(channel)) {
      return;
    }

    console.log(`🔒 Ticket closed: ${channel.name} (${channel.id})`);

    // Step 2: Log ticket closure
    if (this.loggingService) {
      await this.loggingService.logTicketClosure(channel);
    }

    // Step 3: Clean up ticket state
    this.ticketSelectionService.clear(channel.id);
  }

  /**
   * Send welcome message with category selection buttons
   * @param {Object} channel - Discord channel to send message to
   */
  async sendWelcomeMessage(channel) {
    try {
      // Step 1: Create category selection buttons
      const categoryButtons = this.createCategoryButtons();

      // Step 2: Send welcome message
      await channel.send({
        content: "🎫 **Welcome to FrodoBots Support!**\n\nPlease select a category to get started with your support request:",
        components: [categoryButtons]
      });

      console.log(`✅ Welcome message sent to ticket: ${channel.name}`);
    } catch (error) {
      console.error('❌ Error sending welcome message to ticket channel:', error);
    }
  }

  /**
   * Create category selection button row
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
   * Send support escalation message
   * @param {Object} channel - Discord channel to send message to
   */
  async sendSupportMessage(channel) {
    try {
      console.log("==========sendSupportMessage");
      const supportMessage = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
      await channel.send({ content: supportMessage });
    } catch (error) {
      console.error('❌ Error sending support message:', error);
    }
  }

  /**
   * Get support escalation message
   * @returns {string} Support message text
   */
  getSupportMessage() {
    console.log("==========getSupportMessage");
    return constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
  }
}

export default TicketChannelManager; 