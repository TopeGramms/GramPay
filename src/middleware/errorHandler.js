import { logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';

  if (err.isOperational) {
    logger.warn({ path: req.path, statusCode, code, message: err.message }, 'Operational error');
  } else {
    logger.error({ path: req.path, err: err.stack || err.message }, 'Unhandled server error');
  }

  res.status(statusCode).json({
    status: 'error',
    code,
    message: err.message || 'An unexpected error occurred',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}
