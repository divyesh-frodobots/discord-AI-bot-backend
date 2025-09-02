import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import constants from "../config/constants.js";
import { getServerConfig, getServerFallbackResponse } from '../config/serverConfigs.js';

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
    this.processingTickets = new Set(); // Track tickets being processed
  }

  /**
   * Check if a channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    // Get server-specific configuration
    const serverConfig = getServerConfig(channel.guild.id);
    // Only return true for threads whose parent is the server's support ticket channel
    return channel.isThread && channel.isThread() && channel.parentId === serverConfig.ticketChannelId;
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

    // Step 2: Immediate duplicate prevention - check if already processing
    if (this.processingTickets.has(channel.id)) {
      console.log(`⚠️ Already processing ticket: ${channel.name} (${channel.id}), skipping duplicate`);
      return;
    }

    // Add to processing set
    this.processingTickets.add(channel.id);

    console.log(`🎫 New ticket created: ${channel.name} (${channel.id}) - handleChannelCreation called`);

    try {
      // Step 3: Check if ticket state already exists (prevent duplicates)
      const existingState = await this.ticketSelectionService.get(channel.id);
      if (existingState && existingState.welcomeSent) {
        console.log(`⚠️ Welcome already sent for ticket: ${channel.name}, skipping`);
        return;
      }

      // Step 4: Initialize ticket state
      await this.ticketSelectionService.set(channel.id, {
        product: null,
        humanHelp: false,
        category: null,
        questionsAnswered: false,
        welcomeSent: false
      });

      // Step 5: Log ticket creation
      if (this.loggingService) {
        await this.loggingService.logTicketCreation(channel);
      }

      // Step 6: Send welcome message after delay (let Ticket Tool send first)
      setTimeout(async () => {
        try {
          // Double-check welcome wasn't sent during timeout
          const currentState = await this.ticketSelectionService.get(channel.id);
          if (currentState && currentState.welcomeSent) {
            console.log(`⚠️ Welcome already sent during timeout for: ${channel.name}, skipping`);
            return;
          }
          
          await this.sendWelcomeMessage(channel);
          
          // Mark welcome as sent
          await this.ticketSelectionService.set(channel.id, {
            ...currentState,
            welcomeSent: true
          });
        } finally {
          // Remove from processing set after timeout
          this.processingTickets.delete(channel.id);
        }
      }, 2000);
    } catch (error) {
      console.error(`❌ Error processing ticket ${channel.name}:`, error);
      // Remove from processing set on error
      this.processingTickets.delete(channel.id);
    }
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
    await this.ticketSelectionService.clear(channel.id);
  }

  /**
   * Send welcome message with category selection buttons
   * @param {Object} channel - Discord channel to send message to
   */
  async sendWelcomeMessage(channel) {
    try {
      console.log(`🎫 sendWelcomeMessage called for: ${channel.name} (${channel.id})`);
      
      // Step 1: Create category selection buttons
      const categoryButtons = this.createCategoryButtons();

      // Step 2: Send welcome message
      await channel.send({
        content: "🎫 **Welcome to FrodoBots Support!**\n\nPlease select a category to get started with your support request:",
        components: categoryButtons
      });

      console.log(`✅ Welcome message sent to ticket: ${channel.name}`);
    } catch (error) {
      console.error('❌ Error sending welcome message to ticket channel:', error);
    }
  }

  /**
   * Create category selection button row
   * @returns {ActionRowBuilder[]} Array of button rows
   */
  createCategoryButtons() {
    // First row: General, Software, Hardware
    const firstRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('category_general')
        .setLabel('General Questions')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('❓'),
      new ButtonBuilder()
        .setCustomId('category_software')
        .setLabel('Setup & Access')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💻'),
      new ButtonBuilder()
        .setCustomId('category_hardware')
        .setLabel('Hardware Issue')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔧')
    );

    // Second row: Bug Report, Billing, Order Status, Other
    const secondRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('category_bug')
        .setLabel('Bug Report')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🐛'),
      new ButtonBuilder()
        .setCustomId('category_billing')
        .setLabel('Billing & Account')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💳'),
      new ButtonBuilder()
        .setCustomId('category_orders')
        .setLabel('Order Status')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📦'),
      new ButtonBuilder()
        .setCustomId('category_other')
        .setLabel('Other')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝')
    );

    return [firstRow, secondRow];
  }

  /**
   * Send support escalation message
   * @param {Object} channel - Discord channel to send message to
   */
  async sendSupportMessage(channel) {
    try {
      const supportMessage = getServerFallbackResponse(channel.guild.id);
      await channel.send({ content: supportMessage });
    } catch (error) {
      console.error('❌ Error sending support message:', error);
    }
  }
}

export default TicketChannelManager; 
