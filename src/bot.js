import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType, ButtonBuilder, ActionRowBuilder, ButtonStyle } from "discord.js";
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
import shopifyIntegrator from './shopify/ShopifyIntegrator.js';
import shopifyPublicIntegrator from './shopify/ShopifyPublicIntegrator.js';
import redis from './services/redisClient.js';

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

// Initialize Shopify integration with AI service for intelligent order detection
shopifyIntegrator.setAIService(aiService);

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
      // Check if this is a support staff member in a thread
      if (message.channel.isThread() && await isStaffMember(message)) {
        await markThreadAsSupportHandled(message);
        console.log(`👮 Support staff message detected - bot will stop responding in thread: ${message.channel.name}`);
        return; // Don't process this message further
      }

      // Also ignore messages from staff in main public channels
      if (!message.channel.isThread() && await isStaffMember(message)) {
        console.log(`👮 Staff message in main public channel detected - bot will not respond in #${message.channel.name}`);
        return; // Don't process this message further
      }
      
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
    // 🛍️ SMART ROUTING - Check if sensitive order query should go to ticket
    if (await shopifyIntegrator.isOrderRelated(message.content)) {
      const shouldGoPrivate = await shopifyIntegrator.shouldRecommendPrivateChannel(message.content);
      if (shouldGoPrivate) {
        console.log('🛍️ Detected sensitive order query, recommending ticket creation');
        // Get server config to find ticket channel
        const serverConfig = getServerConfig(message.guild?.id);
        const ticketChannelId = serverConfig?.ticketChannelId;
        
        if (ticketChannelId) {
          // Use the Shopify redirect message
          const redirectMessage = shopifyPublicIntegrator.createRedirectMessage(ticketChannelId);
          await message.reply(redirectMessage);
        } else {
          // Fallback if no ticket channel configured
          await message.reply(
            '🔒 For privacy and security, please create a support ticket for order-related assistance. This helps us protect your personal information and provide better support.\n\n' +
            'Use the ticket system for:\n• Order status and tracking\n• Refunds and returns\n• Account-specific issues\n• Payment problems'
          );
        }
        return;
      }
    }

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
  // 🛍️ SHOPIFY INTEGRATION - Check for order-related queries first
  try {
    const shopifyResponse = await shopifyIntegrator.handlePublicMessage(context.message);
    if (shopifyResponse) {
      console.log('🛍️ Shopify handled public message');
      
      // Stop typing
      if (context.typingInterval) {
        clearInterval(context.typingInterval);
        context.typingInterval = null;
      }
      
      // Prepare message content and components
      const messageOptions = { 
        content: shopifyResponse.content, 
        flags: ['SuppressEmbeds'] 
      };

      // Add ticket creation button if requested
      if (shopifyResponse.showTicketButton) {
        const ticketButton = new ButtonBuilder()
          .setCustomId('create_order_ticket')
          .setLabel('🎫 Create Private Ticket')
          .setStyle(ButtonStyle.Primary);

        const continueButton = new ButtonBuilder()
          .setCustomId('continue_public')
          .setLabel('Continue Here')
          .setStyle(ButtonStyle.Secondary);

        const actionRow = new ActionRowBuilder().addComponents(ticketButton, continueButton);
        messageOptions.components = [actionRow];
      }

      await context.targetChannel.send(messageOptions);
      
      // If Shopify fully handled it, skip AI
      if (!shopifyResponse.shouldContinueToAI) {
        console.log('✅ Shopify fully handled the query, skipping AI response');
        return;
      }
      // Otherwise, continue to AI for additional context
    }
  } catch (shopifyError) {
    console.error('❌ Shopify integration error (continuing to AI):', shopifyError.message);
  }
  // END SHOPIFY INTEGRATION

  // Generate conversation key (thread-aware and channel-scoped)
  const conversationKey = getConversationKey(context);

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

    // Determine allowed products for this channel (parent if thread)
    const guildId = context.message.guild.id;
    const targetChannelId = context.message.channel.isThread()
      ? context.message.channel.parent.id
      : context.message.channel.id;
    const channelDetails = await dynamicChannelService.getChannelDetails(guildId);
    const channelInfo = channelDetails.find(c => c.channelId === targetChannelId);
    const allowedProducts = Array.isArray(channelInfo?.products) ? channelInfo.products : [];
    console.log(`🔍 Allowed products for ${targetChannelId}: ${allowedProducts}`);

    // If the user mentioned a product, narrow to that product when possible
    let effectiveAllowedProducts = allowedProducts;
    try {
      const analysis = publicContentManager.analyzeQuery(context.message.content);
      const mentioned = Array.isArray(analysis?.productMentions) ? analysis.productMentions : [];
      if (mentioned.length > 0) {
        if (allowedProducts.length > 0) {
          const narrowed = allowedProducts.filter(p => mentioned.includes(p));
          if (narrowed.length > 0) effectiveAllowedProducts = narrowed;
        } else {
          effectiveAllowedProducts = mentioned;
        }
      }
    } catch {}

    // Get relevant content scoped to allowed products (if any)
    const relevantContent = await publicArticleService.getRelevantContent(
      context.message.content,
      15000,
      effectiveAllowedProducts
    );

    // Create enhanced system prompt with query-specific content
    const productConstraint = (effectiveAllowedProducts && effectiveAllowedProducts.length)
      ? `IMPORTANT: This channel is limited to these products only: ${effectiveAllowedProducts.join(', ')}. If the question is about another product, ask the user to switch to the correct product.`
      : '';

    const enhancedSystemPrompt = publicContentManager.createEnhancedSystemPrompt(
      context.message.content,
      relevantContent,
      effectiveAllowedProducts
    );

    const finalSystemPrompt = productConstraint
      ? `${productConstraint}\n\n${enhancedSystemPrompt}`
      : enhancedSystemPrompt;

    // Initialize conversation with enhanced system prompt
    await publicConversationService.initializeConversation(conversationKey, finalSystemPrompt, false);
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
function getConversationKey(context) {
  const message = context.message;
  const userId = message.author.id;
  const target = context.targetChannel || message.channel;

  if (target.isThread && target.isThread()) {
    const parentChannelId = target.parentId || (target.parent && target.parent.id);
    const threadId = target.id;
    return `user_${userId}:${parentChannelId}:${threadId}`;
  }
  // Include channel id to avoid cross-channel context mixing
  const channelId = target.id;
  return `user_${userId}:${channelId}`;
}

