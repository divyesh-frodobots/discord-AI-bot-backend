import OpenAI from "openai";
import constants from "../config/constants.js";

class AIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generateResponse(messages) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: messages,
        temperature: 0.8, // Increased for more natural responses
        max_tokens: 500, // Reduced from 1000 to leave more room for system prompt
        presence_penalty: 0.1, // Slightly reduce repetition
        frequency_penalty: 0.1 // Slightly reduce repetitive phrases
      });

      const reply = completion.choices[0].message.content;
      const confidence = this.calculateConfidence(reply, messages);
      return this.validateResponse(reply, confidence);
    } catch (err) {
      console.error("OpenAI Error:", err.message);
      throw new Error("AI service error");
    }
  }

  validateResponse(reply, confidence) {
    // Check if the reply is meaningful
    if (!reply || reply.trim().length < 5) {
      return {
        isValid: false,
        response: constants.MESSAGES.getFallbackResponse(constants.ROLES.SUPPORT_TEAM),
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