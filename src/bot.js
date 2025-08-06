import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { getServerFallbackResponse, getServerConfig } from './config/serverConfigs.js';

// Import services
import ArticleService from "./services/ArticleService.js";
import ConversationService from "./services/ConversationService.js";
import AIService from "./services/AIService.js";
import TicketChannelService from "./services/TicketChannelService.js";
import TicketSelectionService from './services/TicketSelectionService.js';
import LoggingService from './services/LoggingService.js';
import PublicChannelService from './services/PublicChannelService.js';
import ChannelService from './services/ChannelService.js';
import PublicArticleService from "./services/PublicArticleService.js";
import PublicContentManager from "./services/PublicContentManager.js";
import dynamicChannelService from './services/DynamicPublicChannelService.js';

// Import handlers
import TicketButtonHandler from './services/TicketButtonHandler.js';
import TicketChannelManager from './services/TicketChannelManager.js';

// Import commands
import commands from './commands/index.js';

// Import constants
import constants from "./config/constants.js";
import botRules from "./config/botRules.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

// Core services
const articleService = new ArticleService();
const aiService = new AIService();
const channelService = new ChannelService();

// Ticket system services
const ticketSelectionService = new TicketSelectionService();
const ticketChannelService = new TicketChannelService(ticketSelectionService, articleService, aiService);
const conversationService = new ConversationService(articleService);

// Public channel services
const publicArticleService = new PublicArticleService();
const publicChannelService = new PublicChannelService();
const publicConversationService = new ConversationService(publicArticleService);
const publicContentManager = new PublicContentManager();

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, // For thread management
  ],
});

// Initialize handlers after client is ready
let ticketButtonHandler;
let ticketChannelManager;
let loggingService;

client.once("ready", async () => {
  console.log(constants.MESSAGES.BOT_READY, client.user.tag);

  // Initialize logging service
  loggingService = new LoggingService(client);

  // Initialize ticket system handlers
  ticketButtonHandler = new TicketButtonHandler(ticketSelectionService, articleService, conversationService, loggingService);
  ticketChannelManager = new TicketChannelManager(ticketSelectionService, loggingService);

  // Set up ticket service dependencies
  ticketChannelService.setServices(conversationService, aiService);
  ticketChannelService.setLoggingService(loggingService);

  // Set bot status and activity
  client.user.setActivity(constants.BOT_CONFIG.ACTIVITY_NAME, {
    type: constants.BOT_CONFIG.ACTIVITY_TYPE,
  });
  client.user.setStatus(constants.BOT_CONFIG.STATUS);

  // Initialize article services
  await initializeServices();

  // Set up periodic maintenance
  setupPeriodicMaintenance();
});

/**
 * Initialize all article services
 */
async function initializeServices() {
  try {
    // Initialize public articles
    await publicArticleService.initialize();

    // Log initialization status
    const status = publicArticleService.getInitializationStatus();
    console.log("✅ Public articles loaded successfully");
    console.log(`📊 PublicArticleService Status:`, status);

    // Rebuild thread tracking after restart
    await publicChannelService.rebuildThreadTracking(client);
    console.log("✅ Thread tracking rebuilt successfully");

  } catch (error) {
    console.error("❌ Error initializing services:", error);
  }
}

/**
 * Set up periodic maintenance tasks
 */
function setupPeriodicMaintenance() {
  // Clean up archived threads every 30 minutes
  setInterval(() => {
    publicChannelService.cleanupArchivedThreads(client);
  }, 30 * 60 * 1000);

  console.log("✅ Periodic maintenance tasks scheduled");
}

// Register slash commands when bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const commandData = Array.from(commands.values()).map(command => command.data);
    await client.application.commands.set(commandData);
    console.log('✅ Slash commands registered successfully');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main message handler - routes messages to appropriate handlers
 */
client.on("messageCreate", async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  try {
    // Route to ticket system
    if (ticketChannelService.isTicketChannel(message.channel)) {
      await ticketChannelService.handleMessage(message);
      return;
    }

    // Route to public channel system
    if (await isPublicChannelMessage(message)) {
      await handlePublicChannelFlow(message);
      return;
    }

    // Message not in any configured channel - ignore silently
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

/**
 * Check if message is in a public channel or thread
 * Now supports DYNAMIC channels from Redis - NO RESTART NEEDED!
 */
async function isPublicChannelMessage(message) {
  if (!botRules.DEVELOPER_CONTROLS.ENABLE_PUBLIC_CHANNELS) {
    console.log(`🚫 Public channels disabled`);
    return false;
  }

  const channelInfo = channelService.getChannelInfo(message);
  const guildId = message.guild.id;
  
  // Get dynamic public channels only
  const approvedChannels = await dynamicChannelService.getAllPublicChannels(guildId);

  // Debug logging
  console.log(`🔍 Checking message in guild ${guildId}, channel ${channelInfo.channelId} (#${message.channel.name})`);
  console.log(`📋 Approved channels: [${approvedChannels.join(', ')}]`);

  // Direct public channel message
  const isPublicChannel = approvedChannels.includes(channelInfo.channelId);

  // Message in thread of public channel
  const isInPublicThread = message.channel.isThread() &&
    message.channel.parent &&
    approvedChannels.includes(message.channel.parent.id);

  const result = isPublicChannel || isInPublicThread;
  console.log(`✅ Channel ${channelInfo.channelId} is public: ${result}`);

  return result;
}

/**
 * Handle the complete public channel message flow
 */
async function handlePublicChannelFlow(message) {
  try {
    // Check if bot should respond
    const responseCheck = await publicChannelService.shouldRespond(message, client.user.id, client);

    if (!responseCheck.shouldRespond) {
      handleNonResponseCase(responseCheck.reason, message);
      return;
    }

    // Process the message
    await processPublicChannelMessage(message);

  } catch (error) {
    console.error("❌ Error in public channel flow:", error);
    await sendErrorResponse(message, error);
  }
}

/**
 * Handle cases where bot doesn't respond
 */
function handleNonResponseCase(reason, message) {
  switch (reason) {
    case 'escalated':
      // User is escalated - silent ignore
      console.log(`🚫 Ignoring message from escalated user: ${message.author.username}`);
      break;
    case 'has_active_thread':
      // User should use their existing thread - silent ignore
      console.log(`🧵 User ${message.author.username} has active thread, ignoring main channel message`);
      break;
    case 'rate_limited':
      // Rate limited - could optionally notify user
      console.log(`⏱️ Rate limited user: ${message.author.username}`);
      break;
    default:
      // Other reasons (no mention, channel not approved, etc.) - silent ignore
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC CHANNEL MESSAGE PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process a public channel message through the complete AI flow
 */
async function processPublicChannelMessage(message) {
  const context = createMessageContext(message);

  try {
    // Step 1: Set up conversation channel (thread or main)
    await setupConversationChannel(context);

    // Step 2: Check for human escalation request
    if (await checkForEscalation(context)) {
      return; // Escalation handled, stop processing
    }

    // Step 3: Generate AI response
    await generateAIResponse(context);

  } catch (error) {
    await handleProcessingError(context, error);
  } finally {
    if (context.typingInterval) {
      clearInterval(context.typingInterval);
    }
  }
}

/**
 * Create message processing context
 */
function createMessageContext(message) {
  return {
    message,
    userId: message.author.id,
    username: message.author.username,
    isInMainChannel: !message.channel.isThread(),
    targetChannel: message.channel,
    typingInterval: null,
  };
}

/**
 * Set up the conversation channel (create thread if needed)
 */
async function setupConversationChannel(context) {
  if (context.isInMainChannel) {
    try {
      const thread = await publicChannelService.createUserThread(
        context.message,
        'AI Support Conversation',
        client
      );
      context.targetChannel = thread;
      console.log(`🧵 Created thread for ${context.username}: ${thread.name}`);
    } catch (error) {
      console.error('⚠️ Failed to create thread, using direct reply:', error);
      // targetChannel remains as message.channel (fallback)
    }
  }

  // Start typing indicator
  context.typingInterval = setInterval(() => context.targetChannel.sendTyping(), 5000);
  context.targetChannel.sendTyping();
}

/**
 * Check for human escalation request
 */
async function checkForEscalation(context) {
  const needsEscalation = await publicChannelService.detectHumanHelpRequest(
    context.message,
    aiService
  );

  if (needsEscalation) {
    // Send escalation to appropriate channel (thread if available, otherwise main channel)
    await publicChannelService.escalateToHuman(context.message, client, context.targetChannel);
    console.log(`🚨 Escalated ${context.username} to human support in ${context.targetChannel.name || 'main channel'}`);
    return true;
  }

  return false;
}

/**
 * Generate and send AI response
 */
async function generateAIResponse(context) {
  // Generate thread-specific conversation key
  const conversationKey = getConversationKey(context.message);

  try {
    // Check if PublicArticleService is properly initialized
    if (!publicArticleService.isInitialized()) {
      console.log("[PublicArticleService] Service not fully initialized, using fallback");
      // Use fallback system prompt
      await publicConversationService.initializeConversation(conversationKey, null, false);
      publicConversationService.addUserMessage(conversationKey, context.message.content, false);

      const conversationHistory = publicConversationService.getConversationHistory(conversationKey, false);
      const aiResponse = await aiService.generateResponse(conversationHistory);

      if (context.typingInterval) {
        clearInterval(context.typingInterval);
        context.typingInterval = null;
      }

      if (isLowConfidenceResponse(aiResponse)) {
        await handleLowConfidenceResponse(context, aiResponse);
      } else {
        await handleNormalResponse(context, aiResponse);
      }
      return;
    }

    // Get relevant content for the user's query
    const relevantContent = await publicArticleService.getRelevantContent(context.message.content);

    // Create enhanced system prompt with query-specific content
    const enhancedSystemPrompt = publicContentManager.createEnhancedSystemPrompt(
      context.message.content,
      relevantContent
    );

    // Initialize conversation with enhanced system prompt
    await publicConversationService.initializeConversation(conversationKey, enhancedSystemPrompt, false);
    publicConversationService.addUserMessage(conversationKey, context.message.content, false);

    // Get conversation history and generate response
    const conversationHistory = publicConversationService.getConversationHistory(conversationKey, false);
    const aiResponse = await aiService.generateResponse(conversationHistory);

    // Stop typing
    if (context.typingInterval) {
      clearInterval(context.typingInterval);
      context.typingInterval = null;
    }

    // Handle response based on confidence
    if (isLowConfidenceResponse(aiResponse)) {
      await handleLowConfidenceResponse(context, aiResponse);
    } else {
      await handleNormalResponse(context, aiResponse);
    }

  } catch (error) {
    console.error("❌ Error generating AI response:", error);
    // Fallback to original method if enhanced system fails
    await publicConversationService.initializeConversation(conversationKey, null, false, context.message.content);
    publicConversationService.addUserMessage(conversationKey, context.message.content, false);

    const conversationHistory = publicConversationService.getConversationHistory(conversationKey, false);
    const aiResponse = await aiService.generateResponse(conversationHistory);

    if (context.typingInterval) {
      clearInterval(context.typingInterval);
      context.typingInterval = null;
    }

    if (isLowConfidenceResponse(aiResponse)) {
      await handleLowConfidenceResponse(context, aiResponse);
    } else {
      await handleNormalResponse(context, aiResponse);
    }
  }
}

/**
 * Generate conversation key based on message context
 */
function getConversationKey(message) {
  const userId = message.author.id;

  if (message.channel.isThread()) {
    const parentChannelId = message.channel.parentId;
    const threadId = message.channel.id;
    return `user_${userId}:${parentChannelId}:${threadId}`;
  } else {
    return `user_${userId}`;
  }
}

/**
 * Check if AI response has low confidence
 */
function isLowConfidenceResponse(aiResponse) {
  return aiResponse.confidence &&
         aiResponse.confidence < botRules.PUBLIC_CHANNELS.CONFIDENCE_THRESHOLD;
}

/**
 * Handle low confidence AI response
 */
async function handleLowConfidenceResponse(context, aiResponse) {
  const lowConfidenceResponse = publicChannelService.getLowConfidenceResponse();
  const escalationRole = botRules.PUBLIC_CHANNELS.ESCALATION_ROLE || '';
  const fullResponse = `${lowConfidenceResponse}\n${escalationRole}`;

  await sendResponse(context, fullResponse);
  await logInteraction(context, lowConfidenceResponse, aiResponse.confidence);
}

/**
 * Handle normal AI response
 */
async function handleNormalResponse(context, aiResponse) {
  const responseText = aiResponse.isValid ? aiResponse.response : aiResponse.response;

  await sendResponse(context, responseText);

  // Add to conversation history if valid
  if (aiResponse.isValid) {
    const conversationKey = getConversationKey(context.message);
    publicConversationService.addAssistantMessage(conversationKey, aiResponse.response, false);
  }

  await logInteraction(context, responseText, aiResponse.confidence);
}

/**
 * Send response to appropriate channel
 */
async function sendResponse(context, responseText) {
  if (context.targetChannel === context.message.channel) {
    await context.message.reply(responseText);
  } else {
    await context.targetChannel.send(`<@${context.userId}> ${responseText}`);
  }
}

/**
 * Log interaction for monitoring
 */
async function logInteraction(context, response, confidence) {
  // Create thread info if not in main channel
  const threadInfo = context.targetChannel !== context.message.channel ? {
    name: context.targetChannel.name,
    id: context.targetChannel.id
  } : null;

  await publicChannelService.logQuery(
    context.userId,
    context.username,
    context.message.content,
    response,
    confidence,
    client,
    threadInfo,
    false // Not an escalation
  );
}

/**
 * Handle processing errors
 */
async function handleProcessingError(context, error) {
  console.error("❌ Error processing public channel message:", error.message);

  const fallbackResponse = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
  await sendResponse(context, fallbackResponse);
}

/**
 * Send error response for unhandled errors
 */
async function sendErrorResponse(message, error) {
  try {
    const errorResponse = "Sorry, I encountered an error. Please try again or contact support.";
    await message.reply(errorResponse);
  } catch (replyError) {
    console.error("❌ Failed to send error response:", replyError);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle Discord interactions (slash commands and buttons)
 */
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    }
  } catch (error) {
    console.error('❌ Error handling interaction:', error);
    await handleInteractionError(interaction, error);
  }
});

/**
 * Handle slash command interactions
 */
async function handleSlashCommand(interaction) {
  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error(`❌ Unknown command: ${interaction.commandName}`);
    return;
  }

  await command.execute(interaction, ticketSelectionService);
}

/**
 * Handle button interactions (ticket system only)
 */
async function handleButtonInteraction(interaction) {
  // Only handle buttons in ticket channels
  if (ticketChannelService.isTicketChannel(interaction.channel)) {
    await ticketButtonHandler.handleButtonInteraction(interaction);
  } else {
    console.log(`🔘 Button interaction in non-ticket channel ignored: ${interaction.customId}`);
  }
}

/**
 * Handle interaction errors
 */
async function handleInteractionError(interaction, error) {
  const errorMessage = 'There was an error while executing this command!';

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  } catch (followupError) {
    console.error('❌ Failed to send error response:', followupError);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL EVENT HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle thread creation (ticket system only)
 */
client.on("threadCreate", async (thread) => {
  try {
    if (ticketChannelService.isTicketChannel(thread)) {
      await ticketChannelManager.handleChannelCreation(thread);
    }
  } catch (error) {
    console.error('❌ Error handling thread creation:', error);
  }
});

/**
 * Handle channel deletion (ticket system only)
 */
client.on('channelDelete', async (channel) => {
  try {
    await ticketChannelManager.handleChannelDeletion(channel);
  } catch (error) {
    console.error('❌ Error handling channel deletion:', error);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOT LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.DISCORD_TOKEN);
