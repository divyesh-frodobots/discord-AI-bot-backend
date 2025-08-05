import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('activation-botstop')
    .setDescription('Stop the AI bot in this activation thread (Support Team only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, activationBot) {
    try {
      // Step 1: Defer reply to prevent timeout - make it ephemeral so only support team sees it
      await interaction.deferReply({ ephemeral: true });
      
      // Step 2: Validate this is an activation thread
      if (!this.isActivationThread(interaction.channel, activationBot)) {
        await interaction.editReply({
          content: '❌ This command can only be used in EarthRovers activation threads.'
        });
        return;
      }

      // Step 3: Check user permissions
      if (!this.hasSupportPermission(interaction, activationBot)) {
        await interaction.editReply({
          content: '❌ **Access Denied**\n\nOnly members of the EarthRovers support team can use this command.'
        });
        return;
      }

      // Step 4: Stop the bot
      const threadId = interaction.channel.id;
      const success = this.stopBot(threadId, activationBot);
      
      if (success) {
        await interaction.editReply({
          content: '🛑 **EarthRovers AI Bot Deactivated**\n\nThe AI assistant has been stopped in this thread. Human support team will now handle this thread directly.'
        });
        console.log(`🛑 Activation bot stopped in thread ${threadId} by ${interaction.user.tag}`);
      } else {
        await interaction.editReply({
          content: '❌ **Error**\n\nFailed to deactivate the bot. Please try again.'
        });
      }

    } catch (error) {
      console.error('Error in activation-botstop command:', error);
      
      // Ensure we always respond to the interaction
      try {
        if (!interaction.replied) {
          if (interaction.deferred) {
            await interaction.editReply({
              content: '❌ An error occurred while processing the command.'
            });
          } else {
            await interaction.reply({
              content: '❌ An error occurred while processing the command.',
              ephemeral: true
            });
          }
        }
      } catch (replyError) {
        console.error('Error sending error reply in activation-botstop:', replyError);
      }
    }
  },

  /**
   * Check if channel is an activation thread
   */
  isActivationThread(channel, activationBot) {
    if (!channel.isThread || !channel.isThread()) {
      return false;
    }

    return activationBot.isEarthRoversActivationThread(channel);
  },

  /**
   * Check if user has support team permissions
   */
  hasSupportPermission(interaction, activationBot) {
    const config = activationBot.getConfig();
    const supportRoleId = config.supportRoleId;

    // Check if user has the support role
    const hasRole = interaction.member.roles.cache.has(supportRoleId);

    // Debug logging
    console.log(`User ${interaction.user.tag} roles:`, 
      interaction.member.roles.cache.map(r => `${r.name} (${r.id})`));
    console.log(`Required support role ID:`, supportRoleId);
    console.log(`Has support permission: ${hasRole}`);

    return hasRole;
  },

  /**
   * Stop the bot in an activation thread
   */
  stopBot(threadId, activationBot) {
    try {
      // Mark thread as escalated to stop AI responses
      activationBot.escalatedThreads.add(threadId);
      console.log(`🚫 Thread ${threadId} marked as escalated - AI responses disabled via command`);
      return true;

    } catch (error) {
      console.error(`Error stopping activation bot for ${threadId}:`, error);
      return false;
    }
  }
}; 