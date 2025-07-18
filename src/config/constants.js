export default {
  BOT_CONFIG: {
    ACTIVITY_NAME: 'FrodoBots | AI Support',
    ACTIVITY_TYPE: 0, // Playing
    STATUS: 'online'
  },

  TOKEN_LIMITS: {
    MAX_ARTICLE_TOKENS: 6000,
    MAX_CONVERSATION_TOKENS: 7000,
    OPENAI_MAX_TOKENS: 8192
  },

  CACHE: {
    REFRESH_INTERVAL: 60 * 60 * 1000, // 1 hour
  },

  ROLES: {
    SUPPORT_TEAM: '1384038915106934924'
  },

  MESSAGES: {
    getFallbackResponse: (supportTeamId = '1384038915106934924') => `Thanks for reaching out!  \n<@&${supportTeamId}> will review your request and get back to you as soon as possible. \n\n**Support Hours:** Mon-Fri, 10am-6pm SGT. \n(*AI bot will no longer respond to messages in this ticket.*)`,
    CONTENT_TRUNCATED: "[Content truncated due to length limits]",
    BOT_READY: "Bot is ready! Logged in as",
    ARTICLES_LOADED: "Article service initialized successfully",
    ARTICLES_FAILED: "Failed to load articles, using fallback"
  }
}; 