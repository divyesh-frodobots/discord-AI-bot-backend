export default {
  BOT_CONFIG: {
    ACTIVITY_NAME: 'FrodoBots | AI Support',
    ACTIVITY_TYPE: 0, // Playing
    STATUS: 'online'
  },

  TOKEN_LIMITS: {
    MAX_ARTICLE_TOKENS: 50000, // Increased for GPT-4.1's 1M context window
    MAX_CONVERSATION_TOKENS: 100000, // Much higher limit for GPT-4.1
    OPENAI_MAX_TOKENS: 1000000 // GPT-4.1's 1 million token context window
  },

  CACHE: {
    REFRESH_INTERVAL: 60 * 60 * 1000, // 1 hour
  },

  ROLES: {
    SUPPORT_TEAM: '1217016478193422406',
    SUPPORT_TICKET_CHANNEL_ID: '1215167614649765960' // <-- Replace with your actual support channel ID
  },

  MESSAGES: {
    getFallbackResponse: (supportTeamId = '1217016478193422406') => `Thanks for reaching out!  \n<@&${supportTeamId}> will review your request and get back to you as soon as possible. \n\n**Support Hours:** Mon-Fri, 10am-6pm SGT. \n(*AI bot will no longer respond to messages in this ticket.*)`,
    CONTENT_TRUNCATED: "[Content truncated due to length limits]",
    BOT_READY: "Bot is ready! Logged in as",
    ARTICLES_LOADED: "Article service initialized successfully",
    ARTICLES_FAILED: "Failed to load articles, using fallback"
  }
}; 