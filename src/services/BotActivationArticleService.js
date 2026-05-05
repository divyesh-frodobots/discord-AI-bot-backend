import axios from "axios";
import * as cheerio from 'cheerio';
import embeddingService from './EmbeddingService.js';

class BotActivationArticleService {
  constructor() {
    this.cachedArticles = {};
    this.lastFetched = {};
    this.cachedContent = null;
    this.lastContentFetch = 0;
    this.discoveredUrls = new Set();
    this.visitedUrls = new Set();

    // Structured article storage for retrieval
    this.structuredArticles = [];

    // Configuration specific to EarthRovers
    this.EARTHROVERS_COLLECTION_URL = "https://intercom.help/frodobots/en/collections/9174353-et-fugi-earthrover";
    // Additional collection URLs to ensure full coverage (FAQs, SIM cards, etc.)
    this.ADDITIONAL_COLLECTION_URLS = [
      "https://intercom.help/frodobots/en/collections/13786258-faqs",
    ];
    this.BASE_URL = "https://intercom.help/frodobots/en/";
    this.REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
    this.MAX_TOKENS = 40000; // Increased for GPT-4.1's 1M context window - comprehensive knowledge base
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
      const cacheBustUrl = `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
      const { data } = await axios.get(cacheBustUrl, {
        timeout: 15000, // Increased timeout
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Activation-Bot/1.0)",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
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
      const cacheBustUrl2 = `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
      const { data } = await axios.get(cacheBustUrl2, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Activation-Bot/1.0)",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      
      const $ = cheerio.load(data);
      
      let content = "";
      let title = "";
      
      // Extract title
      title = $('title').text() || $('h1').first().text() || '';
      
      // Find content element (priority order)
      const contentElement = $("article").length ? $("article") : 
                             $("main").length ? $("main") : 
                             $("body");
      
      // Replace links with "text (<url>)" to preserve URLs (angle brackets suppress Discord embeds)
      contentElement.find('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && !href.startsWith('#') && text) {
          $(el).replaceWith(`${text} (${href})`);
        }
      });
      
      content = contentElement.text();
      
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

    // Step 1b: Also get articles from additional collections (FAQs, etc.)
    for (const collectionUrl of this.ADDITIONAL_COLLECTION_URLS) {
      try {
        const links = await this.extractAllLinksFromPage(collectionUrl);
        const articleLinks = links.filter(url => url.includes('/articles/'));
        directArticleLinks.push(...articleLinks);
        console.log(`📄 EarthRovers Bot: Found ${articleLinks.length} additional articles from ${collectionUrl}`);
      } catch (e) {
        console.warn(`⚠️ EarthRovers Bot: Failed to fetch additional collection ${collectionUrl}:`, e.message);
      }
    }

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

  // Build structured articles from crawled content (call after getAllEarthRoversArticles)
  async buildStructuredArticles() {
    const articles = [];
    for (const [url, content] of Object.entries(this.cachedArticles)) {
      if (!content || content.length < 50) continue;
      // Extract title from cached content (format: "TITLE: ...\n\nURL: ...\n\n...")
      const titleMatch = content.match(/^TITLE:\s*(.+?)(?:\n|$)/);
      const title = titleMatch ? titleMatch[1].trim() : 'Untitled';
      articles.push({ url, title, content, embedding: null });
    }
    // Pre-compute embeddings
    let prepared = 0;
    for (const article of articles) {
      try {
        article.embedding = await embeddingService.embedText(article.content);
        prepared++;
      } catch {}
    }
    this.structuredArticles = articles;
    console.log(`📊 EarthRovers Bot: Built ${articles.length} structured articles, embedded ${prepared}`);
    return articles;
  }

  // Retrieve most relevant articles for a query using embedding similarity
  async getRelevantArticles(query, topK = 8, minScore = 0.22) {
    if (!this.structuredArticles || this.structuredArticles.length === 0) {
      console.log('[ActivationArticleService] No structured articles, falling back to cached content');
      return this.cachedContent || '';
    }

    const queryVec = await embeddingService.embedText((query || '').toLowerCase());
    const corpus = this.structuredArticles
      .filter(a => Array.isArray(a.embedding) && a.embedding.length > 0)
      .map(a => ({ id: a.url, vector: a.embedding, payload: a }));

    const ranked = embeddingService.constructor.topK(queryVec, corpus, topK);
    const filtered = ranked.filter(r => (r.score || 0) >= minScore);

    console.log(`🔍 [Activation RAG] Query: "${query.slice(0, 60)}"`);
    ranked.slice(0, 5).forEach((r, i) => console.log(`  #${i + 1} score=${(r.score || 0).toFixed(4)} url=${r.id}`));
    console.log(`✅ [Activation RAG] Selected ${filtered.length} articles above threshold ${minScore}`);

    if (filtered.length === 0) {
      // Fallback: return top 3 regardless of score
      const fallback = ranked.slice(0, 3).map(r => r.payload.content);
      return fallback.join('\n\n---\n\n');
    }

    return filtered.map(r => r.payload.content).join('\n\n---\n\n');
  }

  // Method to refresh content manually
  async refreshContent() {
    console.log("🔄 EarthRovers Bot: Manually refreshing content...");
    this.cachedContent = null;
    this.lastContentFetch = 0;
    this.structuredArticles = [];
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