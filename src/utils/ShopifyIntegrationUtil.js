import shopifyIntegrator from '../shopify/ShopifyIntegrator.js';

/**
 * Utility for handling Shopify integration patterns consistently
 */
class ShopifyIntegrationUtil {
  /**
   * Handle Shopify integration for messages with consistent error handling
   * @param {Object} message - Discord message object
   * @param {string} context - Context string ('public', 'ticket', etc.)
   * @param {Object} ticketState - Optional ticket state for ticket contexts
   * @returns {Object|null} Shopify response or null
   */
  static async handleMessage(message, context, ticketState = null) {
    try {
      let shopifyResponse;
      
      switch (context) {
        case 'public':
          shopifyResponse = await shopifyIntegrator.handlePublicMessage(message);
          break;
        case 'ticket':
          shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
          break;
        default:
          console.warn(`Unknown Shopify context: ${context}`);
          return null;
      }

      if (shopifyResponse) {
        console.log(`🛍️ Shopify handled ${context} message`);
        return shopifyResponse;
      }
      
      return null;
    } catch (shopifyError) {
      console.error(`❌ Shopify integration error in ${context} (continuing to AI):`, shopifyError.message);
      return null;
    }
  }

  /**
   * Send Shopify response with consistent formatting
   * @param {Object} message - Discord message object
   * @param {Object} shopifyResponse - Shopify response object
   * @param {Object} targetChannel - Optional target channel (for threads)
   * @returns {Promise<void>}
   */
  static async sendResponse(message, shopifyResponse, targetChannel = null) {
    const messageOptions = { 
      content: shopifyResponse.content, 
      flags: ['SuppressEmbeds'] 
    };

    // Add components if provided
    if (shopifyResponse.components) {
      messageOptions.components = shopifyResponse.components;
    }

    if (targetChannel) {
      await targetChannel.send(messageOptions);
    } else {
      await message.reply(messageOptions);
    }
  }

  /**
   * Check if Shopify should continue to AI or stop processing
   * @param {Object} shopifyResponse - Shopify response object
   * @returns {boolean} True if should continue to AI
   */
  static shouldContinueToAI(shopifyResponse) {
    return shopifyResponse && shopifyResponse.shouldContinueToAI;
  }

  /**
   * Check if response fully handled the query
   * @param {Object} shopifyResponse - Shopify response object
   * @returns {boolean} True if fully handled
   */
  static isFullyHandled(shopifyResponse) {
    return shopifyResponse && !shopifyResponse.shouldContinueToAI;
  }
}

export default ShopifyIntegrationUtil;
