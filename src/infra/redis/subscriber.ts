/**
 * @file src/infra/redis/subscriber.ts
 * @description Listens on the Redis bus channel `rt:events` and forwards incoming
 * envelopes to the appropriate Socket.IO room.
 */

import type { Server } from "socket.io";
import { redisSubscriber } from "./client.js";
import { logger } from "../../core/logger/index.js";
import {
  REDIS_REALTIME_BUS_CHANNEL,
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../../shared/socket.contract.js";
import { RedisBusMessageSchema } from "../../realtime/bus-message.schema.js";

export type TypedSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents
>;

/**
 * Handle one message from the rt:events channel. Pure function —
 * testable without Redis or Socket.IO mocks (pass a real io instance).
 *
 * Runtime validation: external Redis messages are Zod-validated.
 * Malformed messages are logged + dropped — the subscriber MUST NOT
 * crash on them (defense-in-depth for realtime reliability).
 */
export function handleBusMessage(raw: string, io: TypedSocketServer): void {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    logger.warn(
      { rawSnippet: raw.slice(0, 200) },
      "Invalid JSON on rt:events — dropped",
    );
    return;
  }

  const result = RedisBusMessageSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues, rawSnippet: raw.slice(0, 200) },
      "Invalid bus message shape on rt:events — dropped",
    );
    return;
  }

  const { targetRoom, envelope } = result.data;

  // Forward to the specific room (project or user) via Socket.IO
  (
    io.to(targetRoom).emit as unknown as (
      event: string,
      payload: unknown,
    ) => boolean
  )(envelope.event, envelope);

  logger.trace(
    {
      targetRoom,
      event: envelope.event,
      eventId: envelope.eventId,
    },
    "Forwarded Redis bus event to Socket.IO room",
  );
}

/**
 * Initializes Redis Pub/Sub subscription and wires incoming messages to Socket.IO rooms.
 */
export async function startRealtimeSubscriber(
  io: TypedSocketServer,
): Promise<void> {
  try {
    await redisSubscriber.subscribe(REDIS_REALTIME_BUS_CHANNEL);

    redisSubscriber.on("message", (channel: string, message: string) => {
      if (channel === REDIS_REALTIME_BUS_CHANNEL) {
        handleBusMessage(message, io);
      }
    });

    logger.info(
      { channel: REDIS_REALTIME_BUS_CHANNEL },
      "Realtime Redis subscriber started successfully",
    );
  } catch (err: unknown) {
    logger.warn(
      { err, channel: REDIS_REALTIME_BUS_CHANNEL },
      "Realtime Redis subscriber could not connect at startup (will retry on reconnect)",
    );
  }
}
