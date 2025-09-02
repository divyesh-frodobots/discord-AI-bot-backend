
import ConversationKeyUtil from '../utils/ConversationKeyUtil.js';

class ConversationService {
  constructor(articleService) {
    this.articleService = articleService;
    this.conversationHistory = {};
    this.userConversations = {}; // New: user-based conversations
    this.MAX_CONVERSATION_TOKENS = 5000; // Reduced from 7000 to stay within limits
    this.systemMessage = null; // Cache the system message
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  // Get conversation ID - can be channel-based or user-based
  getConversationId(message, useUserBased = true) {
    return ConversationKeyUtil.generateKey(message, useUserBased);
  }

  // Initialize system message once and cache it
  async initializeSystemMessage() {
    if (!this.systemMessage) {
      // Get cached articles from ArticleService
      const articles = await this.articleService.getAllArticles();

      this.systemMessage = {
        role: "system",
        content: `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. You have access to the following information from official help articles:

${articles}

CONVERSATION GUIDELINES:
- You can engage in basic conversation, greetings, and general chat
- For technical questions about FrodoBots products, you must ONLY use information from the articles above
- If technical information is not in the provided articles, say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- Be friendly, conversational, and concise while staying focused on FrodoBots support

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can ask to "talk to team" right here in Discord

CRITICAL URL FORMATTING:
- NEVER format URLs as markdown links [text](url)
- ALWAYS use plain URLs like: https://www.robots.fun/ 
- Discord will automatically make plain URLs clickable
- Do NOT add any brackets, parentheses, or markdown formatting around URLs

CRITICAL INSTRUCTIONS:
1. ALWAYS reference previous conversation context when responding
2. If a user asks follow-up questions, refer to what was discussed before
3. Use phrases like "As I mentioned earlier", "Based on our previous discussion", "To continue from where we left off"
4. If the user asks "What about X?" or "How about Y?", connect it to the previous conversation
5. Only answer questions related to FrodoBots services based on the provided article content and the conversation history
6. Be conversational and maintain context throughout the conversation
7. Always base your responses on the official help article content provided above and the conversation history
8. DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
9. DO NOT add generic closing statements like "Feel free to ask if you have any questions" or "I'm here to help" - end responses naturally
10. Focus on providing the information directly without unnecessary closing phrases
11. For technical questions not covered in the articles, say "I don't have specific information about that. You can ask to talk to team for more detailed help."

Remember: Always build on previous context and make connections to earlier parts of the conversation. When users need additional support, remind them they can ask to "talk to team" right here in Discord.`
      };
      console.log("System message initialized and cached");
    }
    return this.systemMessage;
  }

  // NEW: Initialize OR UPDATE the system message per turn (keeps history)
  async initializeConversation(conversationId, articles = null, isUserBased = true, userQuery = null) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;

    // Ensure conversation container exists
    if (!this.userConversations[key]) {
      this.userConversations[key] = [];
    }

    // Decide the new system message
    let newSystemMessage;
    if (articles) {
      newSystemMessage = { role: "system", content: articles };
    } else if (userQuery && this.articleService.getRelevantContent) {
      try {
        const relevantContent = await this.articleService.getRelevantContent(userQuery);
        newSystemMessage = await this._createQuerySpecificSystemMessage(userQuery, relevantContent);
      } catch (error) {
        console.error("Error getting query-specific content, falling back to general:", error);
        const fallback = await this.initializeSystemMessage();
        newSystemMessage = fallback;
      }
    } else {
      const fallback = await this.initializeSystemMessage();
      newSystemMessage = fallback;
    }

    // Replace or insert system message at index 0, preserve rest of history
    if (this.userConversations[key].length === 0) {
      this.userConversations[key].push(newSystemMessage);
    } else {
      this.userConversations[key][0] = newSystemMessage;
    }
  }

  // NEW: Create query-specific system message
  async _createQuerySpecificSystemMessage(query, relevantContent) {
    return {
      role: "system",
      content: `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. 

USER'S QUESTION: "${query}"

RELEVANT INFORMATION:
${relevantContent}

CONVERSATION GUIDELINES:
- Answer the user's question based ONLY on the relevant information provided above
- If the information doesn't cover their specific question, say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- Be friendly, conversational, and helpful
- Keep responses concise but informative
- If you need more context, ask the user to clarify their question
- Always maintain conversation context and refer to previous messages when relevant

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can ask to "talk to team" right here in Discord

CRITICAL INSTRUCTIONS:
1. Focus on answering the specific question: "${query}"
2. Use ONLY the relevant information provided above
3. If the information doesn't cover the question, be honest and suggest talking to team
4. Be conversational and maintain context throughout the conversation
5. DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
6. DO NOT add generic closing statements - end responses naturally
7. For technical questions not covered in the provided information, say "I don't have specific information about that. You can ask to talk to team for more detailed help."

Remember: Provide accurate, helpful information based on the relevant content provided. When users need additional support, remind them they can ask to "talk to team" right here in Discord.`
    };
  }

  addUserMessage(conversationId, message, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    
    // Ensure conversation is initialized
    if (!this.userConversations[key]) {
      console.warn(`⚠️ Conversation ${key} not initialized, initializing now`);
      this.userConversations[key] = [];
    }
    
    this.userConversations[key].push({ role: "user", content: message });
    console.log(`📝 Added user message to conversation ${key}. Total messages: ${this.userConversations[key].length}`);
    this.manageConversationLength(key);
  }

  addAssistantMessage(conversationId, message, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    
    // Ensure conversation is initialized
    if (!this.userConversations[key]) {
      console.warn(`⚠️ Conversation ${key} not initialized, initializing now`);
      this.userConversations[key] = [];
    }
    
    this.userConversations[key].push({ role: "assistant", content: message });
    console.log(`🤖 Added assistant message to conversation ${key}. Total messages: ${this.userConversations[key].length}`);
    this.manageConversationLength(key);
  }

  manageConversationLength(conversationKey) {
    const totalContent = this.userConversations[conversationKey]
      .map(msg => msg.content)
      .join(' ');

    const estimatedTokens = this.estimateTokens(totalContent);

    if (estimatedTokens > this.MAX_CONVERSATION_TOKENS) {
      const systemMessage = this.userConversations[conversationKey][0];
      const recentMessages = this.userConversations[conversationKey].slice(-6);
      this.userConversations[conversationKey] = [systemMessage, ...recentMessages];
      console.log(`Conversation history truncated for ${conversationKey} to prevent token overflow. Kept ${recentMessages.length} recent messages.`);
    }
  }

  getConversationHistory(conversationId, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    const history = this.userConversations[key] || [];

    // Log conversation context for debugging
    if (history.length > 1) {
      const userMessages = history.filter(msg => msg.role === 'user');
      const assistantMessages = history.filter(msg => msg.role === 'assistant');
      console.log(`Conversation context: ${userMessages.length} user messages, ${assistantMessages.length} assistant messages`);

      if (userMessages.length > 0) {
        const lastUserMessage = userMessages[userMessages.length - 1];
        console.log(`Last user message: "${lastUserMessage.content.substring(0, 100)}..."`);
      }
    }

    return history;
  }

  getUserConversation(userId) {
    const key = `user_${userId}`;
    return this.userConversations[key] || [];
  }

  hasUserHistory(userId) {
    const key = `user_${userId}`;
    return this.userConversations[key] && this.userConversations[key].length > 1;
  }

  getConversationContext(userId) {
    const conversation = this.getUserConversation(userId);
    if (conversation.length === 0) return null;

    const userMessages = conversation.filter(msg => msg.role === 'user');
    const assistantMessages = conversation.filter(msg => msg.role === 'assistant');

    return {
      totalMessages: conversation.length - 1, // Exclude system message
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      lastUserMessage: userMessages.length > 0 ? userMessages[userMessages.length - 1].content : null,
      lastAssistantMessage: assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1].content : null,
      conversationStart: conversation.length > 1 ? conversation[1].timestamp : null
    };
  }

  getUserConversationSummary(userId) {
    const conversation = this.getUserConversation(userId);
    if (conversation.length <= 1) return "No conversation history";

    const userMessages = conversation.filter(msg => msg.role === 'user');
    const assistantMessages = conversation.filter(msg => msg.role === 'assistant');

    const summary = {
      userId: userId,
      totalMessages: conversation.length - 1,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      topics: this._extractTopics(userMessages),
      lastActivity: userMessages.length > 0 ? userMessages[userMessages.length - 1].content : null
    };

    return summary;
  }

  _extractTopics(userMessages) {
    const topics = new Set();
    const topicKeywords = {
      'setup': ['setup', 'install', 'configuration', 'getting started'],
      'troubleshooting': ['problem', 'issue', 'error', 'fix', 'help'],
      'features': ['feature', 'function', 'capability', 'what can'],
      'pricing': ['price', 'cost', 'payment', 'subscription'],
      'support': ['support', 'help', 'contact', 'team']
    };

    userMessages.forEach(msg => {
      const content = msg.content.toLowerCase();
      Object.entries(topicKeywords).forEach(([topic, keywords]) => {
        if (keywords.some(keyword => content.includes(keyword))) {
          topics.add(topic);
        }
      });
    });

    return Array.from(topics);
  }

  clearConversation(conversationId, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    if (this.userConversations[key]) {
      delete this.userConversations[key];
      console.log(`Cleared conversation for ${key}`);
    }
  }

  clearUserConversation(userId) {
    this.clearConversation(userId, true);
  }

  getConversationStats(conversationId, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    const conversation = this.userConversations[key] || [];

    if (conversation.length === 0) {
      return {
        exists: false,
        messageCount: 0,
        userMessages: 0,
        assistantMessages: 0,
        estimatedTokens: 0
      };
    }

    const userMessages = conversation.filter(msg => msg.role === 'user');
    const assistantMessages = conversation.filter(msg => msg.role === 'assistant');
    const totalContent = conversation.map(msg => msg.content).join(' ');

    return {
      exists: true,
      messageCount: conversation.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      estimatedTokens: this.estimateTokens(totalContent),
      lastUserMessage: userMessages.length > 0 ? userMessages[userMessages.length - 1].content : null,
      lastAssistantMessage: assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1].content : null
    };
  }

  getAllUserConversations() {
    const conversations = {};
    for (const [key, conversation] of Object.entries(this.userConversations)) {
      if (key.startsWith('user_')) {
        const userId = key.replace('user_', '');
        conversations[userId] = this.getConversationStats(userId, true);
      }
    }
    return conversations;
  }
}

export default ConversationService;
