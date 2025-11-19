import { buildSystemPrompt, buildHumanHelpPrompt } from './ArticleService.js';
import googleDocsContentService from './GoogleDocsContentService.js';
import { getServerFallbackResponse } from '../config/serverConfigs.js';
import TicketChannelUtil from '../utils/TicketChannelUtil.js';
import botRules from '../config/botRules.js';
 import shopifyIntegrator from '../shopify/ShopifyIntegrator.js';
import PermissionService from './PermissionService.js';
import embeddingService from './EmbeddingService.js';

/**
 * TicketChannelService - Handles message processing in ticket channels
 * 
 * This service manages:
 * - Message validation and routing
 * - AI response generation
 * - Human escalation detection
 * - Staff message filtering
 * 
 * STEP 4: Message Processing & AI Responses
 */
class TicketChannelService {
  constructor(ticketSelectionService, articleService, aiService) {
    this.ticketSelectionService = ticketSelectionService;
    this.articleService = articleService;
    this.aiService = aiService;
    this.loggingService = null;
    this.replyGuards = new Set();
  }

  /**
   * Set required services
   * @param {Object} conversationService - Conversation management service
   * @param {Object} aiService - AI service for responses
   */
  setServices(conversationService, aiService) {
    this.conversationService = conversationService;
    this.aiService = aiService;
  }

  /**
   * Set logging service
   * @param {Object} loggingService - Logging service
   */
  setLoggingService(loggingService) {
    this.loggingService = loggingService;
  }

  /**
   * Check if a channel is a ticket channel
   * @param {Object} channel - Discord channel object
   * @returns {boolean} True if it's a ticket channel
   */
  isTicketChannel(channel) {
    return TicketChannelUtil.isTicketChannel(channel);
  }

  /**
   * Check if message is from staff member
   * @param {Object} message - Discord message object
   * @returns {boolean} True if message is from staff
   */
  isStaffMessage(message) {
    return PermissionService.isStaffMember(message);
  }

  /**
   * Main message handler for ticket channels
   * @param {Object} message - Discord message object
   */
  async handleMessage(message) {
    // Only process messages in valid ticket threads
    if (!this.isTicketChannel(message.channel)) {
      return;
    }
    const channelId = message.channel.id;
    
    // Step 1: Get current ticket state
    const ticketState = await this.ticketSelectionService.get(channelId);
    console.log(`📋 Current ticket state for ${channelId}:`, JSON.stringify(ticketState, null, 2));

    // Step 2: Check if AI should respond
    if (!(await this.shouldAIRespond(ticketState, message))) {
      return;
    }

    // Step 3: If category is Order Status, route strictly to Shopify and stop
    if (ticketState.category === 'category_orders') {
      try {
        const shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
        if (shopifyResponse) {
          await message.reply({ content: shopifyResponse.content, flags: ['SuppressEmbeds'] });
          
          // Update ticket state if needed (for follow-up tracking)
          if (shopifyResponse.updateTicketState) {
            const updatedState = { ...ticketState, ...shopifyResponse.updateTicketState };
            await this.ticketSelectionService.set(channelId, updatedState);
          }

          // Log the interaction
          if (this.loggingService) {
            const isEscalation = shopifyResponse.type === 'shopify_escalation';
            await this.loggingService.logTicketInteraction(message, shopifyResponse.content, ticketState.product, isEscalation);
          }
          return; // Never let general AI reply in Order Status category
        }
        // If no shopify response, prompt for both fields
        await message.reply({ content: 'Please provide BOTH your order number (e.g., #1234) and the email used for the purchase.', flags: ['SuppressEmbeds'] });
        return;
      } catch (e) {
        console.error('❌ Order Status handling failed:', e.message);
        await message.reply({ content: 'Sorry, I could not process the order status right now. Please try again.', flags: ['SuppressEmbeds'] });
        return;
      }
    }

    // Step 4: Handle categories that require immediate human escalation (Hardware, Bug, Billing)
    if (this.isCategoryQuestionFlow(ticketState)) {
      await this.handleCategoryQuestions(message, ticketState);
      return;
    }

    // Step 5: Check for human help request
    if (await this.detectHumanHelpRequest(message)) {
      await this.escalateToHuman(message, ticketState);
      return;
    }

    // Step 6: Validate category selection first
    if (!ticketState.category) {
      const allowWithoutCategory = String(process.env.TICKET_ALLOW_AI_WITHOUT_CATEGORY || 'true').toLowerCase() === 'true';
      if (!allowWithoutCategory) {
        // Don't send duplicate messages - the welcome message already has buttons
        const noCategoryResponse = 'Please select a category using the buttons above to get started.';
        await message.reply({ content: noCategoryResponse, flags: ['SuppressEmbeds'] });
        return;
      }
      // Allowed: proceed with a general, multi-product response
      await this.generateAIResponseGeneric(message, ticketState);
      return;
    }

    // Step 7: Validate product selection (skip for order status category)
    if (!ticketState.product) {
      const allowWithoutProductForGeneral = String(process.env.TICKET_ALLOW_AI_WITHOUT_PRODUCT_FOR_GENERAL || 'true').toLowerCase() === 'true';
      const isGeneralLike = ticketState.category === 'category_general' || ticketState.category === 'category_software';
      if (allowWithoutProductForGeneral && isGeneralLike) {
        await this.generateAIResponseNoProductForGeneral(message, ticketState);
        return;
      }
      await this.requestProductSelection(message);
      return;
    }

    // Step 8: Generate AI response
    await this.generateAIResponse(message, ticketState);
  }

  /**
   * Check if support team has messaged in this thread
   * @param {Object} channel - Discord channel object
   * @returns {Promise<boolean>} True if support team has messaged
   */
  async hasSupportTeamMessaged(channel) {
    try {
      // Fetch recent messages to check for support team activity
      const messages = await channel.messages.fetch({ limit: 100 });
      
      for (const [id, message] of messages) {
        if (!message.author.bot && this.isStaffMessage(message)) {
          console.log(`👥 Support team member ${message.author.tag} has messaged in ${channel.id} - bot will stop responding`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('❌ Error checking for support team messages:', error);
      return false;
    }
  }

  /**
   * Check if AI should respond to this message
   * @param {Object} ticketState - Current ticket state
   * @param {Object} message - Discord message object
   * @returns {Promise<boolean>} True if AI should respond
   */
  async shouldAIRespond(ticketState, message) {
    // Don't respond if human help is requested
    if (ticketState.humanHelp) {
      return false;
    }

    // Don't respond to staff messages
    if (this.isStaffMessage(message)) {
      console.log(`👥 Ignoring staff message from ${message.author.tag} in ticket ${message.channel.id}`);
      return false;
    }

    // Check if support team has messaged in this thread - if so, bot should stop responding
    if (await this.hasSupportTeamMessaged(message.channel)) {
      console.log(`🔇 AI staying silent: Support team has messaged in ${message.channel.id} - human support is active`);
      return false;
    }

    // Check if this ticket has bot interaction data (new flow) or no data (old flow)
    const hasBotInteraction = await this.ticketSelectionService.has(message.channel.id);
    if (!hasBotInteraction) {
      console.log(`🔇 AI staying silent: No bot interaction data found - this appears to be an old flow ticket handled by staff in ${message.channel.id}`);
      return false;
    }

    return true;
  }

  /**
   * Check if this is a category question flow
   * @param {Object} ticketState - Current ticket state
   * @returns {boolean} True if in category question flow
   */
  isCategoryQuestionFlow(ticketState) {
    // Only certain categories should immediately escalate to human
    const immediateEscalationCategories = [
      'category_hardware',
      'category_bug', 
      'category_billing',
      'category_other'
    ];
    
    return ticketState.category && 
           !ticketState.questionsAnswered && 
           immediateEscalationCategories.includes(ticketState.category);
  }

  /**
   * Handle category-specific question flows that require immediate human escalation
   * (Hardware, Bug, Billing categories)
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async handleCategoryQuestions(message, ticketState) {
    const channelId = message.channel.id;
    
    // Mark questions as answered and escalate to human
    await this.ticketSelectionService.updateField(channelId, 'questionsAnswered', true);
    await this.ticketSelectionService.escalateToHuman(channelId);
    const supportMessage = getServerFallbackResponse(message.guild.id);
    await message.reply({ content: supportMessage, flags: ['SuppressEmbeds'] });

    // Log escalation
    if (this.loggingService) {
      const categoryName = this.getCategoryDisplayName(ticketState.category);
      await this.loggingService.logEscalation(message, `${categoryName} category - requires human support`);
      await this.loggingService.logTicketInteraction(message, supportMessage, null, true);
    }
  }

  /**
   * Detect if user is requesting human help
   * @param {Object} message - Discord message object
   * @returns {boolean} True if human help is requested
   */
  async detectHumanHelpRequest(message) {
    try {
      // Heuristic first: explicit phrases should escalate immediately
      const contentLower = (message.content || '').toLowerCase();
      const explicitPhrases = botRules.TICKET_CHANNELS?.ESCALATION_PHRASES || [];
      if (explicitPhrases.some(p => contentLower.includes(p))) {
        console.log('🔎 Explicit human-help phrase detected in ticket message → ESCALATE');
        return true;
      }

      const systemContent = buildHumanHelpPrompt();
      const messages = [
        { role: "system", content: systemContent },
        { role: "user", content: message.content }
      ];

      await message.channel.sendTyping();
      const result = await this.aiService.classifyEscalation(messages);
      const isEscalationRequest = result === 'ESCALATE';
      if (isEscalationRequest) {
        console.log(`🚨 Human help request detected from ${message.author.username}: "${message.content}"`);
      }
      return isEscalationRequest;

    } catch (error) {
      console.error('❌ Error detecting human help request:', error);
      // Fallback: escalate if AI fails to be safe
      return true;
    }
  }

  /**
   * Escalate ticket to human support
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async escalateToHuman(message, ticketState) {
    const channelId = message.channel.id;
    
    // Mark for human help
    await this.ticketSelectionService.escalateToHuman(channelId);
            const supportMessage = getServerFallbackResponse(message.guild.id);
        await message.reply({ content: supportMessage, flags: ['SuppressEmbeds'] });

    // Log escalation
    if (this.loggingService) {
      await this.loggingService.logEscalation(message, 'AI detected escalation intent');
      await this.loggingService.logTicketInteraction(message, supportMessage, ticketState?.product, true);
    }
  }

  /**
   * Request category selection from user
   * @param {Object} message - Discord message object
   */
  async requestCategorySelection(message) {
    const noCategoryResponse = 'Please select a category to get started with your support request using the buttons above.';
    await message.reply({ content: noCategoryResponse, flags: ['SuppressEmbeds'] });

    // Log interaction
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, noCategoryResponse, null, false);
    }
  }

  /**
   * Request product selection from user
   * @param {Object} message - Discord message object
   */
  async requestProductSelection(message) {
    const noProductResponse = 'Please select a product (UFB, Earthrover, Earthrover School, SAM, or Robots Fun) using the buttons above before asking your question.';
    await message.reply({ content: noProductResponse, flags: ['SuppressEmbeds'] });

    // Log interaction
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, noProductResponse, null, false);
    }
  }

  /**
   * Generate AI response using general multi-product context when category is not selected
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async generateAIResponseGeneric(message, ticketState) {
    try {
      // Shopify handling even without category, to catch order details early
      try {
        const shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
        if (shopifyResponse) {
          if (!this.replyGuards.has(message.channel.id)) {
            this.replyGuards.add(message.channel.id);
            try {
              await message.reply({ content: shopifyResponse.content, flags: ['SuppressEmbeds'] });
            } finally {
              setTimeout(() => this.replyGuards.delete(message.channel.id), 1500);
            }
          }
          if (this.loggingService) {
            await this.loggingService.logTicketInteraction(message, shopifyResponse.content, ticketState?.product || null, false);
          }
          return;
        }
      } catch (shopifyError) {
        console.error('❌ Shopify integration error in generic flow (continuing to AI):', shopifyError.message);
      }

      const channelId = message.channel.id;
      await message.channel.sendTyping();

      const allArticles = await this.articleService.getAllArticles();
      let systemContent = buildSystemPrompt(allArticles, 'FrodoBots (General Support)', { allowCrossProduct: true });

      // Enrich with ticket parent Google Docs even before category/product selection
      try {
        const parentId = message.channel.parentId;
        if (parentId) {
          const docsContent = await googleDocsContentService.getChannelGoogleDocsContent(message.guild.id, parentId, message.content);
          if (docsContent) {
            systemContent = (systemContent && typeof systemContent === 'string')
              ? (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}\n\n` + systemContent)
              : (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}`);
          }
        }
      } catch (docErr) {
        console.warn('⚠️ Ticket Google Docs enrichment (no-category generic) failed:', docErr.message);
      }

      await this.conversationService.initializeConversation(channelId, systemContent, false);
      this.conversationService.addUserMessage(channelId, message.content, false);

      await message.channel.sendTyping();
      const aiMessages = this.conversationService.getConversationHistory(channelId, false);
      const aiResponse = await this.aiService.generateResponse(aiMessages, message.guild.id);

      if (aiResponse && aiResponse.isValid) {
        await message.reply({ content: aiResponse.response, flags: ['SuppressEmbeds'] });
        this.conversationService.addAssistantMessage(channelId, aiResponse.response, false);
        if (this.loggingService) {
          await this.loggingService.logTicketInteraction(message, aiResponse.response, null, false);
        }
      } else {
        await this.sendFallbackResponse(message, ticketState);
      }
    } catch (e) {
      console.error('❌ Error in generateAIResponseGeneric:', e);
      await this.sendFallbackResponse(message, ticketState);
    }
  }

  /**
   * Generate AI response for General/Setup categories without a selected product.
   * Attempts cross-product retrieval to ground in the best product; falls back to generic.
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async generateAIResponseNoProductForGeneral(message, ticketState) {
    try {
      // Try to detect best product corpus
      const cross = await this.crossProductRetrieval(message.content, null);
      const channelId = message.channel.id;

      if (cross) {
        const productDisplayName = this.getProductDisplayName(cross.product);
        let systemContent = buildSystemPrompt(cross.content, productDisplayName, { allowCrossProduct: true });

        // Optionally autoset product based on confidence threshold
        const autosetThreshold = parseFloat(process.env.TICKET_AUTOSET_PRODUCT_MIN_SCORE || '0.34');
        if (!Number.isNaN(autosetThreshold) && typeof cross.score === 'number' && cross.score >= autosetThreshold) {
          try {
            await this.ticketSelectionService.updateField(channelId, 'product', cross.product);
            ticketState.product = cross.product;
          } catch (setErr) {
            console.warn('⚠️ Could not autoset product from cross-product detection:', setErr.message);
          }
        }

        await message.channel.sendTyping();
        // Enrich with ticket parent Google Docs even without product
        try {
          const parentId = message.channel.parentId;
          if (parentId) {
            const docsContent = await googleDocsContentService.getChannelGoogleDocsContent(message.guild.id, parentId, message.content);
            if (docsContent) {
              systemContent = (systemContent && typeof systemContent === 'string')
                ? (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}\n\n` + systemContent)
                : (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}`);
            }
          }
        } catch (docErr) {
          console.warn('⚠️ Ticket Google Docs enrichment (no-product) failed:', docErr.message);
        }

        await this.conversationService.initializeConversation(channelId, systemContent, false);
        this.conversationService.addUserMessage(channelId, message.content, false);

        await message.channel.sendTyping();
        const aiMessages = this.conversationService.getConversationHistory(channelId, false);
        const aiResponse = await this.aiService.generateResponse(aiMessages, message.guild.id);
        if (aiResponse && aiResponse.isValid) {
          await message.reply({ content: aiResponse.response, flags: ['SuppressEmbeds'] });
          this.conversationService.addAssistantMessage(channelId, aiResponse.response, false);
          if (this.loggingService) {
            await this.loggingService.logTicketInteraction(message, aiResponse.response, ticketState?.product || cross.product || null, false);
          }
          return;
        }
        // Fall through to generic if AI invalid
      }

      // Fallback: generic response
      await this.generateAIResponseGeneric(message, ticketState);
    } catch (e) {
      console.error('❌ Error in generateAIResponseNoProductForGeneral:', e);
      await this.sendFallbackResponse(message, ticketState);
    }
  }

  /**
   * Generate AI response for user message
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async generateAIResponse(message, ticketState) {
    try {
      console.log(`🤖 Generating AI response for product: ${ticketState.product}`);
      
      // 🛍️ SHOPIFY INTEGRATION - Check for order-related queries first
      try {
        const shopifyResponse = await shopifyIntegrator.handleTicketMessage(message, ticketState);
        if (shopifyResponse) {
          console.log('🛍️ Shopify handled ticket message');
          if (!this.replyGuards.has(message.channel.id)) {
            this.replyGuards.add(message.channel.id);
            try {
              await message.reply({ content: shopifyResponse.content, flags: ['SuppressEmbeds'] });
            } finally {
              setTimeout(() => this.replyGuards.delete(message.channel.id), 1500);
            }
          }
          
          // Log Shopify interaction
          if (this.loggingService) {
            await this.loggingService.logTicketInteraction(message, shopifyResponse.content, ticketState.product, false);
          }
          
          // Always stop after a Shopify response to avoid double replies
          console.log('✅ Stopping after Shopify response to prevent duplicate replies');
          return;
        }
      } catch (shopifyError) {
        console.error('❌ Shopify integration error (continuing to AI):', shopifyError.message);
      }
      // END SHOPIFY INTEGRATION
      
      // Step 1: Start typing indicator and get product-specific articles
      const channelId = message.channel.id;
      await message.channel.sendTyping();
      
      // RETRIEVAL-FIRST: Try semantic retrieval over product docs
      let systemContent = null;
      try {
        const structured = await this.articleService.getStructuredArticlesByCategory(ticketState.product);
        // Lazy-embed and rank articles by similarity to the user message
        const queryVec = await embeddingService.embedText(message.content.toLowerCase());
        const topK = parseInt(process.env.TICKET_RETRIEVAL_TOP_K || '10', 10);
        const minScore = parseFloat(process.env.TICKET_RETRIEVAL_MIN_SCORE || '0.25');

        // Attach embeddings lazily
        const corpus = [];
        for (const item of structured) {
          if (!item.embedding && item.content) {
            item.embedding = await embeddingService.embedText(item.content);
          }
          if (item.embedding?.length) {
            corpus.push({ id: item.url, vector: item.embedding, payload: item });
          }
        }

        const ranked = embeddingService.constructor.topK(queryVec, corpus, topK);
        const filtered = ranked.filter(r => (r.score || 0) >= minScore).map(r => r.payload);
        const joined = filtered.map(a => a.content);

        // Compute an aggregate score for the current product (average of topK)
        const selectedAvg = ranked.length
          ? ranked.reduce((s, r) => s + (r.score || 0), 0) / ranked.length
          : 0;

        // Always compute cross-product candidate and compare scores
        const cross = await this.crossProductRetrieval(message.content, ticketState.product);
        const minSwitch = parseFloat(process.env.TICKET_CROSS_PRODUCT_MIN_SCORE || '0.28');
        const delta = parseFloat(process.env.TICKET_CROSS_PRODUCT_DELTA || '0.05');

        const shouldSwitch = !!(cross && cross.score >= Math.max(minSwitch, selectedAvg + delta));

        if (shouldSwitch) {
          const productDisplayName = this.getProductDisplayName(cross.product);
          systemContent = buildSystemPrompt(cross.content, productDisplayName, { allowCrossProduct: true });
        } else if (joined.length > 0) {
          const contentForPrompt = joined.join('\n\n---\n\n');
          const productDisplayName = this.getProductDisplayName(ticketState.product);
          systemContent = buildSystemPrompt(contentForPrompt, productDisplayName, { allowCrossProduct: true });
        } else {
          const contentForPrompt = await this.articleService.getArticlesByCategory(ticketState.product);
          const productDisplayName = this.getProductDisplayName(ticketState.product);
          systemContent = buildSystemPrompt(contentForPrompt, productDisplayName, { allowCrossProduct: true });
        }
      } catch (retrievalError) {
        console.error('❌ Ticket retrieval error, falling back to heuristic:', retrievalError.message);
        // Try cross-product retrieval as a secondary path before falling back
        try {
          const cross = await this.crossProductRetrieval(message.content, ticketState.product);
          if (cross) {
            const productDisplayName = this.getProductDisplayName(cross.product);
            systemContent = buildSystemPrompt(cross.content, productDisplayName, { allowCrossProduct: true });
          } else {
            const articles = await this.articleService.getArticlesByCategory(ticketState.product);
            const productDisplayName = this.getProductDisplayName(ticketState.product);
            systemContent = buildSystemPrompt(articles, productDisplayName, { allowCrossProduct: true });
          }
        } catch (crossError) {
          const articles = await this.articleService.getArticlesByCategory(ticketState.product);
          const productDisplayName = this.getProductDisplayName(ticketState.product);
          systemContent = buildSystemPrompt(articles, productDisplayName, { allowCrossProduct: true });
        }
      }

      // Ticket-channel GOOGLE DOCS: merge any channel-specific docs (parent channel)
      try {
        const parentId = message.channel.parentId;
        if (parentId) {
          const docsContent = await googleDocsContentService.getChannelGoogleDocsContent(message.guild.id, parentId, message.content);
          if (docsContent) {
            systemContent = (systemContent && typeof systemContent === 'string')
              ? (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}\n\n` + systemContent)
              : (`CHANNEL-SPECIFIC DOCUMENTATION:\n${docsContent}`);
            console.log('📄 [Ticket] Added Google Docs content for parent', parentId, 'length=', docsContent.length);
          }
        }
      } catch (docErr) {
        console.warn('⚠️ Ticket Google Docs enrichment failed (continuing):', docErr.message);
      }

      await this.conversationService.initializeConversation(channelId, systemContent, false);
      this.conversationService.addUserMessage(channelId, message.content, false);
      
      // Step 2: Get conversation history (includes product-specific system message)
      const aiMessages = this.conversationService.getConversationHistory(channelId, false);
      
      // Step 3: Generate response (continue typing indicator)
      await message.channel.sendTyping();
      const aiResponse = await this.aiService.generateResponse(aiMessages, message.guild.id);

      // Step 4: Send response
      if (aiResponse && aiResponse.isValid) {
        await message.reply({ content: aiResponse.response, flags: ['SuppressEmbeds'] });
        
        // Add assistant response to conversation history
        this.conversationService.addAssistantMessage(channelId, aiResponse.response, false);
        
        // Log successful interaction
        if (this.loggingService) {
          await this.loggingService.logTicketInteraction(message, aiResponse.response, ticketState.product, false);
        }
      } else {
        await this.sendFallbackResponse(message, ticketState);
      }

    } catch (error) {
      console.error('❌ Error generating AI response:', error);
      await this.sendFallbackResponse(message, ticketState);
      
      // Log error
      if (this.loggingService) {
        await this.loggingService.logError(error, 'Ticket message handling failed');
      }
    }
  }

  /**
   * Cross-product retrieval: if current product returns no hits, try other products and
   * return the best-matching product's concatenated content for the prompt.
   */
  async crossProductRetrieval(query, currentProduct) {
    try {
      const { ALLOWED_PRODUCTS } = await import('../config/products.js');
      const products = ALLOWED_PRODUCTS.filter(p => p !== currentProduct);
      const queryVec = await embeddingService.embedText((query || '').toLowerCase());
      let best = null;
      // Heuristic signal boosts per product to resolve mixed-intent queries
      const productSignals = {
        earthrover_school: [
          /\btest\s?drive\b/i,
          /drive\.frodobots\.com/i,
          /\bcheckpoint\b/i,
          /bind( your)? keys?/i,
          /\bcones?\b/i,
          /\bscan\b/i,
          /school/i
        ],
        earthrover: [/rovers\.frodobots\.com/i, /personal bot/i, /earthrover\b(?! school)/i],
        robotsfun: [/robots\.fun/i, /ai agent/i, /agent\b/i],
        ufb: [/ufb\.gg/i, /fighting/i],
        sam: [/\bsam\b/i, /autonomous/i],
        et_fugi: [/et\s?fugi/i, /competition/i],
        telearms: [/telearms/i, /remote/i, /arm/i, /mission/i, /score/i, /history/i]
      };
      const computeSignalBoost = (productKey) => {
        try {
          const patterns = productSignals[productKey] || [];
          let hits = 0;
          for (const rgx of patterns) { if (rgx.test(query)) hits++; }
          // Stronger boost for explicit test drive signals on school
          const baseBoost = productKey === 'earthrover_school' ? 0.18 : 0.12;
          return Math.min(0.36, hits * baseBoost);
        } catch { return 0; }
      };
      for (const product of products) {
        try {
          const structured = await this.articleService.getStructuredArticlesByCategory(product);
          const corpus = [];
          for (const item of structured) {
            if (!item.embedding && item.content) {
              item.embedding = await embeddingService.embedText(item.content);
            }
            if (item.embedding?.length) corpus.push({ id: item.url, vector: item.embedding, payload: item });
          }
          if (corpus.length === 0) continue;
          const ranked = embeddingService.constructor.topK(queryVec, corpus, parseInt(process.env.TICKET_RETRIEVAL_TOP_K || '8', 10));
          const agg = ranked.reduce((sum, r) => sum + (r.score || 0), 0) / Math.max(1, ranked.length);
          const boost = computeSignalBoost(product);
          const aggregate = agg + boost;
          if (!best || aggregate > best.score) {
            const joined = ranked.slice(0, 6).map(r => r.payload.content).join('\n\n---\n\n');
            best = { product, score: aggregate, content: joined };
          }
        } catch {}
      }
      // Threshold guard to avoid random jumps
      const minSwitch = parseFloat(process.env.TICKET_CROSS_PRODUCT_MIN_SCORE || '0.28');
      if (best && best.score >= minSwitch) {
        console.log(`🌐 Cross-product retrieval selected ${best.product} (avgScore=${best.score.toFixed(3)})`);
        return best;
      }
      return null;
    } catch (e) {
      console.error('Cross-product retrieval failed:', e.message);
      return null;
    }
  }

  /**
   * Send fallback response when AI fails
   * @param {Object} message - Discord message object
   * @param {Object} ticketState - Current ticket state
   */
  async sendFallbackResponse(message, ticketState) {
          const fallbackResponse = getServerFallbackResponse(message.guild.id);
    await message.reply({ content: fallbackResponse, flags: ['SuppressEmbeds'] });

    // Log fallback response
    if (this.loggingService) {
      await this.loggingService.logTicketInteraction(message, fallbackResponse, ticketState?.product, false);
    }
  }

  /**
   * Get display name for category
   * @param {string} category - Category key
   * @returns {string} Display name
   */
  getCategoryDisplayName(category) {
    const categoryNames = {
      'category_hardware': 'Hardware Issue',
      'category_bug': 'Bug Report', 
      'category_billing': 'Billing & Account',
      'category_other': 'Other',
      'category_general': 'General Questions',
      'category_software': 'Setup & Access Issue',
      'category_orders': 'Order Status'
    };
    return categoryNames[category] || 'Support';
  }

  /**
   * Get display name for product
   * @param {string} product - Product key
   * @returns {string} Display name
   */
  getProductDisplayName(product) {
    const productNames = {
      'ufb': 'UFB',
      'earthrover': 'Earthrover',
      'earthrover_school': 'Earthrover School',
      'sam': 'SAM',
      'robotsfun': 'Robots.Fun',
      'et_fugi': 'ET Fugi',
      'telearms': 'TeleArms'
    };
    return productNames[product] || 'FrodoBots Product';
  }
}

export default TicketChannelService; 
