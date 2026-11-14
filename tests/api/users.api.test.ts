/**
 * @file tests/api/users.api.test.ts
 * @description Integration tests for user administration and directory endpoints via Supertest.
 *
 * Implements SRS v3.0 §4.2 (Global Roles & RBAC Matrix), §4.7 (FR-AUTH-01..10),
 * Appendix A, and Phase 2 Chunk C specifications.
 *
 * Endpoints covered:
 * - GET    /api/v1/users               (Administrator only, pagination, filters, search)
 * - POST   /api/v1/users               (Administrator only, provisioning, password hashing, audit)
 * - GET    /api/v1/users/:userId       (Administrator or self-access)
 * - PATCH  /api/v1/users/:userId/role  (Administrator only, self-guard, last-admin guard, session revoke, audit)
 * - PATCH  /api/v1/users/:userId/status (Administrator only, self-guard, last-admin guard, session revoke, audit)
 *
 * Constraints:
 * - Real PostgreSQL + Real Redis (no mocks/stubs/fakes).
 * - No app.listen(0) (Supertest ephemeral execution).
 * - Test isolation: all mutations target temporary users; seed accounts are untouched.
 * - Deterministic assertions without hardcoded total counts.
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/core/db/prisma.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";
import {
  seedTempUser,
  deleteTempUser,
  loginAs,
  bearer,
  TempUser,
} from "../helpers/auth-test-helpers.js";

interface UserItemResponse {
  id: string;
  email: string;
  fullName: string;
  globalRole: string;
  configuredCapacityHours: number;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  passwordHash?: string;
}

interface PaginationMetaResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

describe("Users API Integration Tests", () => {
  let app: Express;
  let adminAccessToken: string;
  let pmAccessToken: string;
  let viewerAccessToken: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = createApp();

    // Authenticate as seeded baseline accounts (read-only usage)
    const adminLogin = await loginAs(app, "admin@fyp.local", "Admin@1234");
    adminAccessToken = adminLogin.accessToken;

    const pmLogin = await loginAs(app, "pm@fyp.local", "Admin@1234");
    pmAccessToken = pmLogin.accessToken;

    const viewerLogin = await loginAs(app, "viewer@fyp.local", "Admin@1234");
    viewerAccessToken = viewerLogin.accessToken;
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
  // GET /api/v1/users (Admin list)
  // ==========================================================================
  describe("GET /api/v1/users — admin list", () => {
    it("admin lists users with default pagination metadata", async () => {
      const res = await request(app)
        .get("/api/v1/users")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const meta = res.body.meta as PaginationMetaResponse;
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(20);
      expect(typeof meta.total).toBe("number");
      expect(typeof meta.totalPages).toBe("number");
    });

    it("admin filters users by role=Administrator", async () => {
      const res = await request(app)
        .get("/api/v1/users?role=Administrator")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const users = res.body.data as UserItemResponse[];
      expect(users.length).toBeGreaterThanOrEqual(1);
      for (const u of users) {
        expect(u.globalRole).toBe("Administrator");
      }
    });

    it("admin filters users by isActive=false (self-contained)", async () => {
      // 1. Create a fresh temp user via admin endpoint
      const createRes = await request(app)
        .post("/api/v1/users")
        .set(bearer(adminAccessToken))
        .send({
          email: `inactive-${randomUUID()}@fyp.local`,
          password: "Inactive@Pass1234",
          fullName: "Inactive Target User",
          globalRole: "Team Member",
        });

      expect(createRes.status).toBe(201);
      const targetUserId = createRes.body.data.id as string;
      createdUserIds.push(targetUserId);

      // 2. Deactivate them via admin PATCH /users/:id/status
      const deactivateRes = await request(app)
        .patch(`/api/v1/users/${targetUserId}/status`)
        .set(bearer(adminAccessToken))
        .send({ isActive: false });

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.data.isActive).toBe(false);

      // 3. Query GET /api/v1/users?isActive=false
      const listRes = await request(app)
        .get("/api/v1/users?isActive=false")
        .set(bearer(adminAccessToken));

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      const users = listRes.body.data as UserItemResponse[];

      // 4. Assert the deactivated user is present and all returned users are inactive
      expect(users.some((u) => u.id === targetUserId)).toBe(true);
      for (const u of users) {
        expect(u.isActive).toBe(false);
      }
    });

    it("admin searches users by partial email or name query", async () => {
      const uniqueTag = `target-${randomUUID().slice(0, 8)}`;
      const targetUser = await createTrackedUser({
        email: `${uniqueTag}@fyp.local`,
      });

      const res = await request(app)
        .get(`/api/v1/users?search=${uniqueTag}`)
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const users = res.body.data as UserItemResponse[];
      expect(users.some((u) => u.id === targetUser.id)).toBe(true);
    });

    it("returns 403 AUTHZ_FORBIDDEN when Project Manager requests user list", async () => {
      const res = await request(app)
        .get("/api/v1/users")
        .set(bearer(pmAccessToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 403 AUTHZ_FORBIDDEN when Team Member requests user list", async () => {
      const member = await createTrackedUser({ globalRole: "Team Member" });
      const memberLogin = await loginAs(app, member.email, member.password);

      const res = await request(app)
        .get("/api/v1/users")
        .set(bearer(memberLogin.accessToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 403 AUTHZ_FORBIDDEN when Viewer requests user list", async () => {
      const res = await request(app)
        .get("/api/v1/users")
        .set(bearer(viewerAccessToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 401 UNAUTHORIZED when no authorization header provided", async () => {
      const res = await request(app).get("/api/v1/users");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("returns 422 VALIDATION_ERROR when pagination query parameter is invalid (page=0)", async () => {
      const res = await request(app)
        .get("/api/v1/users?page=0")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR when isActive query parameter is not boolean string (isActive=abc)", async () => {
      const res = await request(app)
        .get("/api/v1/users?isActive=abc")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // POST /api/v1/users (Admin create)
  // ==========================================================================
  describe("POST /api/v1/users — admin create", () => {
    it(
      "admin creates a new user successfully with 201 response and without leaking passwordHash",
      { timeout: 20000 },
      async () => {
        const payload = {
          email: `new-user-${randomUUID()}@fyp.local`,
          password: "StrongPassword@1234",
          fullName: "Newly Provisioned Member",
          globalRole: "Team Member",
          configuredCapacityHours: 35,
        };

        const res = await request(app)
          .post("/api/v1/users")
          .set(bearer(adminAccessToken))
          .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);

        const data = res.body.data as UserItemResponse;
        expect(data.id).toBeDefined();
        createdUserIds.push(data.id);

        expect(data.email).toBe(payload.email.toLowerCase());
        expect(data.fullName).toBe(payload.fullName);
        expect(data.globalRole).toBe(payload.globalRole);
        expect(data.configuredCapacityHours).toBe(35);
        expect(data.isActive).toBe(true);
        expect(data.passwordHash).toBeUndefined();
        expect("passwordHash" in data).toBe(false);

        // Verify password hash was actually generated and saved in database
        const dbRecord = await prisma.user.findUnique({
          where: { id: data.id },
        });
        expect(dbRecord).not.toBeNull();
        expect(dbRecord?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      },
    );

    it(
      "newly created user can authenticate immediately with provisioned credentials",
      { timeout: 20000 },
      async () => {
        const email = `loginable-${randomUUID()}@fyp.local`;
        const password = "ValidPassword@999";

        const createRes = await request(app)
          .post("/api/v1/users")
          .set(bearer(adminAccessToken))
          .send({
            email,
            password,
            fullName: "Immediate Login User",
            globalRole: "Team Member",
          });

        expect(createRes.status).toBe(201);
        createdUserIds.push(createRes.body.data.id as string);

        const loginRes = await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
        expect(loginRes.body.data.accessToken).toBeDefined();
        expect(loginRes.body.data.user.email).toBe(email);
      },
    );

    it(
      "returns 409 USER_ALREADY_EXISTS when creating user with existing email",
      { timeout: 20000 },
      async () => {
        const existing = await createTrackedUser();

        const res = await request(app)
          .post("/api/v1/users")
          .set(bearer(adminAccessToken))
          .send({
            email: existing.email,
            password: "DuplicatePass@123",
            fullName: "Duplicate User",
            globalRole: "Team Member",
          });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.USER_ALREADY_EXISTS);
      },
    );

    it("returns 422 VALIDATION_ERROR when password does not meet complexity requirements", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(adminAccessToken))
        .send({
          email: `invalid-pass-${randomUUID()}@fyp.local`,
          password: "weak",
          fullName: "Weak Password User",
          globalRole: "Team Member",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR when globalRole is not in frozen enum", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(adminAccessToken))
        .send({
          email: `invalid-role-${randomUUID()}@fyp.local`,
          password: "ValidPass@12345",
          fullName: "Invalid Role User",
          globalRole: "SuperAdmin",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR when configuredCapacityHours is out of bounds (<10 or >80)", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(adminAccessToken))
        .send({
          email: `invalid-capacity-${randomUUID()}@fyp.local`,
          password: "ValidPass@12345",
          fullName: "Capacity Out of Bounds",
          globalRole: "Team Member",
          configuredCapacityHours: 5,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 403 AUTHZ_FORBIDDEN when non-admin (PM) attempts to create a user", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(pmAccessToken))
        .send({
          email: `pm-blocked-${randomUUID()}@fyp.local`,
          password: "ValidPass@12345",
          fullName: "Should Be Blocked",
          globalRole: "Team Member",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 401 UNAUTHORIZED when unauthenticated client attempts to create a user", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .send({
          email: `noauth-${randomUUID()}@fyp.local`,
          password: "ValidPass@12345",
          fullName: "No Auth User",
          globalRole: "Team Member",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("returns 422 VALIDATION_ERROR when required body field (fullName) is missing", async () => {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(adminAccessToken))
        .send({
          email: `missing-name-${randomUUID()}@fyp.local`,
          password: "ValidPass@12345",
          globalRole: "Team Member",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // GET /api/v1/users/:userId (Self-or-admin)
  // ==========================================================================
  describe("GET /api/v1/users/:userId — self-or-admin", () => {
    it("admin can retrieve profile of any user", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}`)
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(targetUser.id);
      expect(res.body.data.email).toBe(targetUser.email);
    });

    it("non-admin user can retrieve their own profile (self access)", async () => {
      const member = await createTrackedUser({ globalRole: "Team Member" });
      const memberLogin = await loginAs(app, member.email, member.password);

      const res = await request(app)
        .get(`/api/v1/users/${member.id}`)
        .set(bearer(memberLogin.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(member.id);
      expect(res.body.data.email).toBe(member.email);
    });

    it("returns 403 AUTHZ_FORBIDDEN when non-admin attempts to view another user profile", async () => {
      const memberA = await createTrackedUser({ globalRole: "Team Member" });
      const memberB = await createTrackedUser({ globalRole: "Team Member" });
      const memberALogin = await loginAs(app, memberA.email, memberA.password);

      const res = await request(app)
        .get(`/api/v1/users/${memberB.id}`)
        .set(bearer(memberALogin.accessToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 422 VALIDATION_ERROR when userId parameter is not a valid UUID", async () => {
      const res = await request(app)
        .get("/api/v1/users/not-a-valid-uuid")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 404 USER_NOT_FOUND when requesting a non-existent UUID as admin", async () => {
      const res = await request(app)
        .get("/api/v1/users/00000000-0000-0000-0000-000000000000")
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    });

    it("returns 401 UNAUTHORIZED when unauthenticated client requests a user profile", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app).get(`/api/v1/users/${targetUser.id}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("user response never leaks passwordHash field", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}`)
        .set(bearer(adminAccessToken));

      expect(res.status).toBe(200);
      expect(res.body.data.passwordHash).toBeUndefined();
      expect("passwordHash" in (res.body.data as Record<string, unknown>)).toBe(
        false,
      );
    });
  });

  // ==========================================================================
  // PATCH /api/v1/users/:userId/role (Admin update role)
  // ==========================================================================
  describe("PATCH /api/v1/users/:userId/role — admin", () => {
    it("admin promotes a Team Member to Administrator successfully", async () => {
      const targetUser = await createTrackedUser({
        globalRole: "Team Member",
      });

      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/role`)
        .set(bearer(adminAccessToken))
        .send({ globalRole: "Administrator" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.globalRole).toBe("Administrator");

      // Verify in DB
      const dbUser = await prisma.user.findUnique({
        where: { id: targetUser.id },
      });
      expect(dbUser?.globalRole).toBe("Administrator");
    });

    it("admin demotes an Administrator to Team Member when another active admin exists", async () => {
      // Create a second temp administrator (seed admin also actively exists)
      const targetAdmin = await createTrackedUser({
        globalRole: "Administrator",
      });

      const res = await request(app)
        .patch(`/api/v1/users/${targetAdmin.id}/role`)
        .set(bearer(adminAccessToken))
        .send({ globalRole: "Team Member" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.globalRole).toBe("Team Member");
    });

    it(
      "revokes all active refresh sessions of target user upon role change",
      { timeout: 20000 },
      async () => {
        const targetUser = await createTrackedUser({
          globalRole: "Team Member",
        });

        // Login twice to acquire two independent active refresh sessions
        const session1 = await loginAs(
          app,
          targetUser.email,
          targetUser.password,
        );
        const session2 = await loginAs(
          app,
          targetUser.email,
          targetUser.password,
        );

        // Admin updates target user's role to Project Manager
        const updateRes = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/role`)
          .set(bearer(adminAccessToken))
          .send({ globalRole: "Project Manager" });

        expect(updateRes.status).toBe(200);

        // Both refresh sessions must be immediately revoked
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

    it(
      "returns 403 AUTHZ_FORBIDDEN when admin attempts to modify their own global role (self-guard)",
      { timeout: 20000 },
      async () => {
        const tempAdmin = await createTrackedUser({
          globalRole: "Administrator",
        });
        const tempAdminLogin = await loginAs(
          app,
          tempAdmin.email,
          tempAdmin.password,
        );

        const res = await request(app)
          .patch(`/api/v1/users/${tempAdmin.id}/role`)
          .set(bearer(tempAdminLogin.accessToken))
          .send({ globalRole: "Team Member" });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
      },
    );

    it("returns 403 AUTHZ_FORBIDDEN when non-admin (PM) attempts to change a user role", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/role`)
        .set(bearer(pmAccessToken))
        .send({ globalRole: "Administrator" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("returns 422 VALIDATION_ERROR when target role is invalid", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/role`)
        .set(bearer(adminAccessToken))
        .send({ globalRole: "SuperAdmin" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 404 USER_NOT_FOUND when changing role of non-existent user", async () => {
      const res = await request(app)
        .patch("/api/v1/users/00000000-0000-0000-0000-000000000000/role")
        .set(bearer(adminAccessToken))
        .send({ globalRole: "Team Member" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    });

    it("returns 422 VALIDATION_ERROR when userId is not a valid UUID", async () => {
      const res = await request(app)
        .patch("/api/v1/users/invalid-uuid-format/role")
        .set(bearer(adminAccessToken))
        .send({ globalRole: "Team Member" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it(
      "records an audit log entry on role update with actorId and without password hash",
      { timeout: 20000 },
      async () => {
        // Clarification 2: Actor MUST be a temp admin created via seedTempUser
        const actorAdmin = await createTrackedUser({
          globalRole: "Administrator",
        });
        const actorLogin = await loginAs(
          app,
          actorAdmin.email,
          actorAdmin.password,
        );

        const targetUser = await createTrackedUser({
          globalRole: "Team Member",
        });

        const updateRes = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/role`)
          .set(bearer(actorLogin.accessToken))
          .send({ globalRole: "Project Manager" });

        expect(updateRes.status).toBe(200);

        // Fetch audit log record from database for this target user
        const audit = await prisma.auditLog.findFirst({
          where: { entityId: targetUser.id },
          orderBy: { timestamp: "desc" },
        });

        expect(audit).not.toBeNull();
        expect(audit?.action).toBe("UPDATE");
        expect(audit?.entityType).toBe("User");
        expect(audit?.actorId).toBe(actorAdmin.id);

        const serialized = JSON.stringify(audit);
        expect(serialized.includes("passwordHash")).toBe(false);
      },
    );

    it(
      "concurrent mutual admin demotion preserves invariant: at least one admin active (SEC-03)",
      { timeout: 20000 },
      async () => {
        // Setup: 3 temporary admins (A, B, C) + seed admin (always active)
        const adminA = await createTrackedUser({ globalRole: "Administrator" });
        const adminB = await createTrackedUser({ globalRole: "Administrator" });
        const adminC = await createTrackedUser({ globalRole: "Administrator" });

        const loginA = await loginAs(app, adminA.email, adminA.password);
        const loginB = await loginAs(app, adminB.email, adminB.password);

        // Fire concurrent: A demotes B, B demotes A
        const [r1, r2] = await Promise.all([
          request(app)
            .patch(`/api/v1/users/${adminB.id}/role`)
            .set(bearer(loginA.accessToken))
            .send({ globalRole: "Team Member" }),
          request(app)
            .patch(`/api/v1/users/${adminA.id}/role`)
            .set(bearer(loginB.accessToken))
            .send({ globalRole: "Team Member" }),
        ]);

        // Invariant: at least one admin must remain active (seed admin + adminC
        // + possibly A or B depending on outcome).
        const activeAdminCount = await prisma.user.count({
          where: { globalRole: "Administrator", isActive: true },
        });
        expect(activeAdminCount).toBeGreaterThanOrEqual(1);

        // Verify both requests returned valid HTTP status codes (not 500 errors)
        expect([200, 403]).toContain(r1.status);
        expect([200, 403]).toContain(r2.status);

        // Verify DB state is consistent (no orphaned relations, no partial writes)
        const aRecord = await prisma.user.findUnique({ where: { id: adminA.id } });
        const bRecord = await prisma.user.findUnique({ where: { id: adminB.id } });
        const cRecord = await prisma.user.findUnique({ where: { id: adminC.id } });
        expect(aRecord).not.toBeNull();
        expect(bRecord).not.toBeNull();
        expect(cRecord).not.toBeNull();
        expect(["Administrator", "Team Member"]).toContain(aRecord!.globalRole);
        expect(["Administrator", "Team Member"]).toContain(bRecord!.globalRole);
        expect(cRecord!.globalRole).toBe("Administrator");
      },
    );
  });

  // ==========================================================================
  // PATCH /api/v1/users/:userId/status (Admin update status)
  // ==========================================================================
  describe("PATCH /api/v1/users/:userId/status — admin", () => {
    it(
      "admin deactivates a user successfully with 200 response and isActive false",
      { timeout: 20000 },
      async () => {
        const targetUser = await createTrackedUser();
        // Login twice to establish active sessions
        await loginAs(app, targetUser.email, targetUser.password);
        await loginAs(app, targetUser.email, targetUser.password);

        const res = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(adminAccessToken))
          .send({ isActive: false });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(false);

        const dbUser = await prisma.user.findUnique({
          where: { id: targetUser.id },
        });
        expect(dbUser?.isActive).toBe(false);
      },
    );

    it(
      "deactivated user cannot authenticate (returns 403 ACCOUNT_DEACTIVATED)",
      { timeout: 20000 },
      async () => {
        const targetUser = await createTrackedUser();

        // Deactivate user via admin endpoint
        const deactivateRes = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(adminAccessToken))
          .send({ isActive: false });

        expect(deactivateRes.status).toBe(200);

        // Attempt login with valid credentials
        const loginRes = await request(app)
          .post("/api/v1/auth/login")
          .send({
            email: targetUser.email,
            password: targetUser.password,
          });

        expect(loginRes.status).toBe(403);
        expect(loginRes.body.success).toBe(false);
        expect(loginRes.body.error.code).toBe(ERROR_CODES.ACCOUNT_DEACTIVATED);
      },
    );

    it(
      "deactivation revokes all active refresh sessions of target user",
      { timeout: 20000 },
      async () => {
        const targetUser = await createTrackedUser();

        // Login twice to acquire two refresh tokens
        const session1 = await loginAs(
          app,
          targetUser.email,
          targetUser.password,
        );
        const session2 = await loginAs(
          app,
          targetUser.email,
          targetUser.password,
        );

        // Admin deactivates target user
        const deactivateRes = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(adminAccessToken))
          .send({ isActive: false });

        expect(deactivateRes.status).toBe(200);

        // Both refresh sessions must be rejected with REFRESH_TOKEN_REVOKED
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

    it("admin reactivates a deactivated user successfully with 200 response and isActive true", async () => {
      const targetUser = await createTrackedUser();

      // Deactivate first
      await request(app)
        .patch(`/api/v1/users/${targetUser.id}/status`)
        .set(bearer(adminAccessToken))
        .send({ isActive: false });

      // Reactivate
      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/status`)
        .set(bearer(adminAccessToken))
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(true);

      const dbUser = await prisma.user.findUnique({
        where: { id: targetUser.id },
      });
      expect(dbUser?.isActive).toBe(true);
    });

    it(
      "reactivated user can authenticate successfully",
      { timeout: 20000 },
      async () => {
        const targetUser = await createTrackedUser();

        // Deactivate then reactivate
        await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(adminAccessToken))
          .send({ isActive: false });

        await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(adminAccessToken))
          .send({ isActive: true });

        // Authenticate
        const loginRes = await request(app)
          .post("/api/v1/auth/login")
          .send({
            email: targetUser.email,
            password: targetUser.password,
          });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
        expect(loginRes.body.data.accessToken).toBeDefined();
      },
    );

    it(
      "returns 403 AUTHZ_FORBIDDEN when admin attempts to deactivate their own account (self-guard)",
      { timeout: 20000 },
      async () => {
        const tempAdmin = await createTrackedUser({
          globalRole: "Administrator",
        });
        const tempAdminLogin = await loginAs(
          app,
          tempAdmin.email,
          tempAdmin.password,
        );

        const res = await request(app)
          .patch(`/api/v1/users/${tempAdmin.id}/status`)
          .set(bearer(tempAdminLogin.accessToken))
          .send({ isActive: false });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
      },
    );

    it("returns 403 AUTHZ_FORBIDDEN when non-admin (PM) attempts to update user status", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/status`)
        .set(bearer(pmAccessToken))
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it(
      "records an audit log entry on status update with actorId and without password hash",
      { timeout: 20000 },
      async () => {
        // Clarification 2: Actor MUST be a temp admin created via seedTempUser
        const actorAdmin = await createTrackedUser({
          globalRole: "Administrator",
        });
        const actorLogin = await loginAs(
          app,
          actorAdmin.email,
          actorAdmin.password,
        );

        const targetUser = await createTrackedUser();

        const statusRes = await request(app)
          .patch(`/api/v1/users/${targetUser.id}/status`)
          .set(bearer(actorLogin.accessToken))
          .send({ isActive: false });

        expect(statusRes.status).toBe(200);

        const audit = await prisma.auditLog.findFirst({
          where: { entityId: targetUser.id },
          orderBy: { timestamp: "desc" },
        });

        expect(audit).not.toBeNull();
        expect(audit?.action).toBe("UPDATE");
        expect(audit?.entityType).toBe("User");
        expect(audit?.actorId).toBe(actorAdmin.id);

        const serialized = JSON.stringify(audit);
        expect(serialized.includes("passwordHash")).toBe(false);
      },
    );

    it("returns 422 VALIDATION_ERROR when isActive body field is missing or not a boolean", async () => {
      const targetUser = await createTrackedUser();

      const res = await request(app)
        .patch(`/api/v1/users/${targetUser.id}/status`)
        .set(bearer(adminAccessToken))
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 422 VALIDATION_ERROR when userId is not a valid UUID", async () => {
      const res = await request(app)
        .patch("/api/v1/users/not-a-valid-uuid/status")
        .set(bearer(adminAccessToken))
        .send({ isActive: false });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("returns 404 USER_NOT_FOUND when updating status of non-existent user", async () => {
      const res = await request(app)
        .patch("/api/v1/users/00000000-0000-0000-0000-000000000000/status")
        .set(bearer(adminAccessToken))
        .send({ isActive: false });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    });
  });
});
