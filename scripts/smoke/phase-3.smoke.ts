/**
 * @file scripts/smoke/phase-3.smoke.ts
 * @description Phase 3 Operational End-to-End Smoke Test Runner.
 *
 * Verifies live Teams + Projects HTTP APIs, RBAC gates, and Socket.IO/Redis
 * Pub/Sub realtime emission against real PostgreSQL, Redis, bcryptjs, and JWT:
 *   [A] Health probe + Redis Pub/Sub subscriber check (`PUBSUB NUMSUB rt:events`)
 *   [B] Admin login (`admin@fyp.local`)
 *   [C] Create team (`POST /api/v1/teams`) + DB verify `Admin-Assigned`
 *   [D] Add PM (`pm@fyp.local`) as team `Member`
 *   [E] Create project (`POST /api/v1/projects`) + DB verify creator `Manager` (A2)
 *   [F] Admin Socket.IO connect + `subscribe:project` ack
 *   [G] Trigger project title update (`PATCH /api/v1/projects/:projectId`)
 *   [H] Verify `project.updated` realtime event received with matching changes
 *   [I] Add PM as project `Contributor` (`POST /api/v1/projects/:projectId/members`)
 *   [J] Verify `membership.changed` realtime event received
 *   [K] Non-member (`viewer@fyp.local`) project read rejected (`AUTHZ_NOT_PROJECT_MEMBER`)
 *   [L] Last-Manager guard (D6): sole Manager self-demotion rejected (`AUTHZ_FORBIDDEN`)
 *   [M] Archive project (A8): `DELETE /api/v1/projects/:projectId` -> `Archived`
 *   [N] Double-archive rejected (`409 CONFLICT`)
 *
 * Note: A4 (PM denied creating a project in a non-member team) is covered in
 * `tests/api/projects.api.test.ts` rather than this single-team smoke script.
 *
 * Constraints:
 * - No mocks, stubs, or fake infrastructure.
 * - Existing-first boot strategy: probes configured port, falls back to ephemeral boot.
 * - Windows-safe exit: sets `process.exitCode`, never calls `process.exit()`, never quits singletons.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Socket as ClientSocket } from "socket.io-client";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/core/db/prisma.js";
import { createApp } from "../../src/app.js";
import {
  initSocketGateway,
  type AppSocketServer,
} from "../../src/realtime/gateway.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";
import {
  projectRoom,
  REALTIME_EVENTS,
  REDIS_REALTIME_BUS_CHANNEL,
  type MembershipChangedEnvelope,
  type ProjectUpdatedEnvelope,
  type SubscriptionAckResponse,
} from "../../shared/socket.contract.js";
import { redis } from "../../src/infra/redis/client.js";
import {
  connectTestSocket,
  waitForEvent,
} from "../../tests/helpers/socket-test-helpers.js";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface HealthData {
  status: string;
  uptimeSeconds: number;
  timestamp: string;
  components: {
    database: string;
    redis: string;
  };
}

interface LoginData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

interface TeamData {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

interface ProjectData {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  memberCount: number;
}

interface ProjectMemberData {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: string;
}

const TOTAL_STEPS = 14;
const OVERALL_TIMEOUT_MS = 45000;

async function fetchJson<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; body: ApiResponse<T> }> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let serializedBody: string | undefined;

    if (options.body !== undefined) {
      serializedBody = JSON.stringify(options.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: serializedBody,
      signal: controller.signal,
    });

    const body = (await res.json()) as ApiResponse<T>;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function loginUser(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string; globalRole: string }> {
  const res = await fetchJson<LoginData>(`${baseUrl}/auth/login`, {
    method: "POST",
    body: { email, password },
  });

  if (
    res.status !== 200 ||
    !res.body.success ||
    !res.body.data?.accessToken ||
    !res.body.data?.refreshToken ||
    !res.body.data?.user?.id
  ) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }

  return {
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
    userId: res.body.data.user.id,
    globalRole: res.body.data.user.globalRole,
  };
}

async function loginAdmin(
  baseUrl: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const login = await loginUser(baseUrl, "admin@fyp.local", "Admin@1234");
  if (login.globalRole !== "Administrator") {
    throw new Error(
      `Expected admin@fyp.local role Administrator, got ${login.globalRole}`,
    );
  }
  return {
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    userId: login.userId,
  };
}

function emitAck<T>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ack on "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function probeHealth(
  origin: string,
  timeoutMs = 1000,
): Promise<{ status: number; body: ApiResponse<HealthData> }> {
  const healthRes = await fetchJson<HealthData>(`${origin}/health`, {
    method: "GET",
    timeoutMs,
  });
  if (healthRes.status !== 404) {
    return healthRes;
  }
  return fetchJson<HealthData>(`${origin}/api/v1/health`, {
    method: "GET",
    timeoutMs,
  });
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const openSockets: ClientSocket[] = [];
  let bootedServer: http.Server | null = null;
  let bootedIo: AppSocketServer | null = null;
  let overallTimer: NodeJS.Timeout | null = null;

  const defaultPort = Number(env.PORT || 3000);
  let activePort = defaultPort;
  let mode: "existing" | "boot" = "existing";
  let currentStep = "[INIT]";
  let failed = false;

  let teamId: string | null = null;
  let projectId: string | null = null;

  const timeoutGuard = new Promise<never>((_resolve, reject) => {
    overallTimer = setTimeout(() => {
      reject(new Error(`Smoke test exceeded overall timeout of ${OVERALL_TIMEOUT_MS}ms`));
    }, OVERALL_TIMEOUT_MS);
  });

  const runSteps = async (): Promise<void> => {
    // ----------------------------------------------------------------------
    // Boot strategy: existing-first, ephemeral boot fallback
    // ----------------------------------------------------------------------
    try {
      const probe = await probeHealth(`http://127.0.0.1:${defaultPort}`, 1000);
      if (probe.status === 200 && probe.body.data?.status === "healthy") {
        mode = "existing";
        activePort = defaultPort;
      } else {
        mode = "boot";
      }
    } catch {
      mode = "boot";
    }

    if (mode === "boot") {
      const app = createApp();
      bootedServer = http.createServer(app);
      await new Promise<void>((resolve, reject) => {
        bootedServer!.once("error", reject);
        bootedServer!.listen(0, "127.0.0.1", () => resolve());
      });
      bootedIo = await initSocketGateway(bootedServer);
      activePort = (bootedServer.address() as AddressInfo).port;
    }

    console.log(`[INFO] mode=${mode} port=${activePort}`);
    const origin = `http://127.0.0.1:${activePort}`;
    const baseUrl = `${origin}/api/v1`;

    // ----------------------------------------------------------------------
    // [A] Health check + Redis Pub/Sub subscriber check
    // ----------------------------------------------------------------------
    currentStep = "[A]";
    const health = await probeHealth(origin, 5000);
    if (
      health.status !== 200 ||
      !health.body.success ||
      health.body.data?.status !== "healthy" ||
      health.body.data?.components?.database !== "up" ||
      health.body.data?.components?.redis !== "up"
    ) {
      throw new Error(`Health check failed: ${JSON.stringify(health.body)}`);
    }

    const numsubResult = (await redis.pubsub(
      "NUMSUB",
      REDIS_REALTIME_BUS_CHANNEL,
    )) as unknown;
    const subCount =
      Array.isArray(numsubResult) && numsubResult.length >= 2
        ? Number(numsubResult[1])
        : 0;
    if (subCount < 1) {
      throw new Error(
        `Expected >= 1 subscriber on "${REDIS_REALTIME_BUS_CHANNEL}", got ${subCount}`,
      );
    }
    console.log("[PASS] [A] Health + Redis Pub/Sub active");

    // ----------------------------------------------------------------------
    // [B] Admin login
    // ----------------------------------------------------------------------
    currentStep = "[B]";
    const admin = await loginAdmin(baseUrl);
    console.log("[PASS] [B] Admin login (role=Administrator)");

    // ----------------------------------------------------------------------
    // [C] Create team + DB verify Admin-Assigned
    // ----------------------------------------------------------------------
    currentStep = "[C]";
    const teamName = `Smoke Team ${randomUUID().slice(0, 8)}`;
    const createTeamRes = await fetchJson<TeamData>(`${baseUrl}/teams`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      body: { name: teamName, description: "Phase 3 smoke verification team" },
    });
    if (
      createTeamRes.status !== 201 ||
      !createTeamRes.body.success ||
      !createTeamRes.body.data?.id
    ) {
      throw new Error(`Create team failed: ${JSON.stringify(createTeamRes.body)}`);
    }
    teamId = createTeamRes.body.data.id;

    const teamMembership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: admin.userId } },
    });
    if (!teamMembership || teamMembership.role !== "Admin-Assigned") {
      throw new Error(
        `Expected creator team role Admin-Assigned, got ${JSON.stringify(teamMembership)}`,
      );
    }
    console.log("[PASS] [C] Team created + admin auto-enrolled as Admin-Assigned");

    // ----------------------------------------------------------------------
    // [D] Add PM as team member
    // ----------------------------------------------------------------------
    currentStep = "[D]";
    const pmUser = await prisma.user.findUnique({
      where: { email: "pm@fyp.local" },
      select: { id: true },
    });
    if (!pmUser) {
      throw new Error("Seed user pm@fyp.local not found; run npm run prisma:seed first");
    }

    const addTeamMemberRes = await fetchJson(`${baseUrl}/teams/${teamId}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      body: { userId: pmUser.id, role: "Member" },
    });
    if (addTeamMemberRes.status !== 201 || !addTeamMemberRes.body.success) {
      throw new Error(`Add PM to team failed: ${JSON.stringify(addTeamMemberRes.body)}`);
    }
    console.log("[PASS] [D] PM added as team member");

    // ----------------------------------------------------------------------
    // [E] Create project + DB verify creator Manager (A2)
    // ----------------------------------------------------------------------
    currentStep = "[E]";
    const projectTitle = `Smoke Project ${randomUUID().slice(0, 8)}`;
    const createProjectRes = await fetchJson<ProjectData>(`${baseUrl}/projects`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      body: { teamId, title: projectTitle },
    });
    if (
      createProjectRes.status !== 201 ||
      !createProjectRes.body.success ||
      !createProjectRes.body.data?.id
    ) {
      throw new Error(`Create project failed: ${JSON.stringify(createProjectRes.body)}`);
    }
    projectId = createProjectRes.body.data.id;

    const projectMembership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: admin.userId } },
    });
    if (!projectMembership || projectMembership.role !== "Manager") {
      throw new Error(
        `Expected creator project role Manager (A2), got ${JSON.stringify(projectMembership)}`,
      );
    }
    console.log("[PASS] [E] Project created + admin auto-enrolled as Manager (A2)");

    // ----------------------------------------------------------------------
    // [F] Socket connect + subscribe to project room
    // ----------------------------------------------------------------------
    currentStep = "[F]";
    const adminSocket = connectTestSocket(activePort, admin.accessToken);
    openSockets.push(adminSocket);
    await waitForEvent(adminSocket, "connect", undefined, 3000);

    const subAck = await emitAck<SubscriptionAckResponse>(
      adminSocket,
      "subscribe:project",
      { projectId },
    );
    if (!subAck.ok || subAck.room !== projectRoom(projectId)) {
      throw new Error(`subscribe:project failed: ${JSON.stringify(subAck)}`);
    }
    console.log("[PASS] [F] Admin socket subscribed to project room");

    // ----------------------------------------------------------------------
    // [G] Trigger project.updated via PATCH (listener registered first)
    // ----------------------------------------------------------------------
    currentStep = "[G]";
    const updatedTitle = `${projectTitle} (updated)`;
    const projectUpdatedPromise = waitForEvent<ProjectUpdatedEnvelope>(
      adminSocket,
      REALTIME_EVENTS.PROJECT_UPDATED,
      (envelope) => envelope.data?.projectId === projectId,
      3000,
    );

    const patchProjectRes = await fetchJson<ProjectData>(
      `${baseUrl}/projects/${projectId}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        body: { title: updatedTitle },
      },
    );
    if (
      patchProjectRes.status !== 200 ||
      !patchProjectRes.body.success ||
      patchProjectRes.body.data?.title !== updatedTitle
    ) {
      throw new Error(`PATCH project failed: ${JSON.stringify(patchProjectRes.body)}`);
    }
    console.log("[PASS] [G] Project title updated");

    // ----------------------------------------------------------------------
    // [H] Verify project.updated realtime event
    // ----------------------------------------------------------------------
    currentStep = "[H]";
    const projectUpdatedEnv = await projectUpdatedPromise;
    if (
      projectUpdatedEnv.event !== REALTIME_EVENTS.PROJECT_UPDATED ||
      projectUpdatedEnv.data?.projectId !== projectId ||
      projectUpdatedEnv.data?.changes?.title !== updatedTitle
    ) {
      throw new Error(
        `Unexpected project.updated envelope: ${JSON.stringify(projectUpdatedEnv)}`,
      );
    }
    console.log(
      "[PASS] [H] project.updated realtime event received (changes.title matches)",
    );

    // ----------------------------------------------------------------------
    // [I] Add PM as project Contributor (listener registered first)
    // ----------------------------------------------------------------------
    currentStep = "[I]";
    const membershipChangedPromise = waitForEvent<MembershipChangedEnvelope>(
      adminSocket,
      REALTIME_EVENTS.MEMBERSHIP_CHANGED,
      (envelope) => envelope.data?.userId === pmUser.id,
      3000,
    );

    const addProjectMemberRes = await fetchJson<ProjectMemberData>(
      `${baseUrl}/projects/${projectId}/members`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        body: { userId: pmUser.id, role: "Contributor" },
      },
    );
    if (
      addProjectMemberRes.status !== 201 ||
      !addProjectMemberRes.body.success ||
      addProjectMemberRes.body.data?.role !== "Contributor"
    ) {
      throw new Error(
        `Add PM to project failed: ${JSON.stringify(addProjectMemberRes.body)}`,
      );
    }
    console.log("[PASS] [I] PM added as project Contributor");

    // ----------------------------------------------------------------------
    // [J] Verify membership.changed realtime event
    // ----------------------------------------------------------------------
    currentStep = "[J]";
    const membershipEnv = await membershipChangedPromise;
    const validAction =
      membershipEnv.data?.action === "added" ||
      membershipEnv.data?.action === "role_updated";
    if (
      membershipEnv.event !== REALTIME_EVENTS.MEMBERSHIP_CHANGED ||
      membershipEnv.data?.userId !== pmUser.id ||
      membershipEnv.data?.role !== "Contributor" ||
      !validAction
    ) {
      throw new Error(
        `Unexpected membership.changed envelope: ${JSON.stringify(membershipEnv)}`,
      );
    }
    console.log("[PASS] [J] membership.changed realtime event received");

    // ----------------------------------------------------------------------
    // [K] Non-member access denied
    // ----------------------------------------------------------------------
    currentStep = "[K]";
    const viewer = await loginUser(baseUrl, "viewer@fyp.local", "Admin@1234");
    const nonMemberRes = await fetchJson(`${baseUrl}/projects/${projectId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${viewer.accessToken}` },
    });
    if (
      nonMemberRes.status !== 403 ||
      nonMemberRes.body.error?.code !== ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER
    ) {
      throw new Error(
        `Expected 403 AUTHZ_NOT_PROJECT_MEMBER, got ${nonMemberRes.status}: ${JSON.stringify(nonMemberRes.body)}`,
      );
    }
    console.log("[PASS] [K] Non-member rejected with AUTHZ_NOT_PROJECT_MEMBER");

    // ----------------------------------------------------------------------
    // [L] D6 last-Manager guard
    // ----------------------------------------------------------------------
    currentStep = "[L]";
    const lastManagerRes = await fetchJson(
      `${baseUrl}/projects/${projectId}/members/${admin.userId}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        body: { role: "Contributor" },
      },
    );
    const guardMessage = (lastManagerRes.body.error?.message ?? "").toLowerCase();
    if (
      lastManagerRes.status !== 403 ||
      lastManagerRes.body.error?.code !== ERROR_CODES.AUTHZ_FORBIDDEN ||
      (!guardMessage.includes("last") && !guardMessage.includes("manager"))
    ) {
      throw new Error(
        `Expected 403 AUTHZ_FORBIDDEN last-Manager error, got ${lastManagerRes.status}: ${JSON.stringify(lastManagerRes.body)}`,
      );
    }
    console.log("[PASS] [L] Sole Manager cannot demote self (last-Manager guard)");

    // ----------------------------------------------------------------------
    // [M] Archive project (A8)
    // ----------------------------------------------------------------------
    currentStep = "[M]";
    const archiveRes = await fetchJson<ProjectData>(
      `${baseUrl}/projects/${projectId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      },
    );
    if (
      archiveRes.status !== 200 ||
      !archiveRes.body.success ||
      archiveRes.body.data?.status !== "Archived"
    ) {
      throw new Error(`Archive project failed: ${JSON.stringify(archiveRes.body)}`);
    }
    console.log("[PASS] [M] Project archived (status=Archived)");

    // ----------------------------------------------------------------------
    // [N] Double-archive conflict (A8 semantics)
    // ----------------------------------------------------------------------
    currentStep = "[N]";
    const doubleArchiveRes = await fetchJson(`${baseUrl}/projects/${projectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });
    if (
      doubleArchiveRes.status !== 409 ||
      doubleArchiveRes.body.error?.code !== ERROR_CODES.CONFLICT
    ) {
      throw new Error(
        `Expected 409 CONFLICT on double archive, got ${doubleArchiveRes.status}: ${JSON.stringify(doubleArchiveRes.body)}`,
      );
    }
    console.log("[PASS] [N] Double-archive rejected with CONFLICT (A8 semantics)");

    const elapsed = Date.now() - startTime;
    console.log(`[SMOKE] ${TOTAL_STEPS}/${TOTAL_STEPS} passed in ${elapsed}ms`);
    console.log("[SMOKE] PHASE 3 OK ✓");
  };

  try {
    await Promise.race([runSteps(), timeoutGuard]);
  } catch (err: unknown) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${currentStep} ${message}`);
    console.error(`[SMOKE] aborted at step ${currentStep}`);
  } finally {
    if (overallTimer) {
      clearTimeout(overallTimer);
    }

    try {
      for (const s of openSockets) {
        if (s.connected) {
          s.disconnect();
        }
      }
      if (projectId) {
        await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
      }
      if (teamId) {
        await prisma.team.delete({ where: { id: teamId } }).catch(() => {});
      }
      if (projectId || teamId) {
        console.log("[SMOKE] Cleanup: deleted test project + team");
      }
      if (bootedIo) {
        await new Promise<void>((r) => bootedIo!.close(() => r()));
      }
      if (bootedServer) {
        await new Promise<void>((r) => bootedServer!.close(() => r()));
      }
    } catch {
      // Best-effort teardown
    }

    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] ${message}`);
  process.exitCode = 1;
});
