/**
 * @file src/core/middleware/authenticate.ts
 * @description Express authentication middleware enforcing JWT verification,
 * JTI revocation checks, and active account status validation.
 *
 * ARCHITECTURAL DESIGN & SECURITY TRADE-OFFS:
 * 1. Session-existence check is intentionally omitted. Role changes,
 *    deactivations, and logouts revoke refresh sessions; active access
 *    tokens expire within env.JWT_ACCESS_EXPIRES_IN (15 min). This is
 *    acceptable for FYP scope per SRS FR-AUTH-04 (JWT validation) and
 *    FR-AUTH-11 (JTI blacklist).
 * 2. Phase 2 Chunk C will refactor src/realtime/gateway.ts to reuse
 *    tokenService.verifyAccessToken. Do NOT touch gateway.ts in Chunk A.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { tokenService, GlobalRole } from "../../modules/auth/index.js";
import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/codes.js";
import { logger } from "../logger/index.js";

/**
 * Express middleware to authenticate REST requests using Bearer JWT.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        "Bearer access token is required",
        401,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError(
        "Bearer access token is missing",
        401,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // 1. Verify access token signature, expiry, and claims
    const decoded = tokenService.verifyAccessToken(token);

    // Fail-closed JTI check (audit NEW-4). If Redis is unavailable we MUST
    // NOT allow the token through — a possibly-revoked token would otherwise
    // pass. Return 503 so the client knows it's an infrastructure failure,
    // not an authentication failure.
    const jtiCheck = await tokenService.safeIsAccessJtiBlacklisted(decoded.jti);

    if (!jtiCheck.ok) {
      logger.error(
        { jti: decoded.jti, userId: decoded.userId, err: jtiCheck.error },
        "JTI blacklist check failed — Redis unavailable (fail-closed rejection)",
      );
      throw new AppError(
        "Authentication service temporarily unavailable",
        503,
        ERROR_CODES.INFRA_REDIS_UNAVAILABLE,
      );
    }

    if (jtiCheck.blacklisted) {
      throw new AppError(
        "Access token has been revoked",
        401,
        ERROR_CODES.TOKEN_BLACKLISTED,
      );
    }

    // 3. Query PostgreSQL to ensure account exists and is currently active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        globalRole: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(
        "Account is deactivated or does not exist",
        403,
        ERROR_CODES.ACCOUNT_DEACTIVATED,
      );
    }

    // 4. Attach authenticated user context to request
    req.user = {
      id: user.id,
      email: user.email,
      globalRole: user.globalRole as GlobalRole,
      jti: decoded.jti,
      isActive: true,
    };

    next();
  } catch (err: unknown) {
    next(err);
  }
}
