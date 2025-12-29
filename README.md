# FrodoBots Discord AI Support Bot

An intelligent Discord support bot for FrodoBots that provides AI-powered customer support using GPT-4.1, semantic search with embeddings, multi-product knowledge bases, and Shopify order integration.

## 🏗️ Architecture Overview

The bot is built with a **service-oriented architecture** for maintainability and scalability. It supports three main applications:

| Application | Entry Point | Description |
|-------------|-------------|-------------|
| **Main Bot** | `npm start` | Discord AI support bot |
| **Channel Manager** | `npm run start:channels` | Web server for managing dynamic channels |
| **Activation Bot** | `npm run start:activation` | Separate activation bot instance |

## 📁 Project Structure

```
discord-ai-bot/
├── src/
│   ├── index.js                    # Entry point (loads bot.js)
│   ├── bot.js                      # Main Discord client & event handlers
│   ├── activation-bot.js           # Separate activation bot
│   ├── channel-manager.js          # Express web server for channel management
│   │
│   ├── commands/                   # Slash command handlers
│   │   ├── index.js               # Command registry
│   │   ├── botstart.js            # /botstart command
│   │   └── botstop.js             # /botstop command
│   │
│   ├── config/                     # Configuration files
│   │   ├── botRules.js            # Bot behavior rules & escalation config
│   │   ├── constants.js           # Token limits, cache settings, messages
│   │   ├── products.js            # Supported products list
│   │   └── serverConfigs.js       # Per-server configurations
│   │
│   ├── services/                   # Core business logic
│   │   ├── AIService.js           # OpenAI GPT-4.1 integration
│   │   ├── ArticleService.js      # Intercom article fetching & caching
│   │   ├── ConversationService.js # Conversation history management
│   │   ├── EmbeddingService.js    # Semantic embeddings & similarity search
│   │   ├── GoogleDocsContentService.js # Google Docs content integration
│   │   ├── LoggingService.js      # Discord logging embeds
│   │   ├── MessageService.js      # Message utilities & typing indicators
│   │   ├── PermissionService.js   # Staff role detection
│   │   ├── redisClient.js         # Redis connection singleton
│   │   │
│   │   ├── PublicChannelService.js      # Public channel thread management
│   │   ├── PublicArticleService.js      # Public channel article retrieval
│   │   ├── PublicContentManager.js      # Content enhancement for public channels
│   │   │
│   │   ├── TicketChannelService.js      # Ticket message processing
│   │   ├── TicketButtonHandler.js       # Ticket button interactions
│   │   ├── TicketChannelManager.js      # Ticket lifecycle (create/close)
│   │   ├── TicketSelectionService.js    # Ticket state management
│   │   ├── TicketStateStore.js          # Redis ticket state persistence
│   │   │
│   │   └── dynamic/                     # Dynamic channel services
│   │       ├── DynamicPublicChannelService.js
│   │       └── DynamicTicketChannelService.js
│   │
│   ├── shopify/                    # Shopify e-commerce integration
│   │   ├── ShopifyIntegrator.js   # Main Shopify integration hub
│   │   ├── ShopifyService.js      # Shopify API wrapper
│   │   ├── ShopifyOrderDetector.js # Order-related message detection
│   │   ├── ShopifyPublicIntegrator.js # Public channel order handling
│   │   └── ShopifyTicketIntegrator.js # Ticket channel order handling
│   │
│   ├── server/                     # Channel Manager web server
│   │   ├── middleware/
│   │   │   └── authenticateUser.js
│   │   ├── routes/
│   │   │   ├── authRouter.js
│   │   │   ├── guildsRouter.js
│   │   │   ├── publicChannelsRouter.js
│   │   │   ├── ticketChannelsRouter.js
│   │   │   └── aggregateRouter.js
│   │   └── views/
│   │       └── channelManagerPage.js
│   │
│   ├── utils/                      # Utility functions
│   │   ├── ConversationKeyUtil.js # Conversation ID generation
│   │   ├── TicketChannelUtil.js   # Ticket channel detection
│   │   └── ShopifyIntegrationUtil.js
│   │
│   └── webhooks/
│       └── ShopifyWebhookHandler.js
│
├── package.json
└── README.md
```

