/**
 * ShopifyOrderDetector - Simplified order-related message detection
 * 
 * This service provides simple order detection using:
 * - Basic keyword matching for common order terms
 * - Order number pattern recognition
 * - Email extraction from messages
 * - AI-powered detection as fallback (if available)
 */
class ShopifyOrderDetector {
  constructor() {
    this.aiService = null;
    
    // Common order-related keywords
    this.ORDER_KEYWORDS = [
      'order', 'orders', 'purchase', 'bought', 'tracking',
      'shipment', 'delivery', 'status', 'refund', 'return'
    ];

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
   * Check if message is order-related
   */
  async isOrderRelated(message) {
    const content = this._extractContent(message);
    
    // Skip very short messages
    if (content.length <= 3) {
      return false;
    }

    // Basic keyword and pattern check
    const hasOrderKeyword = this._hasOrderKeywords(content);
    const hasOrderNumber = this._hasOrderNumber(content);

    // If we have clear indicators, return true
    if (hasOrderKeyword || hasOrderNumber) {
      return true;
    }

    // Use AI as fallback if available
    if (this.aiService) {
      return await this._checkWithAI(content);
    }

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
      hasOrderKeywords: this._hasOrderKeywords(content),
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
   * Check for order-related keywords
   */
  _hasOrderKeywords(content) {
    const lowerContent = content.toLowerCase();
    return this.ORDER_KEYWORDS.some(keyword => 
      lowerContent.includes(keyword)
    );
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
   * Use AI to detect order-related content (fallback)
   */
  async _checkWithAI(content) {
    if (!this.aiService) {
      return false;
    }

    try {
      const prompt = `Is this message asking about an order, purchase, shipping, or delivery? Reply only "yes" or "no".

Message: "${content}"`;

      const response = await this.aiService.generateResponse([
        { role: 'user', content: prompt }
      ]);

      // AIService returns an object with {isValid, response, confidence}
      if (response && response.isValid && typeof response.response === 'string') {
        return response.response.toLowerCase().includes('yes');
      }
      return false;
    } catch (error) {
      console.error('❌ AI order detection failed:', error.message);
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