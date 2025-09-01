import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import PermissionService from '../services/PermissionService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('botstop')
    .setDescription('Stop the AI bot in this ticket (Support Team only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, ticketSelectionService) {
    try {
      // Step 1: Defer reply to prevent timeout - make it ephemeral so only support team sees it
      await interaction.deferReply({ ephemeral: true });
      
      // Step 2: Validate this is a ticket channel
      if (!this.isTicketChannel(interaction.channel)) {
        await interaction.editReply({
          content: '❌ This command can only be used in ticket channels.'
        });
        return;
      }

      // Step 3: Check user permissions
      if (!this.hasSupportPermission(interaction)) {
        await interaction.editReply({
          content: '❌ **Access Denied**\n\nOnly members of the support team can use this command.'
        });
        return;
      }

      // Step 4: Stop the bot
      const channelId = interaction.channel.id;
      const success = await this.stopBot(channelId, ticketSelectionService);
      
      if (success) {
        await interaction.editReply({
          content: '🛑 **Bot Deactivated**\n\nThe AI assistant has been stopped in this ticket. Human support team will now handle this ticket directly.'
        });
        console.log(`Bot stopped in ticket ${channelId} by ${interaction.user.tag}`);
      } else {
        await interaction.editReply({
          content: '❌ **Error**\n\nFailed to deactivate the bot. Please try again.'
        });
      }

    } catch (error) {
      console.error('Error in botstop command:', error);
      
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
        console.error('Error sending error reply in botstop:', replyError);
      }
    }
  },

  /**
   * Check if channel is a ticket channel
   */
  isTicketChannel(channel) {
    if (!channel.isThread || !channel.isThread()) {
      return false;
    }

    return PermissionService.isTicketChannel(channel);
  },

  /**
   * Check if user has support team permissions
   */
  hasSupportPermission(interaction) {
    return PermissionService.hasSupportPermission(interaction);
  },

  /**
   * Stop the bot in a ticket channel
   */
  async stopBot(channelId, ticketSelectionService) {
    try {
      // Get current ticket state
      const currentState = await ticketSelectionService.get(channelId);
      
      // Update state to stop bot
      const updatedState = {
        ...currentState,
        humanHelp: true
      };

      // Save updated state
      await ticketSelectionService.set(channelId, updatedState);
      
      console.log(`Bot state updated for ${channelId}:`, updatedState);
      return true;

    } catch (error) {
      console.error(`Error stopping bot for ${channelId}:`, error);
      return false;
    }
  }
}; 