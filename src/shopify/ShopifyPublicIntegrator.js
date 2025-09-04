import shopifyOrderDetector from './ShopifyOrderDetector.js';
import { ChannelType } from 'discord.js';
import { getServerConfig } from '../config/serverConfigs.js';
import dynamicTicketChannelService from '../services/dynamic/DynamicTicketChannelService.js';

/**
 * ShopifyPublicIntegrator - Simplified public channel integration
 * 
 * Public Channel Flow:
 * 1. Detect if user is asking about orders
 * 2. If yes, redirect them to #support-ticket channel
 * 3. That's it - keep it simple!
 */
class ShopifyPublicIntegrator {
  constructor() {
    // Nothing complex needed here
  }

  /**
   * Process message in public channel
   * Simple flow: detect order question → redirect to ticket
   */
  async processPublicMessage(message) {
    try {
      // Only respond inside threads in public channels
      const isInPublicThread =
        message.channel?.type === ChannelType.PublicThread ||
        message.channel?.type === ChannelType.AnnouncementThread;

      if (!isInPublicThread) {
        return null;
      }

      // Check if message is order-related
      const isOrderRelated = await shopifyOrderDetector.isOrderRelated(message);
      
      if (!isOrderRelated) {
        return null; // Not order-related, let normal AI handle it
      }

      console.log(`🛍️ [Public] Order-related question detected in ${message.channel.id}`);

      // Get ticket channel for this server (dynamic preferred)
      const guildId = message.guild?.id;
      const dynamicTicketParents = dynamicTicketChannelService.getCachedTicketChannels(guildId);
      const ticketChannelId = dynamicTicketParents[0] || null;

      if (!ticketChannelId) {
        console.warn('❌ No dynamic ticket channel configured for server');
        return null;
      }

      // Create redirect message
      const redirectMessage = this.createRedirectMessage(ticketChannelId);

      return {
        type: 'shopify_redirect',
        content: redirectMessage,
        shouldContinueToAI: false, // Don't let AI also respond
        redirectToTicket: true
      };

    } catch (error) {
      console.error('❌ Shopify public integration error:', error);
      return null; // Let normal flow handle it
    }
  }

  /**
   * Create user-friendly redirect message
   */
  createRedirectMessage(ticketChannelId) {
    return `🛍️ **Order Questions**

I'd be happy to help you with your order! For privacy and security, please create a support ticket where I can assist you safely.

👉 **Create a ticket here:** <#${ticketChannelId}>

When you create your ticket, select **"Order Status"** and I'll help you track your order, check shipping details, or answer any order-related questions.

*This keeps your personal information secure! 🔒*`;
  }
}

export default new ShopifyPublicIntegrator();