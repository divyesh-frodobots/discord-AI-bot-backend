import axios from "axios";
import * as cheerio from 'cheerio';
import { buildHumanHelpPrompt } from './ArticleService.js';
import embeddingService from './EmbeddingService.js';

class PublicArticleService {
  constructor() {
    this.cachedContent = null; // Cache the combined content
    this.lastContentFetch = 0;

    // NEW: Structured content storage
    this.categorizedContent = {};

    // Configuration
    this.REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    this.MAX_TOKENS = 40000;
    this.CONTENT_CACHE_DURATION = this.REFRESH_INTERVAL;

    // Allow disabling crawling via env
    this.DISABLE_CRAWL = process.env.DISABLE_PUBLIC_ARTICLE_CRAWL === 'true';

    // NEW: Configurable limits for category article fetching
    this.CATEGORY_ARTICLE_LIMIT = parseInt(process.env.PUBLIC_CATEGORY_ARTICLE_LIMIT || '100', 10);
    this.FETCH_CONCURRENCY = parseInt(process.env.PUBLIC_FETCH_CONCURRENCY || '4', 10);

    // NEW: Organized category URLs with better structure
    this.CATEGORY_CONFIG = {
      getting_started: {
        url: "https://intercom.help/frodobots/en/collections/3762588-getting-started",
        keywords: ["start", "begin", "first steps", "setup"],
        description: "Getting started guides and onboarding tutorials"
      },
      earthrover_school: {
        url: "https://intercom.help/frodobots/en/collections/3762589-earthrovers-school",
        keywords: ["earthrover", "school", "education", "learning", "students", "life points", "LP", "life point", "points", "credits", "mission", "test drive", "leaderboard"],
        description: "EarthRovers School content, educational resources and tutorials"
      },
      earthrover: {
        url: "https://intercom.help/frodobots/en/collections/9174353-earthrovers-personal-bots",
        keywords: ["earthrover", "personal", "bot", "robot", "device", "hardware"],
        description: "Personal EarthRovers features, usage and configuration"
      },
      ufb: {
        url: "https://intercom.help/frodobots/en/collections/12076791-ufb-ultimate-fighting-bots",
        keywords: ["ufb", "fighting", "competition", "bots", "ultimate"],
        description: "Ultimate Fighting Bots competition, rules and guides"
      },
      sam: {
        url: "https://intercom.help/frodobots/en/collections/13197832-sam-small-autonomous-mofo",
        keywords: ["sam", "autonomous", "ai", "robot"],
        description: "SAM product information and support"
      },
      robotsfun: {
        url: "https://intercom.help/frodobots/en/collections/13197811-robots-fun",
        keywords: ["robots.fun", "robots", "fun", "platform"],
        description: "Robots.fun platform usage and account management"
      },
      et_fugi: {
        url: "https://intercom.help/frodobots/en/articles/11561671-et-fugi-ai-competition",
        keywords: ["et fugi", "ai competition", "competition", "ai"],
        description: "ET Fugi AI competition information"
      },
      telearms: {
        url: "https://intercom.help/frodobots/en/collections/16593994-telearms",
        keywords: ["telearms", "tele arms", "remote", "arm", "mission", "sign up", "log in", "login"],
        description: "TeleArms missions, sign up and login guidance, TeleArms mission history, score"
      },
      troubleshooting: {
        url: "https://intercom.help/frodobots/en/collections/3762588-getting-started",
        keywords: ["troubleshoot", "problem", "issue", "error", "fix", "help"],
        description: "Troubleshooting and problem-solving guides"
      },
      faq: {
        url: "https://intercom.help/frodobots/en/",
        keywords: ["faq", "frequently asked", "question", "common"],
        description: "Frequently asked questions and common queries"
      }
    };
    
    this._refreshInProgress = false;
    this._refreshTimeout = null;
  }

  async initialize() {
    if (this.DISABLE_CRAWL) {
      console.log("[PublicArticleService] Crawling disabled via DISABLE_PUBLIC_ARTICLE_CRAWL=true");
      return this.cachedContent || "Article content loading disabled";
    }

    // Check if we have cached content first
    if (this.cachedContent && this.categorizedContent && Object.keys(this.categorizedContent).length > 0) {
      console.log("PublicArticleService: Using cached content");
      this._scheduleRefresh();
      return this.cachedContent;
    }

    // Only fetch if no cached content exists
    await this._refreshContent();
    this._scheduleRefresh();
    
    if (this.cachedContent) {
      console.log("PublicArticleService initialized successfully");
      return this.cachedContent;
    } else {
      console.log("Failed to load public articles, using fallback");
      return "Article content unavailable";
    }
  }

  // Ensure a single category is fetched and cached without loading all
  async _ensureCategory(categoryKey) {
    if (!this.categorizedContent) this.categorizedContent = {};
    if (Array.isArray(this.categorizedContent[categoryKey]) && this.categorizedContent[categoryKey].length > 0) {
      return;
    }
    const config = this.CATEGORY_CONFIG[categoryKey];
    if (!config) return;
    try {
      const articles = await this._fetchCategoryDirectly(config.url, categoryKey);
      this.categorizedContent[categoryKey] = articles;
    } catch (e) {
      console.error(`[PublicArticleService] Error ensuring category ${categoryKey}:`, e.message);
      this.categorizedContent[categoryKey] = this.categorizedContent[categoryKey] || [];
    }
  }

  // Expose concatenated content by category (for unified RAG)
  async getArticlesByCategory(categoryKey) {
    await this._ensureCategory(categoryKey);
    const articles = this.categorizedContent?.[categoryKey] || [];
    if (articles.length === 0) return '';
    const combined = articles.map(a => a.content).join("\n\n---\n\n");
    return this.truncateContent(combined);
  }

  // Expose structured articles by category (url + content)
  async getStructuredArticlesByCategory(categoryKey) {
    await this._ensureCategory(categoryKey);
    return (this.categorizedContent?.[categoryKey] || []).filter(a => a && a.content && a.content.length > 0);
  }

  _scheduleRefresh() {
    if (this.DISABLE_CRAWL) return; // skip scheduling when disabled
    if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    this._refreshTimeout = setTimeout(async () => {
      await this._refreshContent();
      this._scheduleRefresh();
    }, this.REFRESH_INTERVAL);
  }

  async _refreshContent() {
    if (this.DISABLE_CRAWL) return; // skip refresh when disabled
    if (this._refreshInProgress) return;
    this._refreshInProgress = true;
    try {
      console.log("[PublicArticleService] Content refresh: START");
      const newContent = await this.getAllArticles(true); // force fetch
      if (newContent) {
        this.cachedContent = newContent;
        this.lastContentFetch = Date.now();
        console.log("PublicArticleService: Content refreshed successfully");
      } else {
        console.warn("PublicArticleService: Content refresh failed, keeping old content");
      }
      console.log("[PublicArticleService] Content refresh: END");
    } catch (err) {
      console.error("PublicArticleService: Error refreshing content", err);
      console.log("[PublicArticleService] Content refresh: END");
    } finally {
      this._refreshInProgress = false;
    }
  }

