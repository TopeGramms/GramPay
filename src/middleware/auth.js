import crypto from 'crypto';
import { config } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';

export function requireAdminAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || !config.adminApiKey) {
    return next(new UnauthorizedError('Invalid or missing API key. Pass X-API-Key header.'));
  }

  const userBuf = Buffer.from(String(apiKey), 'utf8');
  const validBuf = Buffer.from(String(config.adminApiKey), 'utf8');

  if (userBuf.length !== validBuf.length || !crypto.timingSafeEqual(userBuf, validBuf)) {
    return next(new UnauthorizedError('Invalid or missing API key. Pass X-API-Key header.'));
  }

  next();
}
