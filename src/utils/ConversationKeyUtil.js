/**
 * Utility for generating conversation keys consistently across the application
 */
class ConversationKeyUtil {
  /**
   * Generate a conversation key for a message
   * @param {Object} message - Discord message object
   * @param {boolean} useUserBased - Whether to use user-based keys (default: true)
   * @returns {string} Conversation key
   */
  static generateKey(message, useUserBased = true) {
    const userId = message.author.id;
    const channel = message.channel;

    if (useUserBased) {
      if (channel.isThread && channel.isThread()) {
        const parentChannelId = channel.parentId || (channel.parent && channel.parent.id);
        const threadId = channel.id;
        return `user_${userId}:${parentChannelId}:${threadId}`;
      }
      // Include channel id to avoid cross-channel context mixing
      const channelId = channel.id;
      return `user_${userId}:${channelId}`;
    } else {
      // Channel-based conversation
      return channel.id;
    }
  }

  /**
   * Generate a thread-specific conversation key
   * @param {Object} message - Discord message object
   * @returns {string} Thread conversation key
   */
  static generateThreadKey(message) {
    const userId = message.author.id;
    const threadId = message.channel.id;
    const parentChannelId = message.channel.parentId || (message.channel.parent && message.channel.parent.id);

    return `user_${userId}:${parentChannelId}:${threadId}`;
  }

  /**
   * Generate a conversation key with custom channel context
   * @param {Object} message - Discord message object
   * @param {Object} targetChannel - Target channel object
   * @returns {string} Conversation key
   */
  static generateKeyWithTarget(message, targetChannel) {
    const userId = message.author.id;
    const target = targetChannel || message.channel;

    if (target.isThread && target.isThread()) {
      const parentChannelId = target.parentId || (target.parent && target.parent.id);
      const threadId = target.id;
      return `user_${userId}:${parentChannelId}:${threadId}`;
    }
    // Include channel id to avoid cross-channel context mixing
    const channelId = target.id;
    return `user_${userId}:${channelId}`;
  }
}

export default ConversationKeyUtil;