## 🔄 Message Flow Diagrams

### Public Channel Flow

```
User @mentions bot in public channel
        │
        ▼
┌─────────────────────────────────────┐
│  PublicChannelService.shouldRespond │
│  - Check if channel is approved     │
│  - Check bot mention                │
│  - Check rate limits                │
│  - Check if user has active thread  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Create Thread for User             │
│  - Auto-archive after 24 hours      │
│  - Track in Redis                   │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Check for Escalation Request       │
│  - Explicit phrases ("talk to team")│
│  - AI classification                │
└─────────────────────────────────────┘
        │
        ├── Escalation ──▶ Tag support team, stop AI
        │
        ▼
┌─────────────────────────────────────┐
│  Generate AI Response               │
│  1. Get allowed products for channel│
│  2. Semantic retrieval (embeddings) │
│  3. Add Google Docs content         │
│  4. Build enhanced system prompt    │
│  5. Call GPT-4.1                    │
│  6. Send response to thread         │
└─────────────────────────────────────┘
```

### Ticket Channel Flow

```
User opens ticket (thread in ticket parent channel)
        │
        ▼
┌─────────────────────────────────────┐
│  TicketChannelManager               │
│  - Send welcome message             │
│  - Show category buttons            │
│  - Initialize ticket state          │
└─────────────────────────────────────┘
        │
        ▼
User clicks category button
        │
        ▼
┌─────────────────────────────────────┐
│  TicketButtonHandler                │
│  - Category: General/Software       │
│    → Show product selection buttons │
│  - Category: Hardware/Bug/Billing   │
│    → Immediate escalation to humans │
│  - Category: Orders                 │
│    → Route to Shopify integration   │
└─────────────────────────────────────┘
        │
        ▼
User clicks product button (if General/Software)
        │
        ▼
┌─────────────────────────────────────┐
│  TicketButtonHandler                │
│  - Load product-specific articles   │
│  - Initialize conversation          │
│  - Show ready message               │
└─────────────────────────────────────┘
        │
        ▼
User sends message
        │
        ▼
┌─────────────────────────────────────┐
│  TicketChannelService.handleMessage │
│  1. Check if AI should respond      │
│     - Skip if humanHelp = true      │
│     - Skip if staff has messaged    │
│  2. Check for human help request    │
│  3. Route Order Status to Shopify   │
│  4. Semantic retrieval (embeddings) │
│  5. Cross-product detection         │
│  6. Add Google Docs content         │
│  7. Generate AI response            │
└─────────────────────────────────────┘
```

### Shopify Order Flow

```
User mentions order in message
        │
        ▼
┌─────────────────────────────────────┐
│  ShopifyOrderDetector               │
│  - Detect order number (#1234)      │
│  - Detect email address             │
│  - AI-powered order intent analysis │
└─────────────────────────────────────┘
        │
        ├── In Ticket Channel ──▶ ShopifyTicketIntegrator
        │   - Look up order via Shopify API
        │   - Display order status, tracking, shipping
        │   - Escalate if needed
        │
        └── In Public Channel ──▶ ShopifyPublicIntegrator
            - Redirect to ticket for privacy
            - Show "Create Private Ticket" button
```

## 🚀 Features

### Multi-Channel Support
- **Public Channels**: Thread-based conversations with @mention triggers
- **Ticket Channels**: Full support workflow with category/product selection
- **Dynamic Channels**: Add/remove channels via web UI without restart

### AI Capabilities
- **GPT-4.1 Mini**: Latest OpenAI model with 1M context window
- **Semantic Search**: Text embeddings for relevant content retrieval
- **Cross-Product Detection**: Automatically routes questions to correct product
- **Confidence Scoring**: Low-confidence responses trigger escalation

### Knowledge Integration
- **Intercom Articles**: Automatic crawling and caching of help articles
- **Google Docs**: Per-channel documentation with daily auto-refresh
- **Product-Specific Content**: UFB, Earthrover, SAM, Robots.Fun, TeleArms, etc.

### Shopify Integration
- **Order Lookup**: Real-time order status via Shopify API
- **Tracking Info**: Display shipping and tracking details
- **Privacy-Aware**: Sensitive queries redirected to private tickets

### Staff Detection
- **Role-Based**: Skip bot responses when staff members reply
- **Permission-Based**: Detect admins and moderators automatically
- **Thread Handoff**: Bot stops responding when support takes over

### Logging & Monitoring
- **Discord Embeds**: Rich log messages in dedicated channels
- **Privacy Controls**: Anonymize user IDs, filter PII
- **Retention Policies**: Configurable log retention

## 📦 Services Documentation

### AIService
Handles all OpenAI API interactions:
- Response generation with GPT-4.1 Mini
- Escalation classification
- Response tone improvement
- Confidence calculation

### ConversationService
Manages conversation history:
- Per-channel/per-user conversation tracking
- Token limit management (auto-truncation)
- System prompt injection per turn
- Context preservation across messages

### EmbeddingService
Semantic search capabilities:
- Text-to-vector embeddings (OpenAI `text-embedding-3-small`)
- Redis caching of embeddings
- Cosine similarity ranking
- Top-K retrieval for RAG

### PublicChannelService
Public channel message handling:
- Thread creation for users
- Rate limiting
- Escalation detection
- Session management
- Thread tracking in Redis

### TicketChannelService
Ticket message processing:
- Category/product validation
- AI response generation
- Human escalation detection
- Cross-product retrieval
- Shopify order routing

### DynamicPublicChannelService / DynamicTicketChannelService
Real-time channel management via Redis:
- Add/remove channels without restart
- Per-channel product restrictions
- Google Docs links per channel
- 10-second cache refresh

### GoogleDocsContentService
Google Docs integration:
- Fetch publicly shared docs as plain text
- 24-hour Redis caching
- Daily auto-refresh at 2 AM
- Multi-doc content combining
- Token limit management

### ShopifyIntegrator
E-commerce integration hub:
- Order status lookup
- Tracking information
- Public/ticket channel routing
- AI-powered order detection

## ⚙️ Configuration

### Environment Variables

```env
# Required
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key

# Optional - Shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token

# Optional - Redis
REDIS_URL=redis://localhost:6379

# Optional - Web Server
WEB_PORT=3000

# Optional - Admin
ADMIN_USER_ID=your_discord_user_id

# Optional - AI Tuning
OPENAI_MAX_TOKENS=600
EMBEDDINGS_MODEL=text-embedding-3-small
TICKET_RETRIEVAL_TOP_K=10
TICKET_RETRIEVAL_MIN_SCORE=0.25
TICKET_CROSS_PRODUCT_MIN_SCORE=0.28
TICKET_ALLOW_AI_WITHOUT_CATEGORY=true
TICKET_ALLOW_AI_WITHOUT_PRODUCT_FOR_GENERAL=true
```

### Server Configuration (`serverConfigs.js`)

Per-Discord-server settings:
```javascript
{
  "GUILD_ID": {
    guildId: "GUILD_ID",
    name: "Server Name",
    ticketChannelId: "PARENT_CHANNEL_ID",
    supportTeamRoleId: "ROLE_ID",
    staffRoleIds: ["ROLE_ID_1", "ROLE_ID_2"],
    staffRoles: ["Role Name 1", "Role Name 2"],
    staffPermissions: ["ManageMessages", "Administrator"],
    loggingChannels: {
      ticketLogs: "CHANNEL_ID",
      adminLogs: "CHANNEL_ID",
      publicLogs: "CHANNEL_ID"
    },
    escalationRole: "@SupportTeam"
  }
}
```

### Bot Rules (`botRules.js`)

Global bot behavior configuration:
- Rate limits (queries per minute/hour)
- Escalation phrases and thresholds
- Confidence thresholds
- Staff role detection
- Logging levels and privacy settings
- Developer controls (enable/disable features)

### Products (`products.js`)

Supported product list:
- `earthrover` - Earthrover Personal Bots
- `earthrover_school` - Earthrover School (Test Driving)
- `ufb` - Ultimate Fighting Bots
- `sam` - SAM (Small Autonomous Mofo)
- `robotsfun` - Robots.Fun AI Agents
- `et_fugi` - ET Fugi Competition
- `telearms` - TeleArms Remote Missions

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd discord-ai-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Redis**
   ```bash
   # macOS with Homebrew
   brew install redis
   brew services start redis
   
   # Or use Docker
   docker run -d -p 6379:6379 redis
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

5. **Run the bot**
   ```bash
   npm start
   ```

6. **(Optional) Run Channel Manager**
   ```bash
   npm run start:channels
   # Access at http://localhost:3000
   ```

## 📝 Usage

### Adding Dynamic Channels

Use the Channel Manager web UI or Redis directly:

**Public Channel:**
```javascript
// Via DynamicPublicChannelService
await dynamicChannelService.addPublicChannel(guildId, channelId, {
  name: "support-channel",
  products: ["earthrover", "ufb"],
  googleDocLinks: ["https://docs.google.com/document/d/..."]
});
```

**Ticket Channel:**
```javascript
// Via DynamicTicketChannelService
await dynamicTicketChannelService.addTicketChannel(guildId, channelId, {
  name: "support-tickets",
  googleDocLinks: ["https://docs.google.com/document/d/..."]
});
```

### Admin Commands

**Google Docs Admin (in Discord):**
- `!gdocs refresh` - Manually refresh all Google Docs
- `!gdocs status` - Show cache status
- `!gdocs test` - Test content retrieval for current channel

### Slash Commands

- `/botstart` - Start the bot in current channel
- `/botstop` - Stop the bot in current channel

## 🔧 Troubleshooting

### Bot Not Responding

1. **Check channel is approved:**
   - Use Channel Manager to verify channel is in dynamic channels list
   - Check Redis: `hgetall public_channels:GUILD_ID`

2. **Check bot mention:**
   - Bot requires @mention in public channels
   - Check bot has permissions to read/send messages

3. **Check for staff takeover:**
   - If support staff has messaged in thread, bot stops responding
   - Check Redis: `get publicthread:support-handled:THREAD_ID`

### Staff Role Detection Issues

1. **Enable debug logging:**
   ```javascript
   // In botRules.js
   BEHAVIOR: {
     DEBUG_STAFF_ROLES: true
   }
   ```

2. **Verify role configuration:**
   - Check `staffRoleIds` in `serverConfigs.js`
   - Ensure bot can read member roles (requires proper intents)

### Google Docs Not Loading

1. **Check document is publicly shared:**
   - Document must be set to "Anyone with the link can view"

2. **Check channel configuration:**
   - Verify `googleDocLinks` in dynamic channel settings

3. **Manual refresh:**
   - Use `!gdocs refresh` command

### Shopify Integration Issues

1. **Verify credentials:**
   - Check `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ACCESS_TOKEN`

2. **Test connection:**
   - Bot logs Shopify connection status on startup

## 🔄 Development

### Adding New Products

1. Add product key to `config/products.js`
2. Add category URL to `ArticleService.CATEGORY_URLS`
3. Add product info to `TicketButtonHandler.getProductInfo()`
4. Add display name to relevant services

### Adding New Ticket Categories

1. Add category button in `TicketChannelManager.createCategoryButtons()`
2. Handle category in `TicketButtonHandler.handleCategorySelection()`
3. Update `TicketChannelService.isCategoryQuestionFlow()` if needed

### Adding New Services

1. Create service file in `src/services/`
2. Export singleton or class
3. Import and initialize in `bot.js`
4. Wire up dependencies as needed

## 📊 Monitoring

The bot logs to:
- **Console**: All activity with emojis for easy scanning
- **Discord Channels**: 
  - `#logging-public` - Public channel interactions
  - `#logging-ticket` - Ticket interactions
  - `#admin-logs` - System events

### Key Log Indicators

- ✅ Success operations
- ❌ Errors
- 🤖 AI operations
- 🛍️ Shopify operations
- 📄 Google Docs operations
- 🧵 Thread operations
- 👮 Staff detection
- 🚨 Escalations

## 📄 License

This project is licensed under the ISC License.
