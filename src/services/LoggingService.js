import botRules from '../config/botRules.js';

class LoggingService {
  constructor(client) {
    this.client = client;
    this.logChannels = {
      ticket: null,
      admin: null,
      public: null
    };
    this.initializeLogChannels();
  }

  // Initialize log channels
  async initializeLogChannels() {
    try {
      // Get all guilds the bot is in
      const guilds = this.client.guilds.cache;
      
      for (const [guildId, guild] of guilds) {
        // Find ticket logs channel
        const ticketLogsChannel = guild.channels.cache.find(channel => 
          channel.name === botRules.LOGGING.TICKET_LOGS_CHANNEL && 
          channel.type === 0 // GuildText
        );
        
        if (ticketLogsChannel) {
          this.logChannels.ticket = ticketLogsChannel;
          console.log(`✅ Found ticket logs channel: ${ticketLogsChannel.name} (${ticketLogsChannel.id})`);
        }

        // Find admin logs channel
        const adminLogsChannel = guild.channels.cache.find(channel => 
          channel.name === botRules.LOGGING.ADMIN_LOGS_CHANNEL && 
          channel.type === 0 // GuildText
        );
        
        if (adminLogsChannel) {
          this.logChannels.admin = adminLogsChannel;
          console.log(`✅ Found admin logs channel: ${adminLogsChannel.name} (${adminLogsChannel.id})`);
        }

        // Find public logs channel
        const publicLogsChannel = guild.channels.cache.find(channel => 
          channel.name === botRules.LOGGING.PUBLIC_LOGS_CHANNEL && 
          channel.type === 0 // GuildText
        );
        
        if (publicLogsChannel) {
          this.logChannels.public = publicLogsChannel;
          console.log(`✅ Found public logs channel: ${publicLogsChannel.name} (${publicLogsChannel.id})`);
        }
      }
    } catch (error) {
      console.error('Error initializing log channels:', error);
    }
  }

  // Format timestamp
  formatTimestamp() {
    return new Date().toISOString();
  }

  // Anonymize user ID if privacy is enabled
  anonymizeUserId(userId) {
    if (botRules.LOGGING.PRIVACY.ANONYMIZE_USER_IDS) {
      // Simple hash function for user ID
      let hash = 0;
      for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `user_${Math.abs(hash).toString(16)}`;
    }
    return userId;
  }

  // Sanitize content for logging
  sanitizeContent(content) {
    if (!content) return '[No content]';
    
    // Truncate if too long
    const maxLength = 1000;
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + '... [truncated]';
    }
    
    return content;
  }

  // Log ticket interaction
  async logTicketInteraction(message, botResponse, product = null, escalation = false) {
    if (!botRules.LOGGING.LOG_LEVELS.QUERIES || !this.logChannels.ticket) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();
      const userId = this.anonymizeUserId(message.author.id);
      const username = message.author.tag;
      const channelId = message.channel.id;
      const channelName = message.channel.name;
      const userQuestion = this.sanitizeContent(message.content);
      const botAnswer = this.sanitizeContent(botResponse);

      const logEmbed = {
        color: escalation ? 0xFF6B6B : 0x4ECDC4, // Red for escalation, Green for normal
        title: `🎫 Ticket Interaction ${escalation ? '(Escalated)' : ''}`,
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '👤 User',
            value: `${username} (${userId})`,
            inline: true
          },
          {
            name: '📝 Channel',
            value: `${channelName} (${channelId})`,
            inline: true
          },
          {
            name: '🎯 Product',
            value: product || 'Not selected',
            inline: true
          },
          {
            name: '❓ Question',
            value: userQuestion,
            inline: false
          },
          {
            name: '🤖 Bot Response',
            value: botAnswer,
            inline: false
          }
        ],
        footer: {
          text: `Ticket ID: ${channelId}`
        },
        timestamp: new Date()
      };

      await this.logChannels.ticket.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged ticket interaction: ${username} in ${channelName}`);
    } catch (error) {
      console.error('Error logging ticket interaction:', error);
    }
  }

  // Log ticket creation
  async logTicketCreation(channel) {
    if (!botRules.LOGGING.LOG_LEVELS.TICKET_EVENTS || !this.logChannels.admin) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();
      const channelId = channel.id;
      const channelName = channel.name;

      const logEmbed = {
        color: 0x4CAF50, // Green
        title: '🎫 New Ticket Created',
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '📝 Channel',
            value: `${channelName} (${channelId})`,
            inline: true
          }
        ],
        footer: {
          text: `Ticket ID: ${channelId}`
        },
        timestamp: new Date()
      };

      await this.logChannels.admin.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged ticket creation: ${channelName} (${channelId})`);
    } catch (error) {
      console.error('Error logging ticket creation:', error);
    }
  }

  // Log ticket closure
  async logTicketClosure(channel) {
    if (!botRules.LOGGING.LOG_LEVELS.TICKET_EVENTS || !this.logChannels.admin) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();
      const channelId = channel.id;
      const channelName = channel.name;

      const logEmbed = {
        color: 0xFF9800, // Orange
        title: '🔒 Ticket Closed',
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '📝 Channel',
            value: `${channelName} (${channelId})`,
            inline: true
          }
        ],
        footer: {
          text: `Ticket ID: ${channelId}`
        },
        timestamp: new Date()
      };

      await this.logChannels.admin.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged ticket closure: ${channelName} (${channelId})`);
    } catch (error) {
      console.error('Error logging ticket closure:', error);
    }
  }

  // Log escalation
  async logEscalation(message, reason = 'User requested human help') {
    if (!botRules.LOGGING.LOG_LEVELS.ESCALATIONS || !this.logChannels.admin) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();
      const userId = this.anonymizeUserId(message.author.id);
      const username = message.author.tag;
      const channelId = message.channel.id;
      const channelName = message.channel.name;

      const logEmbed = {
        color: 0xFF6B6B, // Red
        title: '🚨 Ticket Escalated',
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '👤 User',
            value: `${username} (${userId})`,
            inline: true
          },
          {
            name: '📝 Channel',
            value: `${channelName} (${channelId})`,
            inline: true
          },
          {
            name: '📋 Reason',
            value: reason,
            inline: false
          }
        ],
        footer: {
          text: `Ticket ID: ${channelId}`
        },
        timestamp: new Date()
      };

      await this.logChannels.admin.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged escalation: ${username} in ${channelName}`);
    } catch (error) {
      console.error('Error logging escalation:', error);
    }
  }

  // Log error
  async logError(error, context = 'Unknown') {
    if (!botRules.LOGGING.LOG_LEVELS.ERRORS || !this.logChannels.admin) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();

      const logEmbed = {
        color: 0xF44336, // Red
        title: '❌ Bot Error',
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '🔍 Context',
            value: context,
            inline: true
          },
          {
            name: '💥 Error',
            value: error.message || error.toString(),
            inline: false
          }
        ],
        timestamp: new Date()
      };

      await this.logChannels.admin.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged error: ${context}`);
    } catch (logError) {
      console.error('Error logging error:', logError);
    }
  }

  // Log rate limit hit
  async logRateLimit(userId, channelId, limitType) {
    if (!botRules.LOGGING.LOG_LEVELS.RATE_LIMITS || !this.logChannels.admin) {
      return;
    }

    try {
      const timestamp = this.formatTimestamp();
      const anonymizedUserId = this.anonymizeUserId(userId);

      const logEmbed = {
        color: 0xFF9800, // Orange
        title: '⏱️ Rate Limit Hit',
        fields: [
          {
            name: '📅 Timestamp',
            value: timestamp,
            inline: true
          },
          {
            name: '👤 User',
            value: anonymizedUserId,
            inline: true
          },
          {
            name: '📝 Channel',
            value: channelId,
            inline: true
          },
          {
            name: '🚫 Limit Type',
            value: limitType,
            inline: true
          }
        ],
        timestamp: new Date()
      };

      await this.logChannels.admin.send({ embeds: [logEmbed] });
      
      console.log(`📝 Logged rate limit: ${limitType} for user ${anonymizedUserId}`);
    } catch (error) {
      console.error('Error logging rate limit:', error);
    }
  }

  // Get log channel by type
  getLogChannel(type) {
    return this.logChannels[type];
  }

  // Check if logging is enabled for a specific type
  isLoggingEnabled(type) {
    return botRules.LOGGING.LOG_LEVELS[type.toUpperCase()] || false;
  }
}

export default LoggingService; 