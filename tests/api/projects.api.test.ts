/**
 * @file tests/api/projects.api.test.ts
 * @description HTTP API integration tests for the Projects module (Chunk 3D).
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
  seedTempProject,
  addProjectMember,
  cleanupProjects,
} from "../helpers/team-project-helpers.js";

/**
 * Public Project representation returned by the Projects API (verbatim from projects.service.ts).
 */
interface ProjectDTO {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  deadline: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public ProjectMember representation returned by the Projects API (verbatim from projects.service.ts).
 */
interface ProjectMemberDTO {
  projectId: string;
  userId: string;
  role: "Manager" | "Contributor" | "Viewer";
  joinedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

/**
 * Project progress metrics representation (verbatim from projects.service.ts).
 */
interface ProjectProgressDTO {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionPercentage: number;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Projects API — integration (Chunk 3D)", () => {
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

  // Shared fixtures seeded in beforeAll
  let mainTeamId: string;
  let otherTeamId: string;
  let mainProjectId: string;

  // Track API-created entities for teardown
  const apiCreatedProjectIds: string[] = [];
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

    // mainTeam: admin is Admin-Assigned; PM, TM, Viewer are Members
    const mainTeam = await seedTempTeam(adminId);
    mainTeamId = mainTeam.id;
    await addTeamMember(mainTeamId, pmId, "Member", adminId);
    await addTeamMember(mainTeamId, tmId, "Member", adminId);
    await addTeamMember(mainTeamId, viewerId, "Member", adminId);

    // otherTeam: admin is Admin-Assigned; PM is NOT a member (for A4 test)
    const otherTeam = await seedTempTeam(adminId);
    otherTeamId = otherTeam.id;

    // mainProject: admin is Manager, tm is Contributor, viewer is Viewer; outsider is NOT a member
    const mainProject = await seedTempProject(mainTeamId, adminId);
    mainProjectId = mainProject.id;
    await addProjectMember(mainProjectId, tmId, "Contributor");
    await addProjectMember(mainProjectId, viewerId, "Viewer");
  }, 60000);

  afterAll(async () => {
    for (const id of [...apiCreatedProjectIds].reverse()) {
      try {
        await prisma.project.delete({ where: { id } });
      } catch {
        // Already deleted — ok
      }
    }
    apiCreatedProjectIds.length = 0;

    for (const id of [...apiCreatedTeamIds].reverse()) {
      try {
        await prisma.team.delete({ where: { id } });
      } catch {
        // Already deleted — ok
      }
    }
    apiCreatedTeamIds.length = 0;

    await cleanupProjects();
    await cleanupTeams();

    await deleteTempUser(adminId);
    await deleteTempUser(pmId);
    await deleteTempUser(tmId);
    await deleteTempUser(viewerId);
    await deleteTempUser(outsiderId);
  }, 30000);

  // Cycle regression
  it("projects barrel imports cleanly after full app bootstrap", async () => {
    const mod = await import("../../src/modules/projects/index.js");
    expect(mod.projectsService).toBeDefined();
    expect(mod.projectsRouter).toBeDefined();
    expect(mod.projectsController).toBeDefined();
    expect(mod.projectsRepository).toBeDefined();
  });

  // ==========================================================================
  // 1. POST /api/v1/projects — create
  // ==========================================================================
  describe("POST /api/v1/projects — create", () => {
    it("admin creates project in any team → 201; creator enrolled as Manager (A2); two audit rows", async () => {
      const title = `Admin Project ${randomUUID().slice(0, 8)}`;
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(adminToken))
        .send({
          teamId: mainTeamId,
          title,
          description: "Platform delivery initiative",
          priority: "HIGH",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      if (data.id) {
        apiCreatedProjectIds.push(data.id);
      }

      expect(data.title).toBe(title);
      expect(data.teamId).toBe(mainTeamId);
      expect(data.description).toBe("Platform delivery initiative");
      expect(data.status).toBe("Active");
      expect(data.priority).toBe("HIGH");
      expect(data.memberCount).toBe(1);
      expect(typeof data.createdAt).toBe("string");
      expect(typeof data.updatedAt).toBe("string");

      const membership = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: data.id, userId: adminId },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("Manager");

      const auditCount = await prisma.auditLog.count({
        where: { entityId: data.id },
      });
      expect(auditCount).toBe(2);

      const projectAudit = await prisma.auditLog.findFirst({
        where: { entityId: data.id, entityType: "Project", action: "CREATE" },
      });
      expect(projectAudit).not.toBeNull();
      expect(projectAudit?.correlationId).toBeTruthy();

      const memberAudit = await prisma.auditLog.findFirst({
        where: {
          entityId: data.id,
          entityType: "ProjectMember",
          action: "CREATE",
        },
      });
      expect(memberAudit).not.toBeNull();
      expect(memberAudit?.correlationId).toBeTruthy();
    });

    it("PM creates project in team PM belongs to → 201 (A4 satisfied)", async () => {
      const title = `PM Project ${randomUUID().slice(0, 8)}`;
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(pmToken))
        .send({ teamId: mainTeamId, title });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      if (data.id) {
        apiCreatedProjectIds.push(data.id);
      }

      expect(data.title).toBe(title);
      expect(data.teamId).toBe(mainTeamId);
      expect(data.status).toBe("Active");
      expect(data.priority).toBe("MEDIUM");

      const membership = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: data.id, userId: pmId },
        },
      });
      expect(membership?.role).toBe("Manager");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: data.id, entityType: "Project", action: "CREATE" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(pmId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("PM tries to create project in team PM does NOT belong to → 403 AUTHZ_FORBIDDEN with message about team membership", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(pmToken))
        .send({
          teamId: otherTeamId,
          title: `Blocked PM Project ${randomUUID().slice(0, 8)}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
      expect((res.body.error.message as string).toLowerCase()).toMatch(
        /team|member/,
      );
    });

    it("Team Member → 403 AUTHZ_FORBIDDEN (route gate)", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(tmToken))
        .send({
          teamId: mainTeamId,
          title: `TM Blocked ${randomUUID().slice(0, 8)}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Viewer → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(viewerToken))
        .send({
          teamId: mainTeamId,
          title: `Viewer Blocked ${randomUUID().slice(0, 8)}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("missing title → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(adminToken))
        .send({ teamId: mainTeamId });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("nonexistent teamId → 404 TEAM_NOT_FOUND", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(adminToken))
        .send({
          teamId: randomUUID(),
          title: `Orphan Project ${randomUUID().slice(0, 8)}`,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.TEAM_NOT_FOUND);
    });

    it("invalid priority 'URGENT' → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(adminToken))
        .send({
          teamId: mainTeamId,
          title: `Bad Priority ${randomUUID().slice(0, 8)}`,
          priority: "URGENT",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // 2. GET /api/v1/projects — list
  // ==========================================================================
  describe("GET /api/v1/projects — list", () => {
    it("admin sees all projects", async () => {
      const p1 = await seedTempProject(mainTeamId, adminId);
      const p2 = await seedTempProject(mainTeamId, adminId);
      const p3 = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .get("/api/v1/projects?limit=100")
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const rows = res.body.data as ProjectDTO[];
      const titles = rows.map((p) => p.title);
      expect(titles).toContain(p1.title);
      expect(titles).toContain(p2.title);
      expect(titles).toContain(p3.title);
    });

    it("PM sees only member projects", async () => {
      const visible = await seedTempProject(mainTeamId, pmId);
      const hidden = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .get("/api/v1/projects?limit=100")
        .set(bearer(pmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as ProjectDTO[]).map((p) => p.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
    });

    it("Team Member sees only member projects", async () => {
      const visible = await seedTempProject(mainTeamId, adminId);
      await addProjectMember(visible.id, tmId, "Contributor");
      const hidden = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .get("/api/v1/projects?limit=100")
        .set(bearer(tmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const ids = (res.body.data as ProjectDTO[]).map((p) => p.id);
      expect(ids).toContain(mainProjectId);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
    });

    it("filter by teamId works", async () => {
      const inMain = await seedTempProject(mainTeamId, adminId);
      const inOther = await seedTempProject(otherTeamId, adminId);

      const res = await request(app)
        .get(`/api/v1/projects?teamId=${mainTeamId}&limit=100`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const rows = res.body.data as ProjectDTO[];
      expect(rows.every((p) => p.teamId === mainTeamId)).toBe(true);
      const ids = rows.map((p) => p.id);
      expect(ids).toContain(inMain.id);
      expect(ids).not.toContain(inOther.id);
    });

    it("pagination (page=1, limit=1) → data.length===1, meta.total>=1", async () => {
      const res = await request(app)
        .get("/api/v1/projects?page=1&limit=1")
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO[];
      const meta = res.body.meta as PaginationMeta;
      expect(data.length).toBe(1);
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(1);
      expect(meta.total).toBeGreaterThanOrEqual(1);
      expect(meta.totalPages).toBe(meta.total);
    });
  });

  // ==========================================================================
  // 3. GET /api/v1/projects/:projectId — get one
  // ==========================================================================
  describe("GET /api/v1/projects/:projectId — get one", () => {
    it("member retrieves project → 200; DTO includes all 7 mutable fields + memberCount + id/teamId/title/createdAt/updatedAt", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(tmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      expect(data.id).toBe(mainProjectId);
      expect(data.teamId).toBe(mainTeamId);
      expect(typeof data.title).toBe("string");
      expect(data.description === null || typeof data.description === "string").toBe(true);
      expect(typeof data.status).toBe("string");
      expect(typeof data.priority).toBe("string");
      expect(data.startDate === null || typeof data.startDate === "string").toBe(true);
      expect(data.endDate === null || typeof data.endDate === "string").toBe(true);
      expect(data.deadline === null || typeof data.deadline === "string").toBe(true);
      expect(typeof data.memberCount).toBe("number");
      expect(data.memberCount).toBeGreaterThanOrEqual(3);
      expect(typeof data.createdAt).toBe("string");
      expect(typeof data.updatedAt).toBe("string");
    });

    it("non-member → 403 AUTHZ_NOT_PROJECT_MEMBER", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(outsiderToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER);
    });

    it("admin retrieves any project → 200 (bypass)", async () => {
      const pmOwned = await seedTempProject(mainTeamId, pmId);

      const res = await request(app)
        .get(`/api/v1/projects/${pmOwned.id}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as ProjectDTO).id).toBe(pmOwned.id);
    });

    it("invalid UUID → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .get("/api/v1/projects/not-a-valid-uuid")
        .set(bearer(adminToken));

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("nonexistent UUID → 404 PROJECT_NOT_FOUND", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${randomUUID()}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.PROJECT_NOT_FOUND);
    });
  });

  // ==========================================================================
  // 4. PATCH /api/v1/projects/:projectId — update
  // ==========================================================================
  describe("PATCH /api/v1/projects/:projectId — update", () => {
    it("Manager updates title → 200; audit row with oldValues/newValues", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      const nextTitle = `Updated Title ${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken))
        .send({ title: nextTitle });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      expect(data.id).toBe(project.id);
      expect(data.title).toBe(nextTitle);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: project.id, entityType: "Project", action: "UPDATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();

      const oldVals = audit?.oldValues as Record<string, unknown> | null;
      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(oldVals?.title).toBe(project.title);
      expect(newVals?.title).toBe(nextTitle);
    });

    it("Manager updates multiple fields → 200; diff captures all changes", async () => {
      const project = await seedTempProject(mainTeamId, pmId);
      const nextTitle = `Multi Updated ${randomUUID().slice(0, 8)}`;
      const deadlineIso = "2027-06-15T12:00:00.000Z";

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(bearer(pmToken))
        .send({
          title: nextTitle,
          priority: "CRITICAL",
          deadline: deadlineIso,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      expect(data.title).toBe(nextTitle);
      expect(data.priority).toBe("CRITICAL");
      expect(data.deadline).toBe(deadlineIso);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: project.id, entityType: "Project", action: "UPDATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();

      const oldVals = audit?.oldValues as Record<string, unknown> | null;
      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(oldVals?.title).toBe(project.title);
      expect(oldVals?.priority).toBe("MEDIUM");
      expect(oldVals?.deadline).toBeNull();
      expect(newVals?.title).toBe(nextTitle);
      expect(newVals?.priority).toBe("CRITICAL");
      expect(newVals?.deadline).toBe(deadlineIso);
    });

    it("Contributor → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .patch(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(tmToken))
        .send({ title: "Contributor Blocked" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("Viewer → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .patch(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(viewerToken))
        .send({ title: "Viewer Blocked" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("admin updates any project → 200", async () => {
      const pmOwned = await seedTempProject(mainTeamId, pmId);
      const renamed = `Admin Override ${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .patch(`/api/v1/projects/${pmOwned.id}`)
        .set(bearer(adminToken))
        .send({ title: renamed, status: "OnHold" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      expect(data.title).toBe(renamed);
      expect(data.status).toBe("OnHold");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: pmOwned.id, entityType: "Project", action: "UPDATE" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("no-op update (same values) → 200; NO new audit row", async () => {
      const project = await seedTempProject(mainTeamId, adminId, {
        priority: "MEDIUM",
      });

      const beforeCount = await prisma.auditLog.count({
        where: { entityId: project.id, entityType: "Project", action: "UPDATE" },
      });

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken))
        .send({ title: project.title, priority: "MEDIUM" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as ProjectDTO).title).toBe(project.title);

      const afterCount = await prisma.auditLog.count({
        where: { entityId: project.id, entityType: "Project", action: "UPDATE" },
      });
      expect(afterCount).toBe(beforeCount);
    });

    it("invalid status 'Done' → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .patch(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(adminToken))
        .send({ status: "Done" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // 5. DELETE /api/v1/projects/:projectId — archive (A8)
  // ==========================================================================
  describe("DELETE /api/v1/projects/:projectId — archive (A8)", () => {
    it("Manager archives project → 200; status becomes 'Archived'; audit row", async () => {
      const project = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .delete(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectDTO;
      expect(data.id).toBe(project.id);
      expect(data.status).toBe("Archived");

      const row = await prisma.project.findUnique({ where: { id: project.id } });
      expect(row).not.toBeNull();
      expect(row?.status).toBe("Archived");

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: project.id, entityType: "Project", action: "UPDATE" },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();

      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(newVals?.status).toBe("Archived");
    });

    it("already-archived project → 409 CONFLICT", async () => {
      const project = await seedTempProject(mainTeamId, adminId);

      const first = await request(app)
        .delete(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken));
      expect(first.status).toBe(200);

      const second = await request(app)
        .delete(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken));

      expect(second.status).toBe(409);
      expect(second.body.success).toBe(false);
      expect(second.body.error.code).toBe(ERROR_CODES.CONFLICT);
      expect((second.body.error.message as string).toLowerCase()).toContain(
        "already archived",
      );
    });

    it("Contributor tries to archive → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .delete(`/api/v1/projects/${mainProjectId}`)
        .set(bearer(tmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });
  });

  // ==========================================================================
  // 6. POST /api/v1/projects/:projectId/members — add
  // ==========================================================================
  describe("POST /api/v1/projects/:projectId/members — add", () => {
    it("Manager adds user with role 'Contributor' (including non-team-member A5) → 201; audit row", async () => {
      const project = await seedTempProject(mainTeamId, adminId);

      // outsiderId does NOT belong to mainTeamId — verifies A5 permission
      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/members`)
        .set(bearer(adminToken))
        .send({ userId: outsiderId, role: "Contributor" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const member = res.body.data as ProjectMemberDTO;
      expect(member.projectId).toBe(project.id);
      expect(member.userId).toBe(outsiderId);
      expect(member.role).toBe("Contributor");
      expect(typeof member.joinedAt).toBe("string");
      expect(member.user.id).toBe(outsiderId);
      expect("passwordHash" in member.user).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "ProjectMember",
          action: "CREATE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("Manager adds user with role 'Viewer' → 201", async () => {
      const project = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/members`)
        .set(bearer(adminToken))
        .send({ userId: viewerId, role: "Viewer" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const member = res.body.data as ProjectMemberDTO;
      expect(member.userId).toBe(viewerId);
      expect(member.role).toBe("Viewer");

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "ProjectMember",
          action: "CREATE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();
    });

    it("Contributor tries → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${mainProjectId}/members`)
        .set(bearer(tmToken))
        .send({ userId: outsiderId, role: "Contributor" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("duplicate member → 409 PROJECT_MEMBER_ALREADY_EXISTS", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      await addProjectMember(project.id, outsiderId, "Contributor");

      const res = await request(app)
        .post(`/api/v1/projects/${project.id}/members`)
        .set(bearer(adminToken))
        .send({ userId: outsiderId, role: "Contributor" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.PROJECT_MEMBER_ALREADY_EXISTS);
    });

    it("add inactive user → 422 VALIDATION_ERROR", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      const inactiveUser = await seedTempUser({ globalRole: "Team Member" });

      try {
        await prisma.user.update({
          where: { id: inactiveUser.id },
          data: { isActive: false },
        });

        const res = await request(app)
          .post(`/api/v1/projects/${project.id}/members`)
          .set(bearer(adminToken))
          .send({ userId: inactiveUser.id, role: "Contributor" });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      } finally {
        await deleteTempUser(inactiveUser.id);
      }
    });

    it("invalid body (missing userId) → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${mainProjectId}/members`)
        .set(bearer(adminToken))
        .send({ role: "Contributor" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // 7. PATCH /api/v1/projects/:projectId/members/:userId — role change
  // ==========================================================================
  describe("PATCH /api/v1/projects/:projectId/members/:userId — role change", () => {
    it("Manager promotes Contributor to Manager → 200; audit old/new role", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      await addProjectMember(project.id, tmId, "Contributor");

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}/members/${tmId}`)
        .set(bearer(adminToken))
        .send({ role: "Manager" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const member = res.body.data as ProjectMemberDTO;
      expect(member.userId).toBe(tmId);
      expect(member.role).toBe("Manager");

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "ProjectMember",
          action: "UPDATE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();

      const oldVals = audit?.oldValues as Record<string, unknown> | null;
      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(oldVals?.role).toBe("Contributor");
      expect(newVals?.role).toBe("Manager");
    });

    it("Manager demotes Contributor to Viewer → 200", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      await addProjectMember(project.id, tmId, "Contributor");

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}/members/${tmId}`)
        .set(bearer(adminToken))
        .send({ role: "Viewer" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as ProjectMemberDTO).role).toBe("Viewer");

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "ProjectMember",
          action: "UPDATE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();
    });

    it("last-Manager guard (D6): sole Manager tries to demote self → 403 AUTHZ_FORBIDDEN with message about last Manager", async () => {
      const project = await seedTempProject(mainTeamId, pmId);

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}/members/${pmId}`)
        .set(bearer(pmToken))
        .send({ role: "Contributor" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
      expect((res.body.error.message as string).toLowerCase()).toMatch(
        /last.*manager|manager/,
      );
    });

    it("Contributor tries to change another's role → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .patch(`/api/v1/projects/${mainProjectId}/members/${viewerId}`)
        .set(bearer(tmToken))
        .send({ role: "Manager" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });

    it("invalid role 'Owner' → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .patch(`/api/v1/projects/${mainProjectId}/members/${tmId}`)
        .set(bearer(adminToken))
        .send({ role: "Owner" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // 8. DELETE /api/v1/projects/:projectId/members/:userId — remove
  // ==========================================================================
  describe("DELETE /api/v1/projects/:projectId/members/:userId — remove", () => {
    it("Manager removes Contributor → 200; audit row", async () => {
      const project = await seedTempProject(mainTeamId, adminId);
      await addProjectMember(project.id, tmId, "Contributor");

      const res = await request(app)
        .delete(`/api/v1/projects/${project.id}/members/${tmId}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();

      const removed = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: project.id, userId: tmId },
        },
      });
      expect(removed).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "ProjectMember",
          action: "DELETE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminId);
      expect(audit?.correlationId).toBeTruthy();
    });

    it("last-Manager guard (D6): removing the only Manager → 403 AUTHZ_FORBIDDEN", async () => {
      const project = await seedTempProject(mainTeamId, pmId);

      const res = await request(app)
        .delete(`/api/v1/projects/${project.id}/members/${pmId}`)
        .set(bearer(pmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
      expect((res.body.error.message as string).toLowerCase()).toMatch(
        /last.*manager|manager/,
      );
    });

    it("removing non-member → 404 PROJECT_MEMBER_NOT_FOUND", async () => {
      const res = await request(app)
        .delete(`/api/v1/projects/${mainProjectId}/members/${outsiderId}`)
        .set(bearer(adminToken));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.PROJECT_MEMBER_NOT_FOUND);
    });

    it("Contributor tries to remove → 403 AUTHZ_FORBIDDEN", async () => {
      const res = await request(app)
        .delete(`/api/v1/projects/${mainProjectId}/members/${viewerId}`)
        .set(bearer(tmToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_FORBIDDEN);
    });
  });

  // ==========================================================================
  // 9. GET /api/v1/projects/:projectId/progress
  // ==========================================================================
  describe("GET /api/v1/projects/:projectId/progress", () => {
    it("empty project returns zeros", async () => {
      const project = await seedTempProject(mainTeamId, adminId);

      const res = await request(app)
        .get(`/api/v1/projects/${project.id}/progress`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectProgressDTO;
      expect(data.projectId).toBe(project.id);
      expect(data.totalTasks).toBe(0);
      expect(data.completedTasks).toBe(0);
      expect(data.overdueTasks).toBe(0);
      expect(data.completionPercentage).toBe(0);
    });

    it("member (Contributor) can retrieve progress → 200", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${mainProjectId}/progress`)
        .set(bearer(tmToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data as ProjectProgressDTO;
      expect(data.projectId).toBe(mainProjectId);
      expect(typeof data.totalTasks).toBe("number");
      expect(typeof data.completedTasks).toBe("number");
      expect(typeof data.overdueTasks).toBe("number");
      expect(typeof data.completionPercentage).toBe("number");
    });

    it("non-member → 403 AUTHZ_NOT_PROJECT_MEMBER", async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${mainProjectId}/progress`)
        .set(bearer(outsiderToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER);
    });

    it("admin retrieves any → 200 (bypass)", async () => {
      const pmOwned = await seedTempProject(mainTeamId, pmId);

      const res = await request(app)
        .get(`/api/v1/projects/${pmOwned.id}/progress`)
        .set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as ProjectProgressDTO).projectId).toBe(pmOwned.id);
    });
  });

  // ==========================================================================
  // 10. Audit + regression verification
  // ==========================================================================
  describe("Audit + regression verification", () => {
    it("project CRUD writes audit rows with correlationId present", async () => {
      const title = `Audit Corr ${randomUUID().slice(0, 8)}`;
      const res = await request(app)
        .post("/api/v1/projects")
        .set(bearer(adminToken))
        .send({ teamId: mainTeamId, title });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const created = res.body.data as ProjectDTO;
      if (created.id) {
        apiCreatedProjectIds.push(created.id);
      }

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: created.id,
          entityType: "Project",
          action: "CREATE",
        },
      });
      expect(audit).not.toBeNull();
      expect(typeof audit?.correlationId).toBe("string");
      expect(audit?.correlationId).toMatch(UUID_REGEX);
    });

    it("PATCH /projects/:id audit captures before/after diff", async () => {
      const project = await seedTempProject(mainTeamId, adminId, { title: "A" });

      const res = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(bearer(adminToken))
        .send({ title: "B" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body.data as ProjectDTO).title).toBe("B");

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: project.id,
          entityType: "Project",
          action: "UPDATE",
        },
        orderBy: { timestamp: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.correlationId).toBeTruthy();

      const oldVals = audit?.oldValues as Record<string, unknown> | null;
      const newVals = audit?.newValues as Record<string, unknown> | null;
      expect(oldVals).not.toBeNull();
      expect(newVals).not.toBeNull();
      expect(oldVals?.title).toBe("A");
      expect(newVals?.title).toBe("B");
    });

    it("requireProjectManager middleware imports cleanly alongside projects module", async () => {
      const middlewareMod = await import(
        "../../src/core/middleware/requireProjectManager.js"
      );
      expect(typeof middlewareMod.requireProjectManager).toBe("function");
    });
  });
});
