import { ERROR_CODES, ErrorCode } from '../errors/codes.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: ErrorCode = ERROR_CODES.INTERNAL_SERVER_ERROR,
    details?: unknown,
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, ERROR_CODES.VALIDATION_ERROR, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied', code: ErrorCode = ERROR_CODES.FORBIDDEN) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code: ErrorCode = ERROR_CODES.RESOURCE_NOT_FOUND) {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.CONFLICT) {
    super(message, 409, code);
  }
}

export class AccountLockedError extends AppError {
  constructor(message: string = 'Account locked due to consecutive failed login attempts') {
    super(message, 423, ERROR_CODES.ACCOUNT_LOCKED);
  }
}

export class RateLimitExceededError extends AppError {
  constructor(message: string = 'Rate limit exceeded (100 requests per 15-minute window)') {
    super(message, 429, ERROR_CODES.RATE_LIMIT_EXCEEDED);
  }
}
