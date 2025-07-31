import botRules from '../config/botRules.js';
import { getServerConfig } from '../config/serverConfigs.js';

class LoggingService {
  constructor(client) {
    this.client = client;
    this.logChannels = {
      // Now organized by guild ID
      // guildId: { ticket: channel, admin: channel, public: channel }
    };
    this.initializeLogChannels();
  }

  // Initialize log channels
  async initializeLogChannels() {
    try {
      // Get all guilds the bot is in
      const guilds = this.client.guilds.cache;
      
      for (const [guildId, guild] of guilds) {
        // Initialize guild-specific log channels
        this.logChannels[guildId] = {
          ticket: null,
          admin: null,
          public: null
        };

        // Get server-specific configuration
        const serverConfig = getServerConfig(guildId);
        
        if (serverConfig) {
          // Use server-specific channel IDs
          console.log(`🔧 [${guild.name}] Looking for ticket logs channel with ID:`, serverConfig.loggingChannels.ticketLogs);
          console.log(`🔧 [${guild.name}] Available channels:`, guild.channels.cache.map(c => `${c.name} (${c.id})`));
          
          const ticketLogsChannel = guild.channels.cache.get(serverConfig.loggingChannels.ticketLogs);
          
          if (ticketLogsChannel) {
            this.logChannels[guildId].ticket = ticketLogsChannel;
            console.log(`✅ [${guild.name}] Found ticket logs channel: ${ticketLogsChannel.name} (${ticketLogsChannel.id})`);
          } else {
            console.log(`❌ [${guild.name}] Could not find ticket logs channel with ID: ${serverConfig.loggingChannels.ticketLogs}`);
          }

          // Find admin logs channel by name
          const adminLogsChannel = guild.channels.cache.find(channel => 
            channel.name === serverConfig.loggingChannels.adminLogs && 
            channel.type === 0 // GuildText
          );
          
          if (adminLogsChannel) {
            this.logChannels[guildId].admin = adminLogsChannel;
            console.log(`✅ [${guild.name}] Found admin logs channel: ${adminLogsChannel.name} (${adminLogsChannel.id})`);
          }

          // Find public logs channel by name
          const publicLogsChannel = guild.channels.cache.find(channel => 
            channel.name === serverConfig.loggingChannels.publicLogs && 
            channel.type === 0 // GuildText
          );
          
          if (publicLogsChannel) {
            this.logChannels[guildId].public = publicLogsChannel;
            console.log(`✅ [${guild.name}] Found public logs channel: ${publicLogsChannel.name} (${publicLogsChannel.id})`);
          }
        } else {
          // Fallback to global configuration for unconfigured servers
          const ticketLogsChannel = guild.channels.cache.get(botRules.LOGGING.TICKET_LOGS_CHANNEL);
          
          if (ticketLogsChannel) {
            this.logChannels[guildId].ticket = ticketLogsChannel;
            console.log(`✅ [${guild.name}] Found ticket logs channel (fallback): ${ticketLogsChannel.name} (${ticketLogsChannel.id})`);
          }

          // Find admin logs channel
          const adminLogsChannel = guild.channels.cache.find(channel => 
            channel.name === botRules.LOGGING.ADMIN_LOGS_CHANNEL && 
            channel.type === 0 // GuildText
          );
          
          if (adminLogsChannel) {
            this.logChannels[guildId].admin = adminLogsChannel;
            console.log(`✅ [${guild.name}] Found admin logs channel (fallback): ${adminLogsChannel.name} (${adminLogsChannel.id})`);
          }

          // Find public logs channel
          const publicLogsChannel = guild.channels.cache.find(channel => 
            channel.name === botRules.LOGGING.PUBLIC_LOGS_CHANNEL && 
            channel.type === 0 // GuildText
          );
          
          if (publicLogsChannel) {
            this.logChannels[guildId].public = publicLogsChannel;
            console.log(`✅ [${guild.name}] Found public logs channel (fallback): ${publicLogsChannel.name} (${publicLogsChannel.id})`);
          }
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

  // Helper method to get log channel for specific guild and type
  getLogChannel(guildId, channelType) {
    console.log(`🔧 [getLogChannel] ENTRY - Looking for ${channelType} channel in guild:`, guildId);
    
    const guildChannels = this.logChannels[guildId];
    console.log(`🔧 [getLogChannel] guildChannels:`, guildChannels);
    
    if (!guildChannels) {
      console.log(`❌ [getLogChannel] No guild channels found for guild:`, guildId);
      return null;
    }
    
    const channel = guildChannels[channelType];
    console.log(`🔧 [getLogChannel] channelType:`, channelType, 'channel:', channel);
    console.log(`🔧 [getLogChannel] FINAL RETURN:`, channel);
    return channel;
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
    console.log(`📝 [logTicketInteraction] Starting for guild:`, message.guild?.id);
    
    console.log(`📝 [logTicketInteraction] About to call getLogChannel with guild:`, message.guild.id, 'type:', 'ticket');
    
    const ticketLogChannel = this.getLogChannel(message.guild.id, 'ticket');
    
    console.log(`📝 [logTicketInteraction] Got ticketLogChannel:`, ticketLogChannel);
    console.log(`📝 [logTicketInteraction] Channel type:`, typeof ticketLogChannel);
    console.log(`📝 [logTicketInteraction] Has send method:`, typeof ticketLogChannel?.send);
    
    if (!botRules.LOGGING.LOG_LEVELS.QUERIES || !ticketLogChannel) {
      console.log(`📝 [logTicketInteraction] Skipping log - QUERIES enabled:`, botRules.LOGGING.LOG_LEVELS.QUERIES, 'Channel exists:', !!ticketLogChannel);
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

      // Safety check before sending
      if (typeof ticketLogChannel?.send !== 'function') {
        console.error(`❌ [logTicketInteraction] ticketLogChannel.send is not a function. Channel:`, ticketLogChannel);
        console.error(`❌ [logTicketInteraction] Channel type:`, typeof ticketLogChannel);
        return;
      }

      await ticketLogChannel.send({ embeds: [logEmbed] });
      
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
    const adminLogChannel = this.getLogChannel(message.guild?.id, 'admin');
    if (!botRules.LOGGING.LOG_LEVELS.ESCALATIONS || !adminLogChannel) {
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

      await adminLogChannel.send({ embeds: [logEmbed] });
      
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

  // Check if logging is enabled for a specific type
  isLoggingEnabled(type) {
    return botRules.LOGGING.LOG_LEVELS[type.toUpperCase()] || false;
  }
}

export default LoggingService; 
