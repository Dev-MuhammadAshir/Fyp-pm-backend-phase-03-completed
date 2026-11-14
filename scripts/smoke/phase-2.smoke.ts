/**
 * @file scripts/smoke/phase-2.smoke.ts
 * @description Phase 2 Operational End-to-End Smoke Test Runner.
 *
 * Verifies live authentication and user administration infrastructure:
 * [A] HTTP health probe (GET /api/v1/health -> healthy, database up, redis up)
 * [B] Admin login (POST /api/v1/auth/login -> 200, tokens, role=Administrator)
 * [C] Admin profile verification (GET /api/v1/auth/me -> 200, no passwordHash)
 * [D] Refresh rotation & old session revocation (POST /api/v1/auth/refresh -> 200, replay -> 401)
 * [E] Admin user creation (POST /api/v1/users -> 201)
 * [F] Created user authentication (POST /api/v1/auth/login -> 200)
 * [G] User directory listing (GET /api/v1/users?page=1&limit=100 -> 200)
 * [H] Role modification & session revocation (PATCH /api/v1/users/:id/role -> 200, replay -> 401)
 * [I] User deactivation & login blocking (PATCH /api/v1/users/:id/status -> 200, login -> 403)
 * [J] User reactivation & login restoration (PATCH /api/v1/users/:id/status -> 200, login -> 200)
 * [K] Admin logout & access token blacklisting (POST /api/v1/auth/logout -> 200, me -> 401)
 * [L] Teardown & cleanup (soft-delete test user, close ephemeral server if booted)
 *
 * Constraints:
 * - Standalone CLI execution with plain-text status output.
 * - Probes default port; boots ephemeral server if not currently running.
 * - Native fetch with AbortController 5s per-step timeout.
 * - Clean exit: no process.exit(), no redis.quit(), no prisma.$disconnect().
 */

import http from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/core/db/prisma.js";
import { createApp } from "../../src/app.js";
import { initSocketGateway, AppSocketServer } from "../../src/realtime/gateway.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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
    configuredCapacityHours: number;
    isActive: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    passwordHash?: string;
  };
}

interface RefreshData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface UserData {
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

/**
 * Executes an HTTP fetch request with a hard timeout cap.
 */
async function requestWithTimeout<T = unknown>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000,
): Promise<{ status: number; body: ApiResponse<T> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const json = (await res.json()) as ApiResponse<T>;
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  let bootedServer: http.Server | null = null;
  let bootedIo: AppSocketServer | null = null;

  const defaultPort = Number(env.PORT || 3000);
  let activePort = defaultPort;
  let mode: "existing" | "boot" = "existing";
  let currentStep = "INIT";

  let testUserId: string | null = null;

  try {
    // ------------------------------------------------------------------------
    // Step 0: Probe active server or fallback to boot
    // ------------------------------------------------------------------------
    try {
      const probeRes = await requestWithTimeout<HealthData>(
        `http://127.0.0.1:${defaultPort}/api/v1/health`,
        { method: "GET" },
        1000,
      );

      if (probeRes.status === 200 && probeRes.body?.data?.status === "healthy") {
        mode = "existing";
        activePort = defaultPort;
      } else {
        throw new Error("Existing server returned non-healthy response");
      }
    } catch {
      mode = "boot";
      const app = createApp();
      bootedServer = http.createServer(app);
      bootedIo = initSocketGateway(bootedServer);

      await new Promise<void>((resolve, reject) => {
        bootedServer!.listen(0, "127.0.0.1", () => resolve());
        bootedServer!.on("error", reject);
      });

      const address = bootedServer.address() as AddressInfo;
      activePort = address.port;
    }

    console.log(`[INFO] mode=${mode} port=${activePort}`);
    const baseUrl = `http://127.0.0.1:${activePort}/api/v1`;

    // ------------------------------------------------------------------------
    // [A] Health check
    // ------------------------------------------------------------------------
    currentStep = "[A] Health check";
    const health = await requestWithTimeout<HealthData>(`${baseUrl}/health`);
    if (
      health.status !== 200 ||
      health.body.data?.status !== "healthy" ||
      health.body.data?.components?.database !== "up" ||
      health.body.data?.components?.redis !== "up"
    ) {
      throw new Error(`Health check failed: ${JSON.stringify(health.body)}`);
    }
    console.log("[PASS] [A] Health check (database up, redis up)");

    // ------------------------------------------------------------------------
    // [B] Admin login
    // ------------------------------------------------------------------------
    currentStep = "[B] Admin login";
    const adminLoginRes = await requestWithTimeout<LoginData>(
      `${baseUrl}/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@fyp.local",
          password: "Admin@1234",
        }),
      },
    );

    if (
      adminLoginRes.status !== 200 ||
      !adminLoginRes.body.success ||
      !adminLoginRes.body.data?.accessToken ||
      !adminLoginRes.body.data?.refreshToken ||
      adminLoginRes.body.data?.expiresIn !== 900 ||
      adminLoginRes.body.data?.user?.globalRole !== "Administrator"
    ) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.body)}`);
    }

    let adminAccessToken = adminLoginRes.body.data.accessToken;
    let adminRefreshToken = adminLoginRes.body.data.refreshToken;
    console.log("[PASS] [B] Admin login (role=Administrator, expiresIn=900)");

    // ------------------------------------------------------------------------
    // [C] GET /auth/me
    // ------------------------------------------------------------------------
    currentStep = "[C] Admin profile";
    const meRes = await requestWithTimeout<UserData>(`${baseUrl}/auth/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccessToken}` },
    });

    if (
      meRes.status !== 200 ||
      !meRes.body.success ||
      meRes.body.data?.email !== "admin@fyp.local" ||
      "passwordHash" in (meRes.body.data as Record<string, unknown>)
    ) {
      throw new Error(`Admin profile check failed: ${JSON.stringify(meRes.body)}`);
    }
    console.log("[PASS] [C] Admin profile verified (no passwordHash leakage)");

    // ------------------------------------------------------------------------
    // [D] Refresh rotation
    // ------------------------------------------------------------------------
    currentStep = "[D] Refresh rotation";
    const refreshRes = await requestWithTimeout<RefreshData>(
      `${baseUrl}/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: adminRefreshToken }),
      },
    );

    if (
      refreshRes.status !== 200 ||
      !refreshRes.body.success ||
      !refreshRes.body.data?.accessToken ||
      !refreshRes.body.data?.refreshToken ||
      refreshRes.body.data.accessToken === adminAccessToken
    ) {
      throw new Error(
        `Token refresh rotation failed: ${JSON.stringify(refreshRes.body)}`,
      );
    }

    const previousRefreshToken = adminRefreshToken;
    adminAccessToken = refreshRes.body.data.accessToken;
    adminRefreshToken = refreshRes.body.data.refreshToken;

    // Verify old refresh token is revoked
    const replayRes = await requestWithTimeout(
      `${baseUrl}/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: previousRefreshToken }),
      },
    );

    if (
      replayRes.status !== 401 ||
      replayRes.body.error?.code !== ERROR_CODES.REFRESH_TOKEN_REVOKED
    ) {
      throw new Error(
        `Old refresh token replay was not rejected: ${JSON.stringify(replayRes.body)}`,
      );
    }
    console.log("[PASS] [D] Token rotation & old refresh session revocation");

    // ------------------------------------------------------------------------
    // [E] Create test user
    // ------------------------------------------------------------------------
    currentStep = "[E] Create test user";
    const testEmail = `smoke-${randomUUID()}@fyp.local`;
    const testPassword = "Smoke@1234";

    const createUserRes = await requestWithTimeout<UserData>(
      `${baseUrl}/users`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAccessToken}`,
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          fullName: "Smoke Test User",
          globalRole: "Team Member",
          configuredCapacityHours: 40,
        }),
      },
    );

    if (
      createUserRes.status !== 201 ||
      !createUserRes.body.success ||
      !createUserRes.body.data?.id
    ) {
      throw new Error(
        `Test user creation failed: ${JSON.stringify(createUserRes.body)}`,
      );
    }

    testUserId = createUserRes.body.data.id;
    console.log(`[PASS] [E] Admin created test user (${testEmail})`);

    // ------------------------------------------------------------------------
    // [F] New user login
    // ------------------------------------------------------------------------
    currentStep = "[F] New user login";
    const userLoginRes = await requestWithTimeout<LoginData>(
      `${baseUrl}/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      },
    );

    if (
      userLoginRes.status !== 200 ||
      !userLoginRes.body.success ||
      !userLoginRes.body.data?.accessToken ||
      !userLoginRes.body.data?.refreshToken
    ) {
      throw new Error(
        `New user login failed: ${JSON.stringify(userLoginRes.body)}`,
      );
    }

    let testUserRefreshToken = userLoginRes.body.data.refreshToken;
    console.log("[PASS] [F] Test user authenticated successfully");

    // ------------------------------------------------------------------------
    // [G] List users (admin)
    // ------------------------------------------------------------------------
    currentStep = "[G] List users (admin)";
    const listRes = await requestWithTimeout<UserData[]>(
      `${baseUrl}/users?page=1&limit=100`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${adminAccessToken}` },
      },
    );

    if (
      listRes.status !== 200 ||
      !listRes.body.success ||
      listRes.body.meta?.page !== 1 ||
      listRes.body.meta?.limit !== 100 ||
      !Array.isArray(listRes.body.data) ||
      !listRes.body.data.some((u) => u.id === testUserId)
    ) {
      throw new Error(`List users failed: ${JSON.stringify(listRes.body)}`);
    }
    console.log("[PASS] [G] Admin listed users (test user found in directory)");

    // ------------------------------------------------------------------------
    // [H] Change role -> revoke sessions
    // ------------------------------------------------------------------------
    currentStep = "[H] Change role & revoke sessions";
    const updateRoleRes = await requestWithTimeout<UserData>(
      `${baseUrl}/users/${testUserId}/role`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAccessToken}`,
        },
        body: JSON.stringify({ globalRole: "Project Manager" }),
      },
    );

    if (
      updateRoleRes.status !== 200 ||
      !updateRoleRes.body.success ||
      updateRoleRes.body.data?.globalRole !== "Project Manager"
    ) {
      throw new Error(
        `Role update failed: ${JSON.stringify(updateRoleRes.body)}`,
      );
    }

    // Verify test user's old refresh token is revoked
    const userReplayRes = await requestWithTimeout(
      `${baseUrl}/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: testUserRefreshToken }),
      },
    );

    if (
      userReplayRes.status !== 401 ||
      userReplayRes.body.error?.code !== ERROR_CODES.REFRESH_TOKEN_REVOKED
    ) {
      throw new Error(
        `User session revocation on role change failed: ${JSON.stringify(userReplayRes.body)}`,
      );
    }
    console.log("[PASS] [H] Role updated to Project Manager & active sessions revoked");

    // ------------------------------------------------------------------------
    // [I] Deactivate -> login blocked
    // ------------------------------------------------------------------------
    currentStep = "[I] Deactivate & login blocked";
    const deactivateRes = await requestWithTimeout<UserData>(
      `${baseUrl}/users/${testUserId}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAccessToken}`,
        },
        body: JSON.stringify({ isActive: false }),
      },
    );

    if (
      deactivateRes.status !== 200 ||
      !deactivateRes.body.success ||
      deactivateRes.body.data?.isActive !== false
    ) {
      throw new Error(
        `Deactivate status update failed: ${JSON.stringify(deactivateRes.body)}`,
      );
    }

    const blockedLoginRes = await requestWithTimeout(
      `${baseUrl}/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      },
    );

    if (
      blockedLoginRes.status !== 403 ||
      blockedLoginRes.body.error?.code !== ERROR_CODES.ACCOUNT_DEACTIVATED
    ) {
      throw new Error(
        `Login was not blocked for deactivated account: ${JSON.stringify(blockedLoginRes.body)}`,
      );
    }
    console.log("[PASS] [I] Account deactivated & authentication blocked (403)");

    // ------------------------------------------------------------------------
    // [J] Reactivate -> login works
    // ------------------------------------------------------------------------
    currentStep = "[J] Reactivate & login restored";
    const reactivateRes = await requestWithTimeout<UserData>(
      `${baseUrl}/users/${testUserId}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAccessToken}`,
        },
        body: JSON.stringify({ isActive: true }),
      },
    );

    if (
      reactivateRes.status !== 200 ||
      !reactivateRes.body.success ||
      reactivateRes.body.data?.isActive !== true
    ) {
      throw new Error(
        `Reactivate status update failed: ${JSON.stringify(reactivateRes.body)}`,
      );
    }

    const restoredLoginRes = await requestWithTimeout<LoginData>(
      `${baseUrl}/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      },
    );

    if (
      restoredLoginRes.status !== 200 ||
      !restoredLoginRes.body.success ||
      !restoredLoginRes.body.data?.accessToken
    ) {
      throw new Error(
        `Restored login failed: ${JSON.stringify(restoredLoginRes.body)}`,
      );
    }

    testUserRefreshToken = restoredLoginRes.body.data.refreshToken;
    console.log("[PASS] [J] Account reactivated & authentication restored (200)");

    // ------------------------------------------------------------------------
    // [K] Logout admin -> old token blacklisted
    // ------------------------------------------------------------------------
    currentStep = "[K] Admin logout & blacklist";
    const logoutRes = await requestWithTimeout(
      `${baseUrl}/auth/logout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminAccessToken}`,
        },
        body: JSON.stringify({ refreshToken: adminRefreshToken }),
      },
    );

    if (logoutRes.status !== 200 || !logoutRes.body.success) {
      throw new Error(`Admin logout failed: ${JSON.stringify(logoutRes.body)}`);
    }

    // Verify access token is blacklisted on subsequent request
    const blacklistedMeRes = await requestWithTimeout(`${baseUrl}/auth/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccessToken}` },
    });

    if (
      blacklistedMeRes.status !== 401 ||
      blacklistedMeRes.body.error?.code !== ERROR_CODES.TOKEN_BLACKLISTED
    ) {
      throw new Error(
        `Blacklisted access token was not rejected: ${JSON.stringify(blacklistedMeRes.body)}`,
      );
    }
    console.log("[PASS] [K] Admin logout & JTI blacklisted (subsequent me -> 401)");

    // ------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------
    const elapsed = Date.now() - startTime;
    console.log(`[SMOKE] 11/11 passed in ${elapsed}ms`);
    console.log("[SMOKE] PHASE 2 OK ✓");
    process.exitCode = 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${currentStep}: ${message}`);
    console.error("[SMOKE] aborted");
    process.exitCode = 1;
  } finally {
    // ------------------------------------------------------------------------
    // [L] Teardown & cleanup
    // ------------------------------------------------------------------------
    if (testUserId) {
      await prisma.user
        .update({
          where: { id: testUserId },
          data: {
            isActive: false,
            email: `deleted-${testUserId}@fyp.local`,
          },
        })
        .catch(() => {});
      console.log(`[SMOKE] Cleanup: soft-deleted test user ${testUserId}`);
    }

    if (bootedIo) {
      await new Promise<void>((resolve) => bootedIo!.close(() => resolve()));
    }
    if (bootedServer) {
      await new Promise<void>((resolve) =>
        bootedServer!.close(() => resolve()),
      );
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] ${msg}`);
  process.exitCode = 1;
});
