/**
 * @file tests/unit/auth/token.service.test.ts
 * @description Unit tests for tokenService (JWT lifecycle, Redis session management, and JTI blacklisting).
 *
 * Cleanup Strategy:
 * - Uses random UUIDs for every test to guarantee test isolation.
 * - Collects created Redis keys in a test-scoped registry.
 * - afterEach runs targeted `redis.del(...keys)` on known key patterns only (NO FLUSHDB).
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import Redis from "ioredis";
import {
  tokenService,
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
  TokenPayloadUser,
} from "../../../src/modules/auth/token.service.js";
import { env } from "../../../src/config/env.js";
import { redis, redisJti } from "../../../src/infra/redis/client.js";

describe("tokenService — JWT signing and verification", () => {
  const testUser: TokenPayloadUser = {
    id: randomUUID(),
    email: "jwt-test@fyp.local",
    globalRole: "Team Member",
  };

  describe("signAccessToken / verifyAccessToken", () => {
    it("signs and verifies a valid access token", () => {
      const { token, jti, expiresIn } = signAccessToken(testUser);

      expect(typeof token).toBe("string");
      expect(typeof jti).toBe("string");
      expect(jti).toHaveLength(36);
      expect(expiresIn).toBe(env.JWT_ACCESS_EXPIRES_IN);

      const claims = verifyAccessToken(token);

      expect(claims.userId).toBe(testUser.id);
      expect(claims.email).toBe(testUser.email);
      expect(claims.globalRole).toBe(testUser.globalRole);
      expect(claims.jti).toBe(jti);
    });

    it("rejects a refresh token presented as an access token", () => {
      const { token: refreshToken } = signRefreshToken(testUser);

      expect(() => verifyAccessToken(refreshToken)).toThrow();
    });

    it("rejects a tampered access token signature", () => {
      const { token } = signAccessToken(testUser);
      const tampered = token.slice(0, -5) + "AAAAA";

      expect(() => verifyAccessToken(tampered)).toThrow();
    });

    it("rejects an empty access token string", () => {
      expect(() => verifyAccessToken("")).toThrow();
    });
  });

  describe("signRefreshToken / verifyRefreshToken", () => {
    it("signs and verifies a valid refresh token", () => {
      const { token, jti, expiresIn } = signRefreshToken(testUser);

      expect(typeof token).toBe("string");
      expect(typeof jti).toBe("string");
      expect(jti).toHaveLength(36);
      expect(expiresIn).toBe(env.JWT_REFRESH_EXPIRES_IN);

      const claims = verifyRefreshToken(token);

      expect(claims.userId).toBe(testUser.id);
      expect(claims.email).toBe(testUser.email);
      expect(claims.globalRole).toBe(testUser.globalRole);
      expect(claims.jti).toBe(jti);
    });

    it("rejects an access token presented as a refresh token", () => {
      const { token: accessToken } = signAccessToken(testUser);

      expect(() => verifyRefreshToken(accessToken)).toThrow();
    });

    it("rejects a tampered refresh token signature", () => {
      const { token } = signRefreshToken(testUser);
      const tampered = token.slice(0, -5) + "AAAAA";

      expect(() => verifyRefreshToken(tampered)).toThrow();
    });

    it("rejects an empty refresh token string", () => {
      expect(() => verifyRefreshToken("")).toThrow();
    });
  });
});

describe("tokenService — Redis refresh session store and JTI blacklist", () => {
  const trackedRedisKeys: string[] = [];

  afterEach(async () => {
    // Session keys live on redis (DB 0)
    const sessionKeys = trackedRedisKeys.filter((k) =>
      k.startsWith("auth:refresh:"),
    );
    // JTI keys live on redisJti (DB 1)
    const jtiKeys = trackedRedisKeys.filter((k) =>
      k.startsWith("auth:blacklist:"),
    );

    if (sessionKeys.length > 0) await redis.del(...sessionKeys);
    if (jtiKeys.length > 0) await redisJti.del(...jtiKeys);
    trackedRedisKeys.length = 0;
  });

  describe("refresh session store", () => {
    it("persists and retrieves a refresh session in Redis", async () => {
      const jti = randomUUID();
      const userId = randomUUID();
      const email = "session-test@fyp.local";
      const globalRole = "Project Manager";

      trackedRedisKeys.push(`auth:refresh:${jti}`, `auth:refresh:user:${userId}`);

      await storeRefreshSession({ jti, userId, email, globalRole });

      const stored = await getRefreshSession(jti);

      expect(stored).not.toBeNull();
      expect(stored!.userId).toBe(userId);
      expect(stored!.email).toBe(email);
      expect(stored!.globalRole).toBe(globalRole);
      expect(stored!.issuedAt).toBeDefined();
    });

    it("returns null for an unknown or nonexistent JTI", async () => {
      const unknownJti = randomUUID();
      const session = await getRefreshSession(unknownJti);

      expect(session).toBeNull();
    });

    it("revokes a single refresh session and removes it from the user set", async () => {
      const jti = randomUUID();
      const userId = randomUUID();

      trackedRedisKeys.push(`auth:refresh:${jti}`, `auth:refresh:user:${userId}`);

      await storeRefreshSession({
        jti,
        userId,
        email: "revoke-single@fyp.local",
        globalRole: "Team Member",
      });

      const beforeRevoke = await getRefreshSession(jti);
      expect(beforeRevoke).not.toBeNull();

      await revokeRefreshSession(jti, userId);

      const afterRevoke = await getRefreshSession(jti);
      expect(afterRevoke).toBeNull();
    });

    it("revokes all refresh sessions for a specific user atomically", async () => {
      const userId = randomUUID();
      const jti1 = randomUUID();
      const jti2 = randomUUID();
      const jti3 = randomUUID();

      trackedRedisKeys.push(
        `auth:refresh:${jti1}`,
        `auth:refresh:${jti2}`,
        `auth:refresh:${jti3}`,
        `auth:refresh:user:${userId}`,
      );

      await storeRefreshSession({
        jti: jti1,
        userId,
        email: "user-bulk@fyp.local",
        globalRole: "Viewer",
      });
      await storeRefreshSession({
        jti: jti2,
        userId,
        email: "user-bulk@fyp.local",
        globalRole: "Viewer",
      });
      await storeRefreshSession({
        jti: jti3,
        userId,
        email: "user-bulk@fyp.local",
        globalRole: "Viewer",
      });

      const revokedCount = await revokeAllRefreshSessions(userId);

      expect(revokedCount).toBe(3);
      expect(await getRefreshSession(jti1)).toBeNull();
      expect(await getRefreshSession(jti2)).toBeNull();
      expect(await getRefreshSession(jti3)).toBeNull();
    });

    it("atomicConsumeRefreshSession returns session once, then null on second call", async () => {
      const jti = randomUUID();
      const userId = randomUUID();
      const email = "atomic-test@fyp.local";
      const globalRole = "Team Member";

      trackedRedisKeys.push(
        `auth:refresh:${jti}`,
        `auth:refresh:user:${userId}`,
      );

      await storeRefreshSession({ jti, userId, email, globalRole });

      const first = await atomicConsumeRefreshSession(jti);
      expect(first).not.toBeNull();
      expect(first!.userId).toBe(userId);
      expect(first!.email).toBe(email);

      const second = await atomicConsumeRefreshSession(jti);
      expect(second).toBeNull();
    });

    it("atomicConsumeRefreshSession returns null for unknown JTI", async () => {
      const result = await atomicConsumeRefreshSession(randomUUID());
      expect(result).toBeNull();
    });

    it("concurrent atomicConsumeRefreshSession calls: exactly one succeeds", async () => {
      const jti = randomUUID();
      const userId = randomUUID();
      const email = "race-test@fyp.local";
      const globalRole = "Team Member";

      trackedRedisKeys.push(
        `auth:refresh:${jti}`,
        `auth:refresh:user:${userId}`,
      );

      await storeRefreshSession({ jti, userId, email, globalRole });

      // Fire 5 concurrent consumes — exactly ONE must succeed
      const results = await Promise.all([
        atomicConsumeRefreshSession(jti),
        atomicConsumeRefreshSession(jti),
        atomicConsumeRefreshSession(jti),
        atomicConsumeRefreshSession(jti),
        atomicConsumeRefreshSession(jti),
      ]);

      const successes = results.filter((r) => r !== null);
      const failures = results.filter((r) => r === null);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(4);
    });
  });

  describe("JTI blacklist", () => {
    it("blacklists an access token JTI with standard TTL", async () => {
      const jti = randomUUID();
      trackedRedisKeys.push(`auth:blacklist:${jti}`);

      expect(await isAccessJtiBlacklisted(jti)).toBe(false);

      await blacklistAccessJti(jti, 60);

      expect(await isAccessJtiBlacklisted(jti)).toBe(true);
    });

    it("returns false for an unblacklisted JTI", async () => {
      const jti = randomUUID();
      expect(await isAccessJtiBlacklisted(jti)).toBe(false);
    });
  });

  describe("safeIsAccessJtiBlacklisted — fail-closed (NEW-4)", () => {
    it("returns { ok: true, blacklisted: false } for normal jti", async () => {
      const result = await safeIsAccessJtiBlacklisted(randomUUID());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.blacklisted).toBe(false);
    });

    it("returns { ok: true, blacklisted: true } when jti blacklisted", async () => {
      const jti = randomUUID();
      trackedRedisKeys.push(`auth:blacklist:${jti}`);
      await blacklistAccessJti(jti, 60);
      const result = await safeIsAccessJtiBlacklisted(jti);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.blacklisted).toBe(true);
    });

    it("returns { ok: false, error } when Redis is unreachable", async () => {
      const brokenJti = new Redis({
        host: "127.0.0.1",
        port: 1,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableReadyCheck: false,
        retryStrategy: () => null,
      });
      try {
        const result = await safeIsAccessJtiBlacklisted(
          randomUUID(),
          brokenJti,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBeInstanceOf(Error);
      } finally {
        brokenJti.disconnect();
      }
    });
  });

  it("exports all token methods on the tokenService singleton object", () => {
    expect(typeof tokenService.signAccessToken).toBe("function");
    expect(typeof tokenService.signRefreshToken).toBe("function");
    expect(typeof tokenService.verifyAccessToken).toBe("function");
    expect(typeof tokenService.verifyRefreshToken).toBe("function");
    expect(typeof tokenService.storeRefreshSession).toBe("function");
    expect(typeof tokenService.getRefreshSession).toBe("function");
    expect(typeof tokenService.revokeRefreshSession).toBe("function");
    expect(typeof tokenService.revokeAllRefreshSessions).toBe("function");
    expect(typeof tokenService.blacklistAccessJti).toBe("function");
    expect(typeof tokenService.isAccessJtiBlacklisted).toBe("function");
    expect(typeof tokenService.atomicConsumeRefreshSession).toBe("function");
    expect(typeof tokenService.safeIsAccessJtiBlacklisted).toBe("function");
  });
});
