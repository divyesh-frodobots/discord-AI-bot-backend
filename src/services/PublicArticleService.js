import axios from "axios";
import * as cheerio from 'cheerio';
import constants from "../config/constants.js";

class PublicArticleService {
  constructor() {
    this.cachedArticles = {};
    this.lastFetched = {};
    this.cachedContent = null; // Cache the combined content
    this.lastContentFetch = 0;
    this.discoveredUrls = new Set(); // Track discovered URLs to avoid duplicates
    this.visitedUrls = new Set(); // Track visited URLs to avoid infinite loops

    // Configuration
    this.BASE_URL = "https://intercom.help/frodobots/en/";
    this.REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    this.MAX_TOKENS = 40000;
    this.CONTENT_CACHE_DURATION = this.REFRESH_INTERVAL;
    this.MAX_DEPTH = 7;
    this.MAX_URLS = 200;
    this.CONCURRENT_REQUESTS = 3;
    this.CATEGORY_URLS = {
      getting_started: "https://intercom.help/frodobots/en/collections/3762588-getting-started",
      earthrover_school: "https://intercom.help/frodobots/en/collections/3762589-earthrovers-school",
      earthrover: "https://intercom.help/frodobots/en/collections/9174353-earthrovers-personal-bots",
      ufb: "https://intercom.help/frodobots/en/collections/12076791-ufb-ultimate-fighting-bots",
      sam: "https://intercom.help/frodobots/en/collections/13197832-sam-small-autonomous-mofo",
      robotsfun: "https://intercom.help/frodobots/en/collections/13197811-robots-fun",
      et_fugi: "https://intercom.help/frodobots/en/articles/11561671-et-fugi-ai-competition"
    };
    this._refreshInProgress = false;
    this._refreshTimeout = null;
  }

  async initialize() {
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
    if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    this._refreshTimeout = setTimeout(async () => {
      await this._refreshContent();
      this._scheduleRefresh();
    }, this.REFRESH_INTERVAL);
  }

  async _refreshContent() {
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
      const allUrls = await this.getAllArticleUrls();
      const batchSize = this.CONCURRENT_REQUESTS;
      const allArticles = [];
      for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        const batchPromises = batch.map((url) => this.getCachedArticle(url));
        const batchResults = await Promise.all(batchPromises);
        allArticles.push(...batchResults);
      }
      const validArticles = allArticles.filter((article) => article !== null);
      const combinedContent = validArticles.join("\n\n---\n\n");
      const truncatedContent = this.truncateContent(combinedContent);
      this.cachedContent = truncatedContent;
      this.lastContentFetch = now;
      console.log(`[PublicArticleService] Fetching all articles: SUCCESS (${validArticles.length} articles)`);
      return truncatedContent;
    } catch (err) {
      console.error("[PublicArticleService] Fetching all articles: ERROR", err);
      if (this.cachedContent) return this.cachedContent;
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

  async crawlPages(startUrl, depth = 0) {
    if (depth >= this.MAX_DEPTH || 
        this.visitedUrls.size >= this.MAX_URLS || 
        this.visitedUrls.has(startUrl)) {
      return [];
    }
    this.visitedUrls.add(startUrl);
    // Add crawl log as in ArticleService
    console.log(`Crawling: ${startUrl} (depth: ${depth}, visited: ${this.visitedUrls.size})`);
    try {
      const links = await this.extractLinksFromPage(startUrl);
      // Fetch and cache content if not already cached
      let content = this.cachedArticles[startUrl];
      if (!content) {
        content = await this.fetchArticleText(startUrl);
        if (content) {
          this.cachedArticles[startUrl] = content;
          this.lastFetched[startUrl] = Date.now();
        }
      }
      const results = content ? [{ url: startUrl, content }] : [];
      if (depth < this.MAX_DEPTH - 1 && links.length > 0) {
        const batchSize = this.CONCURRENT_REQUESTS;
        for (let i = 0; i < links.length && this.visitedUrls.size < this.MAX_URLS; i += batchSize) {
          const batch = links.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(link => this.crawlPages(link, depth + 1)));
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

  // Add getCachedArticle method for per-URL caching
  async getCachedArticle(url) {
    const now = Date.now();
    // Use 24hr cache for public articles
    if (
      this.cachedArticles[url] &&
      now - (this.lastFetched[url] || 0) < this.REFRESH_INTERVAL
    ) {
      return this.cachedArticles[url];
    }
    // If not cached (should be rare after crawl), fetch and cache
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

  // Add a system prompt generator for public channels
  getSystemPrompt() {
    // You can customize this template as needed
    return `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. You have access to the following information from official help articles:\n\n${this.cachedContent || "[No content loaded]"}\n\nDISCORD CONTEXT:\n- You are running as a Discord bot, already within the FrodoBots Discord server\n- Users are interacting with you directly through Discord messages\n- If users need detailed support, they can ask to \"talk to team\" or create a support ticket right here in Discord\n- The support team is available in this Discord server\n\nIMPORTANT GUIDELINES:\n- Be friendly and conversational, like a helpful friend\n- Only answer questions related to FrodoBots services, robot fighting, Earthrovers, or similar topics\n- If the question is not related to FrodoBots, politely redirect them to ask about FrodoBots services\n- Keep responses concise but informative\n- If someone needs detailed help, suggest they ask to \"talk to team\" or create a support ticket right here in Discord\n- Be encouraging and supportive\n- Avoid robotic language - be natural and conversational\n- DO NOT mention website chat widgets or external contact methods - you're already in Discord with them\n- DO NOT add generic closing statements like \"Feel free to ask if you have any questions\" or \"I'm here to help\" - end responses naturally\n- Focus on providing the information directly without unnecessary closing phrases\n\nTONE: Friendly, helpful, and encouraging. Like talking to a knowledgeable friend who wants to help!`;
  }
}

export default PublicArticleService; 