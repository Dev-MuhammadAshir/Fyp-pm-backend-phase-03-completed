/**
 * @file src/modules/auth/auth.service.ts
 * @description Business orchestration layer for user authentication, session
 * lifecycle management, password policies, and self-service profile updates.
 *
 * ARCHITECTURAL DESIGN & CONSTRAINTS:
 * 1. Login Failure Security: Never reveals whether an email exists (always INVALID_CREDENTIALS,
 *    except when locked -> ACCOUNT_LOCKED).
 * 2. Audit Trail: All user mutations insert audit logs inside the same prisma.$transaction
 *    with before/after state captures.
 * 3. Redis / PostgreSQL Ordering:
 *    - Login: Redis session stored BEFORE DB transaction; on DB transaction failure, session
 *      is revoked via best-effort cleanup.
 *    - Refresh: New session stored in Redis before old session is revoked (token rotation).
 *    - Logout: Best-effort execution; never throws errors client-side.
 * 4. Password Change Session Invalidation:
 *    - Revokes all refresh sessions across all devices immediately.
 *    - Current access token JTI is blacklisted with remaining TTL computed via jwt.decode(token).
 */

import jwt from "jsonwebtoken";
import type { Prisma, User as PrismaUser } from "@prisma/client";
import { env } from "../../config/env.js";
import { APP_CONSTANTS } from "../../config/constants.js";
import { prisma } from "../../core/db/prisma.js";
import { logger } from "../../core/logger/index.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";
import { passwordService } from "./password.service.js";
import { tokenService } from "./token.service.js";
import { authRepository } from "./auth.repository.js";
import {
  GlobalRole,
  LoginRequest,
  UpdateProfileRequest,
  ChangePasswordRequest,
  UserResponse,
} from "./auth.schemas.js";

export interface RequestContext {
  correlationId: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  user: UserResponse;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Transforms internal Prisma User model into public UserResponse, stripping password hash.
 */
function toUserResponse(user: PrismaUser): UserResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    globalRole: user.globalRole as GlobalRole,
    configuredCapacityHours: user.configuredCapacityHours,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Authenticates user credentials with brute-force lockout protection and issues a token pair.
 */
export async function login(
  input: LoginRequest,
  ctx: RequestContext,
): Promise<LoginResult> {
  const email = input.email.toLowerCase().trim();
  const user = await authRepository.findByEmail(email);

  // 1. Uniform rejection if user does not exist (prevents user enumeration)
  if (!user) {
    throw new AppError(
      "Invalid email or password",
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  const now = new Date();

  // 2. Lockout verification (FR-AUTH-08)
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AppError(
      "Account locked due to consecutive failed login attempts",
      423,
      ERROR_CODES.ACCOUNT_LOCKED,
    );
  }

  // 3. Active account verification
  if (!user.isActive) {
    throw new AppError(
      "Account is deactivated",
      403,
      ERROR_CODES.ACCOUNT_DEACTIVATED,
    );
  }

  // 4. Password verification
  const isPasswordValid = await passwordService.comparePassword(
    input.password,
    user.passwordHash,
  );

  if (!isPasswordValid) {
    // Atomic increment + threshold check (audit SEC-08).
    // Two concurrent wrong attempts cannot both read a stale counter —
    // the database increment is atomic and RETURNING gives us the true
    // post-update value.
    const result = await authRepository.incrementAndMaybeLockout(
      user.id,
      APP_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS,
      APP_CONSTANTS.LOCKOUT_DURATION_MS,
    );

    if (result.locked) {
      throw new AppError(
        "Account locked due to consecutive failed login attempts",
        423,
        ERROR_CODES.ACCOUNT_LOCKED,
      );
    }

    throw new AppError(
      "Invalid email or password",
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  // 5. Successful login: Generate tokens
  const access = tokenService.signAccessToken(user);
  const refresh = tokenService.signRefreshToken(user);

  // 6. Store refresh session in Redis before DB transaction
  await tokenService.storeRefreshSession({
    jti: refresh.jti,
    userId: user.id,
    email: user.email,
    globalRole: user.globalRole,
  });

  // 7. Atomic DB transaction: Record successful login and insert audit row
  try {
    const updatedUser = await prisma.$transaction(async (tx) => {
      const before = await authRepository.findById(user.id, tx);
      const after = await authRepository.recordSuccessfulLogin(user.id, tx);

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          entityType: "User",
          entityId: user.id,
          action: "UPDATE",
          oldValues: {
            lastLoginAt: before?.lastLoginAt ? before.lastLoginAt.toISOString() : null,
            failedLoginAttempts: before?.failedLoginAttempts ?? 0,
            lockedUntil: before?.lockedUntil ? before.lockedUntil.toISOString() : null,
          },
          newValues: {
            lastLoginAt: after.lastLoginAt ? after.lastLoginAt.toISOString() : null,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
          correlationId: ctx.correlationId,
        },
      });

      return after;
    });

    return {
      user: toUserResponse(updatedUser),
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
    };
  } catch (err: unknown) {
    // Best-effort rollback of Redis session if DB transaction fails
    await tokenService.revokeRefreshSession(refresh.jti, user.id).catch(() => {});
    throw err;
  }
}

/**
 * Rotates an active refresh token: verifies current token, issues a new token pair,
 * stores the new session in Redis, and revokes the previous session.
 */
export async function refresh(refreshToken: string): Promise<RefreshResult> {
  const claims = tokenService.verifyRefreshToken(refreshToken);

  // ATOMIC CONSUME: read + delete old session in single Lua transaction.
  // Only one concurrent caller wins; other callers get null (SEC-02 fix).
  const session = await tokenService.atomicConsumeRefreshSession(claims.jti);
  if (!session) {
    throw new AppError(
      "Refresh token has been revoked",
      401,
      ERROR_CODES.REFRESH_TOKEN_REVOKED,
    );
  }

  const user = await authRepository.findById(claims.userId);
  if (!user || !user.isActive) {
    throw new AppError(
      "User account is inactive or revoked",
      401,
      ERROR_CODES.REFRESH_TOKEN_REVOKED,
    );
  }

  const newAccess = tokenService.signAccessToken(user);
  const newRefresh = tokenService.signRefreshToken(user);

  // Store new session. Old session already atomically consumed above —
  // no separate revoke call needed.
  await tokenService.storeRefreshSession({
    jti: newRefresh.jti,
    userId: user.id,
    email: user.email,
    globalRole: user.globalRole,
  });

  return {
    accessToken: newAccess.token,
    refreshToken: newRefresh.token,
    expiresIn: newAccess.expiresIn,
  };
}

/**
 * Revokes refresh session and best-effort blacklists active access token JTI.
 * Per Errata E-007, logout never throws client-side errors.
 */
export async function logout(
  refreshToken: string,
  authHeader?: string,
): Promise<void> {
  // 1. Revoke refresh token session
  try {
    const claims = tokenService.verifyRefreshToken(refreshToken);
    await tokenService.revokeRefreshSession(claims.jti, claims.userId);
  } catch (err: unknown) {
    logger.debug({ err }, "Logout: refresh token invalid or expired, continuing");
  }

  // 2. Best-effort blacklist of access token JTI if Bearer token provided.
  // Audit SEC-02: use jwt.verify (not decode) to prevent blacklist injection
  // via forged tokens. ignoreExpiration=true preserves Errata E-007 (logout
  // must work with expired access tokens). Signature verification is the
  // security boundary — an unverified token can inject arbitrary JTIs into
  // Redis (resource exhaustion DoS).
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7).trim();

      let decoded: { jti?: string; exp?: number };
      try {
        const verified = jwt.verify(token, env.JWT_ACCESS_SECRET, {
          algorithms: ["HS256"],
          ignoreExpiration: true,
        });
        if (typeof verified === "string") {
          throw new Error("Malformed token payload");
        }
        decoded = verified as { jti?: string; exp?: number };
      } catch {
        // Signature invalid or token malformed — skip blacklist entirely.
        // Logout still succeeds; refresh revocation above is the primary
        // goal per Errata E-007.
        logger.debug(
          { hasToken: true },
          "Logout: access token signature invalid — skipping JTI blacklist",
        );
        return;
      }

      if (decoded.jti) {
        const rawTtl = decoded.exp
          ? decoded.exp - Math.floor(Date.now() / 1000)
          : env.JWT_ACCESS_EXPIRES_IN;
        // Cap at env TTL to prevent far-future expiry DoS (audit SEC-02)
        const remainingTtl = Math.min(rawTtl, env.JWT_ACCESS_EXPIRES_IN);
        if (remainingTtl > 0) {
          await tokenService.blacklistAccessJti(decoded.jti, remainingTtl);
        }
      }
    } catch (err: unknown) {
      logger.debug(
        { err },
        "Logout: unexpected error during token blacklist, continuing",
      );
    }
  }
}

/**
 * Retrieves the currently authenticated user's profile.
 */
export async function getMe(userId: string): Promise<UserResponse> {
  const user = await authRepository.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
  }
  return toUserResponse(user);
}

/**
 * Updates self-service profile fields with transactional audit logging.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileRequest,
  ctx: RequestContext,
): Promise<UserResponse> {
  const updatedUser = await prisma.$transaction(async (tx) => {
    const before = await authRepository.findById(userId, tx);
    if (!before) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    const after = await authRepository.updateProfile(userId, input, tx);

    const oldValues: Record<string, Prisma.InputJsonValue> = {};
    const newValues: Record<string, Prisma.InputJsonValue> = {};

    if (input.fullName !== undefined && input.fullName !== before.fullName) {
      oldValues.fullName = before.fullName;
      newValues.fullName = after.fullName;
    }
    if (
      input.configuredCapacityHours !== undefined &&
      input.configuredCapacityHours !== before.configuredCapacityHours
    ) {
      oldValues.configuredCapacityHours = before.configuredCapacityHours;
      newValues.configuredCapacityHours = after.configuredCapacityHours;
    }

    if (Object.keys(oldValues).length > 0) {
      await tx.auditLog.create({
        data: {
          actorId: userId,
          entityType: "User",
          entityId: userId,
          action: "UPDATE",
          oldValues: oldValues as Prisma.InputJsonObject,
          newValues: newValues as Prisma.InputJsonObject,
          correlationId: ctx.correlationId,
        },
      });
    }

    return after;
  });

  return toUserResponse(updatedUser);
}

/**
 * Changes user password, logs audit row without hash, revokes all refresh sessions,
 * and blacklists the actor's current access token.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordRequest,
  actorJti: string,
  ctx: RequestContext,
  authHeader?: string,
): Promise<void> {
  const user = await authRepository.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
  }

  const isCurrentPasswordValid = await passwordService.comparePassword(
    input.currentPassword,
    user.passwordHash,
  );
  if (!isCurrentPasswordValid) {
    throw new AppError(
      "Current password does not match",
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  const newHash = await passwordService.hashPassword(input.newPassword);

  // 1. Transaction: Update password hash and write audit row (hashes strictly omitted)
  await prisma.$transaction(async (tx) => {
    const before = await authRepository.findById(userId, tx);
    if (!before) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    const after = await authRepository.updatePasswordHash(userId, newHash, tx);

    await tx.auditLog.create({
      data: {
        actorId: userId,
        entityType: "User",
        entityId: userId,
        action: "UPDATE",
        oldValues: {
          passwordChangedAt: before.updatedAt.toISOString(),
        },
        newValues: {
          passwordChangedAt: after.updatedAt.toISOString(),
        },
        correlationId: ctx.correlationId,
      },
    });
  });

  // 2. Invalidate all active refresh sessions across all devices
  await tokenService.revokeAllRefreshSessions(userId);

  // 3. Blacklist actor's current access token JTI for remaining lifetime.
  // The token was already verified by authenticate middleware (req.user.jti
  // is trusted). We only need exp for TTL — cap at env TTL as defense-in-depth
  // (audit SEC-02: prevent far-future TTL injection).
  try {
    let remainingTtl = env.JWT_ACCESS_EXPIRES_IN;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const verified = jwt.verify(token, env.JWT_ACCESS_SECRET, {
          algorithms: ["HS256"],
          ignoreExpiration: true,
        });
        if (typeof verified !== "string" && typeof verified.exp === "number") {
          const rawTtl = verified.exp - Math.floor(Date.now() / 1000);
          remainingTtl = Math.min(rawTtl, env.JWT_ACCESS_EXPIRES_IN);
        }
      } catch {
        // Token signature invalid or malformed — use env default TTL.
        // Defensive: authenticate middleware already verified this request,
        // but the defensive re-verify costs nothing and protects against
        // header tampering in unusual paths.
      }
    }
    if (remainingTtl > 0) {
      await tokenService.blacklistAccessJti(actorJti, remainingTtl);
    }
  } catch (err: unknown) {
    logger.debug(
      { err },
      "Password change: failed to blacklist current access token, continuing",
    );
  }
}

export const authService = {
  login,
  refresh,
  logout,
  getMe,
  updateProfile,
  changePassword,
};
