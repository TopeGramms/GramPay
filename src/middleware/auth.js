import { config } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';

export function requireAdminAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey || apiKey !== config.adminApiKey) {
    return next(new UnauthorizedError('Invalid or missing API key. Pass X-API-Key header.'));
  }

  next();
}
