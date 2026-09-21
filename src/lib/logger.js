import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'grampay-api',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
