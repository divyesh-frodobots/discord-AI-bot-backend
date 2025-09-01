import redis from './redisClient.js';

/**
 * Dynamic Public Channel Service
 * Manages public channels stored in Redis for real-time updates without restart
 */
class DynamicPublicChannelService {
  constructor() {
    this.REDIS_KEY_PREFIX = 'public_channels:';
  }

  /**
   * Get Redis key for a specific guild
   */
  _getRedisKey(guildId) {
    return `${this.REDIS_KEY_PREFIX}${guildId}`;
  }

  /**
   * Add a public channel for a guild
   */
  async addPublicChannel(guildId, channelId, channelInfo = {}) {
    try {
      const key = this._getRedisKey(guildId);
      const channelData = {
        channelId,
        addedAt: new Date().toISOString(),
        addedBy: channelInfo.addedBy || 'admin',
        name: channelInfo.name || '',
        active: true,
        products: Array.isArray(channelInfo.products) ? channelInfo.products : [],
        googleDocLinks: Array.isArray(channelInfo.googleDocLinks) ? channelInfo.googleDocLinks : []
      };

      console.log('[Redis] Saving public channel payload:', channelData);
      await redis.hSet(key, channelId, JSON.stringify(channelData));
      console.log(`✅ Added dynamic public channel ${channelId} for guild ${guildId}`);
      return true;
    } catch (error) {
      console.error(`❌ Error adding public channel ${channelId} for guild ${guildId}:`, error);
      return false;
    }
  }

  /**
   * Remove a public channel for a guild
   */
  async removePublicChannel(guildId, channelId) {
    try {
      const key = this._getRedisKey(guildId);
      const result = await redis.hDel(key, channelId);
      console.log(`✅ Removed dynamic public channel ${channelId} for guild ${guildId}`);
      return result > 0;
    } catch (error) {
      console.error(`❌ Error removing public channel ${channelId} for guild ${guildId}:`, error);
      return false;
    }
  }

  /**
   * Get all dynamic public channels for a guild
   */
  async getDynamicPublicChannels(guildId) {
    try {
      const key = this._getRedisKey(guildId);
      const channels = await redis.hGetAll(key);
      
      const activeChannels = [];
      for (const [channelId, channelDataStr] of Object.entries(channels)) {
        try {
          const channelData = JSON.parse(channelDataStr);
          if (channelData.active !== false) {
            activeChannels.push(channelId);
          }
        } catch (parseError) {
          console.error(`❌ Error parsing channel data for ${channelId}:`, parseError);
        }
      }

      return activeChannels;
    } catch (error) {
      console.error(`❌ Error getting dynamic public channels for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Get all public channels (DYNAMIC ONLY) - NO RESTART NEEDED!
   * This is the key function that makes channels work immediately
   */
  async getAllPublicChannels(guildId) {
    try {
      // Get dynamic channels from Redis only
      const dynamicChannels = await this.getDynamicPublicChannels(guildId);
      return dynamicChannels;
    } catch (error) {
      console.error(`❌ Error getting dynamic public channels for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Check if a channel is a public channel (dynamic only)
   */
  async isPublicChannel(guildId, channelId) {
    try {
      const dynamicChannels = await this.getAllPublicChannels(guildId);
      return dynamicChannels.includes(channelId);
    } catch (error) {
      console.error(`❌ Error checking if channel ${channelId} is public:`, error);
      return false;
    }
  }

  /**
   * Get detailed channel information for a guild
   */
  async getChannelDetails(guildId) {
    try {
      const key = this._getRedisKey(guildId);
      const channels = await redis.hGetAll(key);
      
      const channelDetails = [];
      for (const [channelId, channelDataStr] of Object.entries(channels)) {
        try {
          const channelData = JSON.parse(channelDataStr);
          channelDetails.push({
            channelId,
            ...channelData
          });
        } catch (parseError) {
          console.error(`❌ Error parsing channel data for ${channelId}:`, parseError);
        }
      }

      return channelDetails.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    } catch (error) {
      console.error(`❌ Error getting channel details for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Get Google Docs links for a specific channel
   */
  async getChannelGoogleDocLinks(guildId, channelId) {
    try {
      const key = this._getRedisKey(guildId);
      const channelDataStr = await redis.hGet(key, channelId);
      
      if (!channelDataStr) {
        return [];
      }
      
      const channelData = JSON.parse(channelDataStr);
      return Array.isArray(channelData.googleDocLinks) ? channelData.googleDocLinks : [];
    } catch (error) {
      console.error(`❌ Error getting Google Docs links for channel ${channelId}:`, error);
      return [];
    }
  }
}

export default new DynamicPublicChannelService(); 