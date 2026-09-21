import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import healthRoutes from './routes/health.js';
import webhookRoutes from './routes/webhook.js';
import flutterwaveWebhookRoutes from './routes/flutterwaveWebhook.js';
import recipientRoutes from './routes/recipients.js';
import transactionRoutes from './routes/transactions.js';
import configRoutes from './routes/config.js';

import { apiRateLimiter, webhookRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Security Headers
  app.use(helmet());

  // CORS Configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }));

  // JSON Body Parser with rawBody capture for Webhook HMAC validation
  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use(healthRoutes);

  // Webhooks with rate limiting
  app.use(webhookRateLimiter, webhookRoutes);
  app.use(webhookRateLimiter, flutterwaveWebhookRoutes);

  // REST API Endpoints with rate limiting
  app.use(apiRateLimiter, recipientRoutes);
  app.use(apiRateLimiter, transactionRoutes);
  app.use(apiRateLimiter, configRoutes);

  // 404 Route Handler
  app.use((req, res) => {
    res.status(404).json({
      status: 'error',
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
