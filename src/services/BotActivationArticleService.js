import axios from "axios";
import * as cheerio from 'cheerio';

class BotActivationArticleService {
  constructor() {
    this.cachedArticles = {};
    this.lastFetched = {};
    this.cachedContent = null;
    this.lastContentFetch = 0;
    this.discoveredUrls = new Set();
    this.visitedUrls = new Set();

    // Configuration specific to EarthRovers
    this.EARTHROVERS_COLLECTION_URL = "https://intercom.help/frodobots/en/collections/9174353-earthrovers-personal-bots";
    this.BASE_URL = "https://intercom.help/frodobots/en/";
    this.REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
    this.MAX_TOKENS = 30000; // Increased for GPT-4.1's 1M context window - comprehensive knowledge base
    this.CONTENT_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
    this.MAX_DEPTH = 5; // Increased for comprehensive content with GPT-4.1
    this.MAX_URLS = 100; // Increased to get full knowledge base
    this.CONCURRENT_REQUESTS = 5; // Keep parallel processing
    
    // Priority keywords for content selection (most important EarthRovers terms)
    this.PRIORITY_KEYWORDS = [
      'activation', 'setup', 'drive to earn', 'personal bot', 'earthrover',
      'wallet', 'solana', 'fbp', 'frodobots points', 'how to', 'getting started',
      'troubleshooting', 'configuration', 'sharing', 'transfer', 'ownership'
    ];
  }

  // Rough token estimation (1 token ≈ 4 characters)
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  // Truncate content to fit within token limits
  truncateContent(content, maxTokens = this.MAX_TOKENS) {
    const estimatedTokens = this.estimateTokens(content);
    if (estimatedTokens <= maxTokens) {
      return content;
    }

    const maxChars = maxTokens * 4;
    const truncated = content.substring(0, maxChars);
    return truncated + "\n\n[Content truncated due to length limits]";
  }

  // Score article content based on priority keywords
  scoreArticleRelevance(content, title = '') {
    const textToAnalyze = (title + ' ' + content).toLowerCase();
    let score = 0;
    
    // Higher score for priority keywords
    this.PRIORITY_KEYWORDS.forEach(keyword => {
      const keywordCount = (textToAnalyze.match(new RegExp(keyword, 'g')) || []).length;
      score += keywordCount * 5; // Increased weight for priority keywords
    });
    
    // High bonus for essential guides
    const essentialKeywords = ['how to activate', 'getting started', 'setup', 'drive to earn', 'wallet'];
    essentialKeywords.forEach(keyword => {
      if (textToAnalyze.includes(keyword)) score += 10; // High bonus for essential content
    });
    
    // Bonus for FAQ content
    if (textToAnalyze.includes('faq') || textToAnalyze.includes('frequently')) {
      score += 8;
    }
    
    // Bonus for troubleshooting
    if (textToAnalyze.includes('troubleshoot') || textToAnalyze.includes('problem') || textToAnalyze.includes('error')) {
      score += 6;
    }
    
    return score;
  }

  // Intelligently select and prioritize content within token limits
  selectPriorityContent(articles) {
    // Score all articles
    const scoredArticles = articles.map(article => ({
      content: article,
      score: this.scoreArticleRelevance(article),
      tokens: this.estimateTokens(article)
    }));
    
    // Sort by score (highest first)
    scoredArticles.sort((a, b) => b.score - a.score);
    
    // Only select articles with meaningful scores (filter out low-relevance content)
    const relevantArticles = scoredArticles.filter(article => article.score > 3);
    
    // Select articles within token limit
    const selectedArticles = [];
    let totalTokens = 0;
    
    for (const article of relevantArticles) {
      if (totalTokens + article.tokens <= this.MAX_TOKENS) {
        selectedArticles.push(article.content);
        totalTokens += article.tokens;
      } else {
        // Try to fit a truncated version of high-priority content
        if (article.score > 10 && selectedArticles.length < 5) {
          const remainingTokens = this.MAX_TOKENS - totalTokens;
          if (remainingTokens > 300) { // Only if there's meaningful space left
            const truncatedContent = this.truncateContent(article.content, remainingTokens);
            selectedArticles.push(truncatedContent);
            break;
          }
        }
      }
    }
    
    console.log(`📊 EarthRovers Bot: Selected ${selectedArticles.length} priority articles (${totalTokens} tokens) from ${articles.length} total`);
    return selectedArticles;
  }

