import { getServerConfig } from '../config/serverConfigs.js';

class TicketChannelUtil {
  static isTicketChannel(channel) {
    try {
      const serverConfig = getServerConfig(channel.guild?.id);
      return channel.isThread && channel.isThread() && serverConfig && channel.parentId === serverConfig.ticketChannelId;
    } catch {
      return false;
    }
  }
}

export default TicketChannelUtil;


