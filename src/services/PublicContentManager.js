import botRules from '../config/botRules.js';
import constants from '../config/constants.js';

/**
 * Public Content Manager - Handles intelligent content selection and relevance scoring
 * This service works alongside PublicArticleService to provide better content organization
 * without affecting the ticket system.
 */
class PublicContentManager {
  constructor() {
    // Content relevance scoring weights
    this.RELEVANCE_WEIGHTS = {
      TITLE_MATCH: 5,
      EXACT_PHRASE: 4,
      KEYWORD_MATCH: 3,
      CATEGORY_MATCH: 2,
      CONTENT_MATCH: 1
    };

    // Query classification patterns
    this.QUERY_PATTERNS = {
      TROUBLESHOOTING: [
        'problem', 'issue', 'error', 'not working', 'broken', 'fix', 'help',
        'troubleshoot', 'debug', 'issue with', 'problem with', 'error with'
      ],
      SETUP: [
        'setup', 'install', 'configuration', 'getting started', 'first time',
        'how to start', 'how to begin', 'initial setup', 'setup guide'
      ],
      FEATURES: [
        'feature', 'function', 'capability', 'what can', 'how does',
        'can it', 'does it', 'support for', 'available features'
      ],
      FAQ: [
        'what is', 'how do', 'why does', 'when can', 'where is',
        'question', 'faq', 'frequently asked'
      ],
      PRODUCT_SPECIFIC: {
        'earthrover': ['earthrover', 'personal bot', 'individual bot'],
        // Strong signals for EarthRover School so generic questions like
        // "how to test drive" map to the school product instead of personal bots
        'earthrover_school': [
          'earthrover school', 'school', 'test drive', 'testdrive',
          'drive.frodobots.com', 'checkpoint', 'scan checkpoint', 'cones',
          'open-world', 'open world', 'bind your keys', 'bind keys',
          'game controller', 'driving wheel'
        ],
        'ufb': ['ufb', 'ultimate fighting', 'fighting bot', 'battle'],
        'sam': ['sam', 'small autonomous', 'autonomous bot'],
        'robotsfun': ['robots fun', 'fun', 'entertainment', 'games'],
        'telearms': ['telearms', 'remote', 'arm', 'mission', 'score', 'history']
      }
    };

    // Content categories with their relevance keywords
    this.CONTENT_CATEGORIES = {
      getting_started: {
        keywords: ['getting started', 'setup', 'first time', 'beginner', 'installation', 'initial'],
        description: 'Getting started guides and basic setup information',
        priority: 1
      },
      troubleshooting: {
        keywords: ['troubleshoot', 'problem', 'issue', 'error', 'fix', 'help', 'broken', 'not working'],
        description: 'Troubleshooting and problem-solving guides',
        priority: 2
      },
      faq: {
        keywords: ['faq', 'frequently asked', 'question', 'common', 'what is', 'how do'],
        description: 'Frequently asked questions and common queries',
        priority: 3
      },
      earthrover: {
        keywords: ['earthrover', 'personal bot', 'individual', 'personal'],
        description: 'Earthrovers personal bot information and guides',
        priority: 4
      },
      earthrover_school: {
        keywords: ['earthrover school', 'school', 'education', 'learning', 'mission', 'test drive', 'life points', 'LP', 'life point', 'points', 'credits', 'leaderboard'],
        description: 'EarthRover School educational content and tutorials',
        priority: 4
      },
      ufb: {
        keywords: ['ufb', 'ultimate fighting', 'fighting', 'battle', 'combat'],
        description: 'Ultimate Fighting Bots information and guides',
        priority: 4
      },
      sam: {
        keywords: ['sam', 'small autonomous', 'autonomous', 'small'],
        description: 'SAM (Small Autonomous Mofo) information and guides',
        priority: 4
      },
      robotsfun: {
        keywords: ['robots fun', 'fun', 'entertainment', 'games', 'play'],
        description: 'Robots Fun entertainment and gaming content',
        priority: 5
      },
      telearms: {
        keywords: ['telearms', 'tele arms', 'remote', 'arm', 'mission', 'sign up', 'log in', 'login'],
        description: 'TeleArms missions, sign up and login guidance',
        priority: 5
      }
    };
  }

  /**
   * Analyze user query and determine the most relevant content categories
   */
  analyzeQuery(query) {
    const queryLower = query.toLowerCase();
    const analysis = {
      query: query,
      queryType: this._classifyQueryType(queryLower),
      relevantCategories: this._getRelevantCategories(queryLower),
      productMentions: this._extractProductMentions(queryLower),
      urgency: this._assessUrgency(queryLower),
      complexity: this._assessComplexity(queryLower)
    };

    console.log(`🔍 Query Analysis:`, analysis);
    return analysis;
  }

