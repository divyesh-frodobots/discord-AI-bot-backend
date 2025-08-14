import axios from "axios";
import * as cheerio from 'cheerio';
import { buildHumanHelpPrompt } from './ArticleService.js';

class PublicArticleService {
  constructor() {
    this.cachedArticles = {};
    this.lastFetched = {};
    this.cachedContent = null; // Cache the combined content
    this.lastContentFetch = 0;
    this.discoveredUrls = new Set(); // Track discovered URLs to avoid duplicates
    this.visitedUrls = new Set(); // Track visited URLs to avoid infinite loops

    // NEW: Structured content storage
    this.categorizedContent = {};
    this.articleMetadata = {};
    this.contentIndex = {};

    // Configuration
    this.BASE_URL = "https://intercom.help/frodobots/en/";
    this.REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    this.MAX_TOKENS = 40000;
    this.CONTENT_CACHE_DURATION = this.REFRESH_INTERVAL;
    this.MAX_DEPTH = 7;
    this.MAX_URLS = 200;
    this.CONCURRENT_REQUESTS = 3;

    // Allow disabling crawling via env
    this.DISABLE_CRAWL = process.env.DISABLE_PUBLIC_ARTICLE_CRAWL === 'true';

    // NEW: Organized category URLs with better structure
    this.CATEGORY_CONFIG = {
      getting_started: {
        url: "https://intercom.help/frodobots/en/collections/3762588-getting-started",
        keywords: ["start", "begin", "first steps", "setup"],
        description: "Getting started guides and onboarding tutorials"
      },
      earthrover_school: {
        url: "https://intercom.help/frodobots/en/collections/3762589-earthrovers-school",
        keywords: ["earthrover", "school", "education", "learning", "students"],
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
  async getRelevantContent(query, maxTokens = 15000) {
    // Check if we have categorized content, if not, return fallback
    if (!this.categorizedContent || Object.keys(this.categorizedContent).length === 0) {
      console.log("[PublicArticleService] No categorized content available, using fallback");
      return "Article content unavailable. Please ask to talk to team for specific help.";
    }

    const queryLower = query.toLowerCase();
    
    // Determine relevant categories based on query
    const relevantCategories = this._getRelevantCategories(queryLower);
    
    // Get content from relevant categories
    let selectedContent = [];
    let totalTokens = 0;
    
    for (const category of relevantCategories) {
      if (this.categorizedContent[category] && this.categorizedContent[category].length > 0) {
        const categoryContent = this.categorizedContent[category];
        
        // Sort articles by relevance score
        const scoredArticles = categoryContent.map(article => ({
          ...article,
          relevanceScore: this._calculateRelevanceScore(queryLower, article)
        })).sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        // Add articles until we reach token limit
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
    
    // If no relevant content found, fall back to general content
    if (selectedContent.length === 0) {
      selectedContent = this._getFallbackContent(maxTokens);
    }
    
    return this._formatContentForAI(selectedContent, query);
  }

  // NEW: Get relevant categories based on query
  _getRelevantCategories(query) {
    const categoryScores = {};
    
    for (const [category, config] of Object.entries(this.CATEGORY_CONFIG)) {
      let score = 0;
      
      // Check keyword matches
      for (const keyword of config.keywords) {
        if (query.includes(keyword)) {
          score += 2; // Higher weight for keyword matches
        }
      }
      
      // Check for product-specific terms
      if (query.includes('earthrover') && category.includes('earthrover')) {
        score += 3;
      }
      if (query.includes('ufb') && category === 'ufb') {
        score += 3;
      }
      if (query.includes('sam') && category === 'sam') {
        score += 3;
      }
      
      // Check for question types
      if (query.includes('how') || query.includes('what') || query.includes('why')) {
        if (category === 'faq' || category === 'troubleshooting') {
          score += 1;
        }
      }
      
      if (query.includes('problem') || query.includes('issue') || query.includes('error')) {
        if (category === 'troubleshooting') {
          score += 2;
        }
      }
      
      if (score > 0) {
        categoryScores[category] = score;
      }
    }
    
    // Return top 3 most relevant categories
    return Object.entries(categoryScores)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([category]) => category);
  }

  // NEW: Calculate relevance score for an article
  _calculateRelevanceScore(query, article) {
    let score = 0;
    const content = article.content.toLowerCase();
    const title = article.title.toLowerCase();
    
    // Title matches get higher weight
    const queryWords = query.split(' ');
    for (const word of queryWords) {
      if (word.length > 2 && title.includes(word)) {
        score += 3;
      }
      if (word.length > 2 && content.includes(word)) {
        score += 1;
      }
    }
    
    // Exact phrase matches
    if (content.includes(query)) {
      score += 5;
    }
    
    // Category relevance
    if (article.category && query.includes(article.category)) {
      score += 2;
    }
    
    return score;
  }

  // NEW: Get fallback content when no specific matches
  _getFallbackContent(maxTokens) {
    const fallbackContent = [];
    let totalTokens = 0;
    
    // Prioritize getting started and FAQ content
    const priorityCategories = ['getting_started', 'faq', 'troubleshooting'];
    
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
      
      // Fetch content for the first 10 articles (limit to prevent excessive requests)
      const limitedArticles = articles.slice(0, 10);
      const fetchedArticles = [];
      
      for (const article of limitedArticles) {
        try {
          const articleContent = await this._fetchStructuredArticle(article.url, article.category);
          if (articleContent) {
            fetchedArticles.push(articleContent);
          }
        } catch (error) {
          console.error(`Error fetching article ${article.url}:`, error.message);
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

  async getAllArticleUrls() {
    this.discoveredUrls.clear();
    this.visitedUrls.clear();
    const crawledPages = await this.crawlPages(this.BASE_URL);
    const urls = [...new Set(crawledPages.map(page => page.url))];
    return urls;
  }

  async crawlPages(startUrl, depth = 0, maxDepth = this.MAX_DEPTH) {
    if (depth >= maxDepth || 
        this.visitedUrls.size >= this.MAX_URLS || 
        this.visitedUrls.has(startUrl)) {
      return [];
    }
    this.visitedUrls.add(startUrl);
    console.log(`Crawling: ${startUrl} (depth: ${depth}, visited: ${this.visitedUrls.size})`);
    try {
      const links = await this.extractLinksFromPage(startUrl);
      let content = this.cachedArticles[startUrl];
      if (!content) {
        content = await this.fetchArticleText(startUrl);
        if (content) {
          this.cachedArticles[startUrl] = content;
          this.lastFetched[startUrl] = Date.now();
        }
      }
      const results = content ? [{ url: startUrl, content }] : [];
      if (depth < maxDepth - 1 && links.length > 0) {
        const batchSize = this.CONCURRENT_REQUESTS;
        for (let i = 0; i < links.length && this.visitedUrls.size < this.MAX_URLS; i += batchSize) {
          const batch = links.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(link => this.crawlPages(link, depth + 1, maxDepth)));
          for (const batchResult of batchResults) {
            results.push(...batchResult);
          }
        }
      }
      return results;
    } catch (error) {
      console.error(`Error crawling ${startUrl}:`, error.message);
      return [];
    }
  }

  async extractLinksFromPage(url) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UFB-Bot/1.0)",
        },
      });
      const $ = cheerio.load(data);
      const links = [];
      $('a[href]').each((index, element) => {
        const href = $(element).attr("href");
        if (href) {
          let fullUrl;
          if (href.startsWith("http")) {
            fullUrl = href;
          } else if (href.startsWith("/")) {
            fullUrl = `https://intercom.help${href}`;
          } else {
            fullUrl = new URL(href, url).href;
          }
          const normalizedUrl = this.normalizeUrl(fullUrl);
          if (this.isValidFrodoBotsUrl(normalizedUrl) && 
              !this.discoveredUrls.has(normalizedUrl)) {
            links.push(normalizedUrl);
            this.discoveredUrls.add(normalizedUrl);
          }
        }
      });
      return [...new Set(links)];
    } catch (err) {
      console.error(`Error extracting links from ${url}:`, err.message);
      return [];
    }
  }

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

