import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({
    port: config.port,
    env: config.env,
    service: 'grampay-api',
  }, `🚀 GramPay Server running on port ${config.port}`);
});

// Graceful Shutdown
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal. Closing HTTP server...');
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });

  // Force exit after 10s if connections don't drain
  setTimeout(() => {
    logger.error('Forced shutdown timed out after 10s. Exiting.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error: error.stack || error.message }, 'Uncaught Exception');
  gracefulShutdown('uncaughtException');
});
