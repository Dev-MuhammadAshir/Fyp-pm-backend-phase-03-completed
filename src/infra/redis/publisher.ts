/**
 * @file src/infra/redis/publisher.ts
 * @description Real-time event publisher broadcasting to Redis Pub/Sub bus.
 *
 * ARCHITECTURAL DECISION:
 * A single global bus channel (`rt:events`) is used for all real-time events.
 * The message payload contains { targetRoom, envelope }.
 * This keeps subscriber count to exactly one per application instance, avoiding
 * channel explosion (which would scale with project count), and guarantees
 * identical behavior in single-instance and multi-instance deployments.
 * Events are NOT emitted locally here; they are published to Redis and forwarded
 * by the local subscriber, preserving a single authoritative event flow.
 */

import { randomUUID } from "crypto";
import { redisPublisher } from "./client.js";
import { logger } from "../../core/logger/index.js";
import {
  REDIS_REALTIME_BUS_CHANNEL,
  ProjectRoomId,
  UserRoomId,
  RealtimeEventName,
  RealtimeEventEnvelope,
  RedisBusMessage,
} from "../../../shared/socket.contract.js";

/**
 * Builds the standard envelope (§7.1) and publishes a RedisBusMessage to Redis
 * for each targeted room.
 *
 * @param event Frozen event name (§7.2)
 * @param projectId Project UUID (required for 12 project events, optional for notification.created)
 * @param actorId UUID of the user/system initiating the mutation
 * @param data Event-specific payload data
 * @param targetRooms List of project (`project:${id}`) or user (`user:${id}`) rooms
 * @param clientOverride Optional Redis publisher client override (for testing/DI)
 * @returns boolean true if published successfully, false if publishing failed
 */
export async function publishRealtime<T = unknown>(
  event: RealtimeEventName,
  projectId: string | undefined,
  actorId: string,
  data: T,
  targetRooms: (ProjectRoomId | UserRoomId)[],
  clientOverride?: typeof redisPublisher,
): Promise<boolean> {
  const client = clientOverride ?? redisPublisher;
  const envelope = {
    eventId: randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    actorId,
    ...(projectId ? { projectId } : {}),
    data,
  } as unknown as RealtimeEventEnvelope;

  try {
    for (const targetRoom of targetRooms) {
      const busMessage: RedisBusMessage = {
        targetRoom,
        envelope,
      };

      await client.publish(
        REDIS_REALTIME_BUS_CHANNEL,
        JSON.stringify(busMessage),
      );
    }

    logger.debug(
      {
        eventId: envelope.eventId,
        event: envelope.event,
        targetRooms,
      },
      "Realtime event published to Redis bus",
    );
    return true;
  } catch (err: unknown) {
    logger.warn(
      {
        err,
        event,
        targetRooms,
      },
      "Realtime publish failed (best-effort, non-throwing)",
    );
    return false;
  }
}
