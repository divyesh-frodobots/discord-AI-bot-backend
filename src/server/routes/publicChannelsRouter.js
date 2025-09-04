import express from 'express';
import dynamicChannelService from '../../services/dynamic/DynamicPublicChannelService.js';
import { ALLOWED_PRODUCTS } from '../../config/products.js';

export default function createPublicChannelsRouter(authenticateUser) {
  const router = express.Router();

  // List public channels for a guild
  router.post('/list', authenticateUser, async (req, res) => {
    try {
      const { guildId } = req.body;
      if (!guildId) return res.status(400).json({ error: 'Guild ID is required' });
      const channels = await dynamicChannelService.getChannelDetails(guildId);
      res.json({ public: channels });
    } catch (error) {
      console.error('Error getting public channels:', error);
      res.status(500).json({ error: 'Failed to get channels' });
    }
  });

  // Add public channel
  router.post('/add', authenticateUser, async (req, res) => {
    try {
      const { guildId, channelId, channelName, products, googleDocLinks } = req.body;
      if (!guildId || !channelId) {
        return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
      }
      if (!/^\d{17,19}$/.test(channelId)) {
        return res.status(400).json({ error: 'Invalid channel ID format. Must be 17-19 digits.' });
      }

      const sanitizedProducts = Array.isArray(products) ? products.filter(p => ALLOWED_PRODUCTS.includes(p)) : [];
      if (sanitizedProducts.length === 0) {
        return res.status(400).json({ error: 'At least one valid product is required' });
      }

      let validGoogleDocLinks = [];
      if (Array.isArray(googleDocLinks)) {
        validGoogleDocLinks = googleDocLinks.filter(link =>
          typeof link === 'string' &&
          /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[a-zA-Z0-9-_]+/.test(link)
        );
      }

      const success = await dynamicChannelService.addPublicChannel(guildId, channelId, {
        name: channelName,
        addedBy: 'web-admin',
        products: sanitizedProducts,
        googleDocLinks: validGoogleDocLinks
      });
      if (!success) return res.status(500).json({ error: 'Failed to add channel' });

      const message = validGoogleDocLinks.length > 0
        ? `Channel added successfully with ${validGoogleDocLinks.length} Google Docs links!`
        : 'Channel added successfully! Bot will respond immediately.';
      return res.json({ success: true, message });
    } catch (error) {
      console.error('Error adding public channel:', error);
      res.status(500).json({ error: 'Failed to add channel' });
    }
  });

  // Remove public channel
  router.post('/remove', authenticateUser, async (req, res) => {
    try {
      const { guildId, channelId } = req.body;
      if (!guildId || !channelId) return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
      const success = await dynamicChannelService.removePublicChannel(guildId, channelId);
      if (!success) return res.status(404).json({ error: 'Channel not found or already removed' });
      return res.json({ success: true, message: 'Channel removed successfully!' });
    } catch (error) {
      console.error('Error removing public channel:', error);
      res.status(500).json({ error: 'Failed to remove channel' });
    }
  });

  // Edit public channel
  router.post('/edit', authenticateUser, async (req, res) => {
    try {
      const { guildId, channelId, channelName, products } = req.body;
      if (!guildId || !channelId) return res.status(400).json({ error: 'Guild ID and Channel ID are required' });
      const sanitizedProducts = Array.isArray(products) ? products.filter(p => ALLOWED_PRODUCTS.includes(p)) : [];
      if (sanitizedProducts.length === 0) return res.status(400).json({ error: 'At least one valid product is required' });

      const result = await dynamicChannelService.updatePublicChannel(guildId, channelId, {
        name: channelName,
        products: sanitizedProducts
      });
      if (!result.success) {
        if (result.reason === 'not_found') return res.status(404).json({ error: 'Channel not found' });
        return res.status(500).json({ error: 'Failed to update channel' });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error('Error editing public channel:', error);
      res.status(500).json({ error: 'Failed to edit channel' });
    }
  });

  return router;
}


