import { Response } from 'express';
import { ErrorCode } from '../errors/codes.js';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedEnvelope<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): Response {
  const envelope: SuccessEnvelope<T> = {
    success: true,
    data,
  };
  return res.status(statusCode).json(envelope);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  statusCode: number = 200,
): Response {
  const envelope: PaginatedEnvelope<T> = {
    success: true,
    data,
    meta,
  };
  return res.status(statusCode).json(envelope);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCode | string,
  message: string,
  details?: unknown,
): Response {
  const envelope: ErrorEnvelope = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && details !== null ? { details } : {}),
    },
  };
  return res.status(statusCode).json(envelope);
}
