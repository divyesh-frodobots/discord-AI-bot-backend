import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import constants from '../config/constants.js';
import { getSupportTeamId } from '../config/serverConfigs.js';

export default {
  data: new SlashCommandBuilder()
    .setName('botresume')
    .setDescription('Resume the AI bot in this ticket (Support Team only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, ticketSelectionService) {
    // Check if user has the support team role
    const supportRoleId = getSupportTeamId(interaction.guild.id);
    const hasSupportRole = interaction.member.roles.cache.has(supportRoleId);
    
    if (!hasSupportRole) {
      await interaction.reply({
        content: '❌ **Access Denied**\n\nOnly members of the support team can use this command.',
        ephemeral: true
      });
      return;
    }

    // Check if this is a ticket channel
    if (interaction.channel.type !== 0) { // 0 = GuildText
      await interaction.reply({
        content: '❌ This command can only be used in ticket channels.',
        ephemeral: true
      });
      return;
    }

    const channelId = interaction.channel.id;
    const currentSelection = await ticketSelectionService.get(channelId);

    // Reset humanHelp to false to resume the bot
    const updatedSelection = {
      ...currentSelection,
      humanHelp: false
    };

    await ticketSelectionService.set(channelId, updatedSelection);

    await interaction.reply({
      content: '✅ **Bot Reactivated**\n\nThe AI assistant is now active again in this ticket. You may continue interacting with the bot for support.',
      ephemeral: false
    });

    console.log(`Bot resumed in ticket ${channelId} by ${interaction.user.tag}`);
  }
}; 