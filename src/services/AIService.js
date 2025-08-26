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
      // Let AI decide response length based on question complexity
      const intelligentSystemPrompt = `You are a helpful Discord bot for FrodoBots. You can engage in basic conversation and greetings, but for technical questions about FrodoBots products, you must STRICTLY ONLY use information from the provided conversation context. CRITICAL: DO NOT use any external knowledge, training data, or assumptions about FrodoBots, bots, or any other systems. For technical questions not covered in the provided content, say 'I don't have specific information about that. You can ask to talk to team for more detailed help.'

RESPONSE LENGTH GUIDELINES:
Analyze the user's question and determine if they need a BRIEF or COMPREHENSIVE response:

BRIEF RESPONSES (aim for 1-3 sentences):
- Simple factual questions (What is X?, How much does Y cost?)
- Yes/No questions  
- Single concept explanations
- Quick clarifications
- Basic feature inquiries

COMPREHENSIVE RESPONSES (detailed explanations):
- Multiple related questions in one message
- Complex technical processes or workflows
- Step-by-step instructions needed
- Comparison questions (X vs Y)
- Questions requiring context and examples
- Troubleshooting problems

CRITICAL URL FORMATTING:
- NEVER format URLs as markdown links [text](url)
- ALWAYS use plain URLs like: https://www.robots.fun/ 
- Discord will automatically make plain URLs clickable
- Do NOT add any brackets, parentheses, or markdown formatting around URLs
- Example: Use "Visit https://rovers.frodobots.com for more info" NOT "Visit [FrodoBots](https://rovers.frodobots.com) for more info"

FORMATTING (Discord-friendly):
- Start with a one-line answer when possible.
- Use bold for key terms and short section headers.
- Prefer bullet lists ("- ") over long paragraphs; max 6 bullets.
- For procedures, use numbered steps (1., 2., 3.).
- Group important links under a "Links:" bullet list with plain URLs (no markdown link syntax).
- Keep paragraphs short; avoid walls of text.

Always match your response length to the complexity and scope of what the user is asking. Don't over-explain simple questions, but provide thorough help for complex topics.`;

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
      'happy to help'
    ];

    friendlyPhrases.forEach(phrase => {
      if (lowerReply.includes(phrase)) {
        confidence += 0.1; // Boost for friendly language
      }
    });

    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }
}

export default AIService;