/**
 * Check if AI response has low confidence
 */
function isLowConfidenceResponse(aiResponse) {
  return aiResponse.confidence &&
         aiResponse.confidence < botRules.PUBLIC_CHANNELS.CONFIDENCE_THRESHOLD;
}

/**
 * Check if message author is a staff member
 */
async function isStaffMember(message) {
  const guildId = message.guild?.id;
  const serverConfig = getServerConfig(guildId);
  
  if (!serverConfig || !serverConfig.staffRoleIds) {
    return false;
  }
  
  try {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return false;
    
    return serverConfig.staffRoleIds.some(roleId => 
      member.roles.cache.has(roleId)
    );
  } catch (error) {
    console.error('Error checking staff member:', error);
    return false;
  }
}

/**
 * Mark a thread as being handled by support staff
 */
async function markThreadAsSupportHandled(message) {
  const threadId = message.channel.id;
  
  try {
    // Mark in Redis with 24 hour expiry
    await redis.set(`publicthread:support-handled:${threadId}`, 'true', 'EX', 86400);
    
    // Silent operation - no notification message sent
    console.log(`🔇 Thread ${threadId} marked as support-handled (silent mode)`);
  } catch (error) {
    console.error('Error marking thread as support-handled:', error);
  }
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
    const conversationKey = getConversationKey(context);
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
  const guildId = context.message.guild?.id;
  const fallbackResponse = getServerFallbackResponse(guildId);
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
 * Handle button interactions (ticket system and public channel ticket creation)
 */
async function handleButtonInteraction(interaction) {
  // Handle ticket channel buttons
  if (ticketChannelService.isTicketChannel(interaction.channel)) {
    await ticketButtonHandler.handleButtonInteraction(interaction);
    return;
  }
  
  // Handle public channel buttons
  if (interaction.customId === 'create_order_ticket') {
    await handleCreateOrderTicket(interaction);
    return;
  }
  
  if (interaction.customId === 'continue_public') {
    await handleContinuePublic(interaction);
    return;
  }
  
  console.log(`🔘 Button interaction ignored: ${interaction.customId}`);
}

/**
 * Handle creating an order support ticket from public channel
 */
async function handleCreateOrderTicket(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    
    // Get server configuration
    const serverConfig = getServerConfig(interaction.guild.id);
    if (!serverConfig) {
      await interaction.editReply({ content: '❌ Server configuration not found.' });
      return;
    }

    // Create ticket thread
    const supportChannel = await interaction.guild.channels.fetch(serverConfig.ticketChannelId);
    if (!supportChannel) {
      await interaction.editReply({ content: '❌ Support channel not found.' });
      return;
    }

    const thread = await supportChannel.threads.create({
      name: `${interaction.user.displayName}: Order Support`,
      type: ChannelType.PrivateThread
    });

    // Auto-select "Order Status" category
    await ticketSelectionService.set(thread.id, {
      category: 'category_orders',
      product: null,
      humanHelp: false,
      questionsAnswered: false
    });

    // Send welcome message in ticket
    const welcomeMessage = '🎫 **Private Order Support Ticket**\n\n' +
      `Hi ${interaction.user.displayName}! I can help you with:\n` +
      '• Order status & tracking information\n' +
      '• Shipping updates & delivery details\n' +
      '• Order modifications & cancellations\n' +
      '• Returns & refunds\n\n' +
      'Please share your order number or describe what you need help with!';

    await thread.send({ content: welcomeMessage });

    // Log ticket creation
    if (loggingService) {
      await loggingService.logTicketCreation(thread, interaction.user, 'Order Support (from public)');
    }

    // Notify user
    await interaction.editReply({ 
      content: `✅ **Created private order support ticket:** ${thread}\n\nYour order inquiry will be handled privately with full details available.` 
    });

  } catch (error) {
    console.error('❌ Error creating order ticket:', error);
    await interaction.editReply({ content: '❌ Failed to create support ticket. Please try again.' });
  }
}

/**
 * Handle continuing in public channel
 */
async function handleContinuePublic(interaction) {
  try {
    await interaction.reply({ 
      content: '👍 **Continuing in public channel**\n\nI can provide basic order information here. Please provide your order number for a status check.\n\n*Remember: Only limited information will be shown for privacy.*',
      ephemeral: true 
    });
  } catch (error) {
    console.error('❌ Error handling continue public:', error);
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
