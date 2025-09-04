import "dotenv/config";
import express from 'express';
import { handleOrdersCreate } from './webhooks/ShopifyWebhookHandler.js';
import createAuthenticateUser from './server/middleware/authenticateUser.js';
import createAuthRouter from './server/routes/authRouter.js';
import createGuildsRouter from './server/routes/guildsRouter.js';
import createPublicChannelsRouter from './server/routes/publicChannelsRouter.js';
import createTicketChannelsRouter from './server/routes/ticketChannelsRouter.js';
import createAggregateRouter from './server/routes/aggregateRouter.js';
import renderChannelManagerPage from './server/views/channelManagerPage.js';

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// Middleware
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Webhook route
app.post('/webhooks/shopify/orders-create', handleOrdersCreate);

// Auth
const authenticateUser = createAuthenticateUser({});

// View
app.get('/', (req, res) => {
  res.send(renderChannelManagerPage());
});

// API routers
app.use('/api', createAuthRouter(authenticateUser));
app.use('/api/guilds', createGuildsRouter(authenticateUser));
app.use('/api/public-channels', createPublicChannelsRouter(authenticateUser));
app.use('/api/ticket-channels', createTicketChannelsRouter(authenticateUser));
app.use('/api/aggregate', createAggregateRouter(authenticateUser));

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Channel Manager Server running on http://localhost:${PORT}`);
  console.log('📊 Ready to manage dynamic public and ticket channels!');
});


