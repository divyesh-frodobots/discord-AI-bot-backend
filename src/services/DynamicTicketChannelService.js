import redis from './redisClient.js';
import EventEmitter from 'events';

/**
 * Dynamic Ticket Channel Service
 * Manages ticket parent channels stored in Redis (with Google Docs support)
 */
class DynamicTicketChannelService extends EventEmitter {
  constructor() {
    super();
    this.REDIS_KEY_PREFIX = 'ticket_channels:';
    this.cache = new Map(); // guildId -> Set(channelIds)
    this._interval = null;
  }

  _getRedisKey(guildId) {
    return `${this.REDIS_KEY_PREFIX}${guildId}`;
  }

  async addTicketChannel(guildId, channelId, info = {}) {
    try {
      const key = this._getRedisKey(guildId);
      const payload = {
        channelId,
        addedAt: new Date().toISOString(),
        addedBy: info.addedBy || 'admin',
        name: info.name || '',
        active: true,
        googleDocLinks: Array.isArray(info.googleDocLinks) ? info.googleDocLinks : []
      };
      await redis.hSet(key, channelId, JSON.stringify(payload));
      this.emit('channel:add', { guildId, channelId });
      return true;
    } catch (error) {
      console.error(`❌ Error adding ticket channel ${channelId} for guild ${guildId}:`, error);
      return false;
    }
  }

  async removeTicketChannel(guildId, channelId) {
    try {
      const key = this._getRedisKey(guildId);
      const result = await redis.hDel(key, channelId);
      if (result > 0) this.emit('channel:remove', { guildId, channelId });
      return result > 0;
    } catch (error) {
      console.error(`❌ Error removing ticket channel ${channelId} for guild ${guildId}:`, error);
      return false;
    }
  }

  async updateTicketChannel(guildId, channelId, updates = {}) {
    try {
      const key = this._getRedisKey(guildId);
      const dataStr = await redis.hGet(key, channelId);
      if (!dataStr) return { success: false, reason: 'not_found' };
      const current = JSON.parse(dataStr);
      const merged = { ...current, ...updates };
      await redis.hSet(key, channelId, JSON.stringify(merged));
      return { success: true };
    } catch (error) {
      console.error(`❌ Error updating ticket channel ${channelId}:`, error);
      return { success: false };
    }
  }

  async getTicketChannels(guildId) {
    try {
      const key = this._getRedisKey(guildId);
      const channels = await redis.hGetAll(key);
      const ids = [];
      for (const [channelId, dataStr] of Object.entries(channels)) {
        try {
          const data = JSON.parse(dataStr);
          if (data.active !== false) ids.push(channelId);
        } catch {}
      }
      return ids;
    } catch (error) {
      console.error(`❌ Error getting ticket channels for guild ${guildId}:`, error);
      return [];
    }
  }

  async getChannelDetails(guildId) {
    try {
      const key = this._getRedisKey(guildId);
      const channels = await redis.hGetAll(key);
      const details = [];
      for (const [channelId, dataStr] of Object.entries(channels)) {
        try {
          const data = JSON.parse(dataStr);
          details.push({ channelId, ...data });
        } catch {}
      }
      return details.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    } catch (error) {
      console.error(`❌ Error getting ticket channel details for guild ${guildId}:`, error);
      return [];
    }
  }

  async getChannelGoogleDocLinks(guildId, channelId) {
    try {
      const key = this._getRedisKey(guildId);
      const str = await redis.hGet(key, channelId);
      if (!str) return [];
      const data = JSON.parse(str);
      return Array.isArray(data.googleDocLinks) ? data.googleDocLinks : [];
    } catch (error) {
      console.error(`❌ Error getting Google Docs for ticket channel ${channelId}:`, error);
      return [];
    }
  }

  // Cache utilities for sync checks
  async refreshCache() {
    try {
      let cursor = '0';
      do {
        const res = await redis.scan(cursor, { MATCH: `${this.REDIS_KEY_PREFIX}*`, COUNT: 100 });
        cursor = res.cursor;
        for (const key of res.keys) {
          const guildId = key.replace(this.REDIS_KEY_PREFIX, '');
          const ids = await this.getTicketChannels(guildId);
          this.cache.set(guildId, new Set(ids));
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error('❌ Error refreshing ticket channel cache:', error);
    }
  }

  startCacheRefresher(intervalMs = 10000) {
    if (this._interval) return;
    this.refreshCache();
    this._interval = setInterval(() => this.refreshCache(), intervalMs);
    console.log(`🗂️ DynamicTicketChannelService cache refresher started (every ${intervalMs}ms)`);
  }

  stopCacheRefresher() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  getCachedTicketChannels(guildId) {
    const set = this.cache.get(guildId);
    return set ? Array.from(set) : [];
  }

  isTicketChannelCached(guildId, channelId) {
    const set = this.cache.get(guildId);
    return set ? set.has(channelId) : false;
  }
}

export default new DynamicTicketChannelService();


