import axios from "axios";
import * as cheerio from 'cheerio';

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

  // Get all article URLs by crawling from the base URL
  async getAllArticleUrls() {
    console.log("Starting crawl from base URL:", this.BASE_URL);

    // Reset tracking sets
    this.discoveredUrls.clear();
    this.visitedUrls.clear();

    // Start crawling from the base URL
    const crawledPages = await this.crawlPages(this.BASE_URL);

    // Extract unique URLs
    const urls = [...new Set(crawledPages.map(page => page.url))];
    console.log(`Crawling completed. Found ${urls.length} unique pages.`);

    return urls;
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

  // Fetch all articles and combine their content with caching
  async getAllArticles() {
    const now = Date.now();

    // Return cached content if it's still fresh
    if (
      this.cachedContent &&
      now - this.lastContentFetch < this.CONTENT_CACHE_DURATION
    ) {
      console.log("Using cached article content");
      return this.cachedContent;
    }

    const allUrls = await this.getAllArticleUrls();
    console.log(`Fetching content from ${allUrls.length} articles...`);

    // Fetch articles in parallel with concurrency limit
    const batchSize = this.CONCURRENT_REQUESTS;
    const allArticles = [];

    for (let i = 0; i < allUrls.length; i += batchSize) {
      const batch = allUrls.slice(i, i + batchSize);
      const batchPromises = batch.map((url) => this.getCachedArticle(url));
      const batchResults = await Promise.all(batchPromises);
      allArticles.push(...batchResults);
    }

    const validArticles = allArticles.filter((article) => article !== null);
    console.log(`Successfully loaded ${validArticles.length} articles`);

    const combinedContent = validArticles.join("\n\n---\n\n");
    const truncatedContent = this.truncateContent(combinedContent);
    const estimatedTokens = this.estimateTokens(truncatedContent);

    console.log(`Combined content estimated tokens: ${estimatedTokens}`);

    // Cache the result
    this.cachedContent = truncatedContent;
    this.lastContentFetch = now;

    return truncatedContent;
  }

  async initialize() {
    // const allContent = await this.getAllArticles();
    // if (allContent) {
    //   console.log("Article service initialized successfully");
    //   return allContent;
    // } else {
    //   console.log("Failed to load articles, using fallback");
    //   return "Article content unavailable";
    // }
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
    const categoryUrl = this.CATEGORY_URLS[categoryKey];
    if (!categoryUrl) throw new Error("Unknown category");

    // Only extract direct article links from the collection page
    this.discoveredUrls.clear();
    this.visitedUrls.clear();
    const articleLinks = await this.extractLinksFromPage(categoryUrl);

    // Fetch and combine content from only those direct article links
    const allArticles = [];
    for (const url of articleLinks) {
      const content = await this.getCachedArticle(url);
      if (content) allArticles.push(content);
    }
    const combinedContent = allArticles.join("\n\n---\n\n");
    return this.truncateContent(combinedContent);
  }

  // Filter Getting Started content to only include generic or selected-product info
  filterGettingStartedContent(content, productKey) {
    const productKeywords = {
      ufb: [
        'ufb', 'ultimate fighting bot', 'fighting bot', 'robot fighting', 'ufb.gg', 'ultimate fighting', 'fighting game', 'robot combat'
      ],
      earthrover: [
        'earthrover', 'drive to earn', 'personal bot', 'earth rover', 'driving', 'drive', 'earn', 'fbp', 'frodobots points', 'wallet', 'solana', 'activation'
      ],
      earthrover_school: [
        'school', 'earthrover school', 'learning', 'education', 'mission', 'test drive', 'practice', 'training', 'leaderboard', 'xp', 'experience points'
      ],
      sam: [
        'sam', 'small autonomous mofo', 'autonomous', 'mofo', 'small bot', 'autonomous bot', 'small autonomous', 'sam bot', 'autonomous mofo'
      ],
      robotsfun: [
        'robots fun', 'robot fun', 'fun robots', 'robot activities', 'fun activities', 'robot games', 'robot entertainment', 'fun bot', 'entertainment robots'
      ]
    };
    const allProductKeys = Object.keys(productKeywords);
    const selectedKeywords = productKeywords[productKey] || [];
    const otherProductKeywords = allProductKeys.filter(k => k !== productKey).flatMap(k => productKeywords[k]);

    // Split content into paragraphs/sections
    const sections = content.split(/\n{2,}/);
    const filtered = sections.filter(section => {
      const lower = section.toLowerCase();
      // If it mentions another product, exclude
      if (otherProductKeywords.some(word => lower.includes(word))) return false;
      // If it mentions the selected product, keep
      if (selectedKeywords.some(word => lower.includes(word))) return true;
      // If it doesn't mention any product, keep (generic)
      if (!allProductKeys.some(key => productKeywords[key].some(word => lower.includes(word)))) return true;
      // Otherwise, exclude
      return false;
    });
    return filtered.join('\n\n');
  }


}

/**
 * Builds a system prompt for GPT using the selected product's article content.
 * @param {string|array} articleContent - The content for the selected product (string or array of strings/objects).
 * @param {string} productName - The product name (e.g., 'UFB', 'Earthrover').
 * @returns {string} The system prompt for GPT.
 */
export function buildSystemPrompt(articleContent, productName) {
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
- If technical information is not in the provided articles, say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- Be friendly and conversational while staying focused on FrodoBots support

CRITICAL PRODUCT CONSTRAINT:
- You are ONLY authorized to answer questions about ${productName}
- If a user asks about other FrodoBots products (UFB, Earthrover School, SAM, Robots Fun, etc.), politely redirect them to ask about ${productName} instead
- Only provide information that is specifically about ${productName} or general FrodoBots information that applies to ${productName}
- If someone asks about a different product, say something like "I'm here to help with ${productName} questions. For questions about other products, please select the correct product using the buttons above."

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
- For technical questions not covered in the articles, say "I don't have specific information about that. You can ask to talk to team for more detailed help."

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
