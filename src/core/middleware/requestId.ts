import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerId = (req.headers["x-correlation-id"] ||
    req.headers["x-request-id"]) as string | undefined;
  const correlationId =
    headerId && isValidUuid(headerId) ? headerId : crypto.randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-ID", correlationId);

  next();
}

function isValidUuid(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
