import express from 'express';
import dynamicTicketChannelService from '../../services/dynamic/DynamicTicketChannelService.js';

export default function createTicketChannelsRouter(authenticateUser) {
  const router = express.Router();

  // List ticket channels
  router.post('/list', authenticateUser, async (req, res) => {
    try {
      const { guildId } = req.body;
      if (!guildId) return res.status(400).json({ error: 'Guild ID is required' });
      const channels = await dynamicTicketChannelService.getChannelDetails(guildId);
      res.json({ ticket: channels });
    } catch (error) {
      console.error('Error getting ticket channels:', error);
      res.status(500).json({ error: 'Failed to get ticket channels' });
    }
  });

  // Add ticket channel
  router.post('/add', authenticateUser, async (req, res) => {
    try {
      const { guildId, channelId, channelName, googleDocLinks } = req.body;
      if (!guildId || !channelId) return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
      if (!/^\d{17,19}$/.test(channelId)) return res.status(400).json({ error: 'Invalid channel ID format. Must be 17-19 digits.' });

      let validGoogleDocLinks = [];
      if (Array.isArray(googleDocLinks)) {
        validGoogleDocLinks = googleDocLinks.filter(link =>
          typeof link === 'string' &&
          /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[a-zA-Z0-9-_]+/.test(link)
        );
      }

      const success = await dynamicTicketChannelService.addTicketChannel(guildId, channelId, {
        name: channelName,
        addedBy: 'web-admin',
        googleDocLinks: validGoogleDocLinks
      });
      if (!success) return res.status(500).json({ error: 'Failed to add ticket channel' });
      return res.json({ success: true, message: 'Ticket channel added successfully!' });
    } catch (error) {
      console.error('Error adding ticket channel:', error);
      res.status(500).json({ error: 'Failed to add ticket channel' });
    }
  });

  // Remove ticket channel
  router.post('/remove', authenticateUser, async (req, res) => {
    try {
      const { guildId, channelId } = req.body;
      if (!guildId || !channelId) return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
      const success = await dynamicTicketChannelService.removeTicketChannel(guildId, channelId);
      if (!success) return res.status(404).json({ error: 'Ticket channel not found or already removed' });
      return res.json({ success: true, message: 'Ticket channel removed successfully!' });
    } catch (error) {
      console.error('Error removing ticket channel:', error);
      res.status(500).json({ error: 'Failed to remove ticket channel' });
    }
  });

  return router;
}