  // NEW: Intelligent content selection based on query
  async getRelevantContent(query, maxTokens = 15000, allowedProducts = null) {
    // Check if we have categorized content, if not, return fallback
    if (!this.categorizedContent || Object.keys(this.categorizedContent).length === 0) {
      console.log("[PublicArticleService] No categorized content available, using fallback");
      return "Article content unavailable. Please ask to talk to team for specific help.";
    }

    const queryLower = query.toLowerCase();
    console.log('[PublicArticleService] getRelevantContent:', {
      querySnippet: queryLower.slice(0, 80),
      maxTokens,
      allowedProducts: Array.isArray(allowedProducts) ? allowedProducts : null
    });

    // Determine categories to search
    let relevantCategories;
    if (Array.isArray(allowedProducts) && allowedProducts.length > 0) {
      // Use only the selected product categories that exist in config
      relevantCategories = allowedProducts.filter(key => this.CATEGORY_CONFIG[key]);
      console.log('[PublicArticleService] Using allowed product categories:', relevantCategories);
      // If nothing valid, fall back to query-driven selection
      if (relevantCategories.length === 0) {
        console.log('[PublicArticleService] No valid product categories provided; falling back to query-driven category selection');
        relevantCategories = this._getRelevantCategories(queryLower);
      }

    } else {
      // Use query-driven selection (default behavior)
      relevantCategories = this._getRelevantCategories(queryLower);
    }
    console.log('[PublicArticleService] Relevant categories to search:', relevantCategories);
    
    // Build candidate set from relevant categories
    let candidateArticles = [];
    for (const category of relevantCategories) {
      if (this.categorizedContent[category] && this.categorizedContent[category].length > 0) {
        candidateArticles.push(...this.categorizedContent[category]);
      }
    }

    // RETRIEVAL-FIRST: semantic search with embeddings
    try {
      // Ensure article embeddings lazily
      let prepared = 0;
      for (const article of candidateArticles) {
        if (!article.embedding && article.content) {
          article.embedding = await embeddingService.embedText(article.content);
          prepared++;
        }
      }
      if (prepared > 0) {
        console.log(`[PublicArticleService] Prepared embeddings for ${prepared} article(s)`);
      }

      const queryVec = await embeddingService.embedText(queryLower);
      const topK = parseInt(process.env.PUBLIC_RETRIEVAL_TOP_K || '12', 10);
      const minScore = parseFloat(process.env.PUBLIC_RETRIEVAL_MIN_SCORE || '0.22');
      const ranked = embeddingService.constructor.topK(queryVec, candidateArticles
        .filter(a => Array.isArray(a.embedding) && a.embedding.length > 0)
        .map(a => ({ id: a.url, vector: a.embedding, payload: a })), topK);

      // Filter by score threshold
      const filtered = ranked.filter(r => (r.score || 0) >= minScore).map(r => r.payload);

      // Select by token budget
      let selectedContent = [];
      let totalTokens = 0;
      for (const article of filtered) {
        const articleTokens = this._estimateTokens(article.content);
        if (totalTokens + articleTokens <= maxTokens) {
          selectedContent.push(article);
          totalTokens += articleTokens;
        } else {
          break;
        }
      }

      if (selectedContent.length > 0) {
        console.log(`[PublicArticleService] Retrieval selected ${selectedContent.length} articles (~${totalTokens} tokens)`);
        return this._formatContentForAI(selectedContent, query);
      }
      console.log('[PublicArticleService] Retrieval returned no results above threshold; falling back to heuristic scoring');
    } catch (retrievalError) {
      console.error('[PublicArticleService] Retrieval error, falling back to heuristic:', retrievalError.message);
    }
    
    // HEURISTIC FALLBACK
    let selectedContent = [];
    let totalTokens = 0;
    for (const category of relevantCategories) {
      if (this.categorizedContent[category] && this.categorizedContent[category].length > 0) {
        const categoryContent = this.categorizedContent[category];
        const scoredArticles = categoryContent.map(article => ({
          ...article,
          relevanceScore: this._calculateRelevanceScore(queryLower, article)
        })).sort((a, b) => b.relevanceScore - a.relevanceScore);
        for (const article of scoredArticles) {
          const articleTokens = this._estimateTokens(article.content);
          if (totalTokens + articleTokens <= maxTokens) {
            selectedContent.push(article);
            totalTokens += articleTokens;
          } else {
            break;
          }
        }
      }
    }
    
    // If no relevant content found, search only within allowed categories when provided
    if (selectedContent.length === 0) {
      if (Array.isArray(allowedProducts) && allowedProducts.length > 0) {
        console.log("[PublicArticleService] No category match; searching within allowed product categories only");
        selectedContent = this._searchArticlesAcross(queryLower, maxTokens, relevantCategories);
      } else {
        console.log("[PublicArticleService] No category matches found, searching all articles");
        selectedContent = this._searchAllArticles(queryLower, maxTokens);
      }
    }
    
    // Final fallback: prefer within allowed categories if provided
    if (selectedContent.length === 0) {
      if (Array.isArray(allowedProducts) && allowedProducts.length > 0) {
        console.log('[PublicArticleService] Using restricted fallback content');
        selectedContent = this._getFallbackContent(maxTokens, relevantCategories);
      } else {
        console.log('[PublicArticleService] Using global fallback content');
        selectedContent = this._getFallbackContent(maxTokens);
      }
    }

    console.log(`[PublicArticleService] Selected ${selectedContent.length} articles for prompt`);
    
    return this._formatContentForAI(selectedContent, query);
  }

  // REVOLUTIONARY: Skip category filtering entirely - analyze ALL content directly
  _getRelevantCategories(query) {
    // Instead of trying to predict which categories might be relevant,
    // we'll search ALL categories and let the content-level scoring decide.
    // This eliminates the keyword prediction problem entirely!
    
    console.log("[PublicArticleService] Using content-driven approach - analyzing all categories");
    return Object.keys(this.CATEGORY_CONFIG);
  }



