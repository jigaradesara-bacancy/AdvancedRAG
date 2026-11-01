import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: process.env.VITEST ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
});