  /**
   * Classify the type of query
   */
  _classifyQueryType(query) {
    for (const [type, patterns] of Object.entries(this.QUERY_PATTERNS)) {
      if (type === 'PRODUCT_SPECIFIC') continue;
      
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          return type.toLowerCase();
        }
      }
    }
    return 'general';
  }

  /**
   * Get relevant content categories based on query
   */
  _getRelevantCategories(query) {
    const categoryScores = {};

    for (const [category, config] of Object.entries(this.CONTENT_CATEGORIES)) {
      let score = 0;

      // Check keyword matches
      for (const keyword of config.keywords) {
        if (query.includes(keyword)) {
          score += this.RELEVANCE_WEIGHTS.KEYWORD_MATCH;
        }
      }

      // Check product-specific patterns
      for (const [product, patterns] of Object.entries(this.QUERY_PATTERNS.PRODUCT_SPECIFIC)) {
        for (const pattern of patterns) {
          if (query.includes(pattern) && category === product) {
            score += this.RELEVANCE_WEIGHTS.CATEGORY_MATCH;
          }
        }
      }

      if (score > 0) {
        categoryScores[category] = {
          score: score,
          priority: config.priority,
          description: config.description
        };
      }
    }

    // Sort by score and priority, return top 3
    return Object.entries(categoryScores)
      .sort(([,a], [,b]) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.priority - b.priority;
      })
      .slice(0, 3)
      .map(([category, data]) => ({
        category: category,
        score: data.score,
        priority: data.priority,
        description: data.description
      }));
  }

  /**
   * Extract product mentions from query
   */
  _extractProductMentions(query) {
    const mentions = [];
    for (const [product, patterns] of Object.entries(this.QUERY_PATTERNS.PRODUCT_SPECIFIC)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          mentions.push(product);
          break;
        }
      }
    }
    return [...new Set(mentions)];
  }

  /**
   * Assess urgency of the query
   */
  _assessUrgency(query) {
    const urgentKeywords = ['urgent', 'emergency', 'broken', 'not working', 'error', 'issue', 'problem'];
    const urgentCount = urgentKeywords.filter(keyword => query.includes(keyword)).length;
    
    if (urgentCount >= 2) return 'high';
    if (urgentCount >= 1) return 'medium';
    return 'low';
  }

  /**
   * Assess complexity of the query
   */
  _assessComplexity(query) {
    const wordCount = query.split(' ').length;
    const hasTechnicalTerms = query.includes('api') || query.includes('config') || query.includes('setup');
    
    if (wordCount > 10 || hasTechnicalTerms) return 'high';
    if (wordCount > 5) return 'medium';
    return 'low';
  }

  /**
   * Score content relevance for a specific query
   */
  scoreContentRelevance(query, content) {
    const queryLower = query.toLowerCase();
    const contentLower = content.content.toLowerCase();
    const titleLower = content.title.toLowerCase();
    
    let score = 0;

    // Title matches get highest weight
    const queryWords = queryLower.split(' ').filter(word => word.length > 2);
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        score += this.RELEVANCE_WEIGHTS.TITLE_MATCH;
      }
    }

    // Exact phrase matches
    if (contentLower.includes(queryLower)) {
      score += this.RELEVANCE_WEIGHTS.EXACT_PHRASE;
    }

    // Content matches
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += this.RELEVANCE_WEIGHTS.CONTENT_MATCH;
      }
    }

    // Category relevance
    if (content.category) {
      const categoryConfig = this.CONTENT_CATEGORIES[content.category];
      if (categoryConfig) {
        for (const keyword of categoryConfig.keywords) {
          if (queryLower.includes(keyword)) {
            score += this.RELEVANCE_WEIGHTS.CATEGORY_MATCH;
          }
        }
      }
    }

    return score;
  }

  /**
   * Select the most relevant content for a query
   */
  selectRelevantContent(query, availableContent, maxTokens = 15000) {
    const analysis = this.analyzeQuery(query);
    const selectedContent = [];
    let totalTokens = 0;

    // Score all available content
    const scoredContent = availableContent.map(content => ({
      ...content,
      relevanceScore: this.scoreContentRelevance(query, content)
    })).sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Select content based on relevance and token limits
    for (const content of scoredContent) {
      const contentTokens = this._estimateTokens(content.content);
      if (totalTokens + contentTokens <= maxTokens) {
        selectedContent.push(content);
        totalTokens += contentTokens;
      } else {
        break;
      }
    }

    // If no content selected, add fallback content
    if (selectedContent.length === 0) {
      const fallbackContent = this._getFallbackContent(availableContent, maxTokens);
      selectedContent.push(...fallbackContent);
    }

    return {
      selectedContent: selectedContent,
      analysis: analysis,
      totalTokens: totalTokens,
      relevanceScores: scoredContent.slice(0, 5).map(c => ({
        title: c.title,
        score: c.relevanceScore,
        category: c.category
      }))
    };
  }

  /**
   * Get fallback content when no specific matches found
   */
  _getFallbackContent(availableContent, maxTokens) {
    const fallbackContent = [];
    let totalTokens = 0;

    // Prioritize getting started, FAQ, and troubleshooting content
    const priorityCategories = ['getting_started', 'faq', 'troubleshooting'];
    
    for (const category of priorityCategories) {
      const categoryContent = availableContent.filter(content => content.category === category);
      for (const content of categoryContent) {
        const contentTokens = this._estimateTokens(content.content);
        if (totalTokens + contentTokens <= maxTokens) {
          fallbackContent.push(content);
          totalTokens += contentTokens;
        } else {
          break;
        }
      }
    }

    return fallbackContent;
  }

  /**
   * Format content for AI consumption
   */
  formatContentForAI(contentSelection, query) {
    if (contentSelection.selectedContent.length === 0) {
      return "No relevant information found. Please ask to talk to team for specific help.";
    }

    // Group by category to enable multi-product answers
    const byCategory = contentSelection.selectedContent.reduce((acc, c) => {
      acc[c.category] = acc[c.category] || [];
      acc[c.category].push(c);
      return acc;
    }, {});

    const formattedSections = Object.entries(byCategory).map(([category, items]) => {
      const header = `### Product: ${category}`;
      const body = items.map(content => `## ${content.title}
URL: ${content.url}

${content.content}

---`).join('\n\n');
      return `${header}\n${body}`;
    });

    const header = `QUERY: "${query}"
ANALYSIS: ${contentSelection.analysis.queryType} query, ${contentSelection.analysis.urgency} urgency, ${contentSelection.analysis.complexity} complexity
RELEVANT CATEGORIES: ${contentSelection.analysis.relevantCategories.map(c => c.category).join(', ')}

RELEVANT INFORMATION:
`;

    return header + formattedSections.join('\n\n');
  }

  /**
   * Estimate tokens for content
   */
  _estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Create enhanced system prompt with query-specific content
   */
  createEnhancedSystemPrompt(query, relevantContent, allowedProducts = [], options = {}) {
    const analysis = this.analyzeQuery(query);
    const multiProduct = Array.isArray(allowedProducts) && allowedProducts.length > 1;
    const allowCrossProduct = options.allowCrossProduct !== false; // default true
    
    return `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server.

USER'S QUERY: "${query}"
QUERY TYPE: ${analysis.queryType}
URGENCY: ${analysis.urgency}
COMPLEXITY: ${analysis.complexity}
RELEVANT CATEGORIES: ${analysis.relevantCategories.map(c => c.category).join(', ')}

RELEVANT INFORMATION:
${relevantContent}

INSTRUCTIONS:
- Answer the user's question based STRICTLY ONLY on the relevant information provided above
- PRIORITY: If there's information in "CHANNEL-SPECIFIC DOCUMENTATION", prioritize that over "GENERAL KNOWLEDGE BASE" content
- CRITICAL: DO NOT use any external knowledge, training data, or assumptions about FrodoBots, Earth Rovers School, UFB, SAM, or any FrodoBots products
- If the information doesn't cover their specific question, first ask 1-2 brief clarifying questions (e.g., exact goal, steps taken, any error). If still unclear and the channel allows multiple products, then ask which product. Only if after clarification the info still isn't covered, then say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- FORBIDDEN: Never make up or infer details about FrodoBots products, even if you think you know them from training data
- Be friendly, conversational, and helpful
- Keep responses concise - prioritize brevity over completeness
- If you need more context, ask the user to clarify their question
- ${multiProduct ? 'IMPORTANT: If the question is unclear or could apply to multiple products, ask: "Which product is this about?" Options: ' + allowedProducts.join(', ') + '.' : 'Always maintain conversation context and refer to previous messages when relevant'}
${multiProduct ? '' : '- Always maintain conversation context and refer to previous messages when relevant'}
      
Response formatting:
- Start with the direct answer immediately
- Use simple, natural language
- Only use formatting (bold, lists, steps) when absolutely necessary
- Keep responses as short as possible while being helpful

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can ask to "talk to team" right here in Discord
      
CRITICAL INSTRUCTIONS:
1. Focus on answering the specific question: "${query}"
2. Use ONLY the relevant information provided above
3. ${allowCrossProduct ? 'Do NOT ask the user to switch products or click buttons; answer directly using the relevant information above, even if multiple products are possible.' : 'If multiple products are possible, ask the user which product they mean.'}
4. If the information doesn't cover the question after clarification, be honest and suggest talking to team
5. Be conversational and maintain context throughout the conversation
6. DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
7. DO NOT add generic closing statements - end responses naturally
8. For technical questions not covered in the provided information, say "I don't have specific information about that. You can ask to talk to team for more detailed help."

Remember: Provide accurate, helpful information based on the relevant content provided. When users need additional support, remind them they can ask to "talk to team" right here in Discord.`;
  }
}

export default PublicContentManager; 