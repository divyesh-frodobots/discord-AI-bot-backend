import botRules from '../config/botRules.js';
import natural from 'natural';

class PublicChannelService {
  constructor() {
    this.userRateLimits = new Map(); // Track user rate limits
    this.lastQueryTime = new Map(); // Track last query time per user
    this.activeSessions = new Map(); // Map of `${userId}:${channelId}` -> lastActiveTimestamp
    this.escalatedUsers = new Map(); // Map of `${userId}:${channelId}` -> true if escalated
    this.lastAnswered = new Map(); // Map of `${userId}:${channelId}` -> timestamp of last answered
    this.lastMessageContent = new Map(); // Map of `${userId}:${channelId}` -> last message content
    this.SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour (updated from 10 min)
    this.COOLDOWN_SECONDS = 10; // 10 seconds cooldown between answers
    this.SIMILARITY_THRESHOLD = 0.5; // Adjust as needed
  }

  /**
   * Check if the bot should respond to a message in public channels
   * Now supports active session logic: after a valid trigger+question, respond to follow-up questions for 1 hour
   * Now supports escalation: if escalated, ignore further messages from that user in that channel
   * Now supports cooldown: user must wait 10 seconds between answers
   */
  shouldRespond(message, botUserId) {
    const channelName = message.channel.name;
    const userId = message.author.id;
    const channelId = message.channel.id;
    const sessionKey = `${userId}:${channelId}`;
    const now = Date.now();

    // Check if channel is approved
    if (!this.isApprovedChannel(channelName)) {
      return { shouldRespond: false, reason: 'channel_not_approved' };
    }

    // Escalation state: if user is escalated in this channel, always escalate
    if (this.escalatedUsers.get(sessionKey)) {
      return { shouldRespond: false, reason: 'escalated' };
    }

    // Cooldown: if last answer was less than COOLDOWN_SECONDS ago, do not respond
    const lastAnswered = this.lastAnswered.get(sessionKey);
    if (lastAnswered && (now - lastAnswered < this.COOLDOWN_SECONDS * 1000)) {
      return { shouldRespond: false, reason: 'cooldown' };
    }

    // Check for escalation phrases FIRST (before other checks)
    if (this.hasEscalationPhrase(message.content)) {
      this.escalatedUsers.set(sessionKey, true);
      return { shouldRespond: false, reason: 'escalation_requested', escalateNow: true };
    }

    // Check if user has an active session in this channel
    const lastActive = this.activeSessions.get(sessionKey);
    const sessionActive = lastActive && (now - lastActive < this.SESSION_TIMEOUT_MS);

    // If session is active, respond to any question (no trigger needed)
    if (sessionActive) {
      if (this.isQuestion(message.content)) {
        this.activeSessions.set(sessionKey, now); // refresh session
        this.lastMessageContent.set(sessionKey, message.content); // store last message
        // Check rate limits
        const rateLimitCheck = this.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          return { shouldRespond: false, reason: 'rate_limited', cooldownRemaining: rateLimitCheck.cooldownRemaining };
        }
        this.lastAnswered.set(sessionKey, now); // set cooldown
        return { shouldRespond: true, reason: 'active_session' };
      } else {
        // Advanced: check semantic similarity to last message
        const lastMsg = this.lastMessageContent.get(sessionKey);
        if (lastMsg) {
          const similarity = natural.JaroWinklerDistance(lastMsg, message.content);
          if (similarity >= this.SIMILARITY_THRESHOLD) {
            this.activeSessions.set(sessionKey, now); // refresh session
            this.lastMessageContent.set(sessionKey, message.content); // update last message
            // Check rate limits
            const rateLimitCheck = this.checkRateLimit(userId);
            if (!rateLimitCheck.allowed) {
              return { shouldRespond: false, reason: 'rate_limited', cooldownRemaining: rateLimitCheck.cooldownRemaining };
            }
            this.lastAnswered.set(sessionKey, now); // set cooldown
            return { shouldRespond: true, reason: 'active_session_semantic' };
          }
        }
        return { shouldRespond: false, reason: 'not_a_question' };
      }
    }

    // If no active session, require trigger + question, or allow mention
    const triggerCheck = this.checkTriggers(message.content, botUserId);
    console.log('---------triggerCheck', triggerCheck)
    const isMention = triggerCheck.triggered && triggerCheck.trigger === 'mention';
    if (!triggerCheck.triggered) {
      // Do NOT start a session, do NOT respond
      return { shouldRespond: false, reason: 'no_trigger' };
    }
    // If mention, allow even if not a question
    if (isMention) {
      this.activeSessions.set(sessionKey, now);
      // Check rate limits
      const rateLimitCheck = this.checkRateLimit(userId);
      if (!rateLimitCheck.allowed) {
        return { shouldRespond: false, reason: 'rate_limited', cooldownRemaining: rateLimitCheck.cooldownRemaining };
      }
      this.lastAnswered.set(sessionKey, now); // set cooldown
      return { shouldRespond: true, reason: 'mention_no_question' };
    }
    if (!this.isQuestion(message.content)) {
      // Friendly prompt if triggered but not a question
      return { shouldRespond: false, reason: 'trigger_no_question', triggered: true };
    }
    // Passed: start session ONLY if trigger + question
    this.activeSessions.set(sessionKey, now);
    this.lastMessageContent.set(sessionKey, message.content); // store last message
    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return { shouldRespond: false, reason: 'rate_limited', cooldownRemaining: rateLimitCheck.cooldownRemaining };
    }
    this.lastAnswered.set(sessionKey, now); // set cooldown
    return { shouldRespond: true, reason: 'triggered_session_start' };
  }

  /**
   * Check if channel is in approved list
   */
  isApprovedChannel(channelName) {
    return botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(channelName);
  }

  /**
   * Check if message has valid triggers
   * Now supports botUserId for mention detection
   */
  checkTriggers(content, botUserId) {
    // Robust mention detection: allow leading whitespace before mention
    const trimmed = content.trimStart();
    if (botUserId && trimmed.startsWith(`<@${botUserId}>`)) {
      return { triggered: true, trigger: 'mention' };
    }
    // Check for prefix command !help at the start
    if (trimmed.toLowerCase().startsWith('!help')) {
      return { triggered: true, trigger: 'prefix' };
    }
    // No other triggers allowed
    return { triggered: false };
  }

  /**
   * Check if message is in question form
   */
  isQuestion(content) {
    if (content.includes('?')) return true;
    
    const questionWords = botRules.PUBLIC_CHANNELS.TRIGGERS.QUESTION_WORDS;
    const words = content.toLowerCase().split(' ');
    
    if (words.length > 0 && questionWords.includes(words[0])) {
      return true;
    }

    return questionWords.some(word => content.toLowerCase().includes(word));
  }

  /**
   * Check rate limits for a user
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const limits = botRules.PUBLIC_CHANNELS.RATE_LIMITS;
    
    // Initialize user tracking if not exists
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

    // Reset minute counter if a minute has passed
    if (now - userData.lastQueryTime > 60000) {
      userData.queriesThisMinute = 0;
    }

    // Reset hour counter if an hour has passed
    if (now - userData.lastQueryTime > 3600000) {
      userData.queriesThisHour = 0;
    }

    // Check minute limit
    if (userData.queriesThisMinute >= limits.MAX_QUERIES_PER_MINUTE) {
      return { allowed: false, reason: 'minute_limit_exceeded' };
    }

    // Check hour limit
    if (userData.queriesThisHour >= limits.MAX_QUERIES_PER_HOUR) {
      return { allowed: false, reason: 'hour_limit_exceeded' };
    }

    // Update counters
    userData.queriesThisMinute++;
    userData.queriesThisHour++;
    userData.lastQueryTime = now;

    return { allowed: true };
  }

  /**
   * Check if message contains escalation phrases
   */
  hasEscalationPhrase(content) {
    const lowerContent = content.toLowerCase();
    return botRules.PUBLIC_CHANNELS.ESCALATION_PHRASES.some(phrase => 
      lowerContent.includes(phrase.toLowerCase())
    );
  }

  /**
   * Handle escalation request
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
   * Log query for monitoring
   * Now sends to #logging-public channel if client is provided
   */
  async logQuery(userId, username, question, response, confidence = null, client = null) {
    const logData = {
      timestamp: new Date().toISOString(),
      userId: this.anonymizeUserId(userId),
      username: username,
      channel: 'public',
      question: this.sanitizeContent(question),
      response: this.sanitizeContent(response),
      confidence,
      type: 'query'
    };

    // Send to Discord log channel if client is provided
    if (client) {
      // Try to find the channel by name
      const logChannel = client.channels.cache.find(
        ch => ch.name === botRules.LOGGING.PUBLIC_LOGS_CHANNEL
      );
      if (logChannel) {
        logChannel.send(
          `📝 **Query Log**\nUser name: ${logData.username}\nQ: ${logData.question}\nA: ${logData.response}\nConfidence: ${confidence !== null ? confidence : 'N/A'}\nTime: ${logData.timestamp}`
        );
      }
    }
    return logData;
  }

  /**
   * Anonymize user ID for privacy
   */
  anonymizeUserId(userId) {
    if (!botRules.LOGGING.PRIVACY.ANONYMIZE_USER_IDS) {
      return userId;
    }
    // Simple hash for demo - in production use proper hashing
    return `user_${userId.slice(-6)}`;
  }

  /**
   * Sanitize content to remove PII
   */
  sanitizeContent(content) {
    let sanitized = content;
    
    if (!botRules.LOGGING.PRIVACY.STORE_EMAILS) {
      // Remove email patterns
      sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
    }
    
    if (!botRules.LOGGING.PRIVACY.STORE_REAL_NAMES) {
      // Simple name detection - in production use more sophisticated detection
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

  getFriendlyPrompt() {
    return "Hi! How can I help you today? Please ask your question.";
  }

  /**
   * Manual reset of escalation for a user/channel (e.g., by a moderator)
   */
  clearEscalation(userId, channelId) {
    const sessionKey = `${userId}:${channelId}`;
    this.escalatedUsers.delete(sessionKey);
  }
}

export default PublicChannelService; 