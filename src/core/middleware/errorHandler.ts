import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../errors/codes.js';
import { sendError } from '../responses/index.js';
import { logger } from '../logger/index.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const correlationId = req.correlationId || 'unknown';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, correlationId, path: req.path }, 'Application internal error');
    } else {
      logger.warn({ err, correlationId, path: req.path }, 'Application operational error');
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Unhandled error
  logger.error({ err, correlationId, path: req.path }, 'Unhandled exception');
  sendError(
    res,
    500,
    ERROR_CODES.INTERNAL_SERVER_ERROR,
    process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred'
      : (err as Error).message || 'An internal server error occurred',
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(
    res,
    404,
    ERROR_CODES.RESOURCE_NOT_FOUND,
    `Route ${req.method} ${req.originalUrl} not found`,
  );
}
