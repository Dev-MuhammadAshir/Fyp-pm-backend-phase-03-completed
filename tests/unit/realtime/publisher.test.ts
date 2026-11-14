/**
 * @file tests/unit/realtime/publisher.test.ts
 * @description Unit tests for best-effort real-time event publisher (NEW-5).
 */

import { describe, it, expect, afterAll } from "vitest";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { publishRealtime } from "../../../src/infra/redis/publisher.js";
import { REALTIME_EVENTS, userRoom } from "../../../shared/socket.contract.js";

describe("publishRealtime — best-effort (NEW-5)", () => {
  const brokenPublisher = new Redis({
    host: "127.0.0.1",
    port: 1, // Dead port — connection refused
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableReadyCheck: false,
    retryStrategy: () => null,
  });

  afterAll(() => {
    brokenPublisher.disconnect();
  });

  it("returns false and does NOT throw when Redis is unreachable", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const result = await publishRealtime(
      REALTIME_EVENTS.NOTIFICATION_CREATED,
      undefined,
      userId,
      {
        notificationId: randomUUID(),
        type: "TEST",
        payload: {},
      },
      [userRoom(userId)],
      brokenPublisher,
    );

    expect(result).toBe(false);
  });
});
