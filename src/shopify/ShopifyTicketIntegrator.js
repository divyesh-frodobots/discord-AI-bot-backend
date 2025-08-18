import shopifyService from './ShopifyService.js';
import shopifyOrderDetector from './ShopifyOrderDetector.js';
import { getServerConfig, getServerFallbackResponse } from '../config/serverConfigs.js';

/**
 * ShopifyTicketIntegrator - Simplified ticket channel integration
 * 
 * Ticket Channel Flow:
 * 1. User clicks "Order Status" button
 * 2. Bot asks for order details
 * 3. User provides order number + email
 * 4. Bot looks up and returns order information
 * Simple and clean!
 */
class ShopifyTicketIntegrator {
  constructor() {
    // Keep it simple
  }

  /**
   * Process message in ticket channel
   */
  async processTicketMessage(message, ticketState) {
    // Only process if Shopify is configured
    if (!shopifyService.isServiceConfigured()) {
      return null;
    }

    // Only handle Order Status category
    if (ticketState?.category !== 'category_orders') {
      return null;
    }

    try {
      // Check if user is directly asking for human support
      if (this._isRequestingHumanSupport(message.content)) {
        return this._handleHumanSupportRequest(message, ticketState);
      }

      // Analyze the message for order lookup
      const analysis = await shopifyOrderDetector.analyzeMessage(message);
      
      // Check if we have both order number and email
      const hasOrderNumber = analysis.orderNumbers && analysis.orderNumbers.length > 0;
      const hasEmail = analysis.emails && analysis.emails.length > 0;

      // If user has already seen order details and this is NOT a new lookup attempt, escalate
      if (ticketState?.orderDetailsShown && (!hasOrderNumber || !hasEmail)) {
        return this._handleOrderFollowUp(message, ticketState);
      }

      if (!hasOrderNumber || !hasEmail) {
        return {
          type: 'shopify_prompt',
          content: this._getPromptMessage(hasOrderNumber, hasEmail, analysis),
          shouldContinueToAI: false
        };
      }

      // We have both - look up the order
      const orderNumber = analysis.orderNumbers[0];
      const email = analysis.emails[0];

      const result = await this._lookupOrder(orderNumber, email);
      
      // Only mark order details as shown if lookup was SUCCESSFUL
      if (result.content && !result.content.includes('❌')) {
        result.updateTicketState = {
          orderDetailsShown: true,
          lastOrderNumber: orderNumber,
          lastOrderEmail: email
        };
      }
      
      return {
        type: 'shopify_response',
        content: result.content,
        shouldContinueToAI: false,
        updateTicketState: result.updateTicketState
      };

    } catch (error) {
      console.error('❌ Shopify ticket integration error:', error);
      return {
        type: 'shopify_error',
        content: '❌ Sorry, I encountered an error while looking up your order. Please try again or contact our support team.',
        shouldContinueToAI: false
      };
    }
  }

  /**
   * Handle follow-up questions after order details have been shown
   */
  _handleOrderFollowUp(message, ticketState) {
    const orderNumber = ticketState.lastOrderNumber || 'your order';
    
    // Get customer support tags from server config
    const supportTags = this._getCustomerSupportTags(message.guild?.id);
    
    return {
      type: 'shopify_escalation',
      content: `We've received your follow-up on order #${orderNumber}. ${supportTags} will get back to you with this.

**Support Hours:** Mon-Fri, 10am-6pm SGT

**Order Number:** ${orderNumber}
**Email:** ${ticketState.lastOrderEmail || 'Not specified'} (edited)`,
      shouldContinueToAI: false,
      escalateToSupport: true
    };
  }

  /**
   * Create prompt message asking for missing information
   */
  _getPromptMessage(hasOrderNumber, hasEmail, analysis) {
    if (!hasOrderNumber && !hasEmail) {
      return `📦 **Order Status Lookup**

To check your order status, I need both pieces of information:

**Order Number:** (e.g., #1234 or 1234)
📧 **Email Address:** The email you used when placing the order

**Example:** "Check order #1234 for email@example.com"

Please provide both to continue! 🔒`;
    }

    if (!hasOrderNumber) {
      return `📦 **Order Number Needed**

I see you provided an email address, but I also need your order number.

**Order Number:** (e.g., #1234 or 1234)

Please provide your order number to continue!`;
    }

    if (!hasEmail) {
      return `📧 **Email Address Needed**

I see you provided an order number (${analysis.orderNumbers[0]}), but I also need the email address you used for this order.

📧 **Email Address:** The email you used when placing the order

Please provide your email to continue!`;
    }

    return `Please provide both your order number and email address.`;
  }

  /**
   * Look up order using the new simplified service
   */
  async _lookupOrder(orderNumber, email) {
    console.log(`🔍 [Ticket] Looking up order ${orderNumber} for ${email}`);

    // Verify order ownership
    const verifyResult = await shopifyService.verifyOrderOwnership(orderNumber, email);
    
    if (!verifyResult.success) {
      if (verifyResult.error === 'Order not found') {
        return {
          content: `❌ **Order Not Found**

I couldn't find order #${orderNumber}. Please check:
- The order number is correct
- The order was placed with us
- Try without the # symbol if you included it

If you're still having trouble, please contact our support team.`
        };
      }

      if (verifyResult.error === 'Email does not match order') {
        return {
          content: `❌ **Email Verification Failed**

The email address doesn't match the one used for order #${orderNumber}. 

Please double-check:
- The email address is spelled correctly
- You're using the same email that was used to place the order

For security, I can only show order details to the email address associated with the purchase.`
        };
      }

      return {
        content: `❌ **Lookup Error**

I couldn't verify order #${orderNumber}: ${verifyResult.error}

Please try again or contact our support team.`
      };
    }

    // Success! Format and return order details
    return this._formatOrderDetails(verifyResult.order);
  }

  /**
   * Format order details for display
   */
  _formatOrderDetails(order) {
    const orderNumber = order.name || order.id;
    const status = this._getStatusDisplay(order);
    const items = this._formatLineItems(order.line_items || []);
    const shipping = this._formatShippingInfo(order);
    const trackingInfo = this._getTrackingDisplay(order);

    let content = `**Order ${orderNumber} Details**

**Status:** ${status}
**Total:** ${order.currency || 'USD'} ${order.current_total_price || order.total_price || '0.00'}
**Placed:** ${this._formatDate(order.created_at)}`;

    if (trackingInfo) {
      content += `\n**Track order:** ${trackingInfo}`;
    }

    content += `

**Items:**
${items}`;

    if (shipping) {
      content += `\n**Shipping Address:**\n${shipping}`;
    }

    content += `\n\n💬 **Have questions about this order?**\nJust ask your question and our support team will help you directly!`;

    return { content };
  }

  /**
   * Get user-friendly status display
   */
  _getStatusDisplay(order) {
    const financial = order.financial_status || 'unknown';
    const fulfillment = order.fulfillment_status || 'unfulfilled';

    if (fulfillment === 'fulfilled') {
      return '**Shipped** - Your order has been sent';
    }

    if (fulfillment === 'partial') {
      return '**Partially Shipped** - Some items have been sent';
    }

    if (financial === 'paid') {
      return '**Processing** - Payment received, preparing to ship';
    }

    if (financial === 'pending') {
      return '**Payment Pending** - Waiting for payment confirmation';  
    }

    return `📋 ${financial} / ${fulfillment}`;
  }

  /**
   * Format line items list
   */
  _formatLineItems(lineItems) {
    if (!lineItems || lineItems.length === 0) {
      return 'No items found';
    }

    return lineItems.map(item => 
      `- ${item.quantity}x ${item.name} - ${item.currency || 'USD'} ${item.price}`
    ).join('\n');
  }

  /**
   * Get tracking number display with clickable links
   */
  _getTrackingDisplay(order) {
    const trackingNumbers = [];
    
    // Extract tracking numbers from fulfillments
    if (order.fulfillments && order.fulfillments.length > 0) {
      order.fulfillments.forEach(fulfillment => {
        if (fulfillment.tracking_numbers && fulfillment.tracking_numbers.length > 0) {
          trackingNumbers.push(...fulfillment.tracking_numbers);
        }
        // Also check for tracking_number (singular) field
        if (fulfillment.tracking_number) {
          trackingNumbers.push(fulfillment.tracking_number);
        }
      });
    }
    
    // Remove duplicates
    const uniqueTrackingNumbers = [...new Set(trackingNumbers)];
    
    if (uniqueTrackingNumbers.length === 0) {
      return null;
    }
    
    // Convert tracking numbers to clickable links
    const trackingLinks = uniqueTrackingNumbers.map(trackingNumber => {
      return `[${trackingNumber}](https://shop.frodobots.com/a/Tracking?nums=${trackingNumber})`;
    });
    
    return trackingLinks.join(', ');
  }

  /**
   * Format shipping information
   */
  _formatShippingInfo(order) {
    const shipping = [];

    // Shipping address
    if (order.shipping_address) {
      const addr = order.shipping_address;
      shipping.push(`${addr.name || ''}`);
      shipping.push(`${addr.address1 || ''}`);
      if (addr.city) shipping.push(`${addr.city}, ${addr.zip || ''}`);
      if (addr.country) shipping.push(`${addr.country}`);
    }

    return shipping.join('\n');
  }

  /**
   * Format date for display
   */
  _formatDate(dateString) {
    if (!dateString) return 'Unknown';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Get customer support tags for the server
   */
  _getCustomerSupportTags(guildId) {
    const serverConfig = getServerConfig(guildId);
    
    // Use the existing support team role ID from server config
    if (serverConfig?.supportTeamRoleId) {
      return `<@&${serverConfig.supportTeamRoleId}>`;
    }

    // Check if server has custom customer support tags
    if (serverConfig?.customerSupportTags) {
      return serverConfig.customerSupportTags;
    }

    // Fallback for unknown servers
    return '@CustomerSupport';
  }

  /**
   * Check if user is requesting human support
   */
  _isRequestingHumanSupport(content) {
    const humanRequestKeywords = [
      'talk to human', 'speak to human', 'human support', 'talk to support',
      'speak to support', 'customer support', 'contact support', 'help from human',
      'talk to agent', 'speak to agent', 'live support', 'real person',
      'human help', 'person help', 'staff help', 'team help'
    ];

    const lowerContent = content.toLowerCase();
    return humanRequestKeywords.some(keyword => lowerContent.includes(keyword));
  }

  /**
   * Handle direct human support requests
   */
  _handleHumanSupportRequest(message, ticketState) {
    // Use the standardized fallback response
    const fallbackResponse = getServerFallbackResponse(message.guild?.id);
    
    return {
      type: 'shopify_escalation',
      content: fallbackResponse,
      shouldContinueToAI: false,
      escalateToSupport: true
    };
  }
}

export default new ShopifyTicketIntegrator();