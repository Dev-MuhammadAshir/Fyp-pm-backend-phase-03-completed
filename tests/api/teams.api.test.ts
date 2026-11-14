/**
 * @file tests/api/teams.api.test.ts
 * @description HTTP API integration tests for the Teams module (Chunk 3B).
 *
 * Executes against real Express app (via Supertest), real PostgreSQL,
 * real Redis, real bcrypt, and real append-only audit logs.
 * Zero mocks, zero stubs, zero skipped tests.
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
} from "../helpers/auth-test-helpers.js";
import {
  seedTempTeam,
  addTeamMember,
  cleanupTeams,
} from "../helpers/team-project-helpers.js";

/**
 * Public Team representation returned by the Teams API (verbatim from teams.service.ts).
 */
interface TeamDTO {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

/**
 * Public TeamMember representation returned by the Teams API (verbatim from teams.service.ts).
 */
interface TeamMemberDTO {
  teamId: string;
  userId: string;
  role: "Admin-Assigned" | "Member";
  assignedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

describe("Teams API — integration (Chunk 3B)", () => {
  let app: Express;

  let adminId: string;
  let adminToken: string;
  let pmId: string;
  let pmToken: string;
  let tmId: string;
  let tmToken: string;
  let viewerId: string;
  let viewerToken: string;
  let outsiderId: string;
  let outsiderToken: string;

  // Track API-created teams (POST /api/v1/teams) for teardown
  const apiCreatedTeamIds: string[] = [];

  beforeAll(async () => {
    app = createApp();

    const admin = await seedTempUser({ globalRole: "Administrator" });
    adminId = admin.id;
    const adminLogin = await loginAs(app, admin.email, admin.password);
    adminToken = adminLogin.accessToken;

    const pm = await seedTempUser({ globalRole: "Project Manager" });
    pmId = pm.id;
    const pmLogin = await loginAs(app, pm.email, pm.password);
    pmToken = pmLogin.accessToken;

    const tm = await seedTempUser({ globalRole: "Team Member" });
    tmId = tm.id;
    const tmLogin = await loginAs(app, tm.email, tm.password);
    tmToken = tmLogin.accessToken;

    const viewer = await seedTempUser({ globalRole: "Viewer" });
    viewerId = viewer.id;
    const viewerLogin = await loginAs(app, viewer.email, viewer.password);
    viewerToken = viewerLogin.accessToken;

    const outsider = await seedTempUser({ globalRole: "Team Member" });
    outsiderId = outsider.id;
    const outsiderLogin = await loginAs(app, outsider.email, outsider.password);
    outsiderToken = outsiderLogin.accessToken;
  }, 60000);

  afterAll(async () => {
    // Clean API-created teams FIRST
    for (const id of [...apiCreatedTeamIds].reverse()) {
      try {
        await prisma.team.delete({ where: { id } });
      } catch {
        // Already deleted — ok
      }
    }
    apiCreatedTeamIds.length = 0;

    // Then helper-created teams
    await cleanupTeams();

    // Then temp users + Redis sessions
    await deleteTempUser(adminId);
    await deleteTempUser(pmId);
    await deleteTempUser(tmId);
    await deleteTempUser(viewerId);
    await deleteTempUser(outsiderId);
  }, 30000);

  // Cycle regression test
  it("teams barrel imports cleanly after full app bootstrap (cycle fix regression)", async () => {
    const mod = await import("../../src/modules/teams/index.js");
    expect(mod.teamsService).toBeDefined();
    expect(mod.teamsRouter).toBeDefined();
    expect(mod.teamsController).toBeDefined();
    expect(mod.teamsRepository).toBeDefined();
  });

  // ==========================================================================
  // 1. POST /api/v1/teams — create (Admin only)
  // ==========================================================================
  describe("POST /api/v1/teams — create (Admin only)", () => {
    it("admin creates team → 201 with memberCount=1; Admin-Assigned row created; two audit rows written", async () => {
      const teamName = `Created Team ${randomUUID().slice(0, 8)}`;
      const res = await request(app)
        .post("/api/v1/teams")
        .set(bearer(adminToken))
        .send({ name: teamName, description: "Backend engineering squad" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const data = res.body.data as TeamDTO;
      expect(typeof data.id).toBe("string");
      apiCreatedTeamIds.push(data.id);

      expect(data.name).toBe(teamName);
      expect(data.description).toBe("Backend engineering squad");
      expect(data.memberCount).toBe(1);
      expect(typeof data.createdAt).toBe("string");

      const membership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: data.id,
            userId: adminId,
          },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("Admin-Assigned");
      expect(membership?.assignedBy).toBe(adminId);

      const auditCount = await prisma.auditLog.count({
        where: { entityId: data.id },
      });
      expect(auditCount).toBe(2);

      const teamAudit = await prisma.auditLog.findFirst({
        where: { entityId: data.id, entityType: "Team", action: "CREATE" },
      });
      expect(teamAudit).not.toBeNull();
      expect(teamAudit?.actorId).toBe(adminId);
      expect(teamAudit?.correlationId).toBeTruthy();

      const memberAudit = await prisma.auditLog.findFirst({
        where: { entityId: data.id, entityType: "TeamMember", action: "CREATE" },
      });
      expect(memberAudit).not.toBeNull();
      expect(memberAudit?.actorId).toBe(adminId);
      expect(memberAudit?.correlationId).toBeTruthy();
    });

    it("PM tries to create team → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(bearer(pmToken))
        .send({ name: `PM Blocked ${randomUUID().slice(0, 8)}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Team Member tries to create team → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(bearer(tmToken))
        .send({ name: `TM Blocked ${randomUUID().slice(0, 8)}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Viewer tries to create team → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(bearer(viewerToken))
        .send({ name: `Viewer Blocked ${randomUUID().slice(0, 8)}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("empty name → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(bearer(adminToken))
        .send({ name: "   " });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("duplicate team name → 409 TEAM_ALREADY_EXISTS", async () => {
      const dupName = `Dup Team ${randomUUID().slice(0, 8)}`;

      const first = await request(app)
        .post("/api/v1/teams")
        .set(bearer(adminToken))
        .send({ name: dupName });

      expect(first.status).toBe(201);
      apiCreatedTeamIds.push((first.body.data as TeamDTO).id);

      const second = await request(app)
        .post("/api/v1/teams")
        .set(bearer(adminToken))
        .send({ name: dupName });

      expect(second.status).toBe(409);
      expect(second.body.success).toBe(false);
      expect(second.body.error.code).toBe(ERROR_CODES.TEAM_ALREADY_EXISTS);
    });

    it("missing Authorization header → 401 UNAUTHORIZED", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .send({ name: `NoAuth ${randomUUID().slice(0, 8)}` });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });
  });

  // ==========================================================================
  // 2. GET /api/v1/teams — list
  // ==========================================================================
  describe("GET /api/v1/teams — list", () => {
    it("admin sees all teams (seeds 3 via helper)", async () => {
      const t1 = await seedTempTeam(adminId);
      const t2 = await seedTempTeam(adminId);
      const t3 = await seedTempTeam(adminId);

      const res = await request(app)
        .get("/api/v1/teams?limit=100")
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const rows = res.body.data as TeamDTO[];
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(t1.id);
      expect(ids).toContain(t2.id);
      expect(ids).toContain(t3.id);

      const matched = rows.find((r) => r.id === t1.id);
      expect(matched?.name).toBe(t1.name);
      expect(matched?.description).toBeNull();
      expect(matched?.memberCount).toBe(1);
      expect(typeof matched?.createdAt).toBe("string");
    });

    it("PM sees only member teams", async () => {
      const visibleTeam = await seedTempTeam(adminId);
      const hiddenTeam = await seedTempTeam(adminId);
      await addTeamMember(visibleTeam.id, pmId, "Member", adminId);

      const res = await request(app)
        .get("/api/v1/teams?limit=100")
        .set(bearer(pmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as TeamDTO[]).map((t) => t.id);
      expect(ids).toContain(visibleTeam.id);
      expect(ids).not.toContain(hiddenTeam.id);
    });

    it("Team Member sees only member teams", async () => {
      const visibleTeam = await seedTempTeam(adminId);
      const hiddenTeam = await seedTempTeam(adminId);
      await addTeamMember(visibleTeam.id, tmId, "Member", adminId);

      const res = await request(app)
        .get("/api/v1/teams?limit=100")
        .set(bearer(tmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as TeamDTO[]).map((t) => t.id);
      expect(ids).toContain(visibleTeam.id);
      expect(ids).not.toContain(hiddenTeam.id);
    });

    it("Viewer sees only member teams", async () => {
      const visibleTeam = await seedTempTeam(adminId);
      const hiddenTeam = await seedTempTeam(adminId);
      await addTeamMember(visibleTeam.id, viewerId, "Member", adminId);

      const res = await request(app)
        .get("/api/v1/teams?limit=100")
        .set(bearer(viewerToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as TeamDTO[]).map((t) => t.id);
      expect(ids).toContain(visibleTeam.id);
      expect(ids).not.toContain(hiddenTeam.id);
    });

    it("pagination (page=1, limit=1) → data.length===1, meta.total>=3", async () => {
      await seedTempTeam(adminId);
      await seedTempTeam(adminId);
      await seedTempTeam(adminId);

      const res = await request(app)
        .get("/api/v1/teams?page=1&limit=1")
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as TeamDTO[];
      const meta = res.body.meta as PaginationMeta;
      expect(data.length).toBe(1);
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(1);
      expect(meta.total).toBeGreaterThanOrEqual(3);
      expect(meta.totalPages).toBe(meta.total);
    });

    it("search filter by name substring", async () => {
      const tag = `SearchTag-${randomUUID().slice(0, 8)}`;
      const matchingTeam = await seedTempTeam(adminId, {
        name: `Prefix ${tag} Suffix`,
      });
      const otherTeam = await seedTempTeam(adminId, {
        name: `Unrelated ${randomUUID().slice(0, 8)}`,
      });

      const res = await request(app)
        .get(`/api/v1/teams?search=${encodeURIComponent(tag)}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as TeamDTO[]).map((t) => t.id);
      expect(ids).toContain(matchingTeam.id);
      expect(ids).not.toContain(otherTeam.id);
    });
  });

  // ==========================================================================
  // 3. GET /api/v1/teams/:teamId — get one
  // ==========================================================================
  describe("GET /api/v1/teams/:teamId — get one", () => {
    it("team member retrieves team → 200", async () => {
      const team = await seedTempTeam(adminId, {
        description: "Member readable",
      });
      await addTeamMember(team.id, pmId, "Member", adminId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}`)
        .set(bearer(pmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as TeamDTO;
      expect(data.id).toBe(team.id);
      expect(data.name).toBe(team.name);
      expect(data.description).toBe("Member readable");
      expect(data.memberCount).toBe(2);
      expect(typeof data.createdAt).toBe("string");
    });

    it("non-member → 403 AUTHZ_NOT_TEAM_MEMBER", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, pmId, "Member", adminId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}`)
        .set(bearer(outsiderToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_NOT_TEAM_MEMBER);
    });

    it("admin retrieves any team → 200 (bypass)", async () => {
      const team = await seedTempTeam(pmId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as TeamDTO).id).toBe(team.id);
    });

    it("invalid UUID → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .get("/api/v1/teams/not-a-valid-uuid")
        .set(bearer(adminToken));

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("nonexistent UUID → 403 AUTHZ_NOT_TEAM_MEMBER for non-admin, 404 TEAM_NOT_FOUND for admin", async () => {
      const missingId = randomUUID();

      const memberRes = await request(app)
        .get(`/api/v1/teams/${missingId}`)
        .set(bearer(tmToken));

      expect(memberRes.status).toBe(403);
      expect(memberRes.body.success).toBe(false);
      expect(memberRes.body.error.code).toBe(ERROR_CODES.AUTHZ_NOT_TEAM_MEMBER);

      const adminRes = await request(app)
        .get(`/api/v1/teams/${missingId}`)
        .set(bearer(adminToken));

      expect(adminRes.status).toBe(404);
      expect(adminRes.body.success).toBe(false);
      expect(adminRes.body.error.code).toBe(ERROR_CODES.TEAM_NOT_FOUND);
    });
  });

  // ==========================================================================
  // 4. PATCH /api/v1/teams/:teamId — update
  // ==========================================================================
  describe("PATCH /api/v1/teams/:teamId — update", () => {
    it("admin updates name → 200; audit row with oldValues/newValues", async () => {
      const team = await seedTempTeam(adminId);
      const updatedName = `Updated Team ${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .patch(`/api/v1/teams/${team.id}`)
        .set(bearer(adminToken))
        .send({ name: updatedName });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as TeamDTO;
      expect(data.id).toBe(team.id);
      expect(data.name).toBe(updatedName);
      expect(data.memberCount).toBe(1);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "Team", action: "UPDATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();

      const oldVals = audit?.oldValues as Record<string, unknown> | null;
      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(oldVals?.name).toBe(team.name);
      expect(newVals?.name).toBe(updatedName);
    });

    it("PM updates team (TEAM_MANAGE_MEMBERS umbrella E-005) → 200", async () => {
      const team = await seedTempTeam(adminId);
      const pmUpdatedName = `PM Renamed ${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .patch(`/api/v1/teams/${team.id}`)
        .set(bearer(pmToken))
        .send({ name: pmUpdatedName, description: "Updated by PM" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as TeamDTO;
      expect(data.name).toBe(pmUpdatedName);
      expect(data.description).toBe("Updated by PM");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "Team", action: "UPDATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(pmId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("Team Member → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .patch(`/api/v1/teams/${team.id}`)
        .set(bearer(tmToken))
        .send({ name: "Unauthorized Update" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Viewer → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, viewerId, "Member", adminId);

      const res = await request(app)
        .patch(`/api/v1/teams/${team.id}`)
        .set(bearer(viewerToken))
        .send({ name: "Viewer Blocked" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("duplicate name → 409 TEAM_ALREADY_EXISTS", async () => {
      const teamA = await seedTempTeam(adminId);
      const teamB = await seedTempTeam(adminId);

      const res = await request(app)
        .patch(`/api/v1/teams/${teamB.id}`)
        .set(bearer(adminToken))
        .send({ name: teamA.name });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TEAM_ALREADY_EXISTS);
    });

    it("no-op update (same name) → 200; no new audit row", async () => {
      const team = await seedTempTeam(adminId);

      const beforeAuditCount = await prisma.auditLog.count({
        where: { entityId: team.id, entityType: "Team", action: "UPDATE" },
      });

      const res = await request(app)
        .patch(`/api/v1/teams/${team.id}`)
        .set(bearer(adminToken))
        .send({ name: team.name });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as TeamDTO).name).toBe(team.name);

      const afterAuditCount = await prisma.auditLog.count({
        where: { entityId: team.id, entityType: "Team", action: "UPDATE" },
      });
      expect(afterAuditCount).toBe(beforeAuditCount);
    });
  });

  // ==========================================================================
  // 5. DELETE /api/v1/teams/:teamId — delete (Admin only)
  // ==========================================================================
  describe("DELETE /api/v1/teams/:teamId — delete (Admin only)", () => {
    it("admin deletes team → 200; team gone; cascade removes team_members", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const deletedTeam = await prisma.team.findUnique({
        where: { id: team.id },
      });
      expect(deletedTeam).toBeNull();

      const memberCount = await prisma.teamMember.count({
        where: { teamId: team.id },
      });
      expect(memberCount).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "Team", action: "DELETE" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("admin deletes team with project → 200; project cascade-deleted", async () => {
      const team = await seedTempTeam(adminId);
      const project = await prisma.project.create({
        data: {
          teamId: team.id,
          title: `Cascade Project ${randomUUID().slice(0, 8)}`,
        },
      });

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const deletedProject = await prisma.project.findUnique({
        where: { id: project.id },
      });
      expect(deletedProject).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "Team", action: "DELETE" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();
    });

    it("PM → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}`)
        .set(bearer(pmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Team Member → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}`)
        .set(bearer(tmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });
  });

  // ==========================================================================
  // 6. GET /api/v1/teams/:teamId/members — list
  // ==========================================================================
  describe("GET /api/v1/teams/:teamId/members — list", () => {
    it("member retrieves list → 200; array includes self", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}/members`)
        .set(bearer(tmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const members = res.body.data as TeamMemberDTO[];
      const self = members.find((m) => m.userId === tmId);
      expect(self).toBeDefined();
      expect(self?.teamId).toBe(team.id);
      expect(self?.role).toBe("Member");
      expect(typeof self?.assignedAt).toBe("string");
      expect(self?.user.id).toBe(tmId);
      expect(typeof self?.user.email).toBe("string");
      expect(typeof self?.user.fullName).toBe("string");
      expect(self?.user.globalRole).toBe("Team Member");
      expect("passwordHash" in (self?.user ?? {})).toBe(false);
    });

    it("non-member → 403 AUTHZ_NOT_TEAM_MEMBER", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}/members`)
        .set(bearer(outsiderToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_NOT_TEAM_MEMBER);
    });

    it("admin retrieves any team members → 200", async () => {
      const team = await seedTempTeam(pmId);

      const res = await request(app)
        .get(`/api/v1/teams/${team.id}/members`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const members = res.body.data as TeamMemberDTO[];
      expect(members.some((m) => m.userId === pmId)).toBe(true);
    });
  });

  // ==========================================================================
  // 7. POST /api/v1/teams/:teamId/members — add member
  // ==========================================================================
  describe("POST /api/v1/teams/:teamId/members — add member", () => {
    it("admin adds user → 201; audit row; user in members list", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .post(`/api/v1/teams/${team.id}/members`)
        .set(bearer(adminToken))
        .send({ userId: tmId, role: "Member" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const member = res.body.data as TeamMemberDTO;
      expect(member.teamId).toBe(team.id);
      expect(member.userId).toBe(tmId);
      expect(member.role).toBe("Member");
      expect(typeof member.assignedAt).toBe("string");
      expect(member.user.id).toBe(tmId);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "TeamMember", action: "CREATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();

      const listRes = await request(app)
        .get(`/api/v1/teams/${team.id}/members`)
        .set(bearer(adminToken));
      expect(listRes.status).toBe(200);
      const members = listRes.body.data as TeamMemberDTO[];
      expect(members.some((m) => m.userId === tmId)).toBe(true);
    });

    it("PM adds user → 201", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .post(`/api/v1/teams/${team.id}/members`)
        .set(bearer(pmToken))
        .send({ userId: tmId, role: "Admin-Assigned" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const member = res.body.data as TeamMemberDTO;
      expect(member.userId).toBe(tmId);
      expect(member.role).toBe("Admin-Assigned");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "TeamMember", action: "CREATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(pmId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("Team Member → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .post(`/api/v1/teams/${team.id}/members`)
        .set(bearer(tmToken))
        .send({ userId: outsiderId, role: "Member" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("add inactive user → 422 VALIDATION_ERROR", async () => {
      const team = await seedTempTeam(adminId);
      const inactiveUser = await seedTempUser({ globalRole: "Team Member" });

      try {
        await prisma.user.update({
          where: { id: inactiveUser.id },
          data: { isActive: false },
        });

        const res = await request(app)
          .post(`/api/v1/teams/${team.id}/members`)
          .set(bearer(adminToken))
          .send({ userId: inactiveUser.id, role: "Member" });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      } finally {
        await deleteTempUser(inactiveUser.id);
      }
    });

    it("duplicate member → 409 TEAM_MEMBER_ALREADY_EXISTS", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .post(`/api/v1/teams/${team.id}/members`)
        .set(bearer(adminToken))
        .send({ userId: tmId, role: "Member" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TEAM_MEMBER_ALREADY_EXISTS);
    });

    it("missing userId in body → 422 VALIDATION_ERROR", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .post(`/api/v1/teams/${team.id}/members`)
        .set(bearer(adminToken))
        .send({ role: "Member" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // 8. DELETE /api/v1/teams/:teamId/members/:userId — remove
  // ==========================================================================
  describe("DELETE /api/v1/teams/:teamId/members/:userId — remove", () => {
    it("admin removes member → 200; user gone; audit row", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}/members/${tmId}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const membership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: tmId,
          },
        },
      });
      expect(membership).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "TeamMember", action: "DELETE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("PM removes member → 200", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, tmId, "Member", adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}/members/${tmId}`)
        .set(bearer(pmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const membership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: tmId,
          },
        },
      });
      expect(membership).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: team.id, entityType: "TeamMember", action: "DELETE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(pmId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("Team Member → 403 AUTHZ_FORBIDDEN", async () => {
      const team = await seedTempTeam(adminId);
      await addTeamMember(team.id, outsiderId, "Member", adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}/members/${outsiderId}`)
        .set(bearer(tmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("removing non-member → 404 TEAM_MEMBER_NOT_FOUND", async () => {
      const team = await seedTempTeam(adminId);

      const res = await request(app)
        .delete(`/api/v1/teams/${team.id}/members/${outsiderId}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TEAM_MEMBER_NOT_FOUND);
    });
  });
});