  // SMART: Content-driven relevance scoring without keyword dependency
  _calculateRelevanceScore(query, article) {
    let score = 0;
    const content = article.content.toLowerCase();
    const title = article.title.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // 1. EXACT MATCHES (highest confidence)
    if (content.includes(queryLower) || title.includes(queryLower)) {
      score += 20; // Very high confidence
    }
    
    // 2. INTELLIGENT WORD ANALYSIS
    const queryWords = this._extractMeaningfulWords(queryLower);
    const contentWords = this._extractMeaningfulWords(content);
    const titleWords = this._extractMeaningfulWords(title);
    
    // Calculate word overlap with smart weighting
    const titleOverlap = this._calculateWordOverlap(queryWords, titleWords);
    const contentOverlap = this._calculateWordOverlap(queryWords, contentWords);
    
    score += titleOverlap * 8;  // Titles are highly relevant
    score += contentOverlap * 3; // Content matches are good
    
    // 3. CONTEXTUAL PATTERN MATCHING
    const contextScore = this._analyzeContentContext(queryLower, content, title);
    score += contextScore;
    
    // 4. SEMANTIC DENSITY ANALYSIS
    const densityScore = this._calculateSemanticDensity(queryWords, content, title);
    score += densityScore;
    
    // 5. QUESTION-ANSWER MATCHING
    const qaScore = this._analyzeQuestionAnswerFit(queryLower, content, title);
    score += qaScore;
    
    return score;
  }

