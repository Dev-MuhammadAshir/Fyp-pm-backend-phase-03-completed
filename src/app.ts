import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { APP_CONSTANTS } from './config/constants.js';
import { normalizeCorsOrigins, isOriginAllowed } from './config/cors-origins.js';
import { requestIdMiddleware } from './core/middleware/requestId.js';
import { errorHandler, notFoundHandler } from './core/middleware/errorHandler.js';
import { v1Router } from './routes/v1.js';
import { healthRouter } from './routes/health.js';

export function createApp(): Express {
  const app = express();

  // 1. Security Headers (NFR-SEC-07: HSTS, XFO, XCTO, CSP)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. CORS (NFR-SEC-05)
  const allowedOrigins = normalizeCorsOrigins(env.CORS_ORIGIN, {
    allowWildcard: env.NODE_ENV !== 'production',
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID'],
      exposedHeaders: ['X-Correlation-ID'],
    }),
  );

  // 3. Body Parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 4. Request Correlation Tracking (CA-12)
  app.use(requestIdMiddleware);

  // 5. Mount Root Information & Health Probe (/health)
  app.get('/', (_req, res) => {
    res.json({
      name: 'FYP Project Management Platform API',
      version: '1.0.0',
      status: 'active',
      endpoints: {
        health: '/health',
        apiV1: APP_CONSTANTS.API_PREFIX,
      },
    });
  });

  app.use('/health', healthRouter);

  // 6. Mount API v1 Routes (/api/v1)
  app.use(APP_CONSTANTS.API_PREFIX, v1Router);

  // 7. 404 & Global Error Handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
