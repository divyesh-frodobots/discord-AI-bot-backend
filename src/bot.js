import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

// Import services
import ArticleService from "./services/ArticleService.js";
import ConversationService from "./services/ConversationService.js";
import AIService from "./services/AIService.js";
import TicketChannelService from "./services/TicketChannelService.js";
import TicketSelectionService from './services/TicketSelectionService.js';
import LoggingService from './services/LoggingService.js';
import PublicChannelService from './services/PublicChannelService.js';
import ChannelService from './services/ChannelService.js';

// Import handlers
import TicketButtonHandler from './services/TicketButtonHandler.js';
import TicketChannelManager from './services/TicketChannelManager.js';

// Import commands
import commands from './commands/index.js';

// Import constants
import constants from "./config/constants.js";
import botRules from "./config/botRules.js";

// Initialize services
const articleService = new ArticleService();
const conversationService = new ConversationService(articleService);
const aiService = new AIService();
const ticketSelectionService = new TicketSelectionService();
const ticketChannelService = new TicketChannelService(ticketSelectionService, articleService, aiService);
const publicChannelService = new PublicChannelService();
const channelService = new ChannelService();

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize handlers and logging service after client is ready
let ticketButtonHandler;
let ticketChannelManager;
let loggingService;

client.once("ready", () => {
  console.log(constants.MESSAGES.BOT_READY, client.user.tag);
  
  // Initialize logging service
  loggingService = new LoggingService(client);
  
  // Initialize handlers
  ticketButtonHandler = new TicketButtonHandler(ticketSelectionService, articleService, conversationService, loggingService);
  ticketChannelManager = new TicketChannelManager(ticketSelectionService, loggingService);
  
  // Set up service dependencies
  ticketChannelService.setServices(conversationService, aiService);
  ticketChannelService.setLoggingService(loggingService);
  
  // Set bot activity
  client.user.setActivity(constants.BOT_CONFIG.ACTIVITY_NAME, {
    type: constants.BOT_CONFIG.ACTIVITY_TYPE,
  });
  
  // Set bot status
  client.user.setStatus(constants.BOT_CONFIG.STATUS);
  // Initialize article service
  articleService.initialize().then(() => {
    console.log(constants.MESSAGES.ARTICLES_LOADED);
  }).catch(() => {
    console.log(constants.MESSAGES.ARTICLES_FAILED);
  });
});

// Register slash commands when bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  try {
    // Register commands globally
    const commandData = Array.from(commands.values()).map(command => command.data);
    await client.application.commands.set(commandData);
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

// Main message handler - handles both ticket and public channels
client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;
  // Handle ticket channels
  if (ticketChannelService.isTicketChannel(message.channel)) {
    await ticketChannelService.handleMessage(message);
    return;
  }
  // Handle public channels
  const channelInfo = channelService.getChannelInfo(message);
  const isPublicChannel = botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS.includes(channelInfo.channelName);
  if (isPublicChannel && botRules.DEVELOPER_CONTROLS.ENABLE_PUBLIC_CHANNELS) {
    // --- Trigger Conditions ---
    const publicChannelCheck = publicChannelService.shouldRespond(message, client.user.id);
    if (publicChannelCheck.shouldRespond) {
      await handlePublicChannelMessage(message, publicChannelService);
    } else if (publicChannelCheck.escalateNow) {
      await publicChannelService.handleEscalation(message);
    } else if (publicChannelCheck.reason === 'escalated') {
      // Do nothing: user is escalated in this channel
    } else if (publicChannelCheck.reason === 'trigger_no_question' && publicChannelCheck.triggered) {
      message.reply(publicChannelService.getFriendlyPrompt());
    }
    // Otherwise, do nothing (silent)
    return;
  }

  // Not a public or ticket channel: do nothing (silent)
  return;
});


// --- Handler for public channel messages ---
async function handlePublicChannelMessage(message, publicChannelService) {
  const userId = message.author.id;
  const username = message.author.username; 
  let typingInterval;
  try {
    typingInterval = setInterval(() => message.channel.sendTyping(), 5000);
    message.channel.sendTyping();
    await conversationService.initializeConversation(userId, null, true);
    conversationService.addUserMessage(userId, message.content, true);
    const conversationHistory = conversationService.getConversationHistory(userId, true);
    console.log("----conversationHistory----", conversationHistory);
    const aiResponse = await aiService.generateResponse(conversationHistory);
    console.log("----aiResponse----", aiResponse);
    if (typingInterval) clearInterval(typingInterval);
    // --- Confidence Threshold ---
    if (aiResponse.confidence && aiResponse.confidence < botRules.PUBLIC_CHANNELS.CONFIDENCE_THRESHOLD) {
      const lowConfidenceResponse = publicChannelService.getLowConfidenceResponse();
      const escalationRole = botRules.PUBLIC_CHANNELS.ESCALATION_ROLE || '';
      await message.reply(`${lowConfidenceResponse}\n${escalationRole}`);
      await publicChannelService.logQuery(userId, username, message.content, lowConfidenceResponse, aiResponse.confidence, client);
      return;
    }
    if (aiResponse.isValid) {
      message.reply(aiResponse.response);
      conversationService.addAssistantMessage(userId, aiResponse.response, true);
      await publicChannelService.logQuery(userId, username, message.content, aiResponse.response, aiResponse.confidence, client);
    } else {
      message.reply(aiResponse.response);
      await publicChannelService.logQuery(userId, username, message.content, aiResponse.response, null, client);
    }
  } catch (err) {
    if (typingInterval) clearInterval(typingInterval);
    console.error("Error processing public channel message:", err.message);
    message.reply(constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM));
  }
}

// Handle interactions
client.on('interactionCreate', async interaction => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    
    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction, ticketSelectionService);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}:`, error);
      const errorMessage = 'There was an error while executing this command!';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
    return;
  }

  // Handle button interactions - only for ticket channels
  if (interaction.isButton()) {
    // Only handle buttons in ticket channels
    if (ticketChannelService.isTicketChannel(interaction.channel)) {
      await ticketButtonHandler.handleButtonInteraction(interaction);
      return;
    }
    
    // Ignore button interactions in non-ticket channels for now
    console.log('Button interaction in non-ticket channel ignored:', interaction.customId);
  }
});

// Handle channel creation - only for ticket channels
client.on("channelCreate", async (channel) => {
  // Only handle text channels
  if (channel.type !== ChannelType.GuildText) return;
  
  await ticketChannelManager.handleChannelCreation(channel);
});

// Handle channel deletion - only for ticket channels
client.on('channelDelete', async (channel) => {
  await ticketChannelManager.handleChannelDeletion(channel);
});

// Login
client.login(process.env.DISCORD_TOKEN);

