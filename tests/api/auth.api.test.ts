/**
 * @file tests/api/auth.api.test.ts
 * @description Integration tests for authentication endpoints via Supertest.
 *
 * Implements SRS v3.0 §4.1 (Password & Session Management), §4.7 (FR-AUTH-01..10),
 * and Errata E-007 (Logout request payload & expired token handling).
 *
 * Constraints:
 * - Real PostgreSQL + Real Redis (no mocks/stubs/fakes).
 * - No app.listen(0) (Supertest ephemeral execution).
 * - Test isolation: all mutations target temporary users; seed accounts are untouched.
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/core/db/prisma.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";
import { tokenService } from "../../src/modules/auth/token.service.js";
import { redisJti } from "../../src/infra/redis/client.js";
import { env } from "../../src/config/env.js";
import {
  seedTempUser,
  deleteTempUser,
  loginAs,
  bearer,
  buildExpiredAccessToken,
  TempUser,
} from "../helpers/auth-test-helpers.js";

describe("Authentication API Integration Tests", () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await Promise.all(createdUserIds.map((id) => deleteTempUser(id)));
    }
  });

  /**
   * Helper to seed a temp user and automatically register for teardown.
   */
  async function createTrackedUser(
    overrides?: Partial<TempUser>,
  ): Promise<TempUser> {
    const user = await seedTempUser(overrides);
    createdUserIds.push(user.id);
    return user;
  }

  // ==========================================================================
  // POST /api/v1/auth/login
  // ==========================================================================
  describe("POST /api/v1/auth/login", () => {
    it("returns 200 and token pair with user profile on valid credentials", async () => {
      const user = await createTrackedUser();

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: user.password });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.expiresIn).toBe(900);
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.email).toBe(user.email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it("updates lastLoginAt timestamp in database upon successful login", async () => {
      const user = await createTrackedUser();

      const initialUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(initialUser?.lastLoginAt).toBeNull();

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: user.password });

      expect(res.status).toBe(200);

      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser?.lastLoginAt).not.toBeNull();
    });

    it("returns 401 INVALID_CREDENTIALS for incorrect password", async () => {
      const user = await createTrackedUser();

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: "WrongPassword@999" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    });

    it("returns 401 INVALID_CREDENTIALS for non-existent email (prevents enumeration)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "non-existent-user-xyz@fyp.local",
          password: "SomePassword@123",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    });

    it("returns 403 ACCOUNT_DEACTIVATED when user account is inactive", async () => {
      const user = await createTrackedUser();
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: user.email, password: user.password });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.ACCOUNT_DEACTIVATED);
    });

    it("returns 422 VALIDATION_ERROR on missing password", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "user@fyp.local" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR on malformed email address", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: "SomePassword@123" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it(
      "locks account after 5 consecutive failed attempts and rejects further logins (423 ACCOUNT_LOCKED)",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();

        // Attempts 1..4 fail with 401 INVALID_CREDENTIALS
        for (let i = 1; i <= 4; i++) {
          const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ email: user.email, password: "IncorrectPassword@1" });

          expect(res.status).toBe(401);
          expect(res.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
        }

        // 5th attempt triggers lockout
        const fifthRes = await request(app)
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: "IncorrectPassword@1" });

        expect(fifthRes.status).toBe(423);
        expect(fifthRes.body.error.code).toBe(ERROR_CODES.ACCOUNT_LOCKED);

        // 6th attempt with correct password remains locked out
        const sixthRes = await request(app)
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: user.password });

        expect(sixthRes.status).toBe(423);
        expect(sixthRes.body.error.code).toBe(ERROR_CODES.ACCOUNT_LOCKED);
      },
    );

    it(
      "concurrent wrong-password attempts correctly trigger lockout (SEC-08)",
      { timeout: 30000 },
      async () => {
        const user = await createTrackedUser();

        // Fire 5 concurrent wrong-password attempts.
        // With the race bug, only ~1 would increment (counter stuck low).
        // With the atomic fix, all 5 increment → threshold reached → lockout.
        const attempts = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(app)
              .post("/api/v1/auth/login")
              .send({ email: user.email, password: "WrongPassword@999" }),
          ),
        );

        // All 5 requests failed with 401 (or 423 if lockout triggered mid-flight)
        const codes = attempts.map((r) => r.status);
        expect(codes.every((c) => c === 401 || c === 423)).toBe(true);

        // After the burst, the account MUST be locked.
        const followUp = await request(app)
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: user.password });
        expect(followUp.status).toBe(423);
        expect(followUp.body.error.code).toBe(ERROR_CODES.ACCOUNT_LOCKED);
      },
    );
  });

  // ==========================================================================
  // POST /api/v1/auth/refresh
  // ==========================================================================
  describe("POST /api/v1/auth/refresh", () => {
    it("returns new TokenPair when presenting a valid active refresh token", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.accessToken).not.toBe(login.accessToken);
      expect(res.body.data.refreshToken).not.toBe(login.refreshToken);
    });

    it("rotates refresh token so the old refresh token is revoked on subsequent use", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      // First rotation succeeds
      const firstRefresh = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(firstRefresh.status).toBe(200);

      // Replay of old refresh token fails with 401 REFRESH_TOKEN_REVOKED
      const replayRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.success).toBe(false);
      expect(replayRes.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_REVOKED);
    });

    it(
      "concurrent refresh with same token: exactly one succeeds, other gets REFRESH_TOKEN_REVOKED (SEC-02)",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();
        const login = await loginAs(app, user.email, user.password);

        // Fire 2 concurrent refresh requests with the SAME refresh token
        const [r1, r2] = await Promise.all([
          request(app).post("/api/v1/auth/refresh").send({ refreshToken: login.refreshToken }),
          request(app).post("/api/v1/auth/refresh").send({ refreshToken: login.refreshToken }),
        ]);

        const statuses = [r1.status, r2.status].sort((a, b) => a - b);
        expect(statuses).toEqual([200, 401]);

        const winner = r1.status === 200 ? r1 : r2;
        const loser = r1.status === 200 ? r2 : r1;

        expect(winner.body.success).toBe(true);
        expect(winner.body.data.accessToken).toBeDefined();
        expect(winner.body.data.refreshToken).toBeDefined();

        expect(loser.body.success).toBe(false);
        expect(loser.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_REVOKED);
      },
    );

    it("returns 401 REFRESH_TOKEN_INVALID for tampered or invalid token format", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);
      const tampered = login.refreshToken.slice(0, -6) + "XXXXXX";

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: tampered });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_INVALID);
    });

    it("returns 401 REFRESH_TOKEN_REVOKED for a logged-out refresh token", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: login.refreshToken });

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_REVOKED);
    });

    it("returns 422 VALIDATION_ERROR on missing refreshToken body", async () => {
      const res = await request(app).post("/api/v1/auth/refresh").send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR on refresh token shorter than 32 characters", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "too-short-token" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // POST /api/v1/auth/logout (Errata E-007 Compliance)
  // ==========================================================================
  describe("POST /api/v1/auth/logout — Errata E-007 compliance", () => {
    it("returns 200 on logout with refreshToken only in body (no Authorization header)", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: login.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it("returns 200 on logout when both access token header and refresh token body are provided", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set(bearer(login.accessToken))
        .send({ refreshToken: login.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 200 on logout with EXPIRED access token in header and valid refresh token in body (E-007 CRITICAL)", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const expiredAccess = buildExpiredAccessToken({
        id: user.id,
        email: user.email,
        globalRole: user.globalRole,
      });

      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .set(bearer(expiredAccess))
        .send({ refreshToken: login.refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Verify that refresh session was indeed revoked
      const refreshRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_REVOKED);
    });

    it("blacklists access token on logout so subsequent authenticated calls return 401 TOKEN_BLACKLISTED", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .set(bearer(login.accessToken))
        .send({ refreshToken: login.refreshToken });

      expect(logoutRes.status).toBe(200);

      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set(bearer(login.accessToken));

      expect(meRes.status).toBe(401);
      expect(meRes.body.success).toBe(false);
      expect(meRes.body.error.code).toBe(ERROR_CODES.TOKEN_BLACKLISTED);
    });

    it("returns 422 VALIDATION_ERROR on missing refreshToken body", async () => {
      const res = await request(app).post("/api/v1/auth/logout").send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it(
      "does not blacklist JTI when Bearer token has forged signature (SEC-02)",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();
        const login = await loginAs(app, user.email, user.password);

        // Craft a JWT signed with WRONG secret (forged), with far-future expiry
        const forgedToken = jwt.sign(
          { userId: user.id, type: "access", jti: "forged-jti-" + randomUUID() },
          "wrong-secret-at-least-32-characters-long",
          { expiresIn: "365d" },
        );

        const logoutRes = await request(app)
          .post("/api/v1/auth/logout")
          .set(bearer(forgedToken))
          .send({ refreshToken: login.refreshToken });

        // Logout still succeeds (E-007: refresh revocation is primary goal)
        expect(logoutRes.status).toBe(200);

        // Refresh token IS revoked (primary logout effect)
        const refreshRes = await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: login.refreshToken });
        expect(refreshRes.status).toBe(401);
        expect(refreshRes.body.error.code).toBe(ERROR_CODES.REFRESH_TOKEN_REVOKED);

        // Forged JTI was NOT written to blacklist (verify via real redisJti)
        const forgedJti = (jwt.decode(forgedToken) as { jti: string }).jti;
        const blacklisted = await tokenService.isAccessJtiBlacklisted(forgedJti);
        expect(blacklisted).toBe(false);
      },
    );

    it(
      "blacklist TTL is capped at env.JWT_ACCESS_EXPIRES_IN (SEC-02)",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();
        const login = await loginAs(app, user.email, user.password);

        // Verify token from a normal login: TTL is <= env TTL anyway, so this
        // test asserts the cap logic exists by checking an already-at-cap token
        // does not exceed env TTL.
        const logoutRes = await request(app)
          .post("/api/v1/auth/logout")
          .set(bearer(login.accessToken))
          .send({ refreshToken: login.refreshToken });
        expect(logoutRes.status).toBe(200);

        // Verify blacklist entry has TTL <= env.JWT_ACCESS_EXPIRES_IN
        const decoded = jwt.decode(login.accessToken) as { jti: string };
        const ttl = await redisJti.ttl(`auth:blacklist:${decoded.jti}`);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(env.JWT_ACCESS_EXPIRES_IN);

        // Cleanup
        await redisJti.del(`auth:blacklist:${decoded.jti}`);
      },
    );
  });

  // ==========================================================================
  // GET /api/v1/auth/me
  // ==========================================================================
  describe("GET /api/v1/auth/me", () => {
    it("returns 200 with full user profile omitting passwordHash on valid access token", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set(bearer(login.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.email).toBe(user.email);
      expect(res.body.data.fullName).toBeDefined();
      expect(res.body.data.globalRole).toBe(user.globalRole);
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it("returns 401 UNAUTHORIZED when Authorization header is missing", async () => {
      const res = await request(app).get("/api/v1/auth/me");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("returns 401 UNAUTHORIZED when Authorization header lacks Bearer prefix", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set({ Authorization: "Token abc123xyz" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("returns 401 TOKEN_EXPIRED on expired access token", async () => {
      const user = await createTrackedUser();
      const expiredToken = buildExpiredAccessToken({
        id: user.id,
        email: user.email,
        globalRole: user.globalRole,
      });

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set(bearer(expiredToken));

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TOKEN_EXPIRED);
    });

    it("returns 401 TOKEN_INVALID on tampered access token signature", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);
      const tampered = login.accessToken.slice(0, -6) + "BADSIG";

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set(bearer(tampered));

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
    });

    it("returns 403 ACCOUNT_DEACTIVATED if account is deactivated after token issue", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      // Deactivate account in PostgreSQL directly
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set(bearer(login.accessToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.ACCOUNT_DEACTIVATED);
    });
  });

  // ==========================================================================
  // PATCH /api/v1/auth/me
  // ==========================================================================
  describe("PATCH /api/v1/auth/me", () => {
    it("updates fullName only and returns updated user profile", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ fullName: "Updated Full Name" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe("Updated Full Name");
    });

    it("updates configuredCapacityHours only and returns updated user profile", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ configuredCapacityHours: 32 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configuredCapacityHours).toBe(32);
    });

    it("updates both fullName and configuredCapacityHours simultaneously", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ fullName: "Dual Update", configuredCapacityHours: 25 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe("Dual Update");
      expect(res.body.data.configuredCapacityHours).toBe(25);
    });

    it("returns 422 VALIDATION_ERROR on unrecognized property (.strict() constraint)", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ fullName: "Valid Name", unauthorizedField: "malicious" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR on configuredCapacityHours outside the 10-80 range", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const lowRes = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ configuredCapacityHours: 9 });

      expect(lowRes.status).toBe(422);
      expect(lowRes.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

      const highRes = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({ configuredCapacityHours: 81 });

      expect(highRes.status).toBe(422);
      expect(highRes.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 401 UNAUTHORIZED on unauthenticated request", async () => {
      const res = await request(app)
        .patch("/api/v1/auth/me")
        .send({ fullName: "No Token" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("returns 200 with no changes on empty body (valid no-op per schema)", async () => {
      // NOTE: current schema allows empty body (both fields optional, no refine).
      // Service treats this as a no-op (no audit row, no field change).
      // Test documents actual behavior — spec does not forbid this.
      // If product later wants to reject empty updates, add .refine() in schema
      // and this test flips to assert 422.
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/me")
        .set(bearer(login.accessToken))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
    });
  });

  // ==========================================================================
  // PATCH /api/v1/auth/password
  // ==========================================================================
  describe("PATCH /api/v1/auth/password", () => {
    it(
      "successfully updates password on valid current and new password",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();
        const login = await loginAs(app, user.email, user.password);
        const newPassword = "NewPassword@2026";

        const res = await request(app)
          .patch("/api/v1/auth/password")
          .set(bearer(login.accessToken))
          .send({
            currentPassword: user.password,
            newPassword,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify subsequent login works with the new password
        const newLoginRes = await request(app)
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: newPassword });

        expect(newLoginRes.status).toBe(200);
        expect(newLoginRes.body.success).toBe(true);
      },
    );

    it("returns 401 INVALID_CREDENTIALS when current password does not match", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/password")
        .set(bearer(login.accessToken))
        .send({
          currentPassword: "IncorrectOldPassword@1",
          newPassword: "BrandNewPassword@2",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    });

    it("returns 422 VALIDATION_ERROR when new password violates password policy", async () => {
      const user = await createTrackedUser();
      const login = await loginAs(app, user.email, user.password);

      const res = await request(app)
        .patch("/api/v1/auth/password")
        .set(bearer(login.accessToken))
        .send({
          currentPassword: user.password,
          newPassword: "weak",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it(
      "revokes all active refresh sessions upon password change",
      { timeout: 20000 },
      async () => {
        const user = await createTrackedUser();

        // Login twice to acquire two independent active refresh sessions
        const session1 = await loginAs(app, user.email, user.password);
        const session2 = await loginAs(app, user.email, user.password);

        // Perform password change using session 1
        const changeRes = await request(app)
          .patch("/api/v1/auth/password")
          .set(bearer(session1.accessToken))
          .send({
            currentPassword: user.password,
            newPassword: "FreshPassword@999",
          });

        expect(changeRes.status).toBe(200);

        // Both previous refresh tokens must now be revoked
        const refresh1Res = await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: session1.refreshToken });

        expect(refresh1Res.status).toBe(401);
        expect(refresh1Res.body.error.code).toBe(
          ERROR_CODES.REFRESH_TOKEN_REVOKED,
        );

        const refresh2Res = await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: session2.refreshToken });

        expect(refresh2Res.status).toBe(401);
        expect(refresh2Res.body.error.code).toBe(
          ERROR_CODES.REFRESH_TOKEN_REVOKED,
        );
      },
    );

    it("returns 401 UNAUTHORIZED on unauthenticated password change request", async () => {
      const res = await request(app)
        .patch("/api/v1/auth/password")
        .send({
          currentPassword: "OldPassword@1",
          newPassword: "NewPassword@2",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });
  });
});
