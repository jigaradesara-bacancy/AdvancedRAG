import { ZodError } from 'zod';
import multer from 'multer';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues } });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: { code: err.code, message: err.message } });
  if (err.name === 'CastError') return res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid id' } });
  const status = err.status || 500;
  if (status >= 500) logger.error({ err }, 'request failed');
  res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: status >= 500 && !err.code ? 'Internal server error' : err.message, details: err.details } });
}
