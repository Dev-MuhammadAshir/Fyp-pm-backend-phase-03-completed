/**
 * @file src/modules/auth/token.service.ts
 * @description JWT generation, verification, and Redis refresh session management.
 *
 * REDIS KEY CONVENTIONS:
 * - `auth:refresh:<jti>`
 *     JSON { userId, email, globalRole, issuedAt }
 *     SETEX with TTL = env.JWT_REFRESH_EXPIRES_IN (default 604800s / 7d)
 * - `auth:refresh:user:<uid>`
 *     SET of refresh JTIs (for bulk revocation on password change / role update)
 *     SADD + EXPIRE with TTL = env.JWT_REFRESH_EXPIRES_IN
 * - `auth:blacklist:<jti>`
 *     "1" with SETEX TTL = remaining access token lifetime (for logout / revocation)
 */

import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { redis, redisJti } from "../../infra/redis/client.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";

export interface TokenPayloadUser {
  id: string;
  email: string;
  globalRole: string;
}

export interface AccessTokenClaims {
  userId: string;
  email: string;
  globalRole: string;
  jti: string;
}

export interface RefreshTokenClaims {
  userId: string;
  email: string;
  globalRole: string;
  jti: string;
}

export interface StoredRefreshSession {
  userId: string;
  email: string;
  globalRole: string;
  issuedAt: string;
}

/**
 * Signs a short-lived access JWT (type: "access") with JTI and standard expiry.
 */
export function signAccessToken(user: TokenPayloadUser): {
  token: string;
  jti: string;
  expiresIn: number;
} {
  const jti = randomUUID();
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      type: "access",
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      jwtid: jti,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
  );

  return {
    token,
    jti,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  };
}

/**
 * Signs a long-lived refresh JWT (type: "refresh") with JTI and standard expiry.
 */
export function signRefreshToken(user: TokenPayloadUser): {
  token: string;
  jti: string;
  expiresIn: number;
} {
  const jti = randomUUID();
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      type: "refresh",
    },
    env.JWT_REFRESH_SECRET,
    {
      algorithm: "HS256",
      jwtid: jti,
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
  );

  return {
    token,
    jti,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  };
}

/**
 * Verifies and decodes an access token.
 * Throws specific AppError codes: UNAUTHORIZED, TOKEN_EXPIRED, TOKEN_INVALID.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  if (!token) {
    throw new AppError(
      "Access token is required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
    });
    if (typeof verified === "string") {
      throw new AppError(
        "Malformed token payload",
        401,
        ERROR_CODES.TOKEN_INVALID,
      );
    }
    decoded = verified;
  } catch (err: unknown) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(
        "Access token has expired",
        401,
        ERROR_CODES.TOKEN_EXPIRED,
      );
    }
    throw new AppError(
      "Invalid access token",
      401,
      ERROR_CODES.TOKEN_INVALID,
    );
  }

  if (decoded.type !== "access") {
    throw new AppError(
      "Token type is not access",
      401,
      ERROR_CODES.TOKEN_INVALID,
    );
  }

  const userId = decoded.userId as string | undefined;
  const email = decoded.email as string | undefined;
  const globalRole = decoded.globalRole as string | undefined;
  const jti = decoded.jti as string | undefined;

  if (!userId || !email || !globalRole || !jti) {
    throw new AppError(
      "Missing required access token claims",
      401,
      ERROR_CODES.TOKEN_INVALID,
    );
  }

  return { userId, email, globalRole, jti };
}

/**
 * Verifies and decodes a refresh token.
 * Fails fast with REFRESH_TOKEN_INVALID on any validation or claim error.
 */
export function verifyRefreshToken(token: string): RefreshTokenClaims {
  if (!token) {
    throw new AppError(
      "Refresh token is required",
      401,
      ERROR_CODES.REFRESH_TOKEN_INVALID,
    );
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
    });
    if (typeof verified === "string") {
      throw new AppError(
        "Malformed refresh token payload",
        401,
        ERROR_CODES.REFRESH_TOKEN_INVALID,
      );
    }
    decoded = verified;
  } catch {
    throw new AppError(
      "Refresh token is invalid or expired",
      401,
      ERROR_CODES.REFRESH_TOKEN_INVALID,
    );
  }

  if (decoded.type !== "refresh") {
    throw new AppError(
      "Token type is not refresh",
      401,
      ERROR_CODES.REFRESH_TOKEN_INVALID,
    );
  }

  const userId = decoded.userId as string | undefined;
  const email = decoded.email as string | undefined;
  const globalRole = decoded.globalRole as string | undefined;
  const jti = decoded.jti as string | undefined;

  if (!userId || !email || !globalRole || !jti) {
    throw new AppError(
      "Missing required refresh token claims",
      401,
      ERROR_CODES.REFRESH_TOKEN_INVALID,
    );
  }

  return { userId, email, globalRole, jti };
}

/**
 * Stores refresh session metadata in Redis atomically via pipeline with the configured TTL
 * and registers the session JTI in the user's active session set.
 */
export async function storeRefreshSession(params: {
  jti: string;
  userId: string;
  email: string;
  globalRole: string;
}): Promise<void> {
  const sessionKey = `auth:refresh:${params.jti}`;
  const userKey = `auth:refresh:user:${params.userId}`;
  const sessionData: StoredRefreshSession = {
    userId: params.userId,
    email: params.email,
    globalRole: params.globalRole,
    issuedAt: new Date().toISOString(),
  };

  const pipeline = redis.multi();
  pipeline.setex(
    sessionKey,
    env.JWT_REFRESH_EXPIRES_IN,
    JSON.stringify(sessionData),
  );
  pipeline.sadd(userKey, params.jti);
  pipeline.expire(userKey, env.JWT_REFRESH_EXPIRES_IN);
  await pipeline.exec();
}

/**
 * Retrieves refresh session metadata by JTI from Redis.
 */
export async function getRefreshSession(
  jti: string,
): Promise<StoredRefreshSession | null> {
  const raw = await redis.get(`auth:refresh:${jti}`);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredRefreshSession;
  } catch {
    return null;
  }
}

/**
 * Atomically consumes a refresh session: reads + deletes the session
 * in a single Redis Lua transaction, ensuring exactly one concurrent
 * caller can successfully rotate a given refresh token.
 *
 * Prevents the refresh-token rotation race (audit finding SEC-02).
 *
 * Returns the session payload on success, or null if already consumed.
 *
 * Cleanup of the user-scoped session SET member is best-effort —
 * failure here does not affect the atomic consume guarantee (the
 * primary DEL is inside the Lua script and always runs atomically).
 */
export async function atomicConsumeRefreshSession(
  jti: string,
): Promise<StoredRefreshSession | null> {
  // Lua script: GET + DEL in single atomic operation.
  // Redis executes Lua scripts atomically — no interleaving possible.
  const consumeScript = `
    local val = redis.call('GET', KEYS[1])
    if val then
      redis.call('DEL', KEYS[1])
      return val
    end
    return nil
  `;

  const sessionKey = `auth:refresh:${jti}`;
  const raw = (await redis.eval(consumeScript, 1, sessionKey)) as string | null;

  if (!raw) {
    return null;
  }

  let session: StoredRefreshSession;
  try {
    session = JSON.parse(raw) as StoredRefreshSession;
  } catch {
    // Malformed JSON — treat as consumed (safer than leaving stale)
    return null;
  }

  // Best-effort cleanup of user-scoped SET (for revokeAllRefreshSessions
  // iteration hygiene). Not security-critical — session key is already gone.
  await redis
    .srem(`auth:refresh:user:${session.userId}`, jti)
    .catch(() => {});

  return session;
}

/**
 * Revokes a single refresh session and removes its JTI from the user's session set atomically.
 */
export async function revokeRefreshSession(
  jti: string,
  userId: string,
): Promise<void> {
  const pipeline = redis.multi();
  pipeline.del(`auth:refresh:${jti}`);
  pipeline.srem(`auth:refresh:user:${userId}`, jti);
  await pipeline.exec();
}

/**
 * Revokes all active refresh sessions for a specific user.
 *
 * @param userId User UUID
 * @returns Number of revoked session keys
 */
export async function revokeAllRefreshSessions(
  userId: string,
): Promise<number> {
  const userKey = `auth:refresh:user:${userId}`;
  const jtis = await redis.smembers(userKey);

  if (jtis.length > 0) {
    const keys = jtis.map((jti) => `auth:refresh:${jti}`);
    await redis.del(...keys);
  }

  await redis.del(userKey);
  return jtis.length;
}

/**
 * Adds an access token JTI to the blacklist with remaining lifetime TTL.
 */
export async function blacklistAccessJti(
  jti: string,
  ttlSeconds: number,
): Promise<void> {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  await redisJti.setex(`auth:blacklist:${jti}`, ttl, "1");
}

/**
 * Checks whether an access token JTI is present in the blacklist.
 */
export async function isAccessJtiBlacklisted(
  jti: string,
): Promise<boolean> {
  const count = await redisJti.exists(`auth:blacklist:${jti}`);
  return count === 1;
}

/**
 * Safe wrapper around isAccessJtiBlacklisted for fail-closed behavior.
 * Returns a discriminated result instead of throwing, so the caller can
 * distinguish "not blacklisted" from "Redis unreachable".
 *
 * FAIL-CLOSED POLICY (audit NEW-4):
 * If Redis is unreachable, the caller MUST reject the request. A
 * possibly-revoked token passing through during an outage is a security
 * regression; returning 503 to the client is the correct trade-off.
 *
 * @param jti  Access-token JTI to check
 * @param clientOverride  Test-only real ioredis instance override (used
 *   to simulate Redis outage via a dead port without mocks)
 * @returns { ok: true, blacklisted: boolean } on success;
 *          { ok: false, error: Error } on Redis failure
 */
export async function safeIsAccessJtiBlacklisted(
  jti: string,
  clientOverride?: typeof redisJti,
): Promise<
  | { ok: true; blacklisted: boolean }
  | { ok: false; error: Error }
> {
  const client = clientOverride ?? redisJti;
  try {
    const count = await client.exists(`auth:blacklist:${jti}`);
    return { ok: true, blacklisted: count === 1 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export const tokenService = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  storeRefreshSession,
  getRefreshSession,
  revokeRefreshSession,
  revokeAllRefreshSessions,
  blacklistAccessJti,
  isAccessJtiBlacklisted,
  atomicConsumeRefreshSession,
  safeIsAccessJtiBlacklisted,
};
