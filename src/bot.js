import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType, ButtonBuilder, ActionRowBuilder, ButtonStyle } from "discord.js";
import { getServerFallbackResponse, getServerConfig } from './config/serverConfigs.js';
import dynamicTicketChannelService from './services/dynamic/DynamicTicketChannelService.js';

// Import services
import ArticleService from "./services/ArticleService.js";
import ConversationService from "./services/ConversationService.js";
import AIService from "./services/AIService.js";
import TicketChannelService from "./services/TicketChannelService.js";
import TicketSelectionService from './services/TicketSelectionService.js';
import LoggingService from './services/LoggingService.js';
import PublicChannelService from './services/PublicChannelService.js';

import { contentService as publicContentService } from "./services/PublicArticleService.js";
import PublicContentManager from "./services/PublicContentManager.js";
import dynamicChannelService from './services/dynamic/DynamicPublicChannelService.js';
import googleDocsContentService from './services/GoogleDocsContentService.js';
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

// Import utilities
import ConversationKeyUtil from "./utils/ConversationKeyUtil.js";
import ShopifyIntegrationUtil from "./utils/ShopifyIntegrationUtil.js";

// Import common services
import PermissionService from "./services/PermissionService.js";
import MessageService from "./services/MessageService.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

// Core services
const articleService = new ArticleService();
const aiService = new AIService();


// Ticket system services
const ticketSelectionService = new TicketSelectionService();
const ticketChannelService = new TicketChannelService(ticketSelectionService, articleService, aiService);
const conversationService = new ConversationService(articleService);

// Public channel services (use singleton for SoT)
const publicArticleService = publicContentService;
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

  // Start dynamic ticket channel cache refresher
  dynamicTicketChannelService.startCacheRefresher(10000);
  // Start public channel cache refresher
  dynamicChannelService.startCacheRefresher(10000);
});

/**
 * Initialize all article services
 */
async function initializeServices() {
  try {
    // Initialize public articles (eager load all categories)
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
    // Admin commands for Google Docs testing
    if (message.content.startsWith('!gdocs') && message.author.id === process.env.ADMIN_USER_ID) {
      await handleGoogleDocsAdminCommand(message);
      return;
    }

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

  const guildId = message.guild.id;
  const channelId = message.channel.id;
  
  // Get dynamic public channels only
  const approvedChannels = await dynamicChannelService.getAllPublicChannels(guildId);

  // Debug logging
  console.log(`🔍 Checking message in guild ${guildId}, channel ${channelId} (#${message.channel.name})`);
  console.log(`📋 Approved channels: [${approvedChannels.join(', ')}]`);

  // Direct public channel message
  const isPublicChannel = approvedChannels.includes(channelId);

  // Message in thread of public channel
  const isInPublicThread = message.channel.isThread() &&
    message.channel.parent &&
    approvedChannels.includes(message.channel.parent.id);

  const result = isPublicChannel || isInPublicThread;
  console.log(`✅ Channel ${channelId} is public: ${result}`);

  return result;
}

/**
 * Handle the complete public channel message flow
 */
async function handlePublicChannelFlow(message) {
  try {
    // 🛍️ SMART ROUTING - Check if sensitive order query should go to ticket
    // BUT ONLY in threads, not in main public channels
    const isInThread = message.channel.isThread();
    
    if (isInThread && await shopifyIntegrator.isOrderRelated(message.content)) {
      const shouldGoPrivate = await shopifyIntegrator.shouldRecommendPrivateChannel(message.content);
      if (shouldGoPrivate) {
        console.log('🛍️ Detected sensitive order query in thread, recommending ticket creation');
        // Dynamic ticket channels only
        const guildId = message.guild?.id;
        const dynamicTicketParents = dynamicTicketChannelService.getCachedTicketChannels(guildId);
        const ticketChannelId = dynamicTicketParents[0] || null;
        
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
    MessageService.stopTyping(context.typingInterval);
  }
}

/**
 * Create message processing context
 */
function createMessageContext(message) {
  return MessageService.createContext(message);
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
  context.typingInterval = MessageService.startTyping(context.targetChannel);
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
  const shopifyResponse = await ShopifyIntegrationUtil.handleMessage(context.message, 'public');
  if (shopifyResponse) {
    // Stop typing
    if (context.typingInterval) {
      clearInterval(context.typingInterval);
      context.typingInterval = null;
    }
    
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
      shopifyResponse.components = [actionRow];
    }

    await ShopifyIntegrationUtil.sendResponse(context.message, shopifyResponse, context.targetChannel);
    
    // If Shopify fully handled it, skip AI
    if (ShopifyIntegrationUtil.isFullyHandled(shopifyResponse)) {
      console.log('✅ Shopify fully handled the query, skipping AI response');
      return;
    }
    // Otherwise, continue to AI for additional context
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

      MessageService.stopTyping(context.typingInterval);
      context.typingInterval = null;

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
        // Merge channel-allowed with mentioned to allow cross-product retrieval (no hard bias)
        const merged = Array.from(new Set([...(allowedProducts || []), ...mentioned]));
        effectiveAllowedProducts = merged;
      }
    } catch {}

    // Get relevant content scoped to allowed products (if any)
    const relevantContent = await publicArticleService.getRelevantContent(
      context.message.content,
      15000,
      effectiveAllowedProducts
    );

    // 📄 GOOGLE DOCS INTEGRATION - Get channel-specific Google Docs content
    const googleDocsContent = await googleDocsContentService.getChannelGoogleDocsContent(
      guildId, 
      targetChannelId, 
      context.message.content
    );

    // Combine Intercom articles with Google Docs content
    let combinedContent = relevantContent;
    if (googleDocsContent) {
      combinedContent = `CHANNEL-SPECIFIC DOCUMENTATION:\n${googleDocsContent}\n\nGENERAL KNOWLEDGE BASE:\n${relevantContent}`;
      console.log(`📄 Enhanced content with Google Docs: ${googleDocsContent.length} chars from docs + ${relevantContent.length} chars from articles`);
    }

    // Create enhanced system prompt with query-specific content
    const enhancedSystemPrompt = publicContentManager.createEnhancedSystemPrompt(
      context.message.content,
      combinedContent,
      effectiveAllowedProducts,
      { allowCrossProduct: true }
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
function getConversationKey(context) {
  const target = context.targetChannel || context.message.channel;
  const mockMessage = { ...context.message, channel: target };
  return ConversationKeyUtil.generateKey(mockMessage, true);
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
  return await PermissionService.isStaffMemberAsync(message);
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
  const MAX_DISCORD_LENGTH = 2000;
  
  // If message is within Discord's limit, send normally
  if (responseText.length <= MAX_DISCORD_LENGTH) {
    if (context.targetChannel === context.message.channel) {
      await context.message.reply(responseText);
    } else {
      await context.targetChannel.send(`<@${context.userId}> ${responseText}`);
    }
    return;
  }
  
  // Message is too long - split it intelligently
  console.log(`📝 Response too long (${responseText.length} chars), splitting into multiple messages...`);
  
  const messages = splitLongMessage(responseText, MAX_DISCORD_LENGTH);
  
  // Send first message as reply
  if (context.targetChannel === context.message.channel) {
    await context.message.reply(messages[0]);
  } else {
    await context.targetChannel.send(`<@${context.userId}> ${messages[0]}`);
  }
  
  // Send remaining messages normally
  for (let i = 1; i < messages.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between messages
    await context.targetChannel.send(messages[i]);
  }
}

/**
 * Split long message into chunks that fit Discord's character limit
 */
function splitLongMessage(text, maxLength) {
  if (text.length <= maxLength) {
    return [text];
  }
  
  const messages = [];
  let currentMessage = '';
  
  // Split by paragraphs first (double newlines)
  const paragraphs = text.split('\n\n');
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed limit
    if (currentMessage.length + paragraph.length + 2 > maxLength) {
      // If current message has content, save it
      if (currentMessage.trim()) {
        messages.push(currentMessage.trim());
        currentMessage = '';
      }
      
      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxLength) {
        const sentences = paragraph.split('. ');
        for (const sentence of sentences) {
          const sentenceWithPeriod = sentence.endsWith('.') ? sentence : sentence + '.';
          
          if (currentMessage.length + sentenceWithPeriod.length + 1 > maxLength) {
            if (currentMessage.trim()) {
              messages.push(currentMessage.trim());
              currentMessage = '';
            }
          }
          
          currentMessage += (currentMessage ? ' ' : '') + sentenceWithPeriod;
        }
      } else {
        currentMessage = paragraph;
      }
    } else {
      currentMessage += (currentMessage ? '\n\n' : '') + paragraph;
    }
  }
  
  // Add remaining content
  if (currentMessage.trim()) {
    messages.push(currentMessage.trim());
  }
  
  return messages.length > 0 ? messages : [text.substring(0, maxLength - 10) + '...[truncated]'];
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
    
    // Create ticket thread under the first dynamic ticket parent
    const guildId = interaction.guild.id;
    const dynamicTicketParents = dynamicTicketChannelService.getCachedTicketChannels(guildId);
    const parentId = dynamicTicketParents[0] || null;
    if (!parentId) {
      await interaction.editReply({ content: '❌ No dynamic ticket channel configured for this server.' });
      return;
    }
    const supportChannel = await interaction.guild.channels.fetch(parentId);
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
// ADMIN COMMANDS FOR GOOGLE DOCS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle Google Docs admin commands
 */
async function handleGoogleDocsAdminCommand(message) {
  const args = message.content.split(' ');
  const command = args[1];

  try {
    switch (command) {
      case 'refresh':
        await message.reply('🔄 Starting manual Google Docs refresh...');
        const result = await googleDocsContentService.manualRefresh();
        if (result.success) {
          await message.reply(`✅ ${result.message || `Refreshed ${result.refreshed}/${result.total} docs`}`);
        } else {
          await message.reply(`❌ Refresh failed: ${result.error}`);
        }
        break;

      case 'status':
        const cacheStatus = await googleDocsContentService.getCacheStatus();
        if (cacheStatus.length === 0) {
          await message.reply('📄 No Google Docs content cached yet.');
        } else {
          const statusMsg = cacheStatus.map(item => 
            `📄 **Doc**: ${item.key.substring(0, 30)}...\n` +
            `   Last fetched: ${new Date(item.lastFetched).toLocaleString()}\n` +
            `   Content: ${item.contentLength} chars\n` +
            `   TTL: ${item.ttlHours}h remaining`
          ).join('\n\n');
          await message.reply(`**Google Docs Cache Status:**\n\`\`\`\n${statusMsg}\n\`\`\``);
        }
        break;

      case 'test':
        const guildId = message.guild.id;
        const channelId = message.channel.id;
        await message.reply('🧪 Testing Google Docs content retrieval...');
        
        // Get the Google Docs links first
        const googleDocLinks = await dynamicChannelService.getChannelGoogleDocLinks(guildId, channelId);
        if (!googleDocLinks || googleDocLinks.length === 0) {
          await message.reply('❌ No Google Docs configured for this channel.');
          break;
        }
        
        await message.reply(`📄 Found ${googleDocLinks.length} Google Docs configured for this channel. Fetching content...`);
        
        const content = await googleDocsContentService.getChannelGoogleDocsContent(guildId, channelId, 'test query');
        if (content) {
          const preview = content.substring(0, 800) + (content.length > 800 ? '...' : '');
          const docCount = (content.match(/=== DOCUMENT \d+/g) || []).length;
          const tokenEstimate = Math.ceil(content.length / 4);
          
          await message.reply(`✅ **Multi-Doc Retrieval Success:**
📊 **Stats**: ${content.length} chars, ~${tokenEstimate} tokens
📄 **Documents**: ${docCount || 1} document(s) combined
🔍 **Preview**:
\`\`\`
${preview}
\`\`\``);
        } else {
          await message.reply('❌ Failed to retrieve Google Docs content (check logs for details).');
        }
        break;

      default:
        await message.reply(`**Google Docs Admin Commands:**
\`!gdocs refresh\` - Manually refresh all Google Docs
\`!gdocs status\` - Show cache status
\`!gdocs test\` - Test content retrieval for current channel`);
    }
  } catch (error) {
    console.error('❌ Google Docs admin command error:', error);
    await message.reply(`❌ Command failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOT LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

client.login(process.env.DISCORD_TOKEN);
