import constants from '../config/constants.js';
import { buildSystemPrompt as buildArticleSystemPrompt, buildHumanHelpPrompt } from './ArticleService.js';
import botRules from '../config/botRules.js';

/**
 * ProductService - Centralized product management
 */
export class ProductService {
  constructor(articleService) {
    this.articleService = articleService;
  }

  /**
   * Get comprehensive product information
   */
  getProductInfo(productKeyOrButtonId) {
    // Handle both button IDs (product_ufb) and keys (ufb)
    const key = productKeyOrButtonId.startsWith('product_') 
      ? productKeyOrButtonId.replace('product_', '') 
      : productKeyOrButtonId;

    const productMap = {
      'ufb': { key: 'ufb', name: 'UFB', displayName: 'UFB (Ultimate Fighting Bots)' },
      'earthrover': { key: 'earthrover', name: 'Earthrover', displayName: 'Earthrover (Drive to Earn)' },
      'earthrover_school': { key: 'earthrover_school', name: 'Earthrover School', displayName: 'Earthrover School' },
      'sam': { key: 'sam', name: 'SAM', displayName: 'SAM (Small Autonomous Mofo)' },
      'robotsfun': { key: 'robotsfun', name: 'Robots Fun', displayName: 'Robots Fun' },
      'et_fugi': { key: 'et_fugi', name: 'ET Fugi', displayName: 'ET Fugi' }
    };
    
    return productMap[key] || null;
  }

  /**
   * Handle product selection for any channel type
   */
  async handleProductSelection(interaction, channelId, conversationService, ticketSelectionService, loggingService, isTicketChannel = true) {
    try {
      await interaction.deferReply();
      
      const productInfo = this.getProductInfo(interaction.customId);
      if (!productInfo) {
        await interaction.editReply({ content: '❌ Unknown product selection.' });
        return;
      }

      // Get product articles and setup conversation
      const articles = await this.articleService.getArticlesByCategory(productInfo.key);
      conversationService.clearConversation(channelId, !isTicketChannel);
      
      const systemContent = this.buildSystemPrompt(articles, productInfo.name);
      await conversationService.initializeConversation(channelId, systemContent, !isTicketChannel);

      // Update selection state
      const selection = { product: productInfo.key, humanHelp: false };
      ticketSelectionService.set(channelId, selection);

      await interaction.editReply({ 
        content: `✅ You selected **${productInfo.displayName}**! Please ask your ${productInfo.name}-related question.`
      });

      // Log product selection
      if (loggingService) {
        const logMessage = {
          author: { tag: interaction.user.tag, id: interaction.user.id },
          channel: interaction.channel,
          content: `Product selected: ${productInfo.name}`
        };
        
        if (isTicketChannel) {
          await loggingService.logTicketInteraction(logMessage, `Product selected: ${productInfo.name}`, productInfo.key, false);
        }
      }

      return productInfo;
    } catch (error) {
      console.error('Error handling product selection:', error);
      throw error;
    }
  }

  /**
   * Build system prompt using the centralized method
   */
  buildSystemPrompt(articles, productName) {
    let systemPrompt = articles;
    if (typeof systemPrompt === "string") {
      systemPrompt = [{ content: systemPrompt }];
    }
    
    return buildArticleSystemPrompt(systemPrompt, productName);
  }

  /**
   * Build system prompt for public channels
   */
  buildPublicChannelPrompt(articles) {
    return `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. You have access to the following information:

${articles}

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need detailed support, they can ask to "talk to team" or create a support ticket right here in Discord
- The support team is available in this Discord server

IMPORTANT GUIDELINES:
- Be friendly and conversational, like a helpful friend
- Only answer questions related to FrodoBots services, robot fighting, Earthrovers, or similar topics
- If the question is not related to FrodoBots, politely redirect them to ask about FrodoBots services
- Keep responses concise but informative
- If someone needs detailed help, suggest they ask to "talk to team" or create a support ticket right here in Discord
- Be encouraging and supportive
- Avoid robotic language - be natural and conversational
- DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
- DO NOT add generic closing statements like "Feel free to ask if you have any questions" or "I'm here to help" - end responses naturally
- Focus on providing the information directly without unnecessary closing phrases

TONE: Friendly, helpful, and encouraging. Like talking to a knowledgeable friend who wants to help!

Remember: Only respond to questions about FrodoBots services. For other topics, politely redirect them. When users need additional support, remind them they can ask to "talk to team" or create a support ticket right here in Discord.`;
  }
}

