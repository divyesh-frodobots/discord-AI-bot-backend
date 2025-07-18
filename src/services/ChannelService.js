class ChannelService {
    constructor() {
      this.ENABLED_CHANNELS = [
        "1389503753379647508", // Channel where bot works in threads
      ];
    }
  
    isBotEnabled(channel) {
      // If no specific channels are configured, enable everywhere
      if (this.ENABLED_CHANNELS.length === 0) return true;
      
      // Allow both the main channel and its threads
      if (this.ENABLED_CHANNELS.includes(channel.id)) return true;
      
      // Allow threads of enabled channels
      if (channel.isThread() && this.ENABLED_CHANNELS.includes(channel.parentId)) return true;
      
      return false;
    }
  
    getConversationId(message) {
      return message.channel.isThread() ? message.channel.id : message.channel.id;
    }
  
    isThread(message) {
      return message.channel.isThread();
    }
  
    getChannelInfo(message) {
      return {
        channelId: message.channel.id,
        channelName: message.channel.name,
        isThread: this.isThread(message),
        parentChannelId: message.channel.parentId,
        isEnabled: this.isBotEnabled(message.channel)
      };
    }
  
    addEnabledChannel(channelId) {
      if (!this.ENABLED_CHANNELS.includes(channelId)) {
        this.ENABLED_CHANNELS.push(channelId);
        console.log(`Added channel ${channelId} to enabled channels`);
      }
    }
  
    removeEnabledChannel(channelId) {
      const index = this.ENABLED_CHANNELS.indexOf(channelId);
      if (index > -1) {
        this.ENABLED_CHANNELS.splice(index, 1);
        console.log(`Removed channel ${channelId} from enabled channels`);
      }
    }
  
    getEnabledChannels() {
      return [...this.ENABLED_CHANNELS];
    }
  
    setEnabledChannels(channels) {
      this.ENABLED_CHANNELS = [...channels];
      console.log(`Updated enabled channels: ${this.ENABLED_CHANNELS.join(', ')}`);
    }
    }

export default ChannelService; 