import express from 'express';
import { getConfiguredServerIds, getServerConfig } from '../../config/serverConfigs.js';

export default function createGuildsRouter(authenticateUser) {
  const router = express.Router();

  // List configured guilds
  router.post('/list', authenticateUser, async (req, res) => {
    try {
      const guilds = getConfiguredServerIds().map(guildId => {
        const config = getServerConfig(guildId);
        return {
          guildId,
          name: config?.name || 'Unknown Server'
        };
      });
      res.json(guilds);
    } catch (error) {
      console.error('Error getting guilds:', error);
      res.status(500).json({ error: 'Failed to get servers' });
    }
  });

  return router;
}


