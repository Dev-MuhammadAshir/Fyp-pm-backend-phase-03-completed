import pino from 'pino';
import { env } from '../../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-access-token"]',
      'password',
      'passwordHash',
      'currentPassword',
      'newPassword',
      'refreshToken',
      'accessToken',
      'token',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
