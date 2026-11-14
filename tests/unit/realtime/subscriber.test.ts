import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { handleBusMessage, type TypedSocketServer } from "../../../src/infra/redis/subscriber.js";
import { REALTIME_EVENTS } from "../../../shared/socket.contract.js";

describe("handleBusMessage — Zod validation survival", () => {
  let io: Server;
  let httpServer: http.Server;

  beforeAll(async () => {
    httpServer = http.createServer();
    io = new Server(httpServer);
    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", () => resolve()),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("does not throw on malformed JSON", () => {
    expect(() =>
      handleBusMessage("{invalid json", io as unknown as TypedSocketServer),
    ).not.toThrow();
  });

  it("does not throw on valid JSON missing fields", () => {
    expect(() =>
      handleBusMessage(
        JSON.stringify({ foo: "bar" }),
        io as unknown as TypedSocketServer,
      ),
    ).not.toThrow();
  });

  it("does not throw on unknown event name", () => {
    const msg = {
      targetRoom: "project:abc",
      envelope: {
        eventId: randomUUID(),
        event: "attachment.created",
        timestamp: new Date().toISOString(),
        actorId: randomUUID(),
        data: {},
      },
    };
    expect(() =>
      handleBusMessage(
        JSON.stringify(msg),
        io as unknown as TypedSocketServer,
      ),
    ).not.toThrow();
  });

  it("does not throw on missing targetRoom", () => {
    const msg = {
      envelope: {
        eventId: randomUUID(),
        event: REALTIME_EVENTS.TASK_CREATED,
        timestamp: new Date().toISOString(),
        actorId: randomUUID(),
        data: {},
      },
    };
    expect(() =>
      handleBusMessage(
        JSON.stringify(msg),
        io as unknown as TypedSocketServer,
      ),
    ).not.toThrow();
  });

  it("processes a fully valid message without throwing", () => {
    const msg = {
      targetRoom: "project:abc",
      envelope: {
        eventId: randomUUID(),
        event: REALTIME_EVENTS.TASK_CREATED,
        timestamp: new Date().toISOString(),
        actorId: randomUUID(),
        projectId: randomUUID(),
        data: { taskId: "abc" },
      },
    };
    expect(() =>
      handleBusMessage(
        JSON.stringify(msg),
        io as unknown as TypedSocketServer,
      ),
    ).not.toThrow();
  });
});
