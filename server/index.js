import express from 'express';
import { config } from './config.js';
import { whatsappService } from './whatsapp.js';
import { commandHandler } from './commandHandler.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verificationResult = whatsappService.verifyWebhook(mode, token, challenge);

  if (verificationResult) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('Received webhook:', JSON.stringify(req.body, null, 2));

    const messageData = whatsappService.extractMessageData(req.body);

    if (!messageData) {
      console.log('No valid message data found');
      return res.sendStatus(200);
    }

    const { from, message, messageId } = messageData;

    if (!whatsappService.isAuthorized(from)) {
      console.log(`Unauthorized number attempted access: ${from}`);
      await whatsappService.sendMessage(
        from,
        '❌ Unauthorized. This bot is for private use only.'
      );
      return res.sendStatus(200);
    }

    console.log(`Processing message from ${from}: ${message}`);

    const response = await commandHandler.handleMessage(from, message, messageId);

    await whatsappService.sendMessage(from, response);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.sendStatus(500);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Money Assistant'
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Money Assistant API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook_verification: 'GET /webhook',
      webhook_handler: 'POST /webhook',
      health_check: 'GET /health'
    }
  });
});

const PORT = config.server.port;

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Money Assistant server running on port ${PORT}`);
  console.log(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`\n⚙️  Environment: ${config.server.nodeEnv}`);
  console.log(`🔒 Authorized number: ${config.authorizedPhoneNumber}`);
  console.log('\n✅ Server ready to receive WhatsApp messages!\n');
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
