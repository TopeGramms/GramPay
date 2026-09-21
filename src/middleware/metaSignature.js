import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

export function verifyMetaSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = config.meta.appSecret;

  if (!appSecret) {
    // If App Secret is not configured, warn and skip in dev mode
    if (config.env === 'production') {
      logger.error('META_APP_SECRET is not configured in production mode!');
      return res.status(401).json({ error: 'Webhook signature verification unconfigured' });
    }
    return next();
  }

  if (!signature) {
    logger.warn('Missing x-hub-signature-256 header on Meta webhook request');
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  const elements = signature.split('=');
  const signatureHash = elements[1];

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest('hex');

  if (signatureHash !== expectedHash) {
    logger.error({ received: signatureHash, expected: expectedHash }, 'Meta Webhook signature mismatch');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}
