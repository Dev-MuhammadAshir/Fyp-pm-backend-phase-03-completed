import { Prisma } from '@prisma/client';
import { AppError, ConflictError, NotFoundError } from './AppError.js';
import { ERROR_CODES } from '../errors/codes.js';

export function mapPrismaError(error: unknown): AppError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[])?.join(', ') || 'field';
        return new ConflictError(
          `Unique constraint violation: ${target} already exists`,
          ERROR_CODES.CONFLICT,
        );
      }
      case 'P2025':
        return new NotFoundError(
          'Record to update or delete not found',
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      case 'P2003':
        return new ConflictError(
          'Foreign key constraint violation: referenced entity does not exist or has dependents',
          ERROR_CODES.CONFLICT,
        );
      default:
        return new AppError(
          `Database request error: ${error.message}`,
          500,
          ERROR_CODES.INTERNAL_SERVER_ERROR,
        );
    }
  }

  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 500, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  return new AppError(
    'An unexpected server error occurred',
    500,
    ERROR_CODES.INTERNAL_SERVER_ERROR,
  );
}
