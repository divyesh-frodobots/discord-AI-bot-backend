import axios from "axios";
import * as cheerio from 'cheerio';
import PublicArticleService, { contentService as publicContentService } from './PublicArticleService.js';

class ArticleService {
  constructor() {
    this.cachedArticles = {};
    this.lastFetched = {};
    this.cachedContent = null; // Cache the combined content
    this.lastContentFetch = 0;
    this.discoveredUrls = new Set(); // Track discovered URLs to avoid duplicates
    this.visitedUrls = new Set(); // Track visited URLs to avoid infinite loops

    // Configuration
    this.BASE_URL = "https://intercom.help/frodobots/en/";
    this.REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
    this.MAX_TOKENS = 40000; // Increased for GPT-4.1's 1M context window - comprehensive knowledge base
    this.CONTENT_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes for combined content
    this.MAX_DEPTH = 7; // Increased for comprehensive content with GPT-4.1
    this.MAX_URLS = 200; // Increased to get full knowledge base
    this.CONCURRENT_REQUESTS = 3; // Number of concurrent requests

    this.CATEGORY_URLS = {
      getting_started: "https://intercom.help/frodobots/en/collections/3762588-getting-started",
      earthrover_school: "https://intercom.help/frodobots/en/collections/3762589-earthrovers-school",
      earthrover: "https://intercom.help/frodobots/en/collections/9174353-earthrovers-personal-bots",
      ufb: "https://intercom.help/frodobots/en/collections/12076791-ufb-ultimate-fighting-bots",
      sam: "https://intercom.help/frodobots/en/collections/13197832-sam-small-autonomous-mofo",
      robotsfun: "https://intercom.help/frodobots/en/collections/13197811-robots-fun",
      et_fugi: "https://intercom.help/frodobots/en/articles/11561671-et-fugi-ai-competition"
    };
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

  // Check if URL is within the FrodoBots help center domain
  isValidFrodoBotsUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === 'intercom.help' &&
             urlObj.pathname.startsWith('/frodobots/en/');
    } catch (error) {
      return false;
    }
  }

  // Normalize URL to avoid duplicates
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove hash fragments and query parameters for consistency
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (error) {
      return url;
    }
  }

  // Extract all links from a page
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

  // Fetch article content from a page including links, images, and videos
  async fetchArticleText(url) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UFB-Bot/1.0)",
        },
      });

      const $ = cheerio.load(data);

      // Try multiple selectors to extract content
      let content = "";
      let mediaContent = "";

      // Helper to inline anchor URLs directly where they appear
      const inlineAnchors = (rootEl) => {
        rootEl.find('a[href]').each((_, link) => {
          const href = $(link).attr('href');
          const text = $(link).text().trim();
          if (!href) return;
          let fullUrl;
          if (href.startsWith('http')) {
            fullUrl = href;
          } else if (href.startsWith('/')) {
            fullUrl = new URL(href, url).href;
          } else {
            fullUrl = new URL(href, url).href;
          }
          // Replace the anchor with "text: URL" so links only appear where they are referenced in content
          $(link).replaceWith(`${text ? text + ': ' : ''}${fullUrl}`);
        });
      };

      // Try article tag first
      const articleElement = $("article");
      if (articleElement.length > 0) {
        inlineAnchors(articleElement);
        content = articleElement.text();
      } else {
        // Try main content area
        const mainElement = $("main");
        if (mainElement.length > 0) {
          inlineAnchors(mainElement);
          content = mainElement.text();
        } else {
          // Try body content
          const bodyElement = $("body");
          inlineAnchors(bodyElement);
          content = bodyElement.text();
        }
      }

      // Clean up the text and convert any markdown links if present (rare after inline replacement)
      const cleanText = content.replace(/\s+/g, " ").trim();
      const textWithClickableUrls = this.cleanUrlsForDiscord(cleanText);
      return textWithClickableUrls;
    } catch (err) {
      console.error(`Error fetching article ${url}:`, err.message);
      return null;
    }
  }

  // Extract media content (links, images, videos) from a cheerio element
  extractMediaContent($, element, baseUrl) {
    const mediaItems = [];

    // Extract links
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

    // Extract images
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

    // Extract videos (iframe, video tags, etc.)
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

    // Extract embedded content (YouTube, Vimeo, etc.)
    element.find('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"]').each((index, iframe) => {
      const src = $(iframe).attr('src');
      const title = $(iframe).attr('title') || 'Embedded Video';
      if (src) {
        mediaItems.push(`Embedded Video: ${title} (${src})`);
      }
    });

    return mediaItems.length > 0 ? "Media Content:\n" + mediaItems.join('\n') : "";
  }

  // Recursive crawler to discover all pages
  async crawlPages(startUrl, depth = 0) {
    if (depth >= this.MAX_DEPTH ||
        this.visitedUrls.size >= this.MAX_URLS ||
        this.visitedUrls.has(startUrl)) {
      return [];
    }

    this.visitedUrls.add(startUrl);
    console.log(`Crawling: ${startUrl} (depth: ${depth}, visited: ${this.visitedUrls.size})`);

    try {
      // Extract links from current page
      const links = await this.extractLinksFromPage(startUrl);

      // Get content from current page
      const content = await this.fetchArticleText(startUrl);
      const results = content ? [{ url: startUrl, content }] : [];

      // Recursively crawl discovered links
      if (depth < this.MAX_DEPTH - 1 && links.length > 0) {
        // Process links in batches to avoid overwhelming the server
        const batchSize = this.CONCURRENT_REQUESTS;
        for (let i = 0; i < links.length && this.visitedUrls.size < this.MAX_URLS; i += batchSize) {
          const batch = links.slice(i, i + batchSize);
          const batchPromises = batch.map(link => this.crawlPages(link, depth + 1));
          const batchResults = await Promise.all(batchPromises);

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

  // Deprecated: Crawling is managed by the unified content service now
  async getAllArticleUrls() {
    console.log("[ArticleService] getAllArticleUrls is deprecated; returning empty list");
    return [];
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

  // Unified: delegate to publicContentService for combined content
  async getAllArticles() {
    try {
      // Join all cached categories into one string from the singleton
      const categories = publicContentService.categorizedContent || {};
      const allArticles = Object.values(categories).flat();
      const combined = allArticles.map(a => a.content).join("\n\n---\n\n");
      return this.truncateContent(combined);
    } catch (e) {
      console.warn('[ArticleService] getAllArticles fallback (empty) due to content service not ready');
      return '';
    }
  }

  async initialize() {
    // No-op. Content is initialized by the singleton at startup.
  }

  // Get cache statistics
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
    };
  }

  async getArticlesByCategory(categoryKey) {
    try {
      // Use singleton cache (already initialized on startup)
      return await publicContentService.getArticlesByCategory(categoryKey);
    } catch (e) {
      // Fallback to legacy method if PAS fails
      const categoryUrl = this.CATEGORY_URLS[categoryKey];
      if (!categoryUrl) throw new Error("Unknown category");
      this.discoveredUrls.clear();
      this.visitedUrls.clear();
      const articleLinks = await this.extractLinksFromPage(categoryUrl);
      const allArticles = [];
      for (const url of articleLinks) {
        const content = await this.getCachedArticle(url);
        if (content) allArticles.push(content);
      }
      const combinedContent = allArticles.join("\n\n---\n\n");
      return this.truncateContent(combinedContent);
    }
  }

  /**
   * Get structured articles (url + content) for a product/category
   * Used by ticket flow retrieval-first RAG
   */
  async getStructuredArticlesByCategory(categoryKey) {
    try {
      // Use singleton cache (already initialized on startup)
      const structured = await publicContentService.getStructuredArticlesByCategory(categoryKey);
      // Normalize shape to legacy {url, content}
      return structured.map(a => ({ url: a.url, content: a.content }));
    } catch (e) {
      const categoryUrl = this.CATEGORY_URLS[categoryKey];
      if (!categoryUrl) throw new Error("Unknown category");
      this.discoveredUrls.clear();
      this.visitedUrls.clear();
      const articleLinks = await this.extractLinksFromPage(categoryUrl);
      const results = [];
      for (const url of articleLinks) {
        const content = await this.getCachedArticle(url);
        if (content && content.length > 50) {
          results.push({ url, content });
        }
      }
      return results;
    }
  }

  // filterGettingStartedContent(...) was unused and has been removed


}

/**
 * Builds a system prompt for GPT using the selected product's article content.
 * @param {string|array} articleContent - The content for the selected product (string or array of strings/objects).
 * @param {string} productName - The product name (e.g., 'UFB', 'Earthrover').
 * @returns {string} The system prompt for GPT.
 */
export function buildSystemPrompt(articleContent, productName, options = {}) {
  const allowCrossProduct = !!options.allowCrossProduct;
  let contentString = "";

  // If articleContent is an array of objects, join their content fields
  if (Array.isArray(articleContent)) {
    if (articleContent.length > 0 && typeof articleContent[0] === "object" && articleContent[0].content) {
      contentString = articleContent.map(a => a.content).join("\n\n---\n\n");
    } else {
      contentString = articleContent.join("\n\n---\n\n");
    }
  } else {
    contentString = articleContent;
  }

  return `
You are a friendly and helpful support assistant for FrodoBots, operating directly within Discord. You have access to information about **${productName}** below. Use this information to help users in a natural, conversational way.

CONVERSATION GUIDELINES:
- You can engage in basic conversation, greetings, and general chat
- For technical questions about FrodoBots products, you must STRICTLY ONLY use information from the articles above
- CRITICAL: DO NOT use any external knowledge, training data, or assumptions about FrodoBots, bots, or any other systems
- CRITICAL: If information is not explicitly mentioned in the provided articles above, you MUST say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- FORBIDDEN: Never generate answers from your training data about FrodoBots products when the information is not in the provided articles
- Be friendly and conversational while staying focused on FrodoBots support

${allowCrossProduct
  ? `CROSS-PRODUCT HANDLING:
- The user may mention multiple products. Prioritize answering with the information provided for ${productName}.
- Do NOT ask the user to switch products or click buttons; just answer directly for ${productName} if the question can be addressed with the information above.
- Only if the question is entirely unrelated to ${productName} and cannot be answered from the information above, briefly ask one clarifying question; otherwise suggest talking to team.`
  : `CRITICAL PRODUCT CONSTRAINT:
- You are ONLY authorized to answer questions about ${productName}
- If a user asks about other FrodoBots products (UFB, Earthrover School, SAM, Robots Fun, etc.), politely redirect them to ask about ${productName} instead
- Only provide information that is specifically about ${productName} or general FrodoBots information that applies to ${productName}
- If someone asks about a different product, say something like "I'm here to help with ${productName} questions. For questions about other products, please select the correct product using the buttons above."
- CRITICAL: If someone asks about features not mentioned in the ${productName} articles above (like test drives, features from other products, etc.), say "I don't have specific information about that for ${productName}. You can ask to talk to team for more detailed help."`}

${contentString}

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can type "talk to team" or request human help in this same Discord channel
- The support team is available in this Discord server and will be notified when users need assistance

IMPORTANT GUIDELINES:
- Be friendly and conversational, like a helpful friend
- ONLY answer questions about ${productName} - redirect other product questions
- If you know the answer from the information above, give it directly and confidently
- If you don't have enough information about ${productName}, be honest but helpful - suggest what you do know and offer to connect them with human support
- When referring users to additional help, mention that they can type "talk to team" or ask for human support right here in Discord
- Avoid robotic phrases like "The information provided does not specify..." or "Based on the available data..."
- Instead, say things like "I don't have specific info about that for ${productName}, but here's what I do know..." or "That's a great question about ${productName}! Let me share what I can help with..."
- Keep responses concise but warm and helpful
- If someone needs more detailed help, mention they can get human assistance right here in Discord by asking to "talk to team"
- Always be encouraging and supportive - we want users to feel helped, not frustrated
- DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
- DO NOT add generic closing statements like "Feel free to ask if you have any questions" or "I'm here to help" - end responses naturally
- Focus on providing the information directly without unnecessary closing phrases
- For technical questions not covered in the articles, say "I don't have specific information about that for ${productName}. You can ask to talk to team for more detailed help."
- NEVER invent or assume information about ${productName} features that are not explicitly mentioned in the articles above

TONE: Friendly, helpful, honest, and encouraging. Like talking to a knowledgeable friend who wants to help!
  `.trim();
}

export function buildHumanHelpPrompt() {
  return `
You are an AI assistant in the FrodoBots Discord server.

Your job is to read a user's message and decide whether they need HUMAN support or if the AI can handle it.

---

RESPOND WITH ONE OF:
- ESCALATE → if the user explicitly wants a human or is clearly frustrated with the bot
- CONTINUE → if the AI can reasonably help (DEFAULT for most questions)

---

ESCALATE ONLY if:
- The message explicitly requests humans: "talk to human", "contact team", "speak to someone", "real person", "support agent"
- The user is clearly frustrated with the BOT: "this bot sucks", "AI isn't helping", "nothing works", "I'm tired of this bot"
- The user explicitly wants escalation: "escalate this", "speak to manager", "get me a human"

CONTINUE for EVERYTHING ELSE including:
- ANY login, password, or access questions ("can't log in", "forgot password", "access issues")
- ANY technical questions ("how does X work", "what is Y", "setup help")  
- ANY general help requests ("help me", "can you help", "I need assistance")
- ANY product questions ("features", "pricing", "capabilities")
- ANY troubleshooting questions ("not working", "having issues", "problems with")

---

Examples:
- "I want to talk to someone" → ESCALATE
- "I can't log in" → CONTINUE
- "Can you help me?" → CONTINUE  
- "This bot isn't helping me" → ESCALATE
- "Having trouble with login" → CONTINUE
- "Need human support" → ESCALATE
- "How do I reset password?" → CONTINUE
- "Get me a real person" → ESCALATE

---

When in doubt, choose CONTINUE. Only escalate if there's a clear, explicit request for human help.

Respond with ONLY: ESCALATE or CONTINUE.
  `.trim();
}

export default ArticleService;
