module.exports = {
  name: "FrodoBots",
  shortName: "FB",
  description: "General FrodoBots support and information",
  
  // Main prompt for general FrodoBots support
  basePrompt: `You are a helpful assistant for FrodoBots, operating as a Discord bot within the FrodoBots Discord server. FrodoBots is a comprehensive platform offering multiple services.

DISCORD CONTEXT:
- You are running as a Discord bot, already within the FrodoBots Discord server
- Users are interacting with you directly through Discord messages
- If users need detailed support, they can ask to "talk to team" or create a support ticket right here in Discord

AVAILABLE PRODUCTS:
1. Ultimate Fighting Bots (UFB) - Robot fighting and combat at ufb.gg
2. Earthrover - Drive to earn personal bot platform
3. Earthrover School - Learning and education platform
4. SAM (Small Autonomous Mofo) - Small autonomous robot platform
5. Robots Fun - Fun robot activities and entertainment

RESPONSE GUIDELINES:
1. Help users understand which FrodoBots service best fits their needs
2. Provide general information about the FrodoBots ecosystem
3. Guide users to the appropriate product-specific support
4. Answer questions about the overall FrodoBots platform
5. For specific product questions, suggest the relevant service
6. Use friendly and informative language about all FrodoBots services
7. Reference the different platforms and their unique features
8. Encourage exploration of different FrodoBots products
9. When users need additional support, remind them they can ask to "talk to team" right here in Discord
10. DO NOT mention website chat widgets or external contact methods - you're already in Discord with them

TONE: Friendly, informative, and helpful while being professional and welcoming
VOICE: Knowledgeable about all FrodoBots services, helpful in guiding users to the right product`,

  // Keywords for general FrodoBots detection
  keywords: [
    'frodobots', 'frodo', 'bot', 'platform', 'services', 'help', 'support',
    'ufb', 'earthrover', 'school', 'sam', 'robotsfun', 'fighting', 'driving', 'learning',
    'autonomous', 'mofo', 'fun', 'entertainment', 'activities',
    'what is', 'how does', 'tell me about', 'explain', 'overview',
    'services offered', 'platform features', 'what can i do', 'help me choose'
  ],

  // Common general questions and responses
  commonQuestions: {
    "What services does FrodoBots offer?": {
      response: "FrodoBots offers five main services: 1) Ultimate Fighting Bots (UFB) - where you can participate in exciting robot fighting battles at ufb.gg, 2) Earthrover - a drive-to-earn platform where you can earn Frodobots Points (FBP) by driving personal bots, 3) Earthrover School - an educational platform for learning about driving and bot management, 4) SAM (Small Autonomous Mofo) - a platform for small autonomous robots, and 5) Robots Fun - entertainment and fun robot activities. Each service has unique features and benefits!",
      keywords: ["services", "offer", "what", "available", "platforms"]
    },
    "Which service should I try first?": {
      response: "It depends on what interests you! If you love competitive gaming and robot combat, try Ultimate Fighting Bots (UFB). If you want to earn rewards while driving, check out Earthrover. If you're new and want to learn, start with Earthrover School for educational content. If you're interested in autonomous robots, try SAM (Small Autonomous Mofo). If you want fun and entertainment, check out Robots Fun. All services are designed to be user-friendly and engaging!",
      keywords: ["which", "first", "try", "start", "begin"]
    },
    "How do I get started with FrodoBots?": {
      response: "Getting started with FrodoBots is easy! You can begin with any of our five services. For UFB, visit ufb.gg to book your first robot fighting session. For Earthrover, you'll need a personal bot to start earning FBP. For Earthrover School, you can immediately access educational content and missions. For SAM, you can explore autonomous robot features. For Robots Fun, you can start with fun robot activities. Each platform has its own onboarding process!",
      keywords: ["get started", "begin", "start", "how to", "first time"]
    }
  },

  // General FrodoBots features and terminology
  features: {
    platforms: ["FrodoBots Ecosystem", "Multiple Service Integration"],
    serviceTypes: ["Gaming (UFB)", "Earning (Earthrover)", "Education (School)"],
    commonFeatures: ["User Accounts", "Cross-Platform Integration", "Community Features"],
    currencies: ["Frodobots Points (FBP)", "Various Platform Currencies"],
    progression: ["Multi-Platform Progression", "Service Integration", "Unified Experience"]
  },

  // Error responses for general support
  errorResponses: {
    serviceUnavailable: "That service might not be available right now. Check our main platforms for current availability and updates!",
    notSupported: "That feature isn't available across FrodoBots services yet. Check individual platforms for the latest updates!",
    redirectToSpecific: "For specific questions about that service, I'd recommend checking the dedicated support for that platform. Each FrodoBots service has specialized assistance available!"
  },

  // Product comparison information
  productComparison: {
    ufb: {
      focus: "Robot Fighting & Combat",
      platform: "ufb.gg",
      keyFeature: "Real-time robot battles",
      bestFor: "Competitive gamers and robot enthusiasts"
    },
    earthrover: {
      focus: "Drive to Earn",
      platform: "Earthrover Platform",
      keyFeature: "Earn FBP by driving",
      bestFor: "Users looking to earn rewards"
    },
    earthrover_school: {
      focus: "Learning & Education",
      platform: "Earthrover School",
      keyFeature: "Educational missions and courses",
      bestFor: "Users wanting to learn and develop skills"
    },
    sam: {
      focus: "Small Autonomous Robots",
      platform: "SAM Platform",
      keyFeature: "Autonomous operations",
      bestFor: "Users interested in autonomous robotics"
    },
    robotsfun: {
      focus: "Fun & Entertainment",
      platform: "Robots Fun Platform",
      keyFeature: "Entertainment activities",
      bestFor: "Users looking for fun robot activities"
    }
  }
}; 