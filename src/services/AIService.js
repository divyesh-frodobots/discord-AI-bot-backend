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
- If the user asks about multiple products in one message, address ALL of them comprehensively
- Structure responses with clear sections for each product/topic using **bold headings** and emojis
- For workflow questions (e.g., "test drive before create agent"), explain the complete process across both products
- Use format: "**🚗 For Test Driving (EarthRover School):** [detailed info] **🤖 For Creating AI Agents (Robots.Fun):** [detailed info]"
- For cross-product workflows, explain how they connect: "**🔄 How They Work Together:** [workflow explanation]"
- Always end multi-product responses with: "Which would you like me to focus on first?" or "What's your next step?"
- Be comprehensive like Intercom Fin AI - provide complete information for each product mentioned

RESPONSE APPROACH:
- DIRECT: Answer what they asked immediately
- SPECIFIC: Give actionable next steps and exact instructions  
- ENTHUSIASTIC: Be positive about solutions when they exist
- NATURAL: Write like you're helping a friend, not giving a formal report
- COMPREHENSIVE: For multi-part questions, address each part clearly

RESPONSE LENGTH by query type:
BRIEF (1-3 sentences):
- Simple factual questions, basic feature inquiries
- Yes/No questions, quick clarifications

COMPREHENSIVE (detailed help):
- How-to questions requiring steps
- Complex workflows or troubleshooting
- Multiple related questions
- Multi-product queries

FORMATTING (Discord-optimized):
- Lead with direct answer: "Great! I can help with both:" or "Perfect! Here's what you need:"
- Use **bold** for key actions, product names, and section headers
- Use emojis for product sections: 🚗 🤖 🎮 ⚔️ 🎯
- Numbered steps for processes (1., 2., 3.)
- Bullet points for options/lists ("- ")
- Plain URLs only: https://example.com (Discord auto-links them)
- Short paragraphs, avoid walls of text

URL RULES:
- NEVER use markdown links [text](url)
- ALWAYS use plain URLs: https://www.robots.fun/
- Example: "Visit https://rovers.frodobots.com for setup" NOT "[Setup Guide](https://rovers.frodobots.com)"

Be the helpful agent they need - direct, knowledgeable, and genuinely eager to solve ALL their problems in one response.`;

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
        max_tokens: 700, // Allow more headroom for structured answers
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

    return {
      isValid: true,
      response: improvedReply,
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