  // Enhanced URL validation for EarthRovers - more permissive to catch all related content
  isValidEarthRoversUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Must be from intercom help center
      if (urlObj.hostname !== 'intercom.help') return false;
      
      // Must be FrodoBots help center
      if (!urlObj.pathname.startsWith('/frodobots/en/')) return false;
      
      // Include EarthRovers collection and related content
      return (
        urlObj.pathname.includes('earthrovers') || 
        urlObj.pathname.includes('earth-rovers') ||
        urlObj.pathname.includes('earth_rovers') ||
        urlObj.pathname.includes('9174353') || // Collection ID
        urlObj.pathname.includes('personal-bots') ||
        urlObj.pathname.includes('personal_bots') ||
        urlObj.pathname.includes('drive-to-earn') ||
        urlObj.pathname.includes('drive_to_earn') ||
        // Include articles that might be linked from EarthRovers pages
        (urlObj.pathname.includes('/articles/') && this.visitedUrls.has(url)) ||
        // Include collection pages that might contain EarthRovers content
        urlObj.pathname.includes('/collections/')
      );
    } catch (error) {
      return false;
    }
  }

  // Normalize URL to avoid duplicates
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove query parameters and fragments for consistency
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (error) {
      return url;
    }
  }

  // Extract ALL links from a page - both EarthRovers specific and potentially related
  async extractAllLinksFromPage(url) {
    try {
      const { data } = await axios.get(url, {
        timeout: 15000, // Increased timeout
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Activation-Bot/1.0)",
        },
      });
      
      const $ = cheerio.load(data);
      const links = [];

      // Find all anchor tags
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
          
          // For collection pages, be more permissive to get all article links
          if (url.includes('/collections/')) {
            // From collection pages, get all article links regardless of EarthRovers specificity
            if (normalizedUrl.includes('/articles/') && 
                normalizedUrl.includes('frodobots/en/') &&
                !this.discoveredUrls.has(normalizedUrl)) {
              links.push(normalizedUrl);
              this.discoveredUrls.add(normalizedUrl);
            }
          } else {
            // For other pages, use EarthRovers validation
            if (this.isValidEarthRoversUrl(normalizedUrl) && 
                !this.discoveredUrls.has(normalizedUrl)) {
              links.push(normalizedUrl);
              this.discoveredUrls.add(normalizedUrl);
            }
          }
        }
      });

      return [...new Set(links)];
    } catch (err) {
      console.error(`🚨 EarthRovers Bot: Error extracting links from ${url}:`, err.message);
      return [];
          }
    }
  
  // Clean and format URLs for Discord auto-linking
  cleanUrlsForDiscord(text) {
    // First, extract URLs from existing markdown links [text](url)
    text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, linkText, url) => {
      // Clean up the URL
      let cleanUrl = url.replace(/[.,;!?]+$/, '');
      // Return just the URL for Discord auto-linking
      return cleanUrl;
    });
    
    // Then handle any remaining plain URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]()]+/g;
    text = text.replace(urlRegex, (url) => {
      // Clean up URL (remove trailing punctuation)
      let cleanUrl = url.replace(/[.,;!?]+$/, '');
      return cleanUrl;
    });
    
    return text;
  }

  // Fetch article content from a page with enhanced content extraction
  async fetchArticleText(url) {
    try {
      const { data } = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Activation-Bot/1.0)",
        },
      });
      
      const $ = cheerio.load(data);
      
      let content = "";
      let title = "";
      
      // Extract title
      title = $('title').text() || $('h1').first().text() || '';
      
      // Try article tag first
      const articleElement = $("article");
      if (articleElement.length > 0) {
        content = articleElement.text();
      } else {
        // Try main content area
        const mainElement = $("main");
        if (mainElement.length > 0) {
          content = mainElement.text();
        } else {
          // Try content-specific selectors for Intercom help center
          const contentElement = $(".article__content, .content, .post-content, .article-body");
          if (contentElement.length > 0) {
            content = contentElement.text();
          } else {
            // Fallback to body content
            const bodyElement = $("body");
            content = bodyElement.text();
          }
        }
      }
      
      // Clean up the text, convert URLs to clickable format, and combine with title
      const cleanText = content.replace(/\s+/g, " ").trim();
      const textWithClickableUrls = this.cleanUrlsForDiscord(cleanText);
      const cleanTitle = title.replace(/\s+/g, " ").trim();
      
      let combinedContent = "";
      if (cleanTitle) {
        combinedContent += `TITLE: ${cleanTitle}\n\n`;
      }
      combinedContent += `URL: ${url}\n\n`;
      combinedContent += textWithClickableUrls;
      
      return combinedContent;
    } catch (err) {
      console.error(`🚨 EarthRovers Bot: Error fetching article ${url}:`, err.message);
      return null;
    }
  }

  // Get all direct article links from the EarthRovers collection page
  async getDirectArticleLinks() {
    console.log("🌍 EarthRovers Bot: Getting direct article links from collection...");
    
    this.discoveredUrls.clear();
    this.visitedUrls.clear();
    
    const directLinks = await this.extractAllLinksFromPage(this.EARTHROVERS_COLLECTION_URL);
    const articleLinks = directLinks.filter(url => url.includes('/articles/'));
    
    console.log(`📄 EarthRovers Bot: Found ${articleLinks.length} direct article links`);
    return articleLinks;
  }

  // Crawl for additional EarthRovers-related content
  async crawlForAdditionalContent(startUrls, depth = 0) {
    if (depth >= this.MAX_DEPTH || this.visitedUrls.size >= this.MAX_URLS) {
      return [];
    }

    const results = [];
    
    for (const startUrl of startUrls) {
      if (this.visitedUrls.has(startUrl) || this.visitedUrls.size >= this.MAX_URLS) {
        continue;
      }

      this.visitedUrls.add(startUrl);
      console.log(`🔍 EarthRovers Bot: Crawling ${startUrl} (depth: ${depth}, visited: ${this.visitedUrls.size})`);

      try {
        // Get content from current page
        const content = await this.fetchArticleText(startUrl);
        if (content) {
          results.push({ url: startUrl, content });
        }

        // If we're not at max depth, look for additional links
        if (depth < this.MAX_DEPTH - 1) {
          const links = await this.extractAllLinksFromPage(startUrl);
          const unvisitedLinks = links.filter(link => !this.visitedUrls.has(link));
          
          if (unvisitedLinks.length > 0) {
            // Process additional links in smaller batches
            const batchSize = Math.min(this.CONCURRENT_REQUESTS, 3);
            for (let i = 0; i < unvisitedLinks.length && this.visitedUrls.size < this.MAX_URLS; i += batchSize) {
              const batch = unvisitedLinks.slice(i, i + batchSize);
              const batchResults = await this.crawlForAdditionalContent(batch, depth + 1);
              results.push(...batchResults);
            }
          }
        }

      } catch (error) {
        console.error(`🚨 EarthRovers Bot: Error crawling ${startUrl}:`, error.message);
      }
    }

    return results;
  }

  // Get ALL EarthRovers article URLs using a comprehensive approach
  async getAllEarthRoversArticleUrls() {
    console.log("🌍 EarthRovers Bot: Starting comprehensive crawl...");
    
    // Step 1: Get all direct article links from the collection page
    const directArticleLinks = await this.getDirectArticleLinks();
    
    // Step 2: Get content from direct articles and crawl for additional links
    console.log("🔍 EarthRovers Bot: Crawling for additional content...");
    const crawledPages = await this.crawlForAdditionalContent([this.EARTHROVERS_COLLECTION_URL, ...directArticleLinks]);
    
    // Step 3: Combine all URLs
    const allUrls = [...new Set([...directArticleLinks, ...crawledPages.map(page => page.url)])];
    
    console.log(`✅ EarthRovers Bot: Comprehensive crawl completed. Found ${allUrls.length} unique EarthRovers pages.`);
    console.log(`📊 EarthRovers Bot: Direct articles: ${directArticleLinks.length}, Additional crawled: ${crawledPages.length - directArticleLinks.length}`);
    
    return allUrls;
  }

  async getCachedArticle(url) {
    const now = Date.now();

    if (
      !this.cachedArticles[url] ||
      now - (this.lastFetched[url] || 0) > this.REFRESH_INTERVAL
    ) {
      this.cachedArticles[url] = await this.fetchArticleText(url);
      this.lastFetched[url] = now;
    }
    return this.cachedArticles[url];
  }

  // Fetch all EarthRovers articles with comprehensive content
  async getAllEarthRoversArticles() {
    const now = Date.now();

    if (
      this.cachedContent &&
      now - this.lastContentFetch < this.CONTENT_CACHE_DURATION
    ) {
      console.log("♻️ EarthRovers Bot: Using cached article content");
      return this.cachedContent;
    }

    const allUrls = await this.getAllEarthRoversArticleUrls();
    console.log(`📚 EarthRovers Bot: Fetching content from ${allUrls.length} articles...`);

    const batchSize = this.CONCURRENT_REQUESTS;
    const allArticles = [];

    for (let i = 0; i < allUrls.length; i += batchSize) {
      const batch = allUrls.slice(i, i + batchSize);
      const batchPromises = batch.map((url) => this.getCachedArticle(url));
      const batchResults = await Promise.all(batchPromises);
      allArticles.push(...batchResults);
    }

    const validArticles = allArticles.filter((article) => article !== null);
    console.log(`✅ EarthRovers Bot: Successfully loaded ${validArticles.length} articles`);

    // Use intelligent content selection to prioritize most important articles
    const prioritizedArticles = this.selectPriorityContent(validArticles);
    
    // Create optimized content with priority articles
    const combinedContent = prioritizedArticles.join("\n\n" + "=".repeat(50) + "\n\n");
    const estimatedTokens = this.estimateTokens(combinedContent);

    console.log(`📊 EarthRovers Bot: Final content tokens: ${estimatedTokens}/${this.MAX_TOKENS}`);

    this.cachedContent = combinedContent;
    this.lastContentFetch = now;

    return combinedContent;
  }

  // Method to refresh content manually
  async refreshContent() {
    console.log("🔄 EarthRovers Bot: Manually refreshing content...");
    this.cachedContent = null;
    this.lastContentFetch = 0;
    this.discoveredUrls.clear();
    this.visitedUrls.clear();
    return await this.getAllEarthRoversArticles();
  }

  // Get cache statistics with more detailed info
  getCacheStats() {
    const now = Date.now();
    const cachedUrls = Object.keys(this.cachedArticles);
    const freshUrls = cachedUrls.filter(
      (url) => now - (this.lastFetched[url] || 0) < this.REFRESH_INTERVAL
    );

    return {
      totalCached: cachedUrls.length,
      freshCached: freshUrls.length,
      contentCacheAge: this.cachedContent ? now - this.lastContentFetch : null,
      contentCacheFresh:
        this.cachedContent &&
        now - this.lastContentFetch < this.CONTENT_CACHE_DURATION,
      discoveredUrls: this.discoveredUrls.size,
      visitedUrls: this.visitedUrls.size,
      estimatedTokens: this.cachedContent ? this.estimateTokens(this.cachedContent) : 0,
      lastRefresh: new Date(this.lastContentFetch).toISOString(),
    };
  }

  // Diagnostic method to check token usage and content breakdown
  getDiagnostics() {
    const stats = this.getCacheStats();
    const maxTokens = this.MAX_TOKENS;
    const usagePercentage = stats.estimatedTokens ? ((stats.estimatedTokens / maxTokens) * 100).toFixed(1) : 0;
    
    return {
      tokenUsage: {
        current: stats.estimatedTokens,
        maximum: maxTokens,
        percentage: usagePercentage,
        remaining: maxTokens - stats.estimatedTokens
      },
      contentLimits: {
        maxUrls: this.MAX_URLS,
        maxDepth: this.MAX_DEPTH,
        concurrentRequests: this.CONCURRENT_REQUESTS
      },
      cacheInfo: {
        totalArticles: stats.totalCached,
        freshArticles: stats.freshCached,
        lastRefresh: stats.lastRefresh
      }
    };
  }
}

export default BotActivationArticleService; 