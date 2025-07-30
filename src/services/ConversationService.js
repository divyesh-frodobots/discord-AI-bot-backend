
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
  getConversationId(message, useUserBased = true) {image.png
    if (useUserBased) {
      return `user_${message.author.id}`;
    } else {
      return message.channel.isThread() ? message.channel.id : message.channel.id;
    }
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

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need human support, they can ask to "talk to team" right here in Discord

CRITICAL INSTRUCTIONS:
1. ONLY reference previous conversation context when the current question is clearly related to what was discussed before
2. If a user asks a completely new, unrelated question, treat it as a fresh conversation and focus solely on answering that question
3. If the user asks follow-up questions or uses phrases like "what about that", "how about the other one", "and what about...", then reference the previous conversation
4. Use phrases like "As I mentioned earlier" or "Based on our previous discussion" ONLY when the current question is genuinely related to previous context
5. If you detect that a question is unrelated to previous conversation (e.g., switching from asking about UFB to asking about EarthRover), respond to the new question without referencing previous context
6. Only answer questions related to FrodoBots services based on the provided article content
7. Be conversational but don't force connections where they don't naturally exist
8. Always base your responses on the official help article content provided above
9. DO NOT mention website chat widgets or external contact methods - you're already in Discord with them
10. DO NOT add generic closing statements like "Feel free to ask if you have any questions" or "I'm here to help" - end responses naturally
11. Focus on providing the information directly without unnecessary closing phrases
12. NEVER fabricate or guess information - stick strictly to the knowledge base content

CONTEXT RELEVANCE GUIDE:
- Related: Follow-up questions about the same topic, clarifications, or deeper questions about what was just discussed
- Unrelated: New topics, different products, completely different questions that don't build on previous discussion
- When in doubt, prioritize answering the current question directly rather than forcing previous context

When users need additional support, remind them they can ask to "talk to team" right here in Discord.`
      };
      console.log("System message initialized and cached");
    }
    return this.systemMessage;
  }

  async initializeConversation(conversationId, articles = null, isUserBased = true) {
    // If articles is provided (for product-specific conversations), use it
    // Otherwise, use the cached system message for general conversations
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    
    if (!this.userConversations[key]) {
      if (articles) {
        // For product-specific conversations (like tickets), use provided articles
        this.userConversations[key] = [{ role: "system", content: articles }];
      } else {
        // For general conversations (like public channels), use cached system message
        const systemMessage = await this.initializeSystemMessage();
        this.userConversations[key] = [systemMessage];
      }
    }
  }

  addUserMessage(conversationId, message, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    this.userConversations[key].push({ role: "user", content: message });
    console.log(`📝 Added user message to conversation ${key}. Total messages: ${this.userConversations[key].length}`);
    this.manageConversationLength(key);
  }

  addAssistantMessage(conversationId, message, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
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
      // Keep more messages for better context (last 10 instead of 6)
      const recentMessages = this.userConversations[conversationKey].slice(-10);
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
        console.log(`Last user message: "${userMessages[userMessages.length - 1].content.substring(0, 100)}..."`);
      }
    }
    
    return history;
  }

  // Get user's conversation history
  getUserConversation(userId) {
    const key = `user_${userId}`;
    return this.userConversations[key] || [];
  }

  // Check if user has previous conversation
  hasUserHistory(userId) {
    const key = `user_${userId}`;
    return this.userConversations[key] && this.userConversations[key].length > 1;
  }

  // Get conversation context summary for debugging
  getConversationContext(userId) {
    const key = `user_${userId}`;
    const conversation = this.userConversations[key] || [];
    
    console.log(`🔍 Checking context for user ${userId} (key: ${key})`);
    console.log(`   Conversation exists: ${!!this.userConversations[key]}`);
    console.log(`   Conversation length: ${conversation.length}`);
    console.log(`   Available conversations: ${Object.keys(this.userConversations).join(', ')}`);
    
    if (conversation.length <= 1) {
      return { hasContext: false, message: "No previous conversation" };
    }
    
    const userMessages = conversation.filter(msg => msg.role === 'user');
    const assistantMessages = conversation.filter(msg => msg.role === 'assistant');
    
    return {
      hasContext: true,
      totalMessages: conversation.length - 1, // Exclude system message
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      lastUserMessage: userMessages[userMessages.length - 1]?.content || null,
      lastAssistantMessage: assistantMessages[assistantMessages.length - 1]?.content || null,
      conversationPreview: conversation.slice(-4).map(msg => `${msg.role}: ${msg.content.substring(0, 50)}...`)
    };
  }

  // Get user's conversation summary
  getUserConversationSummary(userId) {
    const conversation = this.getUserConversation(userId);
    if (conversation.length <= 1) return null; // Only system message
    
    const userMessages = conversation.filter(msg => msg.role === 'user');
    const assistantMessages = conversation.filter(msg => msg.role === 'assistant');
    
    return {
      totalMessages: conversation.length - 1, // Exclude system message
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      lastUserMessage: userMessages[userMessages.length - 1]?.content || null,
      lastAssistantMessage: assistantMessages[assistantMessages.length - 1]?.content || null
    };
  }

  clearConversation(conversationId, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    delete this.userConversations[key];
  }

  // Clear specific user's conversation
  clearUserConversation(userId) {
    const key = `user_${userId}`;
    delete this.userConversations[key];
    console.log(`Cleared conversation history for user ${userId}`);
  }

  getConversationStats(conversationId, isUserBased = true) {
    const key = isUserBased ? `user_${conversationId}` : conversationId;
    const history = this.userConversations[key] || [];
    const totalContent = history.map(msg => msg.content).join(' ');
    const estimatedTokens = this.estimateTokens(totalContent);
    
    return {
      messageCount: history.length,
      estimatedTokens,
      isOverLimit: estimatedTokens > this.MAX_CONVERSATION_TOKENS,
      isUserBased: isUserBased
    };
  }

  // Get all active user conversations
  getAllUserConversations() {
    const users = {};
    for (const [key, conversation] of Object.entries(this.userConversations)) {
      if (key.startsWith('user_')) {
        const userId = key.replace('user_', '');
        users[userId] = {
          messageCount: conversation.length,
          estimatedTokens: this.estimateTokens(conversation.map(msg => msg.content).join(' '))
        };
      }
    }
    return users;
  }
}

export default ConversationService; 