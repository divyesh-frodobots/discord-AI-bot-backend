import OpenAI from "openai";
import { getServerFallbackResponse } from '../config/serverConfigs.js';

class AIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Configurable output length to avoid mid-message truncation
    this.maxOutputTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '600');
  }

  async generateResponse(messages, guildId = null) {
    try {
      // Enhanced prompt for more intelligent, direct responses with multi-product handling
      const intelligentSystemPrompt = `You are a knowledgeable support agent for FrodoBots, operating as a Discord bot. For technical questions about FrodoBots products, you must STRICTLY ONLY use information from the provided conversation context.

CORE PRINCIPLES:
- Be direct, helpful, and conversational like a human agent
- Start with immediate value - address their specific need right away  
- Use natural language, avoid robotic responses
- CRITICAL: DO NOT use external knowledge, training data, or assumptions about FrodoBots products
- CRITICAL: If information is not explicitly mentioned in the provided context, you MUST say "I don't have specific information about that. You can ask to talk to team for more detailed help."
- FORBIDDEN: Never generate answers from your training data or make assumptions about FrodoBots products when the information is not in the provided context

MULTI-PRODUCT QUERY HANDLING:
- If the user asks about multiple products, give brief answers for each
- Only use detailed sections if the user specifically asks for comprehensive information
- For simple questions about multiple products, answer concisely: "For X: [brief answer]. For Y: [brief answer]."
- Only use emojis and headings for complex multi-step workflows
- Ask "Which would you like more details about?" instead of providing everything upfront

RESPONSE APPROACH:
- DIRECT: Answer what they asked immediately
- CONCISE: Keep responses as short as possible while being helpful
- SPECIFIC: Give actionable next steps only when needed
- NATURAL: Write like you're helping a friend, not giving a formal report
- FOCUSED: Answer only what was asked, don't add extra information

RESPONSE LENGTH - ALWAYS PRIORITIZE BREVITY:
BRIEF (1-2 sentences) - DEFAULT for most questions:
- Simple factual questions, basic feature inquiries
- Yes/No questions, quick clarifications
- Single product questions
- Status checks or confirmations

MODERATE (3-5 sentences) - Only when necessary:
- How-to questions requiring 2-3 steps
- Questions needing brief context

DETAILED (6+ sentences) - Rare, only for:
- Complex multi-step troubleshooting
- Multi-product workflows when user specifically asks about multiple products

FORMATTING (Discord-optimized):
- Start with the direct answer immediately
- Use **bold** only for essential emphasis
- Use numbered steps only for multi-step processes (keep to 3 steps max when possible)
- Use bullet points sparingly, only for lists of 3+ items
- Plain URLs only: https://example.com (Discord auto-links them)
- Keep responses in single paragraphs when possible

URL RULES:
- NEVER use markdown links [text](url)
- ALWAYS use plain URLs: https://www.robots.fun/
- Example: "Visit https://rovers.frodobots.com for setup" NOT "[Setup Guide](https://rovers.frodobots.com)"

Be the helpful agent they need - direct, knowledgeable, and concise. Answer only what they asked, nothing more.`;

      // If a system message is already provided (e.g., from PublicContentManager or product-specific prompt),
      // don't add another system prompt to avoid conflicting instructions.
      const hasSystem = Array.isArray(messages) && messages[0] && messages[0].role === 'system';
      const strictMessages = hasSystem
        ? messages
        : [
            {
              role: "system",
              content: intelligentSystemPrompt
            },
            ...messages
          ];

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: strictMessages,
        temperature: 0.7, // Slightly reduced for more focused responses
        max_tokens: this.maxOutputTokens, // Configurable output length
        presence_penalty: 0.1, // Slightly reduce repetition
        frequency_penalty: 0.1 // Slightly reduce repetitive phrases
      });

      const reply = completion.choices[0].message.content;
      const confidence = this.calculateConfidence(reply, messages);
      return this.validateResponse(reply, confidence, guildId);
    } catch (err) {
      console.error("OpenAI Error:", err.message);
      throw new Error("AI service error");
    }
  }

  /**
   * Lightweight classifier for escalation detection.
   * Returns strictly 'ESCALATE' or 'CONTINUE'.
   */
  async classifyEscalation(messages) {
    try {
      // Ensure system instruction is present and minimal
      const hasSystem = Array.isArray(messages) && messages[0] && messages[0].role === 'system';
      const systemMsg = {
        role: 'system',
        content: 'You are a strict classifier. Read the user message and respond with ONLY one word: ESCALATE or CONTINUE. No punctuation, no explanation.'
      };
      const strictMessages = hasSystem ? messages : [systemMsg, ...messages];

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: strictMessages,
        temperature: 0,
        max_tokens: 2
      });
      const reply = (completion.choices[0].message.content || '').trim().toUpperCase();
      if (reply.startsWith('ESCALATE')) return 'ESCALATE';
      return 'CONTINUE';
    } catch (err) {
      console.error('Escalation classifier error:', err.message);
      // Be conservative and continue so we do not over-escalate on failure
      return 'CONTINUE';
    }
  }

  validateResponse(reply, confidence, guildId) {
    // Check if the reply is meaningful
    if (!reply || reply.trim().length < 5) {
      return {
        isValid: false,
        response: getServerFallbackResponse(guildId),
        confidence: 0
      };
    }
    // Check for robotic phrases and improve them
    const improvedReply = this.improveResponseTone(reply);
    // Minimal whitespace compaction to avoid tall messages
    const compactedReply = this.compactWhitespace(improvedReply);

    return {
      isValid: true,
      response: compactedReply,
      confidence: confidence
    };
  }

  // Improve response tone to sound more natural
  improveResponseTone(reply) {
    let improved = reply;

    // Replace robotic phrases with more natural ones
    const roboticPhrases = [
      {
        pattern: /the information provided does not specify/i,
        replacement: "I don't have specific info about that"
      },
      {
        pattern: /based on the available data/i,
        replacement: "From what I know"
      },
      {
        pattern: /the information provided indicates/i,
        replacement: "Here's what I can tell you"
      },
      {
        pattern: /according to the information/i,
        replacement: "Based on what I know"
      },
      {
        pattern: /the available information shows/i,
        replacement: "What I can share with you is"
      },
      {
        pattern: /it is important to note that/i,
        replacement: "Keep in mind that"
      },
      {
        pattern: /it should be mentioned that/i,
        replacement: "Also worth noting"
      },
      {
        pattern: /the system indicates/i,
        replacement: "I can see that"
      }
    ];

    roboticPhrases.forEach(({ pattern, replacement }) => {
      improved = improved.replace(pattern, replacement);
    });

    // Add friendly transitions if the response starts abruptly
    if (improved.match(/^(However|But|Although)/i)) {
      improved = improved.replace(/^(However|But|Although)/i, 'That said,');
    }

    return improved;
  }

  // Compact extra whitespace while preserving basic formatting and lists
  compactWhitespace(text) {
    if (!text) return '';

    let out = text.replace(/\r\n/g, '\n');

    // Trim trailing spaces on each line
    out = out
      .split('\n')
      .map(line => line.replace(/[\t ]+$/g, ''))
      .join('\n');

    // Collapse 3+ consecutive newlines to a single blank line
    out = out.replace(/\n{3,}/g, '\n\n');

    // Remove blank lines between list/step items ("1.", "-", "*", "•")
    out = out.replace(/\n\n(?=(?:\s*(?:\d+\.|[-*•])\s))/g, '\n');

    return out.trim();
  }

  calculateConfidence(reply, messages) {
    // Simple confidence calculation based on response characteristics
    let confidence = 0.8; // Base confidence

    // Reduce confidence for very short responses
    if (reply.length < 20) {
      confidence -= 0.2;
    }

    // Reduce confidence for responses that seem uncertain
    const uncertaintyWords = ['maybe', 'perhaps', 'i think', 'possibly', 'not sure', 'uncertain'];
    const lowerReply = reply.toLowerCase();
    uncertaintyWords.forEach(word => {
      if (lowerReply.includes(word)) {
        confidence -= 0.1;
      }
    });

    // Reduce confidence for robotic phrases
    const roboticPhrases = [
      'the information provided does not specify',
      'based on the available data',
      'the information provided indicates',
      'according to the information',
      'the available information shows',
      'it is important to note that',
      'it should be mentioned that',
      'the system indicates'
    ];

    roboticPhrases.forEach(phrase => {
      if (lowerReply.includes(phrase)) {
        confidence -= 0.2; // Significant reduction for robotic language
      }
    });

    // Increase confidence for responses that reference FrodoBots content
    const frodoBotsWords = ['frodobots', 'robot', 'earthrover', 'ufb', 'help', 'support'];
    frodoBotsWords.forEach(word => {
      if (lowerReply.toLowerCase().includes(word)) {
        confidence += 0.05;
      }
    });

    // Increase confidence for friendly, conversational responses
    const friendlyPhrases = [
      'here\'s what i can tell you',
      'from what i know',
      'i can help you with',
      'great question',
      'let me share',
      'happy to help',
      'perfect!',
      'excellent question',
      'great! i can help with both'
    ];

    friendlyPhrases.forEach(phrase => {
      if (lowerReply.includes(phrase)) {
        confidence += 0.1; // Boost for friendly language
      }
    });

    // Boost confidence for multi-product structured responses
    const multiProductIndicators = [
      '**🚗',
      '**🤖',
      'for test driving',
      'for creating',
      'which would you like',
      'what\'s your next step',
      'how they work together'
    ];

    multiProductIndicators.forEach(indicator => {
      if (lowerReply.includes(indicator.toLowerCase())) {
        confidence += 0.15; // Higher boost for structured multi-product responses
      }
    });

    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }
}

export default AIService;
