import EventEmitter from 'events';
import redis from '../redisClient.js';

export default class BaseDynamicChannelService extends EventEmitter {
  constructor(prefix) {
    super();
    this.REDIS_KEY_PREFIX = prefix;
    this.cache = new Map(); // guildId -> Set(channelIds)
    this._interval = null;
  }

  _getRedisKey(guildId) {
    return `${this.REDIS_KEY_PREFIX}${guildId}`;
  }

  async _scanGuildIds() {
    const prefix = this.REDIS_KEY_PREFIX;
    let cursor = '0';
    const guildIds = new Set();
    do {
      const res = await redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
      cursor = res.cursor;
      for (const key of res.keys) guildIds.add(key.replace(prefix, ''));
    } while (cursor !== '0');
    return Array.from(guildIds);
  }

  async refreshCache(fetchIdsForGuild) {
    try {
      const guildIds = await this._scanGuildIds();
      for (const guildId of guildIds) {
        const ids = await fetchIdsForGuild.call(this, guildId);
        this.cache.set(guildId, new Set(ids));
      }
    } catch (error) {
      console.error('❌ Error refreshing dynamic cache:', error);
    }
  }

  startCacheRefresher(intervalMs, fetchIdsForGuild) {
    if (this._interval) return;
    this.refreshCache(fetchIdsForGuild);
    this._interval = setInterval(() => this.refreshCache(fetchIdsForGuild), intervalMs);
  }

  stopCacheRefresher() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}


