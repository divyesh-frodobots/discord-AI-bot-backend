import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import dynamicTicketChannelService from '../services/dynamic/DynamicTicketChannelService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('testticket')
    .setDescription('Create a real test ticket to test the full ticket flow including AI')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, ticketSelectionService, ticketChannelManager) {
    try {
      // Defer reply to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      // Step 1: Get the ticket channel for this guild
      const guildId = interaction.guild.id;
      const dynamicTicketParents = dynamicTicketChannelService.getCachedTicketChannels(guildId);
      console.log(`🔄 Dynamic ticket parents for ${guildId}:`, dynamicTicketParents);
      const parentId = dynamicTicketParents[0] || null;
      
      if (!parentId) {
        await interaction.editReply({ 
          content: '❌ No ticket channel configured for this server. Please configure a ticket channel first.' 
        });
        return;
      }

      // Step 2: Get the ticket channel
      const ticketChannel = await interaction.guild.channels.fetch(parentId);
      if (!ticketChannel) {
        await interaction.editReply({ 
          content: '❌ Ticket channel not found.' 
        });
        return;
      }

      // Step 2.5: Ensure cache is refreshed for this channel
      await dynamicTicketChannelService.refreshCache();
      console.log(`🔄 Cache refreshed. Ticket channels for ${guildId}:`, dynamicTicketChannelService.getCachedTicketChannels(guildId));

      // Step 3: Create a test ticket thread (same as real tickets)
      const thread = await ticketChannel.threads.create({
        name: `TEST: ${interaction.user.displayName}`,
        type: ChannelType.PrivateThread,
        reason: 'Test ticket created via /testticket command'
      });

      // Step 4: Add the user to the thread
      await thread.members.add(interaction.user.id);

      // Step 5: Let the TicketChannelManager handle the rest (exactly like real tickets)
      // This will:
      // - Initialize ticket state in Redis
      // - Send welcome message with category buttons
      // - Warm up Google Docs cache
      // - Log ticket creation
      if (ticketChannelManager) {
        await ticketChannelManager.handleChannelCreation(thread);
      } else {
        // Fallback if manager not available
        await ticketSelectionService.set(thread.id, {
          category: null,
          product: null,
          humanHelp: false,
          questionsAnswered: false,
          welcomeSent: false
        });
      }

      // Step 6: Confirm to the user
      await interaction.editReply({
        content: `✅ **Test ticket created successfully!**\n\nTicket: ${thread}\n\nThis ticket works exactly like a real ticket:\n• Select a category\n• Choose a product (if needed)\n• Ask questions and test the AI responses\n• Test the full ticket flow including escalation`
      });

      console.log(`🎫 Test ticket created: ${thread.name} (${thread.id}) by ${interaction.user.tag}`);

    } catch (error) {
      console.error('Error in testticket command:', error);
      
      // Ensure we always respond to the interaction
      try {
        if (!interaction.replied) {
          if (interaction.deferred) {
            await interaction.editReply({
              content: '❌ An error occurred while creating the test ticket. Please try again.'
            });
          } else {
            await interaction.reply({
              content: '❌ An error occurred while creating the test ticket. Please try again.',
              ephemeral: true
            });
          }
        }
      } catch (replyError) {
        console.error('Error sending error reply in testticket:', replyError);
      }
    }
  }
};
