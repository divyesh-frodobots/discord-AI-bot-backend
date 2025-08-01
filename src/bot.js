import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { getServerFallbackResponse } from './config/serverConfigs.js';

// Import services
import TicketSelectionService from "./services/TicketSelectionService.js";
import TicketChannelService from "./services/TicketChannelService.js";
import TicketChannelManager from "./services/TicketChannelManager.js";
import TicketButtonHandler from "./services/TicketButtonHandler.js";
import ArticleService from "./services/ArticleService.js";
import PublicChannelService from "./services/PublicChannelService.js";
import ConversationService from "./services/ConversationService.js";
import ChannelService from "./services/ChannelService.js";
import LoggingService from "./services/LoggingService.js";
import AIService from "./services/AIService.js";

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
const publicChannelService = new PublicChannelService();
const publicConversationService = new ConversationService(articleService); // Use articleService like ticket bot

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

// ═══════════════════════════════════════════════════════════════════════════════
// BOT INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

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
    // Initialize article service (used by both ticket and public bots)
    console.log("✅ Article service ready (shared by ticket and public bots)");
    
    // Restore public channel data from Redis
    await publicChannelService.restoreFromRedis(client, articleService);
    console.log("✅ Public channel data restored from Redis");
    
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
    if (isPublicChannelMessage(message)) {
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
 */
function isPublicChannelMessage(message) {
  if (!botRules.DEVELOPER_CONTROLS.ENABLE_PUBLIC_CHANNELS) {
    return false;
  }

  const channelInfo = channelService.getChannelInfo(message);

  // Direct public channel message
  const isPublicChannel = botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(channelInfo.channelName);

  // Message in thread of public channel
  const isInPublicThread = message.channel.isThread() &&
    message.channel.parent &&
    botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(message.channel.parent.name);

  return isPublicChannel || isInPublicThread;
}

/**
 * Handle the complete public channel message flow - Clean Command-Based Bot
 */
async function handlePublicChannelFlow(message) {
  try {
    // Check if bot should respond (command/mention triggers only)
    const responseCheck = await publicChannelService.shouldRespond(message, client.user.id);
    
    if (!responseCheck.shouldRespond) {
      // Don't log non-triggers to reduce noise
      return;
    }

    console.log(`🎯 Public channel trigger: ${responseCheck.reason} from ${message.author.username}`);

    // Handle thread messages
    if (message.channel.isThread()) {
      await publicChannelService.handleThreadMessage(message, articleService, publicConversationService);
      return;
    }

    // Handle public channel messages
    await publicChannelService.handlePublicChannelMessage(message, articleService, publicConversationService);
    
  } catch (error) {
    console.error("❌ Error in public channel flow:", error);
    await message.reply("❌ Sorry, I encountered an error. Please try again or type `human help` for support.");
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
 * Handle button interactions (product selection)
 */
async function handleButtonInteraction(interaction) {
  // Handle product selection buttons
  if (interaction.customId.startsWith('select_')) {
    await publicChannelService.handleProductSelection(interaction, articleService);
    return;
  }
  
  // Handle ticket system buttons
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

