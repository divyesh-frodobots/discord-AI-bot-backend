/**
 * Centralized service for handling Discord message operations
 */
class MessageService {
  /**
   * Send a message with consistent formatting
   * @param {Object} message - Discord message object
   * @param {string} content - Message content
   * @param {Object} options - Additional message options
   * @returns {Promise<Object>} Sent message
   */
  static async reply(message, content, options = {}) {
    const messageOptions = {
      content,
      flags: ['SuppressEmbeds'],
      ...options
    };

    try {
      return await message.reply(messageOptions);
    } catch (error) {
      console.error('❌ Error sending reply:', error);
      throw error;
    }
  }

  /**
   * Send a message to a specific channel
   * @param {Object} channel - Discord channel object
   * @param {string} content - Message content
   * @param {Object} options - Additional message options
   * @returns {Promise<Object>} Sent message
   */
  static async send(channel, content, options = {}) {
    const messageOptions = {
      content,
      flags: ['SuppressEmbeds'],
      ...options
    };

    try {
      return await channel.send(messageOptions);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      throw error;
    }
  }

  /**
   * Send an ephemeral interaction reply
   * @param {Object} interaction - Discord interaction object
   * @param {string} content - Message content
   * @param {Object} options - Additional message options
   * @returns {Promise<void>}
   */
  static async replyEphemeral(interaction, content, options = {}) {
    const messageOptions = {
      content,
      ephemeral: true,
      ...options
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(messageOptions);
      } else {
        await interaction.reply(messageOptions);
      }
    } catch (error) {
      console.error('❌ Error sending ephemeral reply:', error);
      throw error;
    }
  }

  /**
   * Handle interaction errors with consistent messaging
   * @param {Object} interaction - Discord interaction object
   * @param {Error} error - Error object
   * @param {string} customMessage - Custom error message
   * @returns {Promise<void>}
   */
  static async handleInteractionError(interaction, error, customMessage = 'There was an error while executing this command!') {
    console.error('❌ Interaction error:', error);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: customMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: customMessage, ephemeral: true });
      }
    } catch (followupError) {
      console.error('❌ Failed to send error response:', followupError);
    }
  }

  /**
   * Start typing indicator in a channel
   * @param {Object} channel - Discord channel object
   * @returns {NodeJS.Timer} Typing interval
   */
  static startTyping(channel) {
    channel.sendTyping();
    return setInterval(() => channel.sendTyping(), 5000);
  }

  /**
   * Stop typing indicator
   * @param {NodeJS.Timer} typingInterval - Typing interval to clear
   */
  static stopTyping(typingInterval) {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }

  /**
   * Create message context object for processing
   * @param {Object} message - Discord message object
   * @param {Object} targetChannel - Optional target channel
   * @returns {Object} Message context
   */
  static createContext(message, targetChannel = null) {
    return {
      message,
      userId: message.author.id,
      username: message.author.username,
      isInMainChannel: !message.channel.isThread(),
      targetChannel: targetChannel || message.channel,
      typingInterval: null,
    };
  }

  /**
   * Extract channel information from message
   * @param {Object} message - Discord message object
   * @returns {Object} Channel information
   */
  static getChannelInfo(message) {
    return {
      channelId: message.channel.id,
      channelName: message.channel.name,
      isThread: message.channel.isThread(),
      parentChannelId: message.channel.parentId,
      guildId: message.guild.id
    };
  }
}

export default MessageService;
