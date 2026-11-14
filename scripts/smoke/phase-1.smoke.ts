/**
 * @file scripts/smoke/phase-1.smoke.ts
 * @description Phase 1 Operational End-to-End Smoke Test Runner.
 *
 * Verifies live real-time infrastructure against SRS v3.0 §4.7 and §7.1–§7.4:
 * [A] HTTP health probe (`GET /api/v1/health` -> healthy, database up, redis up)
 * [B] Redis Pub/Sub subscription check (`PUBSUB NUMSUB rt:events` >= 1)
 * [C] JWT handshake & personal user room auto-join (`notification.created` in `user:{userId}`)
 * [D] Project room subscription for authorized member (`subscribe:project` ack ok)
 * [E] Administrator bypass of project room scope (Rule 9: global Administrator)
 * [F] Non-member project subscription rejection (`AUTHZ_NOT_PROJECT_MEMBER`)
 * [G] Pub/Sub fan-out broadcast delivery to multiple room subscribers (`task.created`)
 * [H] Project room unsubscription verification (`unsubscribe:project` ack ok & no event leakage)
 *
 * NON-NEGOTIABLE RULES:
 * 1. No mocks, stubs, or in-memory replacements. Real Redis + real PostgreSQL.
 * 2. Standalone CLI execution with plain-text status output (one line per step).
 * 3. Probes port 3000; boots ephemeral server if not currently running.
 * 4. Cleans up all test sockets, ephemeral servers, and database/Redis connections on exit.
 */

import http from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../../src/app.js";
import { initSocketGateway, AppSocketServer } from "../../src/realtime/gateway.js";
import { publishRealtime } from "../../src/infra/redis/publisher.js";
import {
  redis,
  redisPublisher,
  redisSubscriber,
} from "../../src/infra/redis/client.js";
import { prisma } from "../../src/core/db/prisma.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";
import {
  projectRoom,
  userRoom,
  REDIS_REALTIME_BUS_CHANNEL,
  NotificationCreatedEnvelope,
  TaskCreatedEnvelope,
  SubscriptionAckResponse,
} from "../../shared/socket.contract.js";
import {
  buildTestJwt,
  connectTestSocket,
  waitForEvent,
} from "../../tests/helpers/socket-test-helpers.js";

interface HealthEnvelope {
  success?: boolean;
  data?: {
    status?: string;
    timestamp?: string;
    uptimeSeconds?: number;
    components?: {
      database?: string;
      redis?: string;
    };
  };
}

/**
 * Emits a socket event and awaits an acknowledgment callback with timeout.
 */
function emitAck<T = unknown>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for ack on "${event}" after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    socket.emit(event, payload, (response: T) => {
      if (timer) clearTimeout(timer);
      resolve(response);
    });
  });
}

async function main(): Promise<void> {
  const openSockets: ClientSocket[] = [];
  let bootedServer: http.Server | null = null;
  let bootedIo: AppSocketServer | null = null;

  const defaultPort = Number(process.env.PORT || 3000);
  let activePort = defaultPort;
  let mode: "existing" | "boot" = "existing";
  let currentStep = "INIT";

  try {
    // ------------------------------------------------------------------------
    // Server Detection: Probe existing HTTP server on configured port
    // ------------------------------------------------------------------------
    try {
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 1000);
      const probeRes = await fetch(
        `http://127.0.0.1:${defaultPort}/api/v1/health`,
        { signal: probeController.signal },
      );
      clearTimeout(probeTimeout);

      if (probeRes.ok) {
        const probeBody = (await probeRes.json()) as HealthEnvelope;
        if (
          probeBody.success === true &&
          probeBody.data?.status === "healthy"
        ) {
          mode = "existing";
          activePort = defaultPort;
          console.log(`[SMOKE] Mode: existing (http://127.0.0.1:${activePort})`);
        } else {
          mode = "boot";
        }
      } else {
        mode = "boot";
      }
    } catch {
      mode = "boot";
    }

    if (mode === "boot") {
      const app = createApp();
      bootedServer = http.createServer(app);

      await new Promise<void>((resolve) => {
        bootedServer!.listen(0, "127.0.0.1", () => {
          const addr = bootedServer!.address() as AddressInfo;
          activePort = addr.port;
          resolve();
        });
      });

      bootedIo = await initSocketGateway(bootedServer);
      console.log(`[SMOKE] Mode: boot (ephemeral http://127.0.0.1:${activePort})`);
    }

    // ------------------------------------------------------------------------
    // Step [A]: Health probe verification
    // ------------------------------------------------------------------------
    currentStep = "[A]";
    const healthRes = await fetch(
      `http://127.0.0.1:${activePort}/api/v1/health`,
    );
    if (!healthRes.ok) {
      throw new Error(`Health check returned HTTP ${healthRes.status}`);
    }
    const healthData = (await healthRes.json()) as HealthEnvelope;
    if (
      healthData.success !== true ||
      healthData.data?.status !== "healthy" ||
      healthData.data.components?.database !== "up" ||
      healthData.data.components?.redis !== "up"
    ) {
      throw new Error(
        `Health probe reported unhealthy state: ${JSON.stringify(healthData)}`,
      );
    }
    console.log(
      "[A] Health endpoint verified (status: healthy, database: up, redis: up)",
    );

    // ------------------------------------------------------------------------
    // Step [B]: Redis Pub/Sub subscription check
    // ------------------------------------------------------------------------
    currentStep = "[B]";
    if (typeof redis.pubsub === "function") {
      const numsubResult = (await redis.pubsub(
        "NUMSUB",
        REDIS_REALTIME_BUS_CHANNEL,
      )) as unknown;
      let count = 0;
      if (Array.isArray(numsubResult) && numsubResult.length >= 2) {
        count = Number(numsubResult[1]);
      }
      if (count < 1) {
        throw new Error(
          `Expected at least 1 subscriber on "${REDIS_REALTIME_BUS_CHANNEL}", found ${count}`,
        );
      }
      console.log(
        `[B] Redis Pub/Sub verified (${REDIS_REALTIME_BUS_CHANNEL} subscriber count: ${count})`,
      );
    } else {
      const pong = await redis.ping();
      if (pong !== "PONG") {
        throw new Error("Redis ping failed");
      }
      console.log(
        `[B] Redis Pub/Sub verified (channel: ${REDIS_REALTIME_BUS_CHANNEL}, ping: PONG)`,
      );
    }

    // ------------------------------------------------------------------------
    // Step [C]: JWT handshake + personal user room auto-join
    // ------------------------------------------------------------------------
    currentStep = "[C]";
    const pmUser = await prisma.user.findUnique({
      where: { email: "pm@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    if (!pmUser) {
      throw new Error(
        "Seed user pm@fyp.local not found in database. Run npm run prisma:seed first.",
      );
    }

    const pmToken = buildTestJwt(pmUser.id, {
      globalRole: pmUser.globalRole,
    });
    const pmSocket = connectTestSocket(activePort, pmToken);
    openSockets.push(pmSocket);
    await waitForEvent(pmSocket, "connect");

    const notificationId = randomUUID();
    const notificationPromise = waitForEvent<NotificationCreatedEnvelope>(
      pmSocket,
      "notification.created",
      (env) => env.data.notificationId === notificationId,
      5000,
    );

    await publishRealtime(
      "notification.created",
      undefined,
      pmUser.id,
      {
        notificationId,
        type: "SMOKE_TEST",
        payload: { verified: true },
      },
      [userRoom(pmUser.id)],
    );

    const receivedNotification = await notificationPromise;
    if (
      receivedNotification.event !== "notification.created" ||
      receivedNotification.actorId !== pmUser.id
    ) {
      throw new Error("Malformed notification.created envelope received");
    }
    console.log(
      `[C] JWT handshake & personal room verified (notification.created received in user:${pmUser.id})`,
    );

    // ------------------------------------------------------------------------
    // Step [D]: Project room subscription (authorized member)
    // ------------------------------------------------------------------------
    currentStep = "[D]";
    const project = await prisma.project.findFirst({
      select: { id: true, title: true },
    });
    if (!project) {
      throw new Error(
        "Seed project not found in database. Run npm run prisma:seed first.",
      );
    }

    const memberAck = await emitAck<SubscriptionAckResponse>(
      pmSocket,
      "subscribe:project",
      { projectId: project.id },
    );
    if (!memberAck.ok || memberAck.room !== projectRoom(project.id)) {
      throw new Error(
        `Project member subscription failed: ${JSON.stringify(memberAck)}`,
      );
    }
    console.log(
      `[D] Project member subscription verified (pm@fyp.local subscribed to ${memberAck.room})`,
    );

    // ------------------------------------------------------------------------
    // Step [E]: Administrator bypass subscription (Rule 9)
    // ------------------------------------------------------------------------
    currentStep = "[E]";
    const adminUser = await prisma.user.findUnique({
      where: { email: "admin@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    if (!adminUser) {
      throw new Error(
        "Seed user admin@fyp.local not found in database. Run npm run prisma:seed first.",
      );
    }

    const adminToken = buildTestJwt(adminUser.id, {
      globalRole: "Administrator",
    });
    const adminSocket = connectTestSocket(activePort, adminToken);
    openSockets.push(adminSocket);
    await waitForEvent(adminSocket, "connect");

    const adminAck = await emitAck<SubscriptionAckResponse>(
      adminSocket,
      "subscribe:project",
      { projectId: project.id },
    );
    if (!adminAck.ok || adminAck.room !== projectRoom(project.id)) {
      throw new Error(
        `Administrator bypass subscription failed: ${JSON.stringify(adminAck)}`,
      );
    }
    console.log(
      `[E] Administrator bypass verified (admin@fyp.local subscribed to ${adminAck.room})`,
    );

    // ------------------------------------------------------------------------
    // Step [F]: Non-member subscription rejection
    // ------------------------------------------------------------------------
    currentStep = "[F]";
    let nonMemberUser = await prisma.user.findUnique({
      where: { email: "test-nonmember@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    if (!nonMemberUser) {
      nonMemberUser = await prisma.user.create({
        data: {
          email: "test-nonmember@fyp.local",
          passwordHash: "dummyhash",
          fullName: "Smoke Non-Member Viewer",
          globalRole: "Viewer",
          configuredCapacityHours: 40,
          isActive: true,
        },
        select: { id: true, email: true, globalRole: true },
      });
    }

    const nonMemberToken = buildTestJwt(nonMemberUser.id, {
      globalRole: nonMemberUser.globalRole,
    });
    const nonMemberSocket = connectTestSocket(activePort, nonMemberToken);
    openSockets.push(nonMemberSocket);
    await waitForEvent(nonMemberSocket, "connect");

    const nonMemberAck = await emitAck<SubscriptionAckResponse>(
      nonMemberSocket,
      "subscribe:project",
      { projectId: project.id },
    );
    if (
      nonMemberAck.ok ||
      nonMemberAck.error?.code !== ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER
    ) {
      throw new Error(
        `Expected AUTHZ_NOT_PROJECT_MEMBER rejection, got: ${JSON.stringify(nonMemberAck)}`,
      );
    }
    console.log(
      `[F] Non-member subscription rejected (${nonMemberAck.error.code})`,
    );

    // ------------------------------------------------------------------------
    // Step [G]: Fan-out broadcast delivery across subscribers
    // ------------------------------------------------------------------------
    currentStep = "[G]";
    const fanoutTaskId = randomUUID();
    const pmTaskPromise = waitForEvent<TaskCreatedEnvelope>(
      pmSocket,
      "task.created",
      (env) => env.data.taskId === fanoutTaskId,
      5000,
    );
    const adminTaskPromise = waitForEvent<TaskCreatedEnvelope>(
      adminSocket,
      "task.created",
      (env) => env.data.taskId === fanoutTaskId,
      5000,
    );

    await publishRealtime(
      "task.created",
      project.id,
      pmUser.id,
      {
        taskId: fanoutTaskId,
        title: "Smoke Fanout Verification Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
      },
      [projectRoom(project.id)],
    );

    const [pmEnv, adminEnv] = await Promise.all([
      pmTaskPromise,
      adminTaskPromise,
    ]);
    if (
      pmEnv.eventId !== adminEnv.eventId ||
      pmEnv.data.taskId !== fanoutTaskId
    ) {
      throw new Error(
        "Fan-out delivery mismatch: eventId or taskId did not match across subscribers",
      );
    }
    console.log(
      `[G] Fan-out broadcast verified (task.created eventId: ${pmEnv.eventId} delivered to both PM and Admin)`,
    );

    // ------------------------------------------------------------------------
    // Step [H]: Project unsubscription & event isolation verification
    // ------------------------------------------------------------------------
    currentStep = "[H]";
    const unsubAck = await emitAck<SubscriptionAckResponse>(
      pmSocket,
      "unsubscribe:project",
      { projectId: project.id },
    );
    if (!unsubAck.ok) {
      throw new Error(
        `unsubscribe:project failed: ${JSON.stringify(unsubAck)}`,
      );
    }

    const postUnsubTaskId = randomUUID();
    let pmReceivedAfterUnsub = false;
    pmSocket.on("task.created", (env: TaskCreatedEnvelope) => {
      if (env.data.taskId === postUnsubTaskId) {
        pmReceivedAfterUnsub = true;
      }
    });

    const adminPostUnsubPromise = waitForEvent<TaskCreatedEnvelope>(
      adminSocket,
      "task.created",
      (env) => env.data.taskId === postUnsubTaskId,
      5000,
    );

    await publishRealtime(
      "task.created",
      project.id,
      adminUser.id,
      {
        taskId: postUnsubTaskId,
        title: "Post-Unsubscribe Check Task",
        status: "DONE",
        priority: "LOW",
      },
      [projectRoom(project.id)],
    );

    await adminPostUnsubPromise;

    // Allow 350ms propagation window to ensure no leakage occurs
    await new Promise((resolve) => setTimeout(resolve, 350));

    if (pmReceivedAfterUnsub) {
      throw new Error(
        "Unsubscribed socket still received project room broadcast",
      );
    }
    console.log(
      `[H] Project unsubscription verified (pm@fyp.local unsubscribed, subsequent event not received)`,
    );

    // ------------------------------------------------------------------------
    // Completion Summary
    // ------------------------------------------------------------------------
    console.log("[SMOKE] 8/8 passed");
    console.log("[SMOKE] PHASE 1 OK ✓");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${currentStep} ${message}`);
    console.error("[SMOKE] aborted");
    process.exitCode = 1;
  } finally {
    // Clean up test sockets
    for (const socket of openSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    openSockets.length = 0;

    // Clean up ephemeral server if booted
    if (bootedIo) {
      await new Promise<void>((resolve) => bootedIo!.close(() => resolve()));
    }
    if (bootedServer) {
      await new Promise<void>((resolve) =>
        bootedServer!.close(() => resolve()),
      );
    }

    // Standalone CLI: close all own connections to allow clean process exit on Windows (libuv UV_HANDLE_CLOSING assertion).
    try {
      await redisPublisher.quit();
    } catch {
      // ignore cleanup errors
    }
    try {
      await redisSubscriber.quit();
    } catch {
      // ignore cleanup errors
    }
    try {
      await redis.quit();
    } catch {
      // ignore cleanup errors
    }
    try {
      await prisma.$disconnect();
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] ${msg}`);
  process.exitCode = 1;
});
