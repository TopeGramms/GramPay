import { Router } from 'express';
import { config } from '../config/env.js';
import { commandHandler } from '../core/commandHandler.js';
import { logger } from '../lib/logger.js';
import { verifyMetaSignature } from '../middleware/metaSignature.js';

const router = Router();

/**
 * GET /webhook - Meta Cloud API Webhook Verification Challenge
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.meta.verifyToken) {
      logger.info('✅ Meta Webhook verification successful!');
      return res.status(200).send(challenge);
    } else {
      logger.warn({ mode, token }, '❌ Meta Webhook verification failed: Token mismatch');
      return res.sendStatus(403);
    }
  }

  res.status(200).send('Meta WhatsApp Cloud API Webhook Endpoint Active');
});

/**
 * POST /webhook - Meta Cloud API Incoming Webhook Events
 */
router.post('/webhook', verifyMetaSignature, async (req, res) => {
  // Always return 200 OK immediately to Meta to acknowledge receipt
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !messages[0]) {
      return;
    }

    const msg = messages[0];
    const from = msg.from; // User phone number
    const messageId = msg.id;

    let textContent = '';

    if (msg.type === 'text') {
      textContent = msg.text?.body;
    } else if (msg.type === 'interactive') {
      // Interactive button reply
      if (msg.interactive?.type === 'button_reply') {
        textContent = msg.interactive.button_reply?.title || msg.interactive.button_reply?.id;
      }
    } else if (msg.type === 'button') {
      textContent = msg.button?.text;
    }

    if (textContent) {
      // Asynchronously handle message without blocking Meta's webhook runner
      commandHandler.handleMessage({
        from,
        text: textContent,
        messageId,
      }).catch(err => {
        logger.error({ from, err: err.message }, 'Error in async command handler');
      });
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error parsing Meta webhook payload');
  }
});

export default router;
