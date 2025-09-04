import dynamicTicketChannelService from '../services/dynamic/DynamicTicketChannelService.js';

class TicketChannelUtil {
  static isTicketChannel(channel) {
    try {
      if (!channel.isThread || !channel.isThread()) return false;
      const guildId = channel.guild?.id;
      const parentId = channel.parentId;
      // Dynamic only
      return dynamicTicketChannelService.isTicketChannelCached(guildId, parentId);
    } catch {
      return false;
    }
  }
}

export default TicketChannelUtil;


