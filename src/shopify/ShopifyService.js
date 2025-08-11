import Shopify from 'shopify-api-node';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ShopifyService - Shopify API integration using shopify-api-node
 * 
 * This service provides clean access to Shopify order data with:
 * - Automatic authentication handling via shopify-api-node
 * - Simple order lookup by number and email
 * - Proper error handling and debugging
 */
class ShopifyService {
  constructor() {
    this.shopify = null;
    this.isConfigured = false;
    this.debug = process.env.SHOPIFY_DEBUG === 'true';

    this._initialize();
  }

  /**
   * Initialize Shopify client
   */
  _initialize() {
    const shopName = process.env.SHOPIFY_SHOP_NAME;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    // Validate required credentials
    if (!shopName || !accessToken) {
      console.error('❌ [SHOPIFY] Missing required environment variables: SHOPIFY_SHOP_NAME and SHOPIFY_ACCESS_TOKEN');
      this.isConfigured = false;
      return;
    }

    try {
      this.shopify = new Shopify({
        shopName: shopName,
        accessToken: accessToken,
      });
      this.isConfigured = true;
      if (this.debug) {
        console.log(`🛍️ [SHOPIFY] Connected to ${shopName}.myshopify.com`);
      }
    } catch (error) {
      console.error('❌ [SHOPIFY] Initialization failed:', error.message);
      this.isConfigured = false;
    }
  }

  /**
   * Get order status by order number
   */
  async getOrderByNumber(orderNumber) {
    if (!this.isConfigured) {
      return { success: false, error: 'Shopify not configured' };
    }

    if (this.debug) {
      console.log(`🔎 [SHOPIFY] Getting order: ${orderNumber}`);
    }

    try {
      // Clean order number (remove # if present)
      const cleanNumber = orderNumber.replace('#', '');
      
      // Search for order by name (order number)
      const orders = await this.shopify.order.list({
        status: 'any',
        name: cleanNumber,
        limit: 1
      });

      if (!orders || orders.length === 0) {
        return { success: false, error: 'Order not found' };
      }

      return { success: true, order: orders[0] };
    } catch (error) {
      console.error('❌ [SHOPIFY] Order lookup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get orders by customer email
   */
  async getOrdersByEmail(email) {
    if (!this.isConfigured) {
      return { success: false, error: 'Shopify not configured' };
    }

    if (this.debug) {
      console.log(`📧 [SHOPIFY] Getting orders for: ${email}`);
    }

    try {
      const orders = await this.shopify.order.list({
        status: 'any',
        email: email,
        limit: 10
      });

      return { success: true, orders: orders || [] };
    } catch (error) {
      console.error('❌ [SHOPIFY] Email lookup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify order ownership (order number + email)
   */
  async verifyOrderOwnership(orderNumber, email) {
    if (this.debug) {
      console.log(`🔐 [SHOPIFY] Verifying order ${orderNumber} for ${email}`);
    }

    // Get order by number
    const orderResult = await this.getOrderByNumber(orderNumber);
    if (!orderResult.success) {
      return { success: false, error: 'Order not found' };
    }

    // Check if email matches
    const order = orderResult.order;
    if (order.email.toLowerCase() !== email.toLowerCase()) {
      return { success: false, error: 'Email does not match order' };
    }

    return { success: true, order: order };
  }

  /**
   * Test connection to Shopify
   */
  async testConnection() {
    if (!this.isConfigured) {
      return { success: false, error: 'Shopify not configured' };
    }

    try {
      const shop = await this.shopify.shop.get();
      return { success: true, shop: shop.name };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if service is properly configured
   */
  isServiceConfigured() {
    return this.isConfigured;
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      configured: this.isConfigured,
      debug: this.debug
    };
  }

}

export default new ShopifyService(); 
