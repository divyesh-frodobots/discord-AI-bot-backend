import botRules from '../config/botRules.js';
import { buildHumanHelpPrompt } from './ArticleService.js';
import constants from '../config/constants.js';
import redis from './redisClient.js';

/**
 * Public Channel Service - Thread-Based Conversation Management
 * 
 * Flow Overview:
 * 1. User mentions bot in public channel → Create dedicated thread
 * 2. All conversation happens in user's thread
 * 3. AI escalation detection → Human support if needed
 * 4. Thread archives after 24 hours → User can create new thread
 */
class PublicChannelService {
  constructor() {
    // Core tracking maps
    this.userRateLimits = new Map();     // Rate limiting per user
    this.escalatedUsers = new Map();     // Escalated users: userId:channelId → true
    this.userThreads = new Map();        // Active threads: userId:channelId → threadId
    
    // Configuration constants
    this.THREAD_AUTO_ARCHIVE_DURATION = 1440; // 24 hours in minutes
    this.SIMPLE_GREETING_MAX_LENGTH = 5;
    this.COMPLEX_MESSAGE_MIN_LENGTH = 20;
    this.SIMPLE_GREETINGS = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    this.HUMAN_REQUEST_KEYWORDS = [
      'talk to human', 'speak to human', 'human help', 'real person', 
      'support team', 'customer service', 'escalate', 'talk to team',
      'speak to team', 'need human', 'human support', 'contact team'
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MAIN FLOW - Entry point for message processing
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Main entry point: Determine if bot should respond to a message
   * @param {Object} message - Discord message object
   * @param {string} botUserId - Bot's user ID
   * @param {Object} client - Discord client
   * @returns {Object} Response decision with reason
   */
  async shouldRespond(message, botUserId, client = null) {
    const userId = message.author.id;

    // THREAD MESSAGES: Handle messages in existing threads
    if (message.channel.isThread()) {
      return await this._handleThreadMessage(message, userId);
    }

    // MAIN CHANNEL MESSAGES: Handle new conversation requests
    return this._handleMainChannelMessage(message, userId, botUserId, client);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // THREAD MANAGEMENT - Core thread-based conversation logic
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Handle messages within existing threads
   */
  async _handleThreadMessage(message, userId) {
    if (!(await this.isInUserThread(message))) {
      return { shouldRespond: false, reason: 'not_user_thread' };
    }

    // Check escalation state per thread
    const parentChannelId = message.channel.parentId;
    const threadId = message.channel.id;
    const sessionKey = `${userId}:${parentChannelId}:${threadId}`;
    
    if (this.escalatedUsers.get(sessionKey)) {
      return { shouldRespond: false, reason: 'escalated' };
    }

    return { shouldRespond: true, reason: 'in_user_thread' };
  }

  /**
   * Handle messages in main channel (thread creation requests)
   */
  _handleMainChannelMessage(message, userId, botUserId, client) {
    const channelName = message.channel.name;
    const channelId = message.channel.id;
    const sessionKey = `${userId}:${channelId}`;

    // Basic validation
    if (!this.isApprovedChannel(channelName)) {
      return { shouldRespond: false, reason: 'channel_not_approved' };
    }

    // Check for bot mention
    if (!this._isBotMentioned(message.content, botUserId)) {
      return { shouldRespond: false, reason: 'no_mention' };
    }

    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return { shouldRespond: false, reason: 'rate_limited', cooldownRemaining: rateLimitCheck.cooldownRemaining };
    }

    return { shouldRespond: true, reason: 'mention_create_thread' };
  }

  /**
   * Create a thread for user conversation
   */
  async createUserThread(message, reason = 'AI Support', client = null) {
    try {
      const userId = message.author.id;
      const channelId = message.channel.id;
      const threadName = this._generateThreadName(message.content, message.author.username);
      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: this.THREAD_AUTO_ARCHIVE_DURATION,
        reason: reason
      });
      // Store in Redis for persistence (allow multiple threads)
      await redis.set(`publicthread:${userId}:${channelId}:${thread.id}`, 'active');
      console.log(`📝 Created thread "${threadName}" (ID: ${thread.id}) for user ${message.author.username}`);
      if (client) {
        await this.logThreadCreation(
          userId, 
          message.author.username, 
          threadName, 
          thread.id, 
          message.channel.name,
          client
        );
      }
      return thread;
    } catch (error) {
      console.error('Error creating thread:', error);
      throw error;
    }
  }

  /**
   * Check if user has an active (non-archived) thread
   */
  async hasActiveThread(userId, channelId, client) {
    const sessionKey = `${userId}:${channelId}`;
    // Try Redis first
    let threadId = await redis.get(`publicthread:${userId}:${channelId}:${threadId}`);
    if (!threadId) {
      // Fallback to in-memory (for legacy/transition)
      threadId = this.userThreads.get(sessionKey);
    }
    
    if (!threadId) return false;
    
    try {
      const thread = client.channels.cache.get(threadId);
      if (thread && !thread.archived) {
        // Sync in-memory for fast access
        this.userThreads.set(sessionKey, threadId);
        return true;
      } else {
        await this.cleanupUserSession(userId, channelId);
        console.log(`🧹 Cleaned up closed/archived thread for user ${userId} in channel ${channelId}`);
        return false;
      }
    } catch (error) {
      await this.cleanupUserSession(userId, channelId);
      console.log(`🧹 Cleaned up missing thread for user ${userId} in channel ${channelId}`);
      return false;
    }
  }

  /**
   * Check if message is in the user's own thread
   */
  async isInUserThread(message) {
    if (!message.channel.isThread()) return false;
    const userId = message.author.id;
    const parentChannelId = message.channel.parentId;
    const threadId = message.channel.id;
    // Check Redis for this thread
    const exists = await redis.exists(`publicthread:${userId}:${parentChannelId}:${threadId}`);
    return !!exists;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ESCALATION SYSTEM - AI-powered human support detection
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Intelligent escalation detection with 3-layer approach
   * Layer 1: Simple greetings → No escalation
   * Layer 2: Explicit requests → Immediate escalation  
   * Layer 3: Complex messages → AI analysis
   */
  async detectHumanHelpRequest(message, aiService) {
    try {
      const content = message.content.toLowerCase().trim();
      const cleanContent = content.replace(/<@!?\d+>/g, '').trim(); // Remove mentions

      // Layer 1: Skip simple greetings
      if (this._isSimpleGreeting(cleanContent)) {
        console.log(`🤖 Skipping escalation analysis for simple greeting: "${message.content}"`);
        return false;
      }

      // Layer 2: Explicit human requests
      if (this._hasExplicitHumanRequest(content)) {
        console.log(`🤖 Explicit human request detected: "${message.content}"`);
        return true;
      }

      // Layer 3: AI analysis for complex messages
      if (this._shouldUseAIAnalysis(content)) {
        return await this._performAIEscalationAnalysis(message, aiService);
      }

      console.log(`🤖 No escalation needed for: "${message.content}"`);
      return false;

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      return false;
    }
  }

  /**
   * Escalate user to human support
   */
  async escalateToHuman(message, client = null, targetChannel = null) {
    const userId = message.author.id;
    const channelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;
    const threadId = message.channel.isThread() ? message.channel.id : null;
    
    // Mark user as escalated per thread (not per channel)
    const sessionKey = threadId ? `${userId}:${channelId}:${threadId}` : `${userId}:${channelId}`;
    this.escalatedUsers.set(sessionKey, true);
    
    // Send support message to appropriate channel
    const supportMessage = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
    
    if (targetChannel && targetChannel !== message.channel) {
      // Send to specific target channel (e.g., user's thread)
      await targetChannel.send(`<@${userId}> ${supportMessage}`);
      console.log(`🚨 Escalated user ${message.author.username} to human support in thread: ${targetChannel.name}`);
    } else {
      // Fallback to replying to original message
      await message.reply(supportMessage);
      console.log(`🚨 Escalated user ${message.author.username} to human support in original channel`);
    }

    // Log escalation with structured format
    if (client) {
      const threadInfo = targetChannel && targetChannel !== message.channel ? {
        name: targetChannel.name,
        id: targetChannel.id
      } : null;
      
      await this.logQuery(userId, message.author.username, message.content, supportMessage, null, client, threadInfo, true);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS - Helper functions and validation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if channel is approved for bot operation
   */
  isApprovedChannel(channelName) {
    return botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(channelName);
  }

  /**
   * Check if bot is mentioned anywhere in message
   */
  _isBotMentioned(content, botUserId) {
    if (!botUserId) return false;
    
    // Check for direct bot mentions
    const hasDirectMention = content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
    
    // Check for bot-related role mentions (common issue where users mention bot role instead of bot user)
    const botRoleId = botRules.PUBLIC_CHANNELS.TRIGGERS.BOT_ROLE_ID;
    const hasBotRoleMention = botRoleId && content.includes(`<@&${botRoleId}>`);
    
    return hasDirectMention || hasBotRoleMention;
  }

  /**
   * Generate descriptive thread name from message content
   */
  _generateThreadName(content, username) {
    let cleanContent = content
      .replace(/<@!?\d+>/g, '') // Remove mentions
      .replace(/!help/gi, '')   // Remove commands
      .trim();
    
    const preview = cleanContent.length > 50 
      ? cleanContent.substring(0, 50) + '...' 
      : cleanContent;
    
    return `${username}: ${preview}` || `${username}'s Question`;
  }

  /**
   * Check if thread likely belongs to user (fallback after restart)
   */
  _isLikelyUserThread(message, userId) {
    const thread = message.channel;
    const username = message.author.username;
    
    // Check thread name format: "username: message..."
    if (thread.name.toLowerCase().startsWith(username.toLowerCase() + ':')) {
      return true;
    }
    
    // Check thread owner
    try {
      return thread.ownerId === userId;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if content is a simple greeting
   */
  _isSimpleGreeting(cleanContent) {
    return this.SIMPLE_GREETINGS.includes(cleanContent) || cleanContent.length < this.SIMPLE_GREETING_MAX_LENGTH;
  }

  /**
   * Check for explicit human support requests
   */
  _hasExplicitHumanRequest(content) {
    return this.HUMAN_REQUEST_KEYWORDS.some(keyword => 
      content.includes(keyword.toLowerCase())
    );
  }

  /**
   * Determine if message warrants AI escalation analysis
   */
  _shouldUseAIAnalysis(content) {
    return content.length > this.COMPLEX_MESSAGE_MIN_LENGTH || 
           content.includes('?') || 
           content.includes('help') || 
           content.includes('problem');
  }

  /**
   * Perform AI-based escalation analysis
   */
  async _performAIEscalationAnalysis(message, aiService) {
    const systemContent = buildHumanHelpPrompt();
    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: message.content }
    ];

    const aiResponse = await aiService.generateResponse(messages);
    
    const isEscalation = aiResponse && 
                        aiResponse.isValid && 
                        aiResponse.response.includes(constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM));
    
    console.log(`🤖 AI escalation analysis for "${message.content}": ${isEscalation ? 'ESCALATE' : 'CONTINUE'}`);
    return isEscalation;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT - Cleanup and maintenance
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Clean up all tracking for a user session
   */
  async cleanupUserSession(userId, channelId) {
    const sessionKey = `${userId}:${channelId}`;
    
    this.userThreads.delete(sessionKey);
    await redis.del(`publicthread:${userId}:${channelId}:*`); // Clean up all thread keys for this user/channel
    this.escalatedUsers.delete(sessionKey);
    
    console.log(`✨ Cleaned up complete session for user ${userId} in channel ${channelId}`);
  }

  /**
   * Manual session reset (for moderators)
   */
  resetUserSession(userId, channelId) {
    this.cleanupUserSession(userId, channelId);
    console.log(`🔄 Manually reset session for user ${userId} in channel ${channelId}`);
  }

  /**
   * Manual escalation reset (for moderators)
   */
  clearEscalation(userId, channelId) {
    const sessionKey = `${userId}:${channelId}`;
    this.escalatedUsers.delete(sessionKey);
  }

  /**
   * Periodic cleanup of archived threads
   */
  cleanupArchivedThreads(client) {
    for (const [sessionKey, threadId] of this.userThreads.entries()) {
      try {
        const thread = client.channels.cache.get(threadId);
        if (!thread || thread.archived) {
          const [userId, channelId] = sessionKey.split(':');
          this.cleanupUserSession(userId, channelId);
          console.log(`🧹 Cleaned up archived thread session: ${sessionKey}`);
        }
      } catch (error) {
        const [userId, channelId] = sessionKey.split(':');
        this.cleanupUserSession(userId, channelId);
        console.log(`🧹 Cleaned up missing thread session: ${sessionKey}`);
      }
    }
  }

  /**
   * Rebuild thread tracking after server restart
   */
  async rebuildThreadTracking(client) {
    console.log('🔄 Rebuilding thread tracking after restart...');
    
    // Clear previous session data
    this.escalatedUsers.clear();
    console.log('✅ Cleared escalation states from previous session');
    
    let rebuiltCount = 0;
    
    // Scan for existing threads
    for (const [channelId, channel] of client.channels.cache) {
      if (channel.isThread() && channel.parent && !channel.archived) {
        const isApprovedParent = this.isApprovedChannel(channel.parent.name);
        if (!isApprovedParent) continue;
        
        try {
          const threadName = channel.name;
          const colonIndex = threadName.indexOf(':');
          
          if (colonIndex > 0) {
            const possibleUsername = threadName.substring(0, colonIndex).trim();
            const guild = channel.guild;
            const member = guild.members.cache.find(m => 
              m.user.username.toLowerCase() === possibleUsername.toLowerCase()
            );
            
            if (member) {
              const userId = member.user.id;
              const parentChannelId = channel.parentId;
              const sessionKey = `${userId}:${parentChannelId}`;
              
              this.userThreads.set(sessionKey, channel.id);
              rebuiltCount++;
              console.log(`🔗 Restored thread: ${threadName} -> ${member.user.username}`);
            }
          }
        } catch (error) {
          console.log(`⚠️ Could not rebuild tracking for thread: ${channel.name}`);
        }
      }
    }
    
    console.log(`✅ Rebuilt tracking for ${rebuiltCount} threads`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RATE LIMITING - User interaction limits
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if user is within rate limits
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const limits = botRules.PUBLIC_CHANNELS.RATE_LIMITS;
    
    if (!this.userRateLimits.has(userId)) {
      this.userRateLimits.set(userId, {
        queriesThisMinute: 0,
        queriesThisHour: 0,
        lastQueryTime: 0
      });
    }

    const userData = this.userRateLimits.get(userId);
    
    // Check cooldown
    if (now - userData.lastQueryTime < (limits.COOLDOWN_SECONDS * 1000)) {
      const cooldownRemaining = Math.ceil((limits.COOLDOWN_SECONDS * 1000 - (now - userData.lastQueryTime)) / 1000);
      return { allowed: false, cooldownRemaining };
    }

    // Reset counters
    if (now - userData.lastQueryTime > 60000) {
      userData.queriesThisMinute = 0;
    }
    if (now - userData.lastQueryTime > 3600000) {
      userData.queriesThisHour = 0;
    }

    // Check limits
    if (userData.queriesThisMinute >= limits.MAX_QUERIES_PER_MINUTE) {
      return { allowed: false, reason: 'minute_limit_exceeded' };
    }
    if (userData.queriesThisHour >= limits.MAX_QUERIES_PER_HOUR) {
      return { allowed: false, reason: 'hour_limit_exceeded' };
    }

    // Update counters
    userData.queriesThisMinute++;
    userData.queriesThisHour++;
    userData.lastQueryTime = now;

    return { allowed: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LEGACY METHODS - Kept for compatibility
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if message contains escalation phrases (legacy)
   */
  hasEscalationPhrase(content) {
    const lowerContent = content.toLowerCase();
    return botRules.PUBLIC_CHANNELS.ESCALATION_PHRASES.some(phrase => 
      lowerContent.includes(phrase.toLowerCase())
    );
  }

  /**
   * Handle escalation request (legacy)
   */
  async handleEscalation(message) {
    const escalationMessage = botRules.PUBLIC_CHANNELS.ESCALATION_MESSAGE
      .replace('{user}', `<@${message.author.id}>`)
      .replace('{channel}', `<#${message.channel.id}>`);

    await message.reply(`${botRules.PUBLIC_CHANNELS.ESCALATION_ROLE} - ${escalationMessage}`);
    
    return {
      escalated: true,
      message: escalationMessage
    };
  }

  /**
   * Get low confidence response
   */
  getLowConfidenceResponse() {
    return botRules.PUBLIC_CHANNELS.LOW_CONFIDENCE_RESPONSE;
  }

  /**
   * Log query for monitoring (structured like ticket logging)
   */
  async logQuery(userId, username, question, response, confidence = null, client = null, threadInfo = null, escalation = false) {
    const logData = {
      timestamp: new Date().toISOString(),
      userId: this.anonymizeUserId(userId),
      username: username,
      channel: 'public',
      question: this.sanitizeContent(question),
      response: this.sanitizeContent(response),
      confidence,
      type: escalation ? 'escalation' : 'query',
      threadInfo
    };

    if (client) {
      const logChannel = client.channels.cache.find(
        ch => ch.name === botRules.LOGGING.PUBLIC_LOGS_CHANNEL
      );
      if (logChannel) {
        await this.sendStructuredLog(logChannel, logData, escalation);
      }
    }
    return logData;
  }

  /**
   * Send structured embed log (matching ticket logging format)
   */
  async sendStructuredLog(logChannel, logData, escalation = false) {
    try {
      const timestamp = this.formatTimestamp();
      
      // Color coding like ticket system
      let color, title, titleIcon;
      if (escalation) {
        color = 0xFF6B6B; // Red for escalation
        title = '🚨 Public Channel Escalation';
        titleIcon = '🚨';
      } else if (logData.confidence !== null && logData.confidence < 0.7) {
        color = 0xFFA726; // Orange for low confidence
        title = '⚠️ Public Channel Interaction (Low Confidence)';
        titleIcon = '⚠️';
      } else {
        color = 0x4ECDC4; // Green for normal interaction
        title = '💬 Public Channel Interaction';
        titleIcon = '💬';
      }

      const logEmbed = {
        color: color,
        title: title,
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '👤 User',
            value: `${logData.username} (${logData.userId})`,
            inline: true
          },
          {
            name: '🧵 Thread Info',
            value: logData.threadInfo ? `${logData.threadInfo.name} (${logData.threadInfo.id})` : 'Main Channel',
            inline: true
          },
          {
            name: '❓ Question',
            value: logData.question.length > 1024 ? logData.question.substring(0, 1021) + '...' : logData.question,
            inline: false
          },
          {
            name: '🤖 Bot Response',
            value: logData.response.length > 1024 ? logData.response.substring(0, 1021) + '...' : logData.response,
            inline: false
          }
        ],
        footer: {
          text: escalation ? `Escalation - Thread: ${logData.threadInfo?.id || 'N/A'}` : `Public Query - Confidence: ${logData.confidence !== null ? logData.confidence.toFixed(2) : 'N/A'}`
        },
        timestamp: new Date()
      };

      // Add confidence field for non-escalation logs
      if (!escalation && logData.confidence !== null) {
        logEmbed.fields.splice(3, 0, {
          name: '📊 AI Confidence',
          value: `${(logData.confidence * 100).toFixed(1)}%`,
          inline: true
        });
      }

      await logChannel.send({ embeds: [logEmbed] });
      console.log(`📝 Logged ${escalation ? 'escalation' : 'interaction'}: ${logData.username} (${logData.type})`);
      
    } catch (error) {
      console.error('❌ Error sending structured log:', error);
      // Fallback to simple text log
      await logChannel.send(
        `📝 **${escalation ? 'Escalation' : 'Query'} Log** (Fallback)\nUser: ${logData.username}\nQ: ${logData.question}\nA: ${logData.response}\nTime: ${logData.timestamp}`
      );
    }
  }

  /**
   * Log thread creation event
   */
  async logThreadCreation(userId, username, threadName, threadId, parentChannelName, client = null) {
    if (!client) return;

    const logChannel = client.channels.cache.find(
      ch => ch.name === botRules.LOGGING.PUBLIC_LOGS_CHANNEL
    );
    
    if (logChannel) {
      try {
        const timestamp = this.formatTimestamp();
        
        const logEmbed = {
          color: 0x4CAF50, // Green
          title: '🧵 Public Thread Created',
          fields: [
            {
              name: '📅 Timestamp',
              value: timestamp,
              inline: true
            },
            {
              name: '👤 User',
              value: `${username} (${this.anonymizeUserId(userId)})`,
              inline: true
            },
            {
              name: '📍 Parent Channel',
              value: parentChannelName,
              inline: true
            },
            {
              name: '🧵 Thread Name',
              value: threadName,
              inline: false
            }
          ],
          footer: {
            text: `Thread ID: ${threadId}`
          },
          timestamp: new Date()
        };

        await logChannel.send({ embeds: [logEmbed] });
        console.log(`📝 Logged thread creation: ${threadName} for ${username}`);
        
      } catch (error) {
        console.error('❌ Error logging thread creation:', error);
      }
    }
  }

  /**
   * Format timestamp like ticket logging
   */
  formatTimestamp() {
    const now = new Date();
    return `<t:${Math.floor(now.getTime() / 1000)}:F>`;
  }

  /**
   * Anonymize user ID for privacy
   */
  anonymizeUserId(userId) {
    if (!botRules.LOGGING.PRIVACY.ANONYMIZE_USER_IDS) {
      return userId;
    }
    return `user_${userId.slice(-6)}`;
  }

  /**
   * Sanitize content to remove PII
   */
  sanitizeContent(content) {
    let sanitized = content;
    
    if (!botRules.LOGGING.PRIVACY.STORE_EMAILS) {
      sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
    }
    
    if (!botRules.LOGGING.PRIVACY.STORE_REAL_NAMES) {
      sanitized = sanitized.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[NAME]');
    }
    
    return sanitized;
  }

  /**
   * Get bot identity for responses
   */
  getBotIdentity() {
    return botRules.BOT_IDENTITY;
  }

  /**
   * Get friendly prompt for triggered messages
   */
  getFriendlyPrompt() {
    return "Hi! How can I help you today? Please ask your question.";
  }

  // Helper to generate a unique conversation key per thread
  getThreadConversationKey(message) {
    const userId = message.author.id;
    const parentChannelId = message.channel.parentId;
    const threadId = message.channel.id;
    return `user_${userId}:${parentChannelId}:${threadId}`;
  }

  // Example usage in your thread message handler (update all relevant places):
  async handleThreadMessage(message, aiService, conversationService) {
    const conversationKey = this.getThreadConversationKey(message);
    // Initialize conversation for this thread if needed
    await conversationService.initializeConversation(conversationKey, null, false);
    // Add user message
    conversationService.addUserMessage(conversationKey, message.content, false);
    // Get conversation history for this thread
    const conversationHistory = conversationService.getConversationHistory(conversationKey, false);
    // Generate AI response
    const aiResponse = await aiService.generateResponse(conversationHistory);
    // Add assistant message
    conversationService.addAssistantMessage(conversationKey, aiResponse.response, false);
    // Reply in thread
    await message.reply(aiResponse.response);
  }
}

export default PublicChannelService; 