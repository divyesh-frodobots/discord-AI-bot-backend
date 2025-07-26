import axios from "axios";
import * as cheerio from 'cheerio';
import constants from "../config/constants.js";

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
      
      // Try article tag first
      const articleElement = $("article");
      if (articleElement.length > 0) {
        content = articleElement.text();
        mediaContent = this.extractMediaContent($, articleElement, url);
      } else {
        // Try main content area
        const mainElement = $("main");
        if (mainElement.length > 0) {
          content = mainElement.text();
          mediaContent = this.extractMediaContent($, mainElement, url);
        } else {
          // Try body content
          const bodyElement = $("body");
          content = bodyElement.text();
          mediaContent = this.extractMediaContent($, bodyElement, url);
        }
      }
      
      // Clean up the text, convert URLs to clickable format, and combine with media content
      const cleanText = content.replace(/\s+/g, " ").trim();
      const textWithClickableUrls = this.cleanUrlsForDiscord(cleanText);
      const combinedContent = textWithClickableUrls + (mediaContent ? "\n\n" + mediaContent : "");
      
      return combinedContent;
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

  // Check if a question is related to a specific product using article content
  async checkProductRelevance(question, selectedProduct) {
    try {
      // Get all article content
      const allContent = await this.getAllArticles();
      if (!allContent || allContent === "Article content unavailable") {
        console.log("Article content not available, falling back to keyword check");
        return this.fallbackProductRelevance(question, selectedProduct);
      }

      // Create a simple relevance check using the question and product context
      const questionLower = question.toLowerCase();
      const productContext = this.getProductContext(selectedProduct);
      
      // Check if the question contains words that appear in the article content
      const questionWords = questionLower.split(/\s+/).filter(word => word.length > 2);
      const contentLower = allContent.toLowerCase();
      
      // Count how many question words appear in the content
      let relevantWords = 0;
      for (const word of questionWords) {
        if (contentLower.includes(word)) {
          relevantWords++;
        }
      }
      
      // If more than 50% of question words are found in content, consider it relevant
      const relevanceThreshold = Math.max(1, questionWords.length * 0.3); // At least 30% of words or 1 word
      const isRelevant = relevantWords >= relevanceThreshold;
      
      return isRelevant;
    } catch (error) {
      console.error("Error checking product relevance:", error.message);
      return this.fallbackProductRelevance(question, selectedProduct);
    }
  }

  // Fallback to keyword-based relevance check
  fallbackProductRelevance(question, selectedProduct) {
    const contentLower = question.toLowerCase();
    
    const productKeywords = {
      ufb: [
        'ufb', 'fighting bot', 'ultimate fighting bot', 'robot fighting', 
        'ufb.gg', 'session', 'booking', 'fight', 'combat', 'battle',
        'ultimate fighting', 'fighting game', 'robot combat', 'how to fight',
        'fight process', 'fight steps', 'start fight', 'fight tutorial'
      ],
      earthrover: [
        'earthrover', 'rover', 'drive to earn', 'personal bot', 'earth rover',
        'driving', 'drive', 'earn', 'fbp', 'frodobots points', 'wallet', 'solana',
        'personal drive', 'share access', 'ownership', 'transfer', 'start drive',
        'how to drive', 'drive process', 'drive steps', 'drive tutorial'
      ],
      earthrover_school: [
        'school', 'earthrover school', 'learning', 'education', 'mission',
        'test drive', 'practice', 'training', 'leaderboard', 'xp', 'experience points',
        'game pass', 'life points', 'lp', 'time credits', 'tc', 'how to learn',
        'learning process', 'school tutorial', 'education steps'
      ],
      sam: [
        'sam', 'small autonomous mofo', 'autonomous', 'mofo', 'small bot',
        'autonomous bot', 'small autonomous', 'sam bot', 'autonomous mofo',
        'how to use sam', 'sam tutorial', 'sam guide', 'sam features',
        'sam capabilities', 'sam functions', 'sam operations'
      ],
      robotsfun: [
        'robots fun', 'robot fun', 'fun robots', 'robot activities',
        'fun activities', 'robot games', 'robot entertainment', 'fun bot',
        'entertainment robots', 'robot play', 'fun robot activities',
        'robot fun activities', 'entertainment bot', 'fun robot games'
      ]
    };
    
    const keywords = productKeywords[selectedProduct] || [];
    return keywords.some(keyword => contentLower.includes(keyword));
  }

  // Get product context for better relevance checking
  getProductContext(selectedProduct) {
    const contexts = {
      ufb: "Ultimate Fighting Bots, robot fighting, combat, battles, sessions, bookings",
      earthrover: "Earthrover, drive to earn, personal bot, driving, earning points, wallet",
      earthrover_school: "Earthrover School, learning, education, missions, training, practice",
      sam: "SAM, Small Autonomous Mofo, autonomous bot, small autonomous robot, autonomous operations",
      robotsfun: "Robots Fun, robot entertainment, fun robot activities, robot games, entertainment robots"
    };
    return contexts[selectedProduct] || "";
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

  findRelevantArticles(articles, question, maxResults = 3) {
    const questionLower = question.toLowerCase();
    // Score each article by number of question words present
    const questionWords = questionLower.split(/\s+/).filter(w => w.length > 2);
    const scored = articles.map(article => {
      const contentLower = article.content.toLowerCase();
      let score = 0;
      for (const word of questionWords) {
        if (contentLower.includes(word)) score++;
      }
      return { ...article, score };
    });
    // Sort by score descending and return top results
    return scored
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  // Filter Getting Started content to only include generic or selected-product info
  filterGettingStartedContent(content, productKey) {
    const productKeywords = {
      ufb: [
        'ufb', 'ultimate fighting bot', 'fighting bot', 'robot fighting', 'ufb.gg', 'ultimate fighting', 'fighting game', 'robot combat'
      ],
      earthrover: [
        'earthrover', 'drive to earn', 'personal bot', 'earth rover', 'driving', 'drive', 'earn', 'fbp', 'frodobots points', 'wallet', 'solana'
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

  // Fetch and combine product-specific and Getting Started articles with filtering
  async getCombinedProductAndGettingStartedArticles(productKey) {
    // Fetch product-specific articles
    const productContent = await this.getArticlesByCategory(productKey);
    // Fetch Getting Started articles and filter
    let gettingStartedContent = await this.getArticlesByCategory('getting_started');
    gettingStartedContent = this.filterGettingStartedContent(gettingStartedContent, productKey);
    // Combine both, with Getting Started first
    const combinedContent = `# Getting Started\n\n${gettingStartedContent}\n\n---\n\n# ${productKey.charAt(0).toUpperCase() + productKey.slice(1)}\n\n${productContent}`;
    return this.truncateContent(combinedContent);
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

${contentString}

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can type "talk to team" or request human help in this same Discord channel
- The support team is available in this Discord server and will be notified when users need assistance

IMPORTANT GUIDELINES:
- Be friendly and conversational, like a helpful friend
- If you know the answer from the information above, give it directly and confidently
- If you don't have enough information, be honest but helpful - suggest what you do know and offer to connect them with human support
- When referring users to additional help, mention that they can type "talk to team" or ask for human support right here in Discord
- Avoid robotic phrases like "The information provided does not specify..." or "Based on the available data..."
- Instead, say things like "I don't have specific info about that, but here's what I do know..." or "That's a great question! Let me share what I can help with..."
- Keep responses concise but warm and helpful
- If someone needs more detailed help, mention they can get human assistance right here in Discord by asking to "talk to team"
- Always be encouraging and supportive - we want users to feel helped, not frustrated
- DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
- DO NOT add generic closing statements like "Feel free to ask if you have any questions" or "I'm here to help" - end responses naturally
- Focus on providing the information directly without unnecessary closing phrases

TONE: Friendly, helpful, honest, and encouraging. Like talking to a knowledgeable friend who wants to help!
  `.trim();
}

export function buildHumanHelpPrompt() {
  return `
You are an advanced customer support AI for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. You are designed to assist users while accurately identifying when human intervention is needed. Your goal is to maximize user satisfaction by detecting subtle cues that indicate a need for real support, even when explicit keywords are missing.

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- When escalation is needed, the support team will be notified in this same Discord channel

MESSAGE ANALYSIS FRAMEWORK:

1. DIRECT INDICATORS (Explicit requests for human help):
- "I want to talk to a human"
- "Can I speak to someone?"
- "I need to talk to support team"
- "Talk to human"
- "Speak to human"
- "Need human help"
- "Human support"
- "Real person please"
- "Live person"
- "Talk to support"
- "Speak to agent"
- "Customer service"
- "I want to talk to someone"
- "Need support team"
- "Talk to someone"
- "Speak to someone"
- "Human representative"
- "I want to talk with someone"
- "Talk to team"
- "Contact team"
- "Need team help"

2. INDIRECT INDICATORS (Subtle cues suggesting human help needed):
- Frustration: "This is getting frustrating", "I'm tired of this", "Why is this so difficult?"
- Repeated issues: "I've tried everything", "Nothing works", "This keeps happening"
- Urgency: "I need this fixed now", "This is urgent", "I can't wait"
- Dissatisfaction: "This doesn't solve my problem", "That's not what I need", "This isn't helping"
- Confusion: "I don't understand", "This is confusing", "I'm lost"
- Escalation: "I want to speak to a manager", "Get me someone higher up", "I need to escalate this"

3. EMOTIONAL TONE ANALYSIS:
- Anger, frustration, or impatience
- Desperation or urgency
- Confusion or helplessness
- Dissatisfaction with previous responses
- Signs of giving up or losing hope

4. CONTEXTUAL CUES:
- Multiple follow-up questions without resolution
- Complex or technical issues beyond basic FAQ
- Personal or account-specific problems
- Requests for exceptions or special handling
- Issues that require account verification or access

DECISION CRITERIA:

🔴 HUMAN SUPPORT REQUIRED when:
- User uses any direct indicator phrase (including "talk to team")
- User shows frustration, anger, or desperation
- User has tried multiple solutions without success
- Issue is complex, personal, or requires account access
- User explicitly wants to speak with someone
- Previous automated responses haven't resolved the issue

🟢 AUTOMATED RESPONSE SUFFICIENT when:
- Clear product questions ("what is X", "how does Y work")
- General information requests
- Feature inquiries or capability questions
- Simple troubleshooting steps
- FAQ-type questions
- Identity questions ("what are you?", "who are you?", "are you AI?") - respond naturally as FrodoBots AI

🟡 CLARIFICATION NEEDED when:
- Message is vague or lacks detail
- Intent is unclear
- Need more context to determine appropriate response

RESPONSE PROTOCOL:

If human support is required, respond with ONLY the exact escalation message:
${constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM)}

If automated help is sufficient, provide a relevant, helpful answer in a friendly, conversational tone.

For identity questions like "what are you?" or "who are you?", respond naturally as FrodoBots' AI assistant without escalating to human support.

If clarification is needed, ask a gentle follow-up question to better understand the issue.

IMPORTANT: 
- When human support is required, respond with ONLY the exact escalation message above, nothing else
- Always prioritize user satisfaction. When in doubt about whether human help is needed, err on the side of escalation rather than leaving a user frustrated or unresolved
- Do NOT include the escalation message as part of a longer response - it should be the complete response
- Remember that "talk to team" is a common Discord phrase users might use to request human help
  `.trim();
}

export default ArticleService;
