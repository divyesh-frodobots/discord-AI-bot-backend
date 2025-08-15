/**
 * ShopifyOrderDetector - AI-powered order intent detection
 * 
 * This service uses AI to intelligently determine if a message is asking about:
 * - Order status, tracking, or shipping updates
 * - Returns, refunds, or order modifications
 * - Purchase-related account issues
 * 
 * It differentiates between order inquiries and product support questions.
 */
class ShopifyOrderDetector {
  constructor() {
    this.aiService = null;

    // Order number patterns (4+ digits, often with #)
    this.ORDER_PATTERNS = [
      /#?\d{4,}/g,           // #1234 or 1234
      /order\s*#?\s*\d+/gi,  // "order #1234" or "order 1234"
    ];

    // Email pattern
    this.EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  }

  /**
   * Set AI service for advanced detection
   */
  setAIService(aiService) {
    this.aiService = aiService;
  }

  /**
   * Check if message is order-related using AI intent analysis
   */
  async isOrderRelated(message) {
    const content = this._extractContent(message);
    
    // Skip very short messages
    if (content.length <= 3) {
      return false;
    }

    // First check for obvious order numbers - if present, likely order-related
    if (this._hasOrderNumber(content)) {
      return true;
    }

    // Use AI to analyze intent (primary method)
    if (this.aiService) {
      return await this._analyzeIntentWithAI(content);
    }

    // Fallback: no AI available, be conservative
    return false;
  }

  /**
   * Analyze message and extract order-related information
   */
  async analyzeMessage(message) {
    const content = this._extractContent(message);
    
    const analysis = {
      isOrderRelated: await this.isOrderRelated(message),
      orderNumbers: this._extractOrderNumbers(content),
      emails: this._extractEmails(content),
      content: content
    };

    return analysis;
  }

  /**
   * Extract content from message (string or Discord message object)
   */
  _extractContent(message) {
    if (typeof message === 'string') {
      return message;
    }
    
    if (message && message.content) {
      // Remove Discord mentions and clean up
      return message.content
        .replace(/<@!?\d+>/g, '') // Remove user mentions
        .replace(/<#\d+>/g, '')   // Remove channel mentions
        .replace(/<:\w+:\d+>/g, '') // Remove custom emojis
        .trim();
    }
    
    return '';
  }



  /**
   * Check for order number patterns
   */
  _hasOrderNumber(content) {
    return this.ORDER_PATTERNS.some(pattern => pattern.test(content));
  }

  /**
   * Extract order numbers from content
   */
  _extractOrderNumbers(content) {
    const numbers = [];
    
    this.ORDER_PATTERNS.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Clean up the number (remove # and non-digits)
          const cleanNumber = match.replace(/[^0-9]/g, '');
          if (cleanNumber.length >= 4) {
            numbers.push(cleanNumber);
          }
        });
      }
    });

    return [...new Set(numbers)]; // Remove duplicates
  }

  /**
   * Extract email addresses from content
   */
  _extractEmails(content) {
    const matches = content.match(this.EMAIL_PATTERN);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Use AI to analyze user intent and determine if it's truly an order inquiry
   */
  async _analyzeIntentWithAI(content) {
    if (!this.aiService) {
      return false;
    }

    try {
      const prompt = `Analyze this user message and determine if they are asking about an EXISTING ORDER they already placed.

DO NOT classify as order-related if they are asking about:
- Where to buy or how to purchase (pre-purchase questions)
- Product setup, installation, or activation
- How to use a product they received
- Unboxing instructions
- Technical support for a product
- Product features or troubleshooting
- General product information or pricing

ONLY classify as order-related if they have an EXISTING ORDER and want to:
- Check order status or tracking of a placed order
- Modify, cancel, or return an existing order
- Get refund for an existing order
- Report shipping/delivery problems with a placed order
- Ask about billing issues with an existing order

Reply only "ORDER" if it's about an existing order, or "GENERAL" if it's anything else.

Message: "${content}"`;

      const response = await this.aiService.generateResponse([
        { role: 'user', content: prompt }
      ]);

      // AIService returns an object with {isValid, response, confidence}
      if (response && response.isValid && typeof response.response === 'string') {
        const answer = response.response.toUpperCase().trim();
        return answer.includes('ORDER');
      }
      return false;
    } catch (error) {
      console.error('❌ AI intent analysis failed:', error.message);
      return false;
    }
  }

  /**
   * Get suggested response type based on analysis
   */
  getSuggestedResponseType(analysis) {
    if (analysis.orderNumbers.length > 0 && analysis.emails.length > 0) {
      return 'lookup'; // Can do direct lookup
    }
    
    if (analysis.orderNumbers.length > 0 || analysis.emails.length > 0) {
      return 'partial'; // Need more info
    }
    
    return 'general'; // General order help
  }
}

export default new ShopifyOrderDetector();