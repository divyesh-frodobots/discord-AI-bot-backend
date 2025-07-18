# ChatGPT Discord Bot (Advanced Structure)

## Project Structure (2024+)

```
chatgpt-discord-bot/
│
├── config/                # Configuration files
│   ├── botRules.js
│   ├── constants.js
│   └── ...
│
├── src/
│   ├── bot.js             # Main Discord client setup & event registration
│   ├── commands/          # All slash/legacy command handlers
│   ├── events/            # Discord event handlers (message, interaction, etc.)
│   ├── middleware/        # Shared logic (rate limiting, logging, etc.)
│   ├── services/          # Business logic/services
│   ├── utils/             # Utility functions/helpers
│   └── index.js           # Entry point (loads bot.js)
│
├── logs/                  # Log files (if needed)
├── package.json
└── README.md
```

- **src/services/** contains all business logic (AI, ticketing, logging, etc.)
- **src/events/** contains one file per Discord event (message, interaction, etc.)
- **src/commands/** contains all slash/legacy command handlers
- **src/middleware/** for reusable logic (rate limiting, logging, etc.)
- **src/utils/** for helpers (e.g., sanitize logs)

---

# UFB Discord Bot

A Discord bot for Ultimate Fighting Bots (UFB) that provides automated support using AI and comprehensive knowledge from help articles.

## 🏗️ Architecture

The bot is built with a service-oriented architecture for better maintainability and scalability:

```
├── index.js                 # Main application entry point
├── services/               # Service layer
│   ├── ArticleService.js   # Handles article fetching and caching
│   ├── ConversationService.js # Manages conversation history
│   ├── AIService.js        # OpenAI API interactions
│   └── ChannelService.js   # Channel and thread management
├── config/                 # Configuration
│   └── constants.js        # Centralized constants and messages
└── package.json           # Dependencies
```

## 🚀 Features

- **Multi-Article Support**: Fetches content from individual articles and collections
- **Thread Support**: Works in Discord threads with separate conversation contexts
- **Token Management**: Intelligent conversation history management to prevent API limits
- **Caching**: Article content is cached for 1 hour to improve performance
- **Channel Configuration**: Configurable channel/thread restrictions
- **Fallback Responses**: Graceful handling when AI can't provide answers
- **Staff Message Filtering**: Automatically ignores messages from staff members in ticket channels
- **Comprehensive Logging**: Detailed ticket logs with timestamps, user ID, questions, and bot answers

## 📦 Services

### ArticleService
- Fetches and caches article content from Intercom help pages
- Supports both individual articles and collection pages
- Automatic content truncation to fit token limits
- Configurable refresh intervals

### ConversationService
- Manages conversation history per channel/thread
- Automatic token limit management
- Conversation context preservation
- Memory optimization for long conversations

### AIService
- Handles OpenAI API interactions
- Response validation and fallback handling
- Question classification for service relevance
- Error handling and retry logic

### ChannelService
- Channel and thread management
- Configurable enabled channels
- Thread detection and handling
- Channel information utilities

### LoggingService
- Comprehensive ticket interaction logging
- Admin-only log channels with detailed embeds
- Privacy controls with user ID anonymization
- Error logging and escalation tracking
- Rate limit monitoring
- Ticket creation and closure events

## ⚙️ Configuration

### Environment Variables
```env
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
```

### Channel Configuration
Edit `services/ChannelService.js` to configure enabled channels:
```javascript
this.ENABLED_CHANNELS = [
  "1384131353527975936", // Your channel ID
];
```

### Article Sources
Edit `services/ArticleService.js` to add article sources:
```javascript
this.ARTICLE_URLS = [
  "https://intercom.help/frodobots/en/articles/article-id",
];

this.COLLECTION_URLS = [
  "https://intercom.help/frodobots/en/collections/collection-id",
];
```

### Staff Role Configuration
Edit `config/botRules.js` to configure staff roles that the bot should ignore:
```javascript
TICKET_CHANNELS: {
  // Staff roles (bot ignores messages from these roles)
  STAFF_ROLES: [
    "My Support team",
    "Moderator", 
    "Admin",
    "Staff",
    "Support Team",
    "Support Agent",
    "Helper",
    "Team Lead",
    "Supervisor"
  ],

  // Staff role IDs (bot ignores messages from these role IDs)
  STAFF_ROLE_IDS: [
    "1384038915106934924", // Support team role ID
    // Add more staff role IDs here as needed
  ],

  // Staff permissions (bot ignores messages from users with these permissions)
  STAFF_PERMISSIONS: [
    "ManageMessages",
    "ManageChannels", 
    "Administrator",
    "ManageGuild"
  ],
}
```

The bot supports multiple methods to identify staff members:
- **Role Names**: Check if user has any role with matching names
- **Role IDs**: Check if user has any role with matching IDs (more precise)
- **Permissions**: Check if user has any staff-level permissions

### Logging Configuration
The bot provides comprehensive logging with admin-only channels. Configure logging in `config/botRules.js`:

```javascript
LOGGING: {
  // Log channels (create these channels in your Discord server)
  PUBLIC_LOGS_CHANNEL: "logging-public",
  TICKET_LOGS_CHANNEL: "logging-ticket",    // Admin-only ticket interactions
  ADMIN_LOGS_CHANNEL: "admin-logs",         // Admin-only system events

  // What to log
  LOG_LEVELS: {
    QUERIES: true,        // User questions and bot responses
    RESPONSES: true,      // Bot answers
    ESCALATIONS: true,    // Human escalations
    ERRORS: true,         // Bot errors
    RATE_LIMITS: true,    // Rate limit hits
    TICKET_EVENTS: true   // Ticket creation/closure
  },

  // Data privacy settings
  PRIVACY: {
    STORE_PII: false,           // Personal identifiable information
    STORE_EMAILS: false,        // Email addresses
    STORE_REAL_NAMES: false,    // Real names
    ANONYMIZE_USER_IDS: true,   // Hash user IDs in logs
    LOG_RETENTION_DAYS: 30      // How long to keep logs
  }
}
```

**Log Channels Setup:**
1. Create these channels in your Discord server:
   - `#logging-ticket` - For ticket interactions (admin-only)
   - `#admin-logs` - For system events (admin-only)
   - `#logging-public` - For public logs (optional)

2. Set appropriate permissions:
   - Admin-only channels should only be visible to staff
   - Regular users should not have access to log channels

**What Gets Logged:**
- **Ticket Interactions**: User questions, bot responses, timestamps
- **Escalations**: When users request human help
- **Errors**: Bot errors and fallbacks
- **Ticket Events**: Creation and closure of tickets
- **Rate Limits**: When users hit rate limits

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatgpt-discord-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

4. **Run the bot**
   ```bash
   node index.js
   ```

## 📝 Usage

### Adding New Articles
1. Add the article URL to `ArticleService.js`:
   ```javascript
   this.ARTICLE_URLS = [
     "existing-article-url",
     "new-article-url", // Add here
   ];
   ```

2. Restart the bot - it will automatically fetch and cache the new content

### Adding New Collections
1. Add the collection URL to `ArticleService.js`:
   ```javascript
   this.COLLECTION_URLS = [
     "existing-collection-url",
     "new-collection-url", // Add here
   ];
   ```

2. The bot will automatically extract all article links from the collection

### Managing Channels
Use the ChannelService methods to manage enabled channels:
```javascript
channelService.addEnabledChannel("new-channel-id");
channelService.removeEnabledChannel("channel-id");
channelService.getEnabledChannels();
```

## 🔧 Development

### Adding New Services
1. Create a new service file in `services/`
2. Export the service class
3. Import and initialize in `index.js`
4. Use dependency injection for service communication

### Extending Functionality
- **New AI Models**: Extend `AIService.js`
- **Different Content Sources**: Extend `ArticleService.js`
- **Advanced Channel Logic**: Extend `ChannelService.js`
- **Conversation Features**: Extend `ConversationService.js`

## 📊 Monitoring

The bot provides comprehensive logging:
- Article loading status
- Token usage statistics
- Channel/thread activity
- Error handling and fallbacks
- Conversation management events
- **Ticket interactions with timestamps, user ID, questions, and bot answers**
- **Escalation tracking and error logging**
- **Rate limit monitoring**

### Log Monitoring

**Ticket Logs (`#logging-ticket`):**
- Every user question and bot response
- Timestamps and user information
- Product selection and context
- Escalation events

**Admin Logs (`#admin-logs`):**
- Ticket creation and closure events
- Bot errors and system issues
- Rate limit violations
- Escalation reasons

**Privacy Features:**
- User IDs can be anonymized
- Personal information is not stored
- Configurable retention periods
- GDPR-compliant logging

## 🚨 Error Handling

- **API Limits**: Automatic token management and content truncation
- **Network Issues**: Graceful fallbacks and retry logic

## 🔧 Troubleshooting

### Staff Role Detection
If the bot is not properly ignoring staff messages:

1. **Enable Debug Logging**: Set `DEBUG_STAFF_ROLES: true` in `config/botRules.js`:
   ```javascript
   BEHAVIOR: {
     DEBUG_STAFF_ROLES: true  // Enable to log staff role detection
   }
   ```

2. **Check Role Names**: Ensure staff role names in `botRules.js` match exactly with Discord server roles

3. **Verify Role IDs**: Add specific role IDs to `STAFF_ROLE_IDS` array for more precise control

4. **Check Permissions**: Ensure the bot has permission to read member roles in the server

### Logging System Issues

**If logs are not appearing:**

1. **Check Channel Names**: Ensure log channels exist with exact names:
   - `logging-ticket` for ticket interactions
   - `admin-logs` for system events
   - `logging-public` for public logs

2. **Verify Bot Permissions**: The bot needs:
   - `Send Messages` in log channels
   - `Embed Links` for rich log embeds
   - `View Channel` to access log channels

3. **Check Logging Configuration**: Verify in `botRules.js`:
   ```javascript
   LOG_LEVELS: {
     QUERIES: true,        // Must be true for ticket logs
     ESCALATIONS: true,    // Must be true for escalation logs
     ERRORS: true,         // Must be true for error logs
     TICKET_EVENTS: true   // Must be true for ticket events
   }
   ```

4. **Enable Debug Mode**: Set `DEBUG_MODE: true` in `botRules.js` for detailed console logs

**Log Format Examples:**
- **Ticket Interaction**: Timestamp, user info, question, bot response
- **Escalation**: User info, reason, timestamp
- **Error**: Error details, context, timestamp
- **Ticket Event**: Channel info, event type, timestamp

### Managing Multiple Staff Members

**Best Practices:**
- Use **Role IDs** for precise control (recommended)
- Use **Role Names** for easy management across servers
- Use **Permissions** as a fallback for admin-level users

**Adding New Staff Members:**
1. **By Role**: Add the role name or ID to the respective arrays in `botRules.js`
2. **By Permission**: Users with specified permissions will automatically be ignored

**Example Configuration:**
```javascript
STAFF_ROLES: [
  "Support Team",     // Role name
  "Moderator",        // Role name
  "Admin"             // Role name
],
STAFF_ROLE_IDS: [
  "1384038915106934924",  // Support team role ID
  "987654321098765432",   // Admin role ID
  "123456789012345678"    // Moderator role ID
]
```

## 🔄 Updates

The bot automatically:
- Refreshes article content every hour
- Manages conversation history
- Handles token limits
- Updates cached content

## 📄 License

This project is licensed under the ISC License. 