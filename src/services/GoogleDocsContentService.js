import axios from 'axios';
import redis from './redisClient.js';
import dynamicPublicChannelService from './dynamic/DynamicPublicChannelService.js';
import dynamicTicketChannelService from './dynamic/DynamicTicketChannelService.js';

/**
 * Google Docs Content Service
 * Fetches, caches, and manages Google Docs content for AI responses
 * Features:
 * - Daily auto-refresh of all Google Docs
 * - Redis caching with 24-hour TTL
 * - Content relevance scoring
 * - Integration with existing AI response system
 */
class GoogleDocsContentService {
  constructor() {
    this.CACHE_PREFIX = 'google_docs_content:';
    this.CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds
    this.MAX_CONTENT_LENGTH = 50000; // Max content length per doc
    this.MAX_COMBINED_TOKENS = 15000; // Max tokens for combined multiple docs
    this.REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    
    // Start daily refresh scheduler
    this.startDailyRefreshScheduler();
  }

  /**
   * Get Redis key for cached Google Docs content
   */
  _getCacheKey(url) {
    // Create a safe key from URL
    const urlHash = Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    return `${this.CACHE_PREFIX}${urlHash}`;
  }

  /**
   * Convert Google Docs URL to exportable plain text URL
   */
  _convertToExportUrl(googleDocsUrl) {
    try {
      // Extract document ID from Google Docs URL
      const docIdMatch = googleDocsUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!docIdMatch) {
        throw new Error('Invalid Google Docs URL format');
      }
      
      const docId = docIdMatch[1];
      console.log(`📄 Converting Google Docs URL to export URL: ${googleDocsUrl}`);
      console.log(`📄 Document ID: ${docId}`);
      
      // Convert to plain text export URL
      return `https://docs.google.com/document/d/${docId}/export?format=txt`;
    } catch (error) {
      console.error(`❌ Error converting Google Docs URL: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch content from a single Google Doc
   */
  async fetchGoogleDocContent(url, useCache = true) {
    try {
      const cacheKey = this._getCacheKey(url);
      
      // Check cache first if enabled
      if (useCache) {
        const cachedContent = await redis.get(cacheKey);
        if (cachedContent) {
          console.log(`📄 Using cached Google Docs content for: ${url.substring(0, 50)}...`);
          return JSON.parse(cachedContent);
        }
      }

      console.log(`🔄 Fetching fresh Google Docs content from: ${url.substring(0, 50)}...`);
      
      // Convert to export URL
      const exportUrl = this._convertToExportUrl(url);
      if (!exportUrl) {
        return null;
      }

      // Fetch content from Google Docs
      const response = await axios.get(exportUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FrodoBots-AI/1.0)',
        },
      });

      if (!response.data) {
        console.warn(`⚠️ Empty response from Google Docs: ${url}`);
        return null;
      }

      // Process and clean content
      const rawContent = response.data;
      const cleanContent = this._cleanContent(rawContent);
      
      if (cleanContent.length < 100) {
        console.warn(`⚠️ Google Docs content too short, might be private or empty: ${url}`);
        return null;
      }

      // Create content object
      const contentObject = {
        url: url,
        content: cleanContent,
        lastFetched: new Date().toISOString(),
        contentLength: cleanContent.length,
        tokenEstimate: this._estimateTokens(cleanContent)
      };

      // Cache the content
      await redis.setEx(cacheKey, this.CACHE_TTL, JSON.stringify(contentObject));
      
      console.log(`✅ Fetched and cached Google Docs content: ${cleanContent.length} chars, ~${contentObject.tokenEstimate} tokens`);
      return contentObject;

    } catch (error) {
      // Special handling for authentication errors
      if (error.response && error.response.status === 401) {
        console.error(`🔒 AUTHENTICATION ERROR for Google Doc: ${url}`);
        return null; // Don't use cache for auth errors - need to fix the document
      }
      
      console.error(`❌ Error fetching Google Docs content from ${url}:`, error.message);
      
      // Try to return cached content as fallback
      if (useCache) {
        try {
          const cacheKey = this._getCacheKey(url);
          const cachedContent = await redis.get(cacheKey);
          if (cachedContent) {
            console.log(`🔄 Using stale cached content as fallback for: ${url}`);
            return JSON.parse(cachedContent);
          }
        } catch (cacheError) {
          console.error(`❌ Cache fallback failed: ${cacheError.message}`);
        }
      }
      
      return null;
    }
  }

  /**
   * Clean and format Google Docs content
   */
  _cleanContent(rawContent) {
    if (!rawContent || typeof rawContent !== 'string') {
      return '';
    }

    let content = rawContent;
    
    // Remove excessive whitespace and normalize line breaks
    content = content.replace(/\r\n/g, '\n');
    content = content.replace(/\r/g, '\n');
    content = content.replace(/\n{3,}/g, '\n\n');
    content = content.replace(/[ \t]+/g, ' ');
    content = content.trim();
    
    // Truncate if too long
    if (content.length > this.MAX_CONTENT_LENGTH) {
      content = content.substring(0, this.MAX_CONTENT_LENGTH) + '\n\n[Content truncated - document continues...]';
    }
    
    return content;
  }

  /**
   * Estimate token count for content
   */
  _estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get relevant Google Docs content for a channel and user query
   */
  async getChannelGoogleDocsContent(guildId, channelId, userQuery = null) {
    try {
      // Get Google Docs links for this channel (merge public + ticket sources)
      const publicLinks = await dynamicPublicChannelService.getChannelGoogleDocLinks(guildId, channelId).catch(() => []);
      const ticketLinks = await dynamicTicketChannelService.getChannelGoogleDocLinks(guildId, channelId).catch(() => []);
      const merged = Array.from(new Set([...(publicLinks || []), ...(ticketLinks || [])]));
      
      if (!merged || merged.length === 0) {
        console.log(`📄 No Google Docs configured for channel ${channelId}`);
        return null;
      }

      console.log(`📄 Found ${merged.length} Google Docs for channel ${channelId}:`);
      merged.forEach((url, i) => console.log(`   ${i + 1}. ${url.substring(0, 80)}...`));
      
      // Fetch content from all Google Docs in parallel
      const contentPromises = merged.map((url, index) => 
        this.fetchGoogleDocContent(url).catch(error => {
          console.error(`❌ Failed to fetch Google Doc ${index + 1}: ${error.message}`);
          return null;
        })
      );
      const contentResults = await Promise.all(contentPromises);
      
      // Filter out failed fetches and log results
      const validContent = contentResults.filter(content => content !== null);
      const failedCount = merged.length - validContent.length;
      
      if (failedCount > 0) {
        console.warn(`⚠️ ${failedCount} out of ${merged.length} Google Docs failed to fetch for channel ${channelId}`);
      }
      
      if (validContent.length === 0) {
        console.warn(`⚠️ No valid Google Docs content retrieved for channel ${channelId}`);
        return null;
      }

      // Combine all content with intelligent truncation
      const combinedContent = this._combineContentWithLimits(validContent, userQuery);
      
      console.log(`✅ Retrieved Google Docs content: ${combinedContent.length} chars from ${validContent.length} docs`);
      return combinedContent;

    } catch (error) {
      console.error(`❌ Error getting Google Docs content for channel ${channelId}:`, error.message);
      return null;
    }
  }

  /**
   * Combine content from multiple Google Docs with intelligent limits
   */
  _combineContentWithLimits(contentObjects, userQuery = null) {
    if (!contentObjects || contentObjects.length === 0) {
      return '';
    }

    // Single document - use original method
    if (contentObjects.length === 1) {
      return this._combineContent(contentObjects, userQuery);
    }

    // Multiple documents - check token limits
    const totalTokens = contentObjects.reduce((sum, obj) => sum + obj.tokenEstimate, 0);
    
    if (totalTokens <= this.MAX_COMBINED_TOKENS) {
      // All content fits - use full content
      console.log(`📄 All ${contentObjects.length} docs fit within ${this.MAX_COMBINED_TOKENS} token limit`);
      return this._combineContent(contentObjects, userQuery);
    }

    // Content too large - need to truncate intelligently
    console.log(`⚠️ Combined content (${totalTokens} tokens) exceeds limit (${this.MAX_COMBINED_TOKENS}). Applying intelligent truncation...`);
    
    // Sort by content length (prioritize shorter docs that are likely more focused)
    const sortedContent = [...contentObjects].sort((a, b) => a.tokenEstimate - b.tokenEstimate);
    
    const selectedContent = [];
    let currentTokens = 0;
    const headerTokens = 200; // Reserve tokens for headers and metadata
    
    for (const doc of sortedContent) {
      if (currentTokens + doc.tokenEstimate + headerTokens <= this.MAX_COMBINED_TOKENS) {
        selectedContent.push(doc);
        currentTokens += doc.tokenEstimate;
        console.log(`   ✅ Including doc ${this._extractDocumentId(doc.url)}: ${doc.tokenEstimate} tokens`);
      } else {
        console.log(`   ❌ Skipping doc ${this._extractDocumentId(doc.url)}: would exceed limit`);
      }
    }

    if (selectedContent.length === 0) {
      // Fallback: use just the first document, truncated
      const firstDoc = contentObjects[0];
      const maxChars = (this.MAX_COMBINED_TOKENS - headerTokens) * 4; // Rough char estimate
      const truncatedContent = firstDoc.content.substring(0, maxChars) + '\n\n[Content truncated due to size limits...]';
      
      return `GOOGLE DOCS CONTENT (1 of ${contentObjects.length} documents shown due to size limits):

=== DOCUMENT 1 (ID: ${this._extractDocumentId(firstDoc.url)}) ===
Last Updated: ${new Date(firstDoc.lastFetched).toLocaleDateString()}
Content: TRUNCATED to fit token limits

${truncatedContent}`;
    }

    // Use selected content
    const skippedCount = contentObjects.length - selectedContent.length;
    const result = this._combineContent(selectedContent, userQuery);
    
    if (skippedCount > 0) {
      return `${result}\n\n[Note: ${skippedCount} additional document(s) were not included due to size limits]`;
    }
    
    return result;
  }

  /**
   * Original combine method for internal use
   */
  _combineContent(contentObjects, userQuery = null) {
    if (!contentObjects || contentObjects.length === 0) {
      return '';
    }

    // Single document - return content directly
    if (contentObjects.length === 1) {
      console.log(`📄 Using single Google Doc: ${contentObjects[0].tokenEstimate} tokens`);
      return contentObjects[0].content;
    }

    // Multiple documents - combine with clear separators and metadata
    console.log(`📄 Combining ${contentObjects.length} Google Docs:`);
    
    const combinedSections = contentObjects.map((obj, index) => {
      const docNumber = index + 1;
      const urlId = this._extractDocumentId(obj.url);
      const tokenCount = obj.tokenEstimate;
      const lastUpdated = new Date(obj.lastFetched).toLocaleDateString();
      
      console.log(`   ${docNumber}. Doc ID: ${urlId}, ${obj.contentLength} chars, ~${tokenCount} tokens`);
      
      return `=== DOCUMENT ${docNumber} (ID: ${urlId}) ===
Last Updated: ${lastUpdated}
Content Length: ${obj.contentLength} characters

${obj.content}`;
    });

    const totalTokens = contentObjects.reduce((sum, obj) => sum + obj.tokenEstimate, 0);
    const header = `MULTIPLE GOOGLE DOCS CONTENT (${contentObjects.length} documents, ~${totalTokens} total tokens):

`;

    console.log(`📄 Combined content: ${totalTokens} total tokens from ${contentObjects.length} documents`);
    
    return header + combinedSections.join('\n\n' + '='.repeat(50) + '\n\n');
  }

  /**
   * Extract document ID from Google Docs URL for identification
   */
  _extractDocumentId(url) {
    try {
      const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return match ? match[1].substring(0, 8) + '...' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Refresh all Google Docs content across all channels
   */
  async refreshAllGoogleDocsContent() {
    try {
      console.log('🔄 Starting daily refresh of all Google Docs content...');
      
      // Get all channel details across public and ticket
      const allChannelDetails = await this._getAllChannelDetails();
      
      let totalDocs = 0;
      let successfulRefresh = 0;
      
      for (const { guildId, channelId, googleDocLinks } of allChannelDetails) {
        if (googleDocLinks && googleDocLinks.length > 0) {
          console.log(`🔄 Refreshing ${googleDocLinks.length} docs for guild ${guildId}, channel ${channelId}`);
          
          for (const url of googleDocLinks) {
            totalDocs++;
            try {
              // Force refresh (bypass cache)
              const content = await this.fetchGoogleDocContent(url, false);
              if (content) {
                successfulRefresh++;
              }
            } catch (error) {
              console.error(`❌ Failed to refresh Google Doc ${url}:`, error.message);
            }
          }
        }
      }
      
      console.log(`✅ Daily refresh completed: ${successfulRefresh}/${totalDocs} Google Docs refreshed successfully`);
      
    } catch (error) {
      console.error('❌ Error during daily Google Docs refresh:', error.message);
    }
  }

  /**
   * Get all channel details with Google Docs (helper method)
   */
  async _getAllChannelDetails() {
    try {
      // Collect from public
      const publicKeys = await redis.keys('public_channels:*');
      const ticketKeys = await redis.keys('ticket_channels:*');
      const allChannelDetails = [];
      // Public channels
      for (const key of publicKeys) {
        const guildId = key.replace('public_channels:', '');
        const channelDetails = await dynamicPublicChannelService.getChannelDetails(guildId);
        for (const channel of channelDetails) {
          if (channel.googleDocLinks && channel.googleDocLinks.length > 0) {
            allChannelDetails.push({ guildId, channelId: channel.channelId, googleDocLinks: channel.googleDocLinks });
          }
        }
      }
      // Ticket channels
      for (const key of ticketKeys) {
        const guildId = key.replace('ticket_channels:', '');
        const channelDetails = await dynamicTicketChannelService.getChannelDetails(guildId);
        for (const channel of channelDetails) {
          if (channel.googleDocLinks && channel.googleDocLinks.length > 0) {
            allChannelDetails.push({ guildId, channelId: channel.channelId, googleDocLinks: channel.googleDocLinks });
          }
        }
      }
      return allChannelDetails;
    } catch (error) {
      console.error('❌ Error getting all channel details:', error.message);
      return [];
    }
  }

  /**
   * Start the daily refresh scheduler
   */
  startDailyRefreshScheduler() {
    // Calculate time until next midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0); // Refresh at 2 AM
    
    const timeUntilRefresh = tomorrow.getTime() - now.getTime();
    
    console.log(`⏰ Google Docs daily refresh scheduled for: ${tomorrow.toISOString()}`);
    
    // Initial delay until first refresh
    setTimeout(() => {
      // Run first refresh
      this.refreshAllGoogleDocsContent();
      
      // Then set up daily interval
      setInterval(() => {
        this.refreshAllGoogleDocsContent();
      }, this.REFRESH_INTERVAL);
      
    }, timeUntilRefresh);
  }

  /**
   * Manual refresh trigger (for testing or admin commands)
   */
  async manualRefresh(guildId = null, channelId = null) {
    try {
      if (guildId && channelId) {
        // Refresh specific channel
        // Merge links from both dynamic services to match getChannelGoogleDocsContent
        const publicLinks = await dynamicPublicChannelService.getChannelGoogleDocLinks(guildId, channelId).catch(() => []);
        const ticketLinks = await dynamicTicketChannelService.getChannelGoogleDocLinks(guildId, channelId).catch(() => []);
        const googleDocLinks = Array.from(new Set([...(publicLinks || []), ...(ticketLinks || [])]));
        let refreshed = 0;
        
        for (const url of googleDocLinks) {
          const content = await this.fetchGoogleDocContent(url, false);
          if (content) refreshed++;
        }
        
        console.log(`✅ Manual refresh completed for channel ${channelId}: ${refreshed}/${googleDocLinks.length} docs refreshed`);
        return { success: true, refreshed, total: googleDocLinks.length };
      } else {
        // Refresh all
        await this.refreshAllGoogleDocsContent();
        return { success: true, message: 'All Google Docs refreshed' };
      }
    } catch (error) {
      console.error('❌ Manual refresh failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cache status for debugging
   */
  async getCacheStatus() {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await redis.keys(pattern);
      
      const cacheInfo = [];
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        const content = await redis.get(key);
        if (content) {
          const parsed = JSON.parse(content);
          cacheInfo.push({
            key: key.replace(this.CACHE_PREFIX, ''),
            lastFetched: parsed.lastFetched,
            contentLength: parsed.contentLength,
            ttlHours: Math.round(ttl / 3600)
          });
        }
      }
      
      return cacheInfo;
    } catch (error) {
      console.error('❌ Error getting cache status:', error.message);
      return [];
    }
  }
}

export default new GoogleDocsContentService();