  async fetchArticleText(url) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UFB-Bot/1.0)",
        },
      });
      const $ = cheerio.load(data);
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
      return combinedContent;
    } catch (err) {
      console.error(`Error fetching article ${url}:`, err.message);
      return null;
    }
  }

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

  async getCachedArticle(url) {
    const now = Date.now();
    if (
      this.cachedArticles[url] &&
      now - (this.lastFetched[url] || 0) < this.REFRESH_INTERVAL
    ) {
      return this.cachedArticles[url];
    }
    try {
      const content = await this.fetchArticleText(url);
      if (content) {
        this.cachedArticles[url] = content;
        this.lastFetched[url] = now;
        return content;
      }
      return null;
    } catch (err) {
      console.error(`[PublicArticleService] Fetching article: ${url} ERROR`, err);
      return null;
    }
  }

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
- Answer based ONLY on the information provided above
- When users ask about websites, links, or URLs, check the article content for any mentioned links and share them
- If an article mentions links like "Test Drive", "Visit website", domain names like "ufb.gg", or any URLs, always include those URLs in your response
- ALWAYS include the full URL with https:// protocol (e.g., https://ufb.gg not just ufb.gg) so Discord can make it clickable
- Use plain URLs without markdown formatting (e.g., https://robots.fun/test-drive not [Test Drive](https://robots.fun/test-drive))
- If the information doesn't cover the specific question, say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- Be friendly, conversational, and helpful
- Keep responses concise but informative
- If you need more context, ask the user to clarify their question`;
    } else {
      // Fallback to general content
      return `${humanHelpPrompt}

FRODOBOTS KNOWLEDGE BASE:
${this.cachedContent || "[No content loaded]"}

ADDITIONAL CONTEXT:
- You have access to the above FrodoBots help articles and information
- When users ask about websites or links, always check the article content for any mentioned URLs and share them
- ALWAYS include the full URL with https:// protocol (e.g., https://ufb.gg not just ufb.gg) so Discord can make it clickable
- Use plain URLs without markdown formatting - Discord will auto-link them
- Focus on FrodoBots services, robot fighting, Earthrovers, and related topics
- If questions are unrelated to FrodoBots, politely redirect to FrodoBots services
- Be friendly, conversational, and encouraging
- Keep responses concise but informative`;
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

export default PublicArticleService; 