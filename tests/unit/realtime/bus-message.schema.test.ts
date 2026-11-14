import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { RedisBusMessageSchema } from "../../../src/realtime/bus-message.schema.js";
import { REALTIME_EVENTS } from "../../../shared/socket.contract.js";

const validEnvelope = () => ({
  eventId: randomUUID(),
  event: REALTIME_EVENTS.TASK_CREATED,
  timestamp: new Date().toISOString(),
  actorId: randomUUID(),
  data: { taskId: "abc" },
});

describe("RedisBusMessageSchema (audit NEW — bus validation)", () => {
  it("accepts a valid message", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
      envelope: validEnvelope(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional projectId present", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
      envelope: { ...validEnvelope(), projectId: randomUUID() },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID eventId", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
      envelope: { ...validEnvelope(), eventId: "not-a-uuid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown event name (attachment.created — not in frozen 13)", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
      envelope: { ...validEnvelope(), event: "attachment.created" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing targetRoom", () => {
    const result = RedisBusMessageSchema.safeParse({
      envelope: validEnvelope(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty targetRoom", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "",
      envelope: validEnvelope(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing envelope", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO timestamp", () => {
    const result = RedisBusMessageSchema.safeParse({
      targetRoom: "project:abc",
      envelope: { ...validEnvelope(), timestamp: "not-a-date" },
    });
    expect(result.success).toBe(false);
  });
});