  // Extract meaningful words (filter out common words)
  _extractMeaningfulWords(text) {
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'her', 'us', 'them'
    ]);
    
    return text.split(/\s+/)
      .map(word => word.replace(/[^\w]/g, ''))
      .filter(word => word.length > 2 && !commonWords.has(word))
      .filter(word => word.length > 0);
  }

  // Calculate meaningful word overlap between query and content
  _calculateWordOverlap(queryWords, contentWords) {
    if (queryWords.length === 0) return 0;
    
    const contentWordSet = new Set(contentWords);
    let matches = 0;
    
    for (const queryWord of queryWords) {
      if (contentWordSet.has(queryWord)) {
        matches++;
      } else {
        // Check for partial matches (handles plurals, etc.)
        for (const contentWord of contentWords) {
          if (this._areWordsSimilar(queryWord, contentWord)) {
            matches += 0.7; // Partial credit
            break;
          }
        }
      }
    }
    
    return (matches / queryWords.length) * 10; // Normalize to 0-10 scale
  }

  // Check if two words are similar (handles plurals, tenses, etc.)
  _areWordsSimilar(word1, word2) {
    // Handle common variations
    const normalize = (word) => {
      return word.replace(/s$/, '') // plurals
                 .replace(/ed$/, '') // past tense
                 .replace(/ing$/, '') // present participle
                 .replace(/er$/, '') // comparative
                 .replace(/est$/, ''); // superlative
    };
    
    const norm1 = normalize(word1);
    const norm2 = normalize(word2);
    
    // Check if one is contained in the other or vice versa
    return norm1.includes(norm2) || norm2.includes(norm1) || 
           norm1 === norm2 ||
           Math.abs(norm1.length - norm2.length) <= 2 && this._calculateEditDistance(norm1, norm2) <= 2;
  }

  // Simple edit distance for typo tolerance
  _calculateEditDistance(str1, str2) {
    const dp = Array(str1.length + 1).fill().map(() => Array(str2.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) dp[i][0] = i;
    for (let j = 0; j <= str2.length; j++) dp[0][j] = j;
    
    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        if (str1[i-1] === str2[j-1]) {
          dp[i][j] = dp[i-1][j-1];
        } else {
          dp[i][j] = Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1;
        }
      }
    }
    
    return dp[str1.length][str2.length];
  }

  // Analyze content context and patterns
  _analyzeContentContext(query, content, title) {
    let score = 0;
    
    // Question type analysis
    const isQuestion = /^(what|how|why|when|where|who|can|do|does|is|are)\b/i.test(query);
    
    if (isQuestion) {
      // Boost content that looks like answers
      if (content.includes('answer') || content.includes('solution') || 
          title.includes('about') || title.includes('guide') ||
          content.includes('step') || content.includes('follow')) {
        score += 5;
      }
    }
    
    // Problem-solving context
    const isProblem = /\b(problem|issue|error|broken|not working|help|fix|trouble)\b/i.test(query);
    
    if (isProblem) {
      if (content.includes('troubleshoot') || content.includes('solve') ||
          content.includes('fix') || content.includes('resolve') ||
          title.includes('troubleshoot') || title.includes('fix')) {
        score += 7;
      }
    }
    
    // How-to context
    if (query.includes('how to') || query.includes('how do')) {
      if (content.includes('step') || content.includes('guide') ||
          content.includes('tutorial') || content.includes('instruction') ||
          title.includes('how to') || title.includes('guide')) {
        score += 6;
      }
    }
    
    return score;
  }

  // Calculate semantic density (how concentrated the relevant terms are)
  _calculateSemanticDensity(queryWords, content, title) {
    if (queryWords.length === 0) return 0;
    
    const titleWords = title.split(/\s+/).length;
    const contentWords = content.split(/\s+/).length;
    
    let titleDensity = 0;
    let contentDensity = 0;
    
    for (const queryWord of queryWords) {
      // Count occurrences in title and content
      const titleMatches = (title.match(new RegExp(queryWord, 'gi')) || []).length;
      const contentMatches = (content.match(new RegExp(queryWord, 'gi')) || []).length;
      
      if (titleWords > 0) titleDensity += titleMatches / titleWords;
      if (contentWords > 0) contentDensity += contentMatches / contentWords;
    }
    
    return (titleDensity * 10) + (contentDensity * 3); // Title density weighted higher
  }

  // Analyze how well content answers the specific question
  _analyzeQuestionAnswerFit(query, content, title) {
    let score = 0;
    
    // Extract question type and key terms
    const questionWords = query.match(/^(what|how|why|when|where|who|can|do|does|is|are)\b/i);
    
    if (questionWords) {
      const questionType = questionWords[0].toLowerCase();
      
      switch (questionType) {
        case 'what':
          if (content.includes('definition') || content.includes(' is ') || 
              title.includes('about') || title.includes('what is')) {
            score += 4;
          }
          break;
        case 'how':
          if (content.includes('step') || content.includes('process') ||
              content.includes('method') || title.includes('how to')) {
            score += 4;
          }
          break;
        case 'why':
          if (content.includes('because') || content.includes('reason') ||
              content.includes('cause') || content.includes('purpose')) {
            score += 4;
          }
          break;
        case 'when':
          if (content.includes('time') || content.includes('date') ||
              content.includes('schedule') || content.includes('timing')) {
            score += 4;
          }
          break;
        case 'where':
          if (content.includes('location') || content.includes('place') ||
              content.includes('find') || content.includes('access')) {
            score += 4;
          }
          break;
      }
    }
    
    return score;
  }



  // NEW: Search all articles when categories fail
  _searchAllArticles(query, maxTokens) {
    console.log("[PublicArticleService] Performing comprehensive search across all articles");
    
    const allArticles = [];
    
    // Collect all articles from all categories
    for (const category in this.categorizedContent) {
      if (this.categorizedContent[category]) {
        allArticles.push(...this.categorizedContent[category]);
      }
    }
    
    if (allArticles.length === 0) {
      console.log("[PublicArticleService] No articles available for comprehensive search");
      return [];
    }
    
    // Score all articles using our enhanced scoring
    const scoredArticles = allArticles.map(article => ({
      ...article,
      relevanceScore: this._calculateRelevanceScore(query, article)
    })).filter(article => article.relevanceScore > 0) // Only include articles with some relevance
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    console.log(`[PublicArticleService] Found ${scoredArticles.length} relevant articles out of ${allArticles.length} total`);
    
    // Select top articles within token limit
    const selectedContent = [];
    let totalTokens = 0;
    
    for (const article of scoredArticles) {
      const articleTokens = this._estimateTokens(article.content);
      if (totalTokens + articleTokens <= maxTokens) {
        selectedContent.push(article);
        totalTokens += articleTokens;
        console.log(`[PublicArticleService] Selected article: "${article.title}" (score: ${article.relevanceScore})`);
      } else {
        break;
      }
    }
    
    return selectedContent;
  }

  // NEW: Search a subset of categories when restricted by products
  _searchArticlesAcross(query, maxTokens, categoryKeys) {
    console.log("[PublicArticleService] Searching within specific categories: ", categoryKeys);
    const allArticles = [];
    for (const category of categoryKeys) {
      if (this.categorizedContent[category]) {
        allArticles.push(...this.categorizedContent[category]);
      }
    }

    if (allArticles.length === 0) {
      console.log("[PublicArticleService] No articles available in restricted categories");
      return [];
    }

    const scoredArticles = allArticles.map(article => ({
      ...article,
      relevanceScore: this._calculateRelevanceScore(query, article)
    })).filter(article => article.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const selectedContent = [];
    let totalTokens = 0;
    for (const article of scoredArticles) {
      const articleTokens = this._estimateTokens(article.content);
      if (totalTokens + articleTokens <= maxTokens) {
        selectedContent.push(article);
        totalTokens += articleTokens;
      } else {
        break;
      }
    }
    return selectedContent;
  }

  // NEW: Get fallback content when no specific matches
  _getFallbackContent(maxTokens, categoryKeys = null) {
    const fallbackContent = [];
    let totalTokens = 0;
    
    // Prioritize common help categories; if restricted, use only within allowed categories
    let priorityCategories = ['getting_started', 'faq', 'troubleshooting'];
    if (Array.isArray(categoryKeys) && categoryKeys.length > 0) {
      priorityCategories = categoryKeys;
    }
    
    for (const category of priorityCategories) {
      if (this.categorizedContent[category]) {
        for (const article of this.categorizedContent[category]) {
          const articleTokens = this._estimateTokens(article.content);
          if (totalTokens + articleTokens <= maxTokens) {
            fallbackContent.push(article);
            totalTokens += articleTokens;
          } else {
            break;
          }
        }
      }
    }
    
    return fallbackContent;
  }

  // NEW: Format content for AI consumption
  _formatContentForAI(articles, query) {
    if (articles.length === 0) {
      return "No relevant information found. Please ask to talk to team for specific help.";
    }
    
    const formattedSections = articles.map(article => {
      return `## ${article.title}
Category: ${article.category}
URL: ${article.url}

${article.content}

---`;
    });
    
    return formattedSections.join('\n\n');
  }

  // NEW: Estimate tokens for content
  _estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  async getAllArticles(force = false) {
    const now = Date.now();
    if (!force && this.cachedContent && (now - this.lastContentFetch < this.CONTENT_CACHE_DURATION)) {
      return this.cachedContent;
    }
    if (this._refreshInProgress && this.cachedContent) {
      return this.cachedContent;
    }
    try {
      console.log("[PublicArticleService] Fetching all articles: START");
      
      // NEW: Fetch and categorize articles
      await this._fetchAndCategorizeArticles();
      
      // Create structured content for backward compatibility
      const allArticles = [];
      for (const category in this.categorizedContent) {
        allArticles.push(...this.categorizedContent[category]);
      }
      
      const validArticles = allArticles.filter((article) => article !== null);
      const combinedContent = validArticles.map(article => article.content).join("\n\n---\n\n");
      const truncatedContent = this.truncateContent(combinedContent);
      this.cachedContent = truncatedContent;
      this.lastContentFetch = now;
      console.log(`[PublicArticleService] Fetching all articles: SUCCESS (${validArticles.length} articles in ${Object.keys(this.categorizedContent).length} categories)`);
      return truncatedContent;
    } catch (err) {
      console.error("[PublicArticleService] Fetching all articles: ERROR", err);
      if (this.cachedContent) return this.cachedContent;
      return "Article content unavailable";
    }
  }

  // NEW: Fetch and categorize articles
  async _fetchAndCategorizeArticles() {
    // Check if we already have categorized content
    if (this.categorizedContent && Object.keys(this.categorizedContent).length > 0) {
      console.log("[PublicArticleService] Using existing categorized content");
      return;
    }

    this.categorizedContent = {};
    
    for (const [category, config] of Object.entries(this.CATEGORY_CONFIG)) {
      console.log(`[PublicArticleService] Fetching category: ${category}`);
      this.categorizedContent[category] = [];
      
      try {
        // Use a more efficient approach - fetch only the main category page
        const articles = await this._fetchCategoryDirectly(config.url, category);
        this.categorizedContent[category] = articles;
        console.log(`[PublicArticleService] Category ${category}: ${articles.length} articles`);
        // Pre-compute embeddings lazily in the background (best-effort)
        (async () => {
          let prepared = 0;
          for (const a of articles) {
            try {
              if (!a.embedding && a.content) {
                a.embedding = await embeddingService.embedText(a.content);
                prepared++;
              }
            } catch {}
          }
          if (prepared > 0) {
            console.log(`[PublicArticleService] Precomputed embeddings for ${prepared} ${category} article(s)`);
          }
        })();
      } catch (error) {
        console.error(`[PublicArticleService] Error fetching category ${category}:`, error);
      }
    }
  }

  // NEW: Fetch category directly without excessive crawling
  async _fetchCategoryDirectly(categoryUrl, category) {
    try {
      const { data } = await axios.get(categoryUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UFB-Bot/1.0)",
        },
      });
      
      const $ = cheerio.load(data);
      const articles = [];
      
      // Extract article links from the category page
      $('a[href*="/articles/"]').each((index, element) => {
        const href = $(element).attr("href");
        if (href) {
          let fullUrl;
          if (href.startsWith("http")) {
            fullUrl = href;
          } else if (href.startsWith("/")) {
            fullUrl = `https://intercom.help${href}`;
          } else {
            fullUrl = new URL(href, categoryUrl).href;
          }
          
          const normalizedUrl = this.normalizeUrl(fullUrl);
          if (this.isValidFrodoBotsUrl(normalizedUrl)) {
            // Add to articles list for processing
            articles.push({ url: normalizedUrl, category: category });
          }
        }
      });
      
      // Fetch content for up to CATEGORY_ARTICLE_LIMIT articles with limited concurrency
      const limit = Math.max(1, Math.min(this.CATEGORY_ARTICLE_LIMIT, articles.length));
      const limitedArticles = articles.slice(0, limit);
      const fetchedArticles = [];
      const batchSize = Math.max(1, this.FETCH_CONCURRENCY);
      for (let i = 0; i < limitedArticles.length; i += batchSize) {
        const batch = limitedArticles.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (article) => {
          try {
            return await this._fetchStructuredArticle(article.url, article.category);
          } catch (error) {
            console.error(`Error fetching article ${article.url}:`, error.message);
            return null;
          }
        }));
        for (const res of results) {
          if (res) fetchedArticles.push(res);
        }
      }
      
      return fetchedArticles;
      
    } catch (error) {
      console.error(`Error fetching category ${category}:`, error.message);
      return [];
    }
  }

  // NEW: Fetch structured article with metadata
  async _fetchStructuredArticle(url, category) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UFB-Bot/1.0)",
        },
      });
      
      const $ = cheerio.load(data);
      
      // Extract title
      const title = $('h1').first().text().trim() || 
                   $('title').text().trim() || 
                   'Untitled Article';
      
      // Extract content and media content (links, images, etc.)
      let content = "";
      let mediaContent = "";
      const articleElement = $("article");
      if (articleElement.length > 0) {
        content = articleElement.text();
        mediaContent = this.extractMediaContent($, articleElement, url);
      } else {
        const mainElement = $("main");
        if (mainElement.length > 0) {
          content = mainElement.text();
          mediaContent = this.extractMediaContent($, mainElement, url);
        } else {
          const bodyElement = $("body");
          content = bodyElement.text();
          mediaContent = this.extractMediaContent($, bodyElement, url);
        }
      }
      
      const cleanText = content.replace(/\s+/g, " ").trim();
      const textWithClickableUrls = this.cleanUrlsForDiscord(cleanText);
      const combinedContent = textWithClickableUrls + (mediaContent ? "\n\n" + mediaContent : "");
      
      if (combinedContent.length < 50) {
        return null; // Skip very short articles
      }
      
      return {
        title: title,
        content: combinedContent,
        url: url,
        category: category,
        tokens: this._estimateTokens(combinedContent)
      };
      
    } catch (err) {
      console.error(`Error fetching structured article ${url}:`, err.message);
      return null;
    }
  }

  // URL helpers (used by category fetcher)
  isValidFrodoBotsUrl(url) {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname !== 'intercom.help') return false;
      if (!urlObj.pathname.startsWith('/frodobots/en/')) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  normalizeUrl(url) {
    try {
      return new URL(url).toString();
    } catch {
      return url;
    }
  }

  // Deprecated crawl methods removed as we now fetch categories directly

  // fetchArticleText(url) is deprecated in favor of _fetchStructuredArticle and is no longer used

  extractMediaContent($, element, baseUrl) {
    const mediaItems = [];
    element.find('a[href]').each((index, link) => {
      const href = $(link).attr('href');
      const text = $(link).text().trim();
      if (href && text) {
        let fullUrl;
        if (href.startsWith('http')) {
          fullUrl = href;
        } else if (href.startsWith('/')) {
          fullUrl = new URL(href, baseUrl).href;
        } else {
          fullUrl = new URL(href, baseUrl).href;
        }
        mediaItems.push(`${text}: ${fullUrl}`);
      }
    });
    element.find('img[src]').each((index, img) => {
      const src = $(img).attr('src');
      const alt = $(img).attr('alt') || 'Image';
      if (src) {
        let fullUrl;
        if (src.startsWith('http')) {
          fullUrl = src;
        } else if (src.startsWith('/')) {
          fullUrl = new URL(src, baseUrl).href;
        } else {
          fullUrl = new URL(src, baseUrl).href;
        }
        mediaItems.push(`Image: ${alt} (${fullUrl})`);
      }
    });
    element.find('iframe[src], video source[src], video[src]').each((index, video) => {
      const src = $(video).attr('src');
      const title = $(video).attr('title') || $(video).attr('alt') || 'Video';
      if (src) {
        let fullUrl;
        if (src.startsWith('http')) {
          fullUrl = src;
        } else if (src.startsWith('/')) {
          fullUrl = new URL(src, baseUrl).href;
        } else {
          fullUrl = new URL(src, baseUrl).href;
        }
        mediaItems.push(`Video: ${title} (${fullUrl})`);
      }
    });
    return mediaItems.join("\n");
  }

  cleanUrlsForDiscord(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<$1>');
  }

  truncateContent(content, maxTokens = this.MAX_TOKENS) {
    const tokens = Math.ceil(content.length / 4);
    if (tokens <= maxTokens) return content;
    const approxChars = maxTokens * 4;
    return content.slice(0, approxChars);
  }

  // Deprecated page-level cache removed

  // NEW: Enhanced system prompt with query-specific content
  async getSystemPrompt(query = null) {
    const humanHelpPrompt = buildHumanHelpPrompt();
    
    if (query) {
      // Get query-specific content
      const relevantContent = await this.getRelevantContent(query);
      return `${humanHelpPrompt}

FRODOBOTS KNOWLEDGE BASE (Relevant to your question):
${relevantContent}

INSTRUCTIONS:
- Answer based STRICTLY ONLY on the information provided above
- CRITICAL: DO NOT use any external knowledge, training data, or assumptions about FrodoBots, Earth Rovers School, UFB, SAM, or any FrodoBots products
- CRITICAL: If information is not explicitly mentioned in the articles above, you MUST say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- When users ask about websites, links, or URLs, check the article content for any mentioned links and share them
- If an article mentions links like "Test Drive", "Visit website", domain names like "ufb.gg", or any URLs, always include those URLs in your response
- ALWAYS include the full URL with https:// protocol (e.g., https://ufb.gg not just ufb.gg) so Discord can make it clickable
- Use plain URLs without markdown formatting (e.g., https://robots.fun/test-drive not [Test Drive](https://robots.fun/test-drive))
- If the information doesn't cover the specific question, say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- FORBIDDEN: Never make up, infer, or generate details about FrodoBots products from your training data when the information is not in the provided articles
- FORBIDDEN: Never assume features exist for products when they are not mentioned in the provided content
- Be friendly, conversational, and helpful
- Keep responses concise - prioritize brevity
- If you need more context, ask the user to clarify their question`;
    } else {
      // Fallback to general content
      return `${humanHelpPrompt}

FRODOBOTS KNOWLEDGE BASE:
${this.cachedContent || "[No content loaded]"}

ADDITIONAL CONTEXT:
- You have access to the above FrodoBots help articles and information
- CRITICAL: DO NOT use any external knowledge, training data, or assumptions about FrodoBots, Earth Rovers School, UFB, SAM, or any FrodoBots products
- CRITICAL: If information is not explicitly mentioned in the articles above, you MUST say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- When users ask about websites or links, always check the article content for any mentioned URLs and share them
- ALWAYS include the full URL with https:// protocol (e.g., https://ufb.gg not just ufb.gg) so Discord can make it clickable
- Use plain URLs without markdown formatting - Discord will auto-link them
- Focus on FrodoBots services, robot fighting, Earthrovers, and related topics
- If questions are unrelated to FrodoBots, politely redirect to FrodoBots services
- FORBIDDEN: Never make up, infer, or generate details about FrodoBots products from your training data when the information is not in the provided articles
- FORBIDDEN: Never assume features exist for products when they are not mentioned in the provided content
- Be friendly, conversational, and encouraging
- Keep responses concise - prioritize brevity`;
    }
  }

  // NEW: Check if service is properly initialized
  isInitialized() {
    return this.categorizedContent && 
           Object.keys(this.categorizedContent).length > 0 && 
           this.cachedContent;
  }

  // NEW: Get initialization status
  getInitializationStatus() {
    return {
      hasCategorizedContent: this.categorizedContent && Object.keys(this.categorizedContent).length > 0,
      hasCachedContent: !!this.cachedContent,
      categories: this.categorizedContent ? Object.keys(this.categorizedContent) : [],
      totalArticles: this.categorizedContent ? 
        Object.values(this.categorizedContent).reduce((sum, articles) => sum + articles.length, 0) : 0
    };
  }
}

// Export both the class (for legacy) and a singleton instance for SoT usage
export const contentService = new PublicArticleService();
export default PublicArticleService; 