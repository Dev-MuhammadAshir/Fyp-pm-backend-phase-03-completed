/**
 * @file src/realtime/bus-message.schema.ts
 * @description Runtime Zod validation for Redis Pub/Sub bus messages.
 *
 * Redis is an EXTERNAL boundary — messages must be validated at runtime,
 * not trusted via TypeScript assertions. Malformed messages (bug in
 * publisher, version skew, injection) would otherwise crash the subscriber
 * or forward invalid data to clients (NFR-SEC-03).
 */

import { z } from "zod";
import { REALTIME_EVENTS } from "../../shared/socket.contract.js";

/**
 * Standard realtime envelope (SRS §7.1).
 */
export const RealtimeEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  event: z.enum([
    REALTIME_EVENTS.TASK_CREATED,
    REALTIME_EVENTS.TASK_UPDATED,
    REALTIME_EVENTS.TASK_STATUS_CHANGED,
    REALTIME_EVENTS.TASK_ASSIGNED,
    REALTIME_EVENTS.TASK_DELETED,
    REALTIME_EVENTS.COMMENT_CREATED,
    REALTIME_EVENTS.COMMENT_UPDATED,
    REALTIME_EVENTS.COMMENT_DELETED,
    REALTIME_EVENTS.PROJECT_UPDATED,
    REALTIME_EVENTS.NOTIFICATION_CREATED,
    REALTIME_EVENTS.RISK_DETECTED,
    REALTIME_EVENTS.RISK_UPDATED,
    REALTIME_EVENTS.MEMBERSHIP_CHANGED,
  ]),
  timestamp: z.string().datetime(),
  actorId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  data: z.unknown(),
});

/**
 * Redis bus message — envelope wrapped with target room.
 */
export const RedisBusMessageSchema = z.object({
  targetRoom: z.string().min(1),
  envelope: RealtimeEnvelopeSchema,
});

export type ValidatedRedisBusMessage = z.infer<typeof RedisBusMessageSchema>;
