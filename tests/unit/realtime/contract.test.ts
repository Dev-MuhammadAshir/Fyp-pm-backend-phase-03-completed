import { describe, it, expect } from "vitest";
import {
  REALTIME_EVENTS,
  projectRoom,
  userRoom,
  REDIS_REALTIME_BUS_CHANNEL,
  RedisBusMessage,
  TaskCreatedEnvelope,
} from "../../../shared/socket.contract.js";

describe("Real-Time Event Contract (SRS v3.0 §7.1, §7.2, §7.3)", () => {
  it("freezes exactly 13 real-time events per SRS §7.2 (CA-07)", () => {
    const expectedEvents = [
      "task.created",
      "task.updated",
      "task.status_changed",
      "task.assigned",
      "task.deleted",
      "comment.created",
      "comment.updated",
      "comment.deleted",
      "project.updated",
      "notification.created",
      "risk.detected",
      "risk.updated",
      "membership.changed",
    ];

    const actualValues = Object.values(REALTIME_EVENTS);

    expect(actualValues).toHaveLength(13);
    expect(actualValues.sort()).toEqual(expectedEvents.sort());
    expect(Object.keys(REALTIME_EVENTS)).toHaveLength(13);
  });

  it("formats canonical project and user rooms per SRS §7.3", () => {
    expect(projectRoom("abc")).toBe("project:abc");
    expect(projectRoom("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "project:550e8400-e29b-41d4-a716-446655440000",
    );

    expect(userRoom("xyz")).toBe("user:xyz");
    expect(userRoom("123e4567-e89b-12d3-a456-426614174000")).toBe(
      "user:123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("verifies single global Redis bus channel is rt:events", () => {
    expect(REDIS_REALTIME_BUS_CHANNEL).toBe("rt:events");
  });

  it("verifies RedisBusMessage JSON round-trip preserves envelope shape", () => {
    const originalEnvelope: TaskCreatedEnvelope = {
      eventId: "e100-v4",
      event: "task.created",
      timestamp: "2026-11-06T00:00:00.000Z",
      actorId: "actor-123",
      projectId: "proj-456",
      data: {
        taskId: "task-789",
        title: "Test Task",
        status: "TODO",
        priority: "HIGH",
      },
    };

    const originalMessage: RedisBusMessage = {
      targetRoom: projectRoom("proj-456"),
      envelope: originalEnvelope,
    };

    const serialized = JSON.stringify(originalMessage);
    const deserialized = JSON.parse(serialized) as RedisBusMessage;

    expect(deserialized).toEqual(originalMessage);
    expect(deserialized.targetRoom).toBe("project:proj-456");
    expect(deserialized.envelope.event).toBe("task.created");
    expect(deserialized.envelope.data).toEqual(originalEnvelope.data);
  });
});