/**
 * EscalationService - Centralized human help and escalation logic
 */
export class EscalationService {
  constructor(aiService) {
    this.aiService = aiService;
  }

  /**
   * Handle human help request for any channel type
   */
  async handleHumanHelp(interaction, channelId, conversationService, ticketSelectionService, loggingService, isTicketChannel = true) {
    try {
      await interaction.deferReply();
      
      // Clear conversation and set human help
      conversationService.clearConversation(channelId, !isTicketChannel);
      
      const selection = { product: null, humanHelp: true };
      ticketSelectionService.set(channelId, selection);
      
      const helpMessage = constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM);
      await interaction.editReply({ content: helpMessage });
      
      // Log human help request
      if (loggingService) {
        const logMessage = {
          author: { tag: interaction.user.tag, id: interaction.user.id },
          channel: interaction.channel,
          content: 'Human help requested via button'
        };
        
        if (isTicketChannel) {
          await loggingService.logEscalation(logMessage, 'User requested human help via button');
        }
      }

    } catch (error) {
      console.error('Error handling human help:', error);
      throw error;
    }
  }

  /**
   * Detect if user is requesting human help using AI
   */
  async detectHumanHelpRequest(message) {
    try {
      const systemContent = buildHumanHelpPrompt();
      const messages = [
        { role: "system", content: systemContent },
        { role: "user", content: message.content }
      ];

      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(messages);
      
      // Check if AI detected escalation intent
      return aiResponse && 
             aiResponse.isValid && 
             aiResponse.response.includes(constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM));

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      // Fallback: escalate if AI fails
      return true;
    }
  }

  /**
   * Check for escalation phrases in message content
   */
  hasEscalationPhrase(content) {
    const escalationPhrases = botRules.PUBLIC_CHANNELS.ESCALATION_PHRASES;
    const contentLower = content.toLowerCase();
    return escalationPhrases.some(phrase => contentLower.includes(phrase.toLowerCase()));
  }

  /**
   * Handle escalation for public channels
   */
  async handlePublicEscalation(message) {
    const escalationMessage = botRules.PUBLIC_CHANNELS.ESCALATION_MESSAGE
      .replace('{user}', `<@${message.author.id}>`)
      .replace('{channel}', `<#${message.channel.id}>`);

    await message.reply({ 
      content: `${botRules.PUBLIC_CHANNELS.ESCALATION_ROLE} - ${escalationMessage}`, 
      flags: ['SuppressEmbeds'] 
    });
    
    return {
      escalated: true,
      message: escalationMessage
    };
  }
}

/**
 * ChannelUtilsService - Channel detection and utilities
 */
export class ChannelUtilsService {
  /**
   * Check if channel is a ticket channel
   */
  static isTicketChannel(channel) {
    return channel.isThread && channel.isThread() && channel.parentId === constants.ROLES.SUPPORT_TICKET_CHANNEL_ID;
  }

  /**
   * Check if channel is approved for public bot responses
   */
  static isApprovedPublicChannel(channelName) {
    const approvedChannels = botRules.PUBLIC_CHANNELS.APPROVED_CHANNELS;
    return approvedChannels.some(approved => 
      channelName.toLowerCase().includes(approved.toLowerCase())
    );
  }

  /**
   * Check if message is from staff member
   */
  static isStaffMessage(message) {
    const staffRoles = botRules.TICKET_CHANNELS.STAFF_ROLES;
    const staffRoleIds = botRules.TICKET_CHANNELS.STAFF_ROLE_IDS;
    const staffPermissions = botRules.TICKET_CHANNELS.STAFF_PERMISSIONS;
    
    // Check staff roles by name
    const hasStaffRoleByName = message.member.roles.cache.some(role => 
      staffRoles.includes(role.name)
    );
    
    // Check staff roles by ID
    const hasStaffRoleById = message.member.roles.cache.some(role => 
      staffRoleIds.includes(role.id)
    );
    
    // Check staff permissions
    const hasStaffPermissions = message.member.permissions && 
      staffPermissions.some(permission => 
        message.member.permissions.has(permission)
      );
    
    return hasStaffRoleByName || hasStaffRoleById || hasStaffPermissions;
  }
} 