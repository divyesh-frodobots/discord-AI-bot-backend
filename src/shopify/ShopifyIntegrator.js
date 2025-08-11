import shopifyService from './ShopifyService.js';
import shopifyOrderDetector from './ShopifyOrderDetector.js';
import shopifyPublicIntegrator from './ShopifyPublicIntegrator.js';
import shopifyTicketIntegrator from './ShopifyTicketIntegrator.js';

/**
 * ShopifyIntegrator - Main hub for Shopify integration
 * 
 * This simplified integrator provides:
 * - Easy integration points for bot.js and services
 * - Routing to appropriate channel-specific integrators
 * - Status and health checks
 * - Clean API for different channel types
 */
class ShopifyIntegrator {
  constructor() {
    this.isEnabled = shopifyService.isServiceConfigured();
  }

  /**
   * Set AI service for advanced order detection
   */
  setAIService(aiService) {
    shopifyOrderDetector.setAIService(aiService);
  }

  /**
   * Main message processor - routes to appropriate integrator
   */
  async processMessage(message, context = {}) {
    if (!this.isEnabled) {
      return null;
    }

    // Determine channel type from context
    const channelType = this._determineChannelType(message, context);
    
    switch (channelType) {
      case 'ticket':
        return await shopifyTicketIntegrator.processTicketMessage(message, context.ticketState);
        
      case 'public':
        return await shopifyPublicIntegrator.processPublicMessage(message);
        
      default:
        return null;
    }
  }

  /**
   * Easy integration for ticket channels
   */
  async handleTicketMessage(message, ticketState) {
    return await shopifyTicketIntegrator.processTicketMessage(message, ticketState);
  }

  /**
   * Easy integration for public channels
   */
  async handlePublicMessage(message) {
    return await shopifyPublicIntegrator.processPublicMessage(message);
  }

  /**
   * Check if message is order-related (for any channel)
   */
  async isOrderRelated(message) {
    if (!this.isEnabled) {
      return false;
    }
    
    return await shopifyOrderDetector.isOrderRelated(message);
  }

  /**
   * Analyze message for order content (for any channel)
   */
  async analyzeMessage(message) {
    if (!this.isEnabled) {
      return { isOrderRelated: false };
    }
    
    return await shopifyOrderDetector.analyzeMessage(message);
  }

  /**
   * Check if message should be routed to private channel
   * (Used by public channels to decide on redirect)
   */
  async shouldRecommendPrivateChannel(message) {
    if (!this.isEnabled) {
      return false;
    }
    
    // Any order-related question in public should go to ticket
    return await shopifyOrderDetector.isOrderRelated(message);
  }

  /**
   * Test the Shopify integration
   */
  async testIntegration() {
    if (!this.isEnabled) {
      return { success: false, error: 'Shopify not configured' };
    }
    
    return await shopifyService.testConnection();
  }

  /**
   * Get integration status
   */
  getStatus() {
    const serviceStatus = shopifyService.getStatus();
    
    return {
      enabled: this.isEnabled,
      service: serviceStatus,
      components: {
        service: '✅ ShopifyService (shopify-api-node)',
        detector: '✅ ShopifyOrderDetector (simplified)',
        publicIntegrator: '✅ ShopifyPublicIntegrator (redirect only)',
        ticketIntegrator: '✅ ShopifyTicketIntegrator (lookup)',
      }
    };
  }

  /**
   * Determine channel type from message and context
   */
  _determineChannelType(message, context) {
    // Check if it's a ticket channel (thread in ticket parent)
    if (message.channel?.isThread && message.channel.isThread()) {
      return 'ticket';
    }
    
    // Check from context
    if (context.channelType) {
      return context.channelType;
    }
    
    // Default to public
    return 'public';
  }
}

export default new ShopifyIntegrator();