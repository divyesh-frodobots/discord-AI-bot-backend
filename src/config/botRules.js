export default {
  // Bot Identity
  BOT_IDENTITY: {
    NAME: "FrodoBots",
    DISPLAY_NAME: "FrodoBots Support AI",
    AVATAR_URL: "https://cdn.prod.website-files.com/66042185882fa3428f4dd6f1/662bee5b5ef7ed094186a56a_frodobots_ai_logo.png",
    BRAND_VOICE: "friendly, concise, professional"
  },

  // Public Channels Configuration
  PUBLIC_CHANNELS: {
    // Approved channels where bot can respond
    APPROVED_CHANNELS: [
      "test-bot-ai", // #test-bot-ai
      "test",
      "AIsupport",
      "generalchat"
    ],

    // Trigger conditions
    TRIGGERS: {
      MENTION_BOT: true,        // @FrodoBot
      PREFIX_COMMANDS: [        // Command prefixes
        "/ask",
        "!help",
        "!question",
        "?help",
        "talk to team",
        "contact team",
        "need team help"
      ],
      QUESTION_WORDS: [         // Interrogative words
        "how", "what", "where", "why", "when", "who", "which"
      ],
      QUESTION_MARK: true       // Messages ending with ?
    },

    // Rate limiting
    RATE_LIMITS: {
      MAX_QUERIES_PER_MINUTE: 5,
      COOLDOWN_SECONDS: 10,
      MAX_QUERIES_PER_HOUR: 300
    },

    // Confidence threshold
    CONFIDENCE_THRESHOLD: 0.7,
    LOW_CONFIDENCE_RESPONSE: "I'm not fully sure about that, please tag a moderator for more help.",

    // Escalation
    ESCALATION_PHRASES: [
      "human please",
      "mod please",
      "support please",
      "escalate",
      "need human",
      "talk to team",
      "contact team",
      "need team help"
    ],
    ESCALATION_ROLE: "@SupportTeam",
    ESCALATION_MESSAGE: "A user has requested human assistance. {user} needs help in {channel}.",

    // Behavior controls
    BEHAVIOR: {
      DELETE_MESSAGES: false,
      EDIT_MESSAGES: false,
      MODERATE_MESSAGES: false,
      CHANGE_ROLES: false,
      BAN_USERS: false,
      KICK_USERS: false
    }
  },

  // Ticket Channels Configuration
  TICKET_CHANNELS: {
    // Ticket-related keywords
    TICKET_KEYWORDS: [
      "ticket",
      // "support",
      // "help",
      // "issue",
      // "problem"
    ],

    // Staff roles (bot ignores messages from these roles)
    STAFF_ROLES: [
      // "My Support team",
      "Customer Support"
    ],

    // Staff role IDs (bot ignores messages from these role IDs)
    STAFF_ROLE_IDS: [
      "1396708268998660179", // Support team role ID
      // Add more staff role IDs here as needed
    ],

    // Staff permissions (bot ignores messages from users with these permissions)
    STAFF_PERMISSIONS: [
      "ManageMessages",
      "ManageChannels", 
      "Administrator",
      "ManageGuild"
    ],

    // Ticket status keywords
    CLOSED_STATUS: [
      "closed",
      "resolved",
      "solved",
      "completed",
      "finished"
    ],

    // Rate limiting for tickets
    RATE_LIMITS: {
      MAX_QUERIES_PER_MINUTE: 3,
      COOLDOWN_SECONDS: 30,
      MAX_QUERIES_PER_TICKET: 50
    },

    // Confidence threshold
    CONFIDENCE_THRESHOLD: 0.7,
    LOW_CONFIDENCE_RESPONSE: "I'm not fully sure about that, I've tagged a support agent to help.",

    // Escalation
    ESCALATION_PHRASES: [
      "human please",
      "mod please",
      "support please",
      "escalate",
      "need human",
      "talk to team",
      "contact team",
      "need team help"
    ],
    ESCALATION_ROLE: "@SupportTeam",
    ESCALATION_MESSAGE: "User has requested human assistance in ticket {ticket}. Tagging support team.",

    // Bot reactivation command
    REACTIVATION_COMMAND: "/botresume",

    // Behavior controls
    BEHAVIOR: {
      CHANGE_TICKET_STATUS: false,
      MODIFY_ROLES: false,
      ACT_ON_ACCOUNTS: false,
      DELETE_MESSAGES: false,
      EDIT_MESSAGES: false,
      DEBUG_STAFF_ROLES: false  // Enable to log staff role detection
    }
  },

  // Logging Configuration
  LOGGING: {
    // Log channels
    PUBLIC_LOGS_CHANNEL: "logging-public",
    TICKET_LOGS_CHANNEL: "1215167403848114217", // Channel ID for ticket logs
    ADMIN_LOGS_CHANNEL: "admin-logs",

    // What to log
    LOG_LEVELS: {
      QUERIES: true,        // User questions
      RESPONSES: true,      // Bot answers
      ESCALATIONS: true,    // Human escalations
      ERRORS: true,         // Bot errors
      RATE_LIMITS: true,    // Rate limit hits
      TICKET_EVENTS: true   // Ticket creation/closure
    },

    // Data privacy
    PRIVACY: {
      STORE_PII: false,           // Personal identifiable information
      STORE_EMAILS: false,        // Email addresses
      STORE_REAL_NAMES: false,    // Real names
      ANONYMIZE_USER_IDS: true,   // Hash user IDs in logs
      LOG_RETENTION_DAYS: 30      // How long to keep logs
    }
  },

  // Developer Controls
  DEVELOPER_CONTROLS: {
    ENABLE_BOT: true,           // Master switch
    ENABLE_PUBLIC_CHANNELS: true,
    ENABLE_TICKET_CHANNELS: true,
    DEBUG_MODE: false,          // Extra logging
    MAINTENANCE_MODE: false,    // Bot responds with maintenance message
    
    // Quick disable commands
    DISABLE_COMMANDS: [
      "!botdisable",
      "!botstop",
      "!maintenance"
    ],
    
    // Enable commands
    ENABLE_COMMANDS: [
      "!botenable",
      "!botstart",
      "!botresume"
    ]
  },

  // Environment Variables
  ENV_VARS: {
    DISCORD_TOKEN: "DISCORD_TOKEN",
    OPENAI_API_KEY: "OPENAI_API_KEY",
    LOG_WEBHOOK_URL: "LOG_WEBHOOK_URL",
    ADMIN_CHANNEL_ID: "ADMIN_CHANNEL_ID",
    TICKET_LOGS_CHANNEL_ID: "TICKET_LOGS_CHANNEL_ID",
    ADMIN_LOGS_CHANNEL_ID: "ADMIN_LOGS_CHANNEL_ID"
  }
}; 