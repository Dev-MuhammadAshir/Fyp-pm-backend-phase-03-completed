import http from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../../src/app.js";
import { initSocketGateway, AppSocketServer } from "../../src/realtime/gateway.js";
import { publishRealtime } from "../../src/infra/redis/publisher.js";
import { prisma } from "../../src/core/db/prisma.js";
import { ERROR_CODES } from "../../src/core/errors/codes.js";
import {
  projectRoom,
  userRoom,
  NotificationCreatedEnvelope,
  TaskCreatedEnvelope,
} from "../../shared/socket.contract.js";
import {
  buildTestJwt,
  connectTestSocket,
  waitForEvent,
  waitForConnectError,
} from "../helpers/socket-test-helpers.js";

describe("Socket.IO Real-Time Gateway Integration (SRS §4.7, §7.2, §7.4)", () => {
  let server: http.Server;
  let io: AppSocketServer;
  let port: number;

  const openSockets: ClientSocket[] = [];

  // Seeded database entities
  let adminUser: { id: string; email: string; globalRole: string };
  let pmUser: { id: string; email: string; globalRole: string };
  let dev1User: { id: string; email: string; globalRole: string };
  let viewerUser: { id: string; email: string; globalRole: string };
  let nonMemberUser: { id: string; email: string; globalRole: string };
  let seededProject: { id: string; title: string };

  beforeAll(async () => {
    // 1. Fetch real seeded users from PostgreSQL
    const admin = await prisma.user.findUnique({
      where: { email: "admin@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    const pm = await prisma.user.findUnique({
      where: { email: "pm@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    const dev1 = await prisma.user.findUnique({
      where: { email: "dev1@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });
    const viewer = await prisma.user.findUnique({
      where: { email: "viewer@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });

    if (!admin || !pm || !dev1 || !viewer) {
      throw new Error(
        "Seeded test users (admin, pm, dev1, viewer) not found. Run `npm run prisma:seed` first.",
      );
    }

    adminUser = admin;
    pmUser = pm;
    dev1User = dev1;
    viewerUser = viewer;

    // 2. Fetch or create a non-member user for test case (g)
    let nonMember = await prisma.user.findUnique({
      where: { email: "test-nonmember@fyp.local" },
      select: { id: true, email: true, globalRole: true },
    });

    if (!nonMember) {
      nonMember = await prisma.user.create({
        data: {
          email: "test-nonmember@fyp.local",
          passwordHash: "dummyhash",
          fullName: "Non-Project Viewer",
          globalRole: "Viewer",
          configuredCapacityHours: 40,
          isActive: true,
        },
        select: { id: true, email: true, globalRole: true },
      });
    }

    nonMemberUser = nonMember;

    // 3. Fetch seeded project
    const project = await prisma.project.findFirst({
      select: { id: true, title: true },
    });

    if (!project) {
      throw new Error(
        "Seeded test project not found. Run `npm run prisma:seed` first.",
      );
    }

    seededProject = project;

    // 4. Boot real Express app + HTTP server on dynamic test port (listen 0)
    const app = createApp();
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });

    // 5. Initialize Socket.IO Gateway
    io = await initSocketGateway(server);
  });

  afterEach(async () => {
    // Disconnect all sockets opened during test
    for (const s of openSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }
    openSockets.length = 0;

    // Restore dev1User isActive status if modified during test
    if (dev1User) {
      await prisma.user
        .update({
          where: { id: dev1User.id },
          data: { isActive: true },
        })
        .catch(() => {});
    }
  });

  afterAll(async () => {
    if (io) {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await prisma.$disconnect();
  });

  // ==========================================================================
  // Test Case (a): Valid token -> connects; auto-joined user:{userId} room
  // ==========================================================================
  it("(a) connects with valid token and auto-joins personal user room", async () => {
    const token = buildTestJwt(pmUser.id, { globalRole: pmUser.globalRole });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    await waitForEvent(socket, "connect");
    expect(socket.connected).toBe(true);

    // Verify personal room membership by publishing notification.created to user:{userId}
    const uniqueNotificationId = randomUUID();
    const notificationPromise = waitForEvent<NotificationCreatedEnvelope>(
      socket,
      "notification.created",
      (env) => env.data.notificationId === uniqueNotificationId,
    );

    await publishRealtime(
      "notification.created",
      undefined,
      pmUser.id,
      {
        notificationId: uniqueNotificationId,
        type: "TASK_ASSIGNED",
        payload: { title: "Assigned Task" },
      },
      [userRoom(pmUser.id)],
    );

    const received = await notificationPromise;
    expect(received.event).toBe("notification.created");
    expect(received.actorId).toBe(pmUser.id);
    expect(received.data.notificationId).toBe(uniqueNotificationId);
  });

  // ==========================================================================
  // Test Case (b): Missing token -> handshake rejected with AUTH_TOKEN_MISSING
  // ==========================================================================
  it("(b) rejects handshake when token is missing", async () => {
    const socket = connectTestSocket(port, null);
    openSockets.push(socket);

    const err = await waitForConnectError(socket);
    expect(err.message).toBe(ERROR_CODES.AUTH_TOKEN_MISSING);
    expect(socket.connected).toBe(false);
  });

  // ==========================================================================
  // Test Case (c): Expired token -> handshake rejected with AUTH_TOKEN_EXPIRED
  // ==========================================================================
  it("(c) rejects handshake when token is expired", async () => {
    const token = buildTestJwt(pmUser.id, {
      expiresIn: "1ms",
      globalRole: pmUser.globalRole,
    });

    // Wait 10ms to guarantee expiration
    await new Promise((r) => setTimeout(r, 10));

    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    const err = await waitForConnectError(socket);
    expect(err.message).toBe(ERROR_CODES.AUTH_TOKEN_EXPIRED);
    expect(socket.connected).toBe(false);
  });

  // ==========================================================================
  // Test Case (d): Tampered token -> handshake rejected with AUTH_TOKEN_INVALID
  // ==========================================================================
  it("(d) rejects handshake when token signature is invalid/tampered", async () => {
    const token = buildTestJwt(pmUser.id, {
      secret: "invalid-signature-key-that-does-not-match-env-secret-32ch",
    });

    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    const err = await waitForConnectError(socket);
    expect(err.message).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
    expect(socket.connected).toBe(false);
  });

  // ==========================================================================
  // Test Case (e): Inactive user -> rejected with AUTH_ACCOUNT_INACTIVE (FR-RT-03)
  // ==========================================================================
  it("(e) rejects handshake when user is deactivated (FR-RT-03)", async () => {
    // Set user inactive in PostgreSQL
    await prisma.user.update({
      where: { id: dev1User.id },
      data: { isActive: false },
    });

    const token = buildTestJwt(dev1User.id, { globalRole: dev1User.globalRole });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    const err = await waitForConnectError(socket);
    expect(err.message).toBe(ERROR_CODES.AUTH_ACCOUNT_INACTIVE);
    expect(socket.connected).toBe(false);
  });

  // ==========================================================================
  // Test Case (f): subscribe:project with valid member -> ack { ok: true } and receives event
  // ==========================================================================
  it("(f) allows valid project member to subscribe and receive project room events", async () => {
    const token = buildTestJwt(pmUser.id, { globalRole: pmUser.globalRole });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    await waitForEvent(socket, "connect");

    // Subscribe to seeded project
    const ack = await new Promise<{ ok: boolean; room?: string }>((resolve) => {
      socket.emit(
        "subscribe:project",
        { projectId: seededProject.id },
        (res: { ok: boolean; room?: string }) => resolve(res),
      );
    });

    expect(ack.ok).toBe(true);
    expect(ack.room).toBe(projectRoom(seededProject.id));

    // Verify real-time message delivery through project room
    const uniqueTaskId = randomUUID();
    const taskPromise = waitForEvent<TaskCreatedEnvelope>(
      socket,
      "task.created",
      (env) => env.data.taskId === uniqueTaskId,
    );

    await publishRealtime(
      "task.created",
      seededProject.id,
      pmUser.id,
      {
        taskId: uniqueTaskId,
        title: "Integration Test Task",
        status: "TODO",
        priority: "HIGH",
      },
      [projectRoom(seededProject.id)],
    );

    const received = await taskPromise;
    expect(received.event).toBe("task.created");
    expect(received.projectId).toBe(seededProject.id);
    expect(received.data.taskId).toBe(uniqueTaskId);
  });

  // ==========================================================================
  // Test Case (g): subscribe:project with non-member -> ack { ok: false, AUTHZ_NOT_PROJECT_MEMBER }
  // ==========================================================================
  it("(g) rejects project subscription for non-member with AUTHZ_NOT_PROJECT_MEMBER", async () => {
    const token = buildTestJwt(nonMemberUser.id, {
      globalRole: nonMemberUser.globalRole,
    });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    await waitForEvent(socket, "connect");

    const ack = await new Promise<{
      ok: boolean;
      error?: { code: string; message: string };
    }>((resolve) => {
      socket.emit(
        "subscribe:project",
        { projectId: seededProject.id },
        (res: { ok: boolean; error?: { code: string; message: string } }) =>
          resolve(res),
      );
    });

    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe(ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER);
  });

  // ==========================================================================
  // Test Case (h): Administrator bypass -> admin can subscribe without project membership
  // ==========================================================================
  it("(h) allows Administrator to bypass project scope and subscribe (Rule 9)", async () => {
    // adminUser is NOT a project member in seed.ts, but has globalRole: Administrator
    const token = buildTestJwt(adminUser.id, { globalRole: "Administrator" });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    await waitForEvent(socket, "connect");

    const ack = await new Promise<{ ok: boolean; room?: string }>((resolve) => {
      socket.emit(
        "subscribe:project",
        { projectId: seededProject.id },
        (res: { ok: boolean; room?: string }) => resolve(res),
      );
    });

    expect(ack.ok).toBe(true);
    expect(ack.room).toBe(projectRoom(seededProject.id));
  });

  // ==========================================================================
  // Test Case (i): unsubscribe:project -> leaves room; subsequent event not received
  // ==========================================================================
  it("(i) stops receiving project events after unsubscribe:project", async () => {
    const token = buildTestJwt(pmUser.id, { globalRole: pmUser.globalRole });
    const socket = connectTestSocket(port, token);
    openSockets.push(socket);

    await waitForEvent(socket, "connect");

    // 1. Join room
    await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit("subscribe:project", { projectId: seededProject.id }, resolve);
    });

    // 2. Leave room
    const leaveAck = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit("unsubscribe:project", { projectId: seededProject.id }, resolve);
    });
    expect(leaveAck.ok).toBe(true);

    // 3. Publish event to room and assert client does NOT receive it
    const unreachedTaskId = randomUUID();
    let receivedEvent = false;

    socket.on("task.created", (env: TaskCreatedEnvelope) => {
      if (env.data.taskId === unreachedTaskId) {
        receivedEvent = true;
      }
    });

    await publishRealtime(
      "task.created",
      seededProject.id,
      pmUser.id,
      {
        taskId: unreachedTaskId,
        title: "Should Not Be Received",
        status: "TODO",
        priority: "LOW",
      },
      [projectRoom(seededProject.id)],
    );

    // Wait 350ms to ensure no delayed delivery arrives
    await new Promise((r) => setTimeout(r, 350));
    expect(receivedEvent).toBe(false);
  });

  // ==========================================================================
  // Test Case (j): Pub/Sub fan-out across two clients
  // ==========================================================================
  it("(j) fans out Redis Pub/Sub events to multiple subscribed clients", async () => {
    const token1 = buildTestJwt(pmUser.id, { globalRole: pmUser.globalRole });
    const token2 = buildTestJwt(viewerUser.id, {
      globalRole: viewerUser.globalRole,
    });

    const socket1 = connectTestSocket(port, token1);
    const socket2 = connectTestSocket(port, token2);
    openSockets.push(socket1, socket2);

    await Promise.all([
      waitForEvent(socket1, "connect"),
      waitForEvent(socket2, "connect"),
    ]);

    // Both sockets subscribe to the same seeded project
    await Promise.all([
      new Promise((r) =>
        socket1.emit("subscribe:project", { projectId: seededProject.id }, r),
      ),
      new Promise((r) =>
        socket2.emit("subscribe:project", { projectId: seededProject.id }, r),
      ),
    ]);

    const fanoutTaskId = randomUUID();

    const promise1 = waitForEvent<TaskCreatedEnvelope>(
      socket1,
      "task.created",
      (env) => env.data.taskId === fanoutTaskId,
    );
    const promise2 = waitForEvent<TaskCreatedEnvelope>(
      socket2,
      "task.created",
      (env) => env.data.taskId === fanoutTaskId,
    );

    // Publish single real-time event to project room
    await publishRealtime(
      "task.created",
      seededProject.id,
      pmUser.id,
      {
        taskId: fanoutTaskId,
        title: "Fan-out Broadcast Task",
        status: "IN_PROGRESS",
        priority: "CRITICAL",
      },
      [projectRoom(seededProject.id)],
    );

    const [envelope1, envelope2] = await Promise.all([promise1, promise2]);

    expect(envelope1.eventId).toBe(envelope2.eventId);
    expect(envelope1.data.taskId).toBe(fanoutTaskId);
    expect(envelope2.data.taskId).toBe(fanoutTaskId);
  });
});
