const fs = require('fs');
const path = require('path');

class PromptLoader {
  constructor() {
    this.prompts = {};
    this.loaded = false;
    this.promptsPath = path.join(__dirname);
  }

  // Load all prompt files dynamically
  async loadPrompts() {
    if (this.loaded) {
      return this.prompts;
    }

    try {
      const files = fs.readdirSync(this.promptsPath);
      
      for (const file of files) {
        if (file.endsWith('-prompt.js') && file !== 'promptLoader.js') {
          const productKey = file.replace('-prompt.js', '');
          const promptPath = path.join(this.promptsPath, file);
          
          try {
            const promptModule = require(promptPath);
            this.prompts[productKey] = promptModule;
            console.log(`✅ Loaded prompt for: ${promptModule.name} (${productKey})`);
          } catch (error) {
            console.error(`❌ Failed to load prompt ${file}:`, error.message);
          }
        }
      }

      this.loaded = true;
      console.log(`📚 Loaded ${Object.keys(this.prompts).length} prompt files`);
      return this.prompts;
    } catch (error) {
      console.error('Error loading prompts:', error);
      throw error;
    }
  }

  // Get a specific prompt by product key
  getPrompt(productKey) {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }
    return this.prompts[productKey] || this.prompts['general'];
  }

  // Detect product from user message
  detectProduct(message) {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }

    const messageLower = message.toLowerCase();
    let bestMatch = 'general';
    let highestScore = 0;

    for (const [productKey, prompt] of Object.entries(this.prompts)) {
      if (productKey === 'general') continue;

      let score = 0;
      for (const keyword of prompt.keywords) {
        if (messageLower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = productKey;
      }
    }

    return bestMatch;
  }

  // Get all available products
  getAvailableProducts() {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }

    const products = {};
    for (const [key, prompt] of Object.entries(this.prompts)) {
      if (key !== 'general') {
        products[key] = {
          name: prompt.name,
          shortName: prompt.shortName,
          description: prompt.description
        };
      }
    }
    return products;
  }

  // Get all keywords for debugging
  getAllKeywords() {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }

    const allKeywords = {};
    for (const [productKey, prompt] of Object.entries(this.prompts)) {
      allKeywords[productKey] = prompt.keywords;
    }
    return allKeywords;
  }

  // Test product detection with sample messages
  testDetection(sampleMessages = []) {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }

    const results = [];
    for (const message of sampleMessages) {
      const detected = this.detectProduct(message);
      const prompt = this.getPrompt(detected);
      
      results.push({
        message,
        detectedProduct: detected,
        productName: prompt.name,
        confidence: this.calculateDetectionConfidence(message, detected)
      });
    }
    return results;
  }

  // Calculate detection confidence
  calculateDetectionConfidence(message, productKey) {
    const prompt = this.getPrompt(productKey);
    const messageLower = message.toLowerCase();
    
    let matches = 0;
    for (const keyword of prompt.keywords) {
      if (messageLower.includes(keyword.toLowerCase())) {
        matches += 1;
      }
    }
    
    return Math.min(1, matches / Math.max(1, prompt.keywords.length * 0.3));
  }

  // Get common questions for a product
  getCommonQuestions(productKey) {
    const prompt = this.getPrompt(productKey);
    return prompt.commonQuestions || {};
  }

  // Get features for a product
  getFeatures(productKey) {
    const prompt = this.getPrompt(productKey);
    return prompt.features || {};
  }

  // Get error responses for a product
  getErrorResponses(productKey) {
    const prompt = this.getPrompt(productKey);
    return prompt.errorResponses || {};
  }

  // Reload prompts (useful for development)
  async reloadPrompts() {
    this.prompts = {};
    this.loaded = false;
    return await this.loadPrompts();
  }

  // Get prompt statistics
  getStats() {
    if (!this.loaded) {
      throw new Error('Prompts not loaded. Call loadPrompts() first.');
    }

    const stats = {
      totalPrompts: Object.keys(this.prompts).length,
      products: {},
      totalKeywords: 0
    };

    for (const [productKey, prompt] of Object.entries(this.prompts)) {
      stats.products[productKey] = {
        name: prompt.name,
        keywords: prompt.keywords.length,
        hasCommonQuestions: !!prompt.commonQuestions,
        hasFeatures: !!prompt.features,
        hasErrorResponses: !!prompt.errorResponses
      };
      stats.totalKeywords += prompt.keywords.length;
    }

    return stats;
  }
}

// Create singleton instance
const promptLoader = new PromptLoader();

module.exports = promptLoader; 