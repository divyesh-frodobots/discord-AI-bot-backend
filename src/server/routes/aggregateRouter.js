import express from 'express';
import dynamicChannelService from '../../services/dynamic/DynamicPublicChannelService.js';
import dynamicTicketChannelService from '../../services/dynamic/DynamicTicketChannelService.js';

export default function createAggregateRouter(authenticateUser) {
  const router = express.Router();

  // Get combined public + ticket channels for a guild
  router.post('/channels', authenticateUser, async (req, res) => {
    try {
      const { guildId } = req.body;
      if (!guildId) return res.status(400).json({ error: 'Guild ID is required' });
      const publicChannels = await dynamicChannelService.getChannelDetails(guildId);
      const ticketChannels = await dynamicTicketChannelService.getChannelDetails(guildId);
      res.json({ public: publicChannels, ticket: ticketChannels });
    } catch (error) {
      console.error('Error getting aggregate channels:', error);
      res.status(500).json({ error: 'Failed to get channels' });
    }
  });

  return router;
}


