/**
 * @file shared/socket.contract.ts
 * @description Single source of truth for the real-time event contract.
 * Shared between backend (Phase 1+) and future frontend.
 *
 * Implements SRS v3.0 §7.1 (Standard Envelope), §7.2 (13 Frozen Real-Time Events),
 * and §7.3 (Room Strategy).
 *
 * NON-NEGOTIABLE RULES:
 * 1. Exactly 13 events from SRS §7.2. No additions, no deletions, no renames.
 * 2. Room naming: `project:${projectId}` and `user:${userId}`.
 * 3. Standard envelope on all server-emitted real-time events.
 * 4. TypeScript strict - discriminated unions, no `any`.
 */

// ============================================================================
// 1. DOMAIN ENUMS (Frozen per SRS v3.0 CA-01, CA-09, CA-13)
// ============================================================================

export type RealtimeTaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type RealtimePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RealtimeRiskType = 'WORKLOAD' | 'DELAY' | 'DEPENDENCY' | 'PRIORITY';
export type RealtimeRiskSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type RealtimeRiskStatus = 'Open' | 'Resolved';

// ============================================================================
// 2. ROOM HELPERS (§7.3)
// ============================================================================

export type ProjectRoomId = `project:${string}`;
export type UserRoomId = `user:${string}`;

/**
 * Generates canonical project room identifier.
 * Pattern: `project:${projectId}`
 */
export function projectRoom(projectId: string): ProjectRoomId {
  return `project:${projectId}` as const;
}

/**
 * Generates canonical user room identifier.
 * Pattern: `user:${userId}`
 */
export function userRoom(userId: string): UserRoomId {
  return `user:${userId}` as const;
}

// ============================================================================
// 3. 13 FROZEN REAL-TIME EVENT NAMES (§7.2, CA-07)
// ============================================================================

export const REALTIME_EVENTS = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED: 'task.assigned',
  TASK_DELETED: 'task.deleted',
  COMMENT_CREATED: 'comment.created',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  PROJECT_UPDATED: 'project.updated',
  NOTIFICATION_CREATED: 'notification.created',
  RISK_DETECTED: 'risk.detected',
  RISK_UPDATED: 'risk.updated',
  MEMBERSHIP_CHANGED: 'membership.changed',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

// ============================================================================
// 4. EVENT PAYLOAD DATA SHAPES (§7.2)
// ============================================================================

/**
 * 1. `task.created`
 * Trigger: Task inserted
 * Room: `project:{projectId}`
 * Payload: `{ taskId, title, status, priority }`
 */
export interface TaskCreatedData {
  taskId: string;
  title: string;
  status: RealtimeTaskStatus;
  priority: RealtimePriority;
}

/**
 * 2. `task.updated`
 * Trigger: Task attributes changed
 * Room: `project:{projectId}`
 * Payload: `{ taskId, changes }`
 */
export interface TaskUpdatedData {
  taskId: string;
  changes: Record<string, unknown>;
}

/**
 * 3. `task.status_changed`
 * Trigger: Kanban transition
 * Room: `project:{projectId}`
 * Payload: `{ taskId, oldStatus, newStatus }`
 */
export interface TaskStatusChangedData {
  taskId: string;
  oldStatus: RealtimeTaskStatus;
  newStatus: RealtimeTaskStatus;
}

/**
 * 4. `task.assigned`
 * Trigger: Assignee added/removed
 * Rooms: `project:{projectId}` + `user:{assigneeId}`
 * Payload: `{ taskId, assigned }`
 *
 * SRS §7.2 specifies { taskId, assigned }. The inner `assigned` shape is
 * constrained here to { userId, action } to disambiguate add vs remove
 * in a single event. This is an implementation refinement of an
 * under-specified SRS field, documented for traceability.
 */
export interface TaskAssignedData {
  taskId: string;
  assigned: {
    userId: string;
    action: 'assigned' | 'unassigned';
  };
}

/**
 * 5. `task.deleted`
 * Trigger: Task archived/deleted
 * Room: `project:{projectId}`
 * Payload: `{ taskId }`
 */
export interface TaskDeletedData {
  taskId: string;
}

/**
 * 6. `comment.created`
 * Trigger: Comment inserted
 * Room: `project:{projectId}`
 * Payload: `{ commentId, taskId, body }`
 */
export interface CommentCreatedData {
  commentId: string;
  taskId: string;
  body: string;
}

/**
 * 7. `comment.updated`
 * Trigger: Comment edited <= 15 min (BR-COL-02)
 * Room: `project:{projectId}`
 * Payload: `{ commentId, taskId, body, updatedAt }`
 */
export interface CommentUpdatedData {
  commentId: string;
  taskId: string;
  body: string;
  updatedAt: string;
}

/**
 * 8. `comment.deleted`
 * Trigger: Comment deleted
 * Room: `project:{projectId}`
 * Payload: `{ commentId, taskId }`
 */
export interface CommentDeletedData {
  commentId: string;
  taskId: string;
}

/**
 * 9. `project.updated`
 * Trigger: Project fields changed
 * Room: `project:{projectId}`
 * Payload: `{ projectId, changes }`
 */
export interface ProjectUpdatedData {
  projectId: string;
  changes: Record<string, unknown>;
}

/**
 * 10. `notification.created`
 * Trigger: Notification persisted in PostgreSQL
 * Room: `user:{userId}` (Personal user room only)
 * Payload: `{ notificationId, type, payload }`
 */
export interface NotificationCreatedData {
  notificationId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * 11. `risk.detected`
 * Trigger: PIRAE produces new risk assessment
 * Room: `project:{projectId}`
 * Payload: `{ riskId, riskType, severity, reason }`
 */
export interface RiskDetectedData {
  riskId: string;
  riskType: RealtimeRiskType;
  severity: RealtimeRiskSeverity;
  reason: string;
}

/**
 * 12. `risk.updated`
 * Trigger: PIRAE risk status changed (e.g. marked resolved)
 * Room: `project:{projectId}`
 * Payload: `{ riskId, status, resolvedAt }`
 */
export interface RiskUpdatedData {
  riskId: string;
  status: RealtimeRiskStatus;
  resolvedAt: string | null;
}

/**
 * 13. `membership.changed`
 * Trigger: Project or team membership change
 * Room: `project:{projectId}`
 * Payload: `{ userId, role, action }`
 *
 * SRS §7.2 specifies { userId, role, action }. The `action` shape is
 * constrained here to 'added' | 'removed' | 'role_updated' to represent
 * member addition, removal, and role reassignment unambiguously in a
 * single event. This is an implementation refinement of an under-specified
 * SRS field, documented for traceability.
 */
export interface MembershipChangedData {
  userId: string;
  role: string;
  action: 'added' | 'removed' | 'role_updated';
}

// ============================================================================
// 5. STANDARD EVENT ENVELOPE (§7.1) & DISCRIMINATED UNIONS
// ============================================================================

export interface SocketEnvelopeBase<E extends RealtimeEventName, T> {
  eventId: string;
  event: E;
  timestamp: string;
  actorId: string;
  projectId?: string;
  data: T;
}

export type TaskCreatedEnvelope = SocketEnvelopeBase<'task.created', TaskCreatedData> & {
  projectId: string;
};

export type TaskUpdatedEnvelope = SocketEnvelopeBase<'task.updated', TaskUpdatedData> & {
  projectId: string;
};

export type TaskStatusChangedEnvelope = SocketEnvelopeBase<
  'task.status_changed',
  TaskStatusChangedData
> & {
  projectId: string;
};

export type TaskAssignedEnvelope = SocketEnvelopeBase<'task.assigned', TaskAssignedData> & {
  projectId: string;
};

export type TaskDeletedEnvelope = SocketEnvelopeBase<'task.deleted', TaskDeletedData> & {
  projectId: string;
};

export type CommentCreatedEnvelope = SocketEnvelopeBase<
  'comment.created',
  CommentCreatedData
> & {
  projectId: string;
};

export type CommentUpdatedEnvelope = SocketEnvelopeBase<
  'comment.updated',
  CommentUpdatedData
> & {
  projectId: string;
};

export type CommentDeletedEnvelope = SocketEnvelopeBase<
  'comment.deleted',
  CommentDeletedData
> & {
  projectId: string;
};

export type ProjectUpdatedEnvelope = SocketEnvelopeBase<
  'project.updated',
  ProjectUpdatedData
> & {
  projectId: string;
};

export type NotificationCreatedEnvelope = SocketEnvelopeBase<
  'notification.created',
  NotificationCreatedData
>;

export type RiskDetectedEnvelope = SocketEnvelopeBase<'risk.detected', RiskDetectedData> & {
  projectId: string;
};

export type RiskUpdatedEnvelope = SocketEnvelopeBase<'risk.updated', RiskUpdatedData> & {
  projectId: string;
};

export type MembershipChangedEnvelope = SocketEnvelopeBase<
  'membership.changed',
  MembershipChangedData
> & {
  projectId: string;
};

/**
 * Discriminated union of all 13 real-time event envelopes.
 * Keyed strictly on the `event` literal field.
 */
export type RealtimeEventEnvelope =
  | TaskCreatedEnvelope
  | TaskUpdatedEnvelope
  | TaskStatusChangedEnvelope
  | TaskAssignedEnvelope
  | TaskDeletedEnvelope
  | CommentCreatedEnvelope
  | CommentUpdatedEnvelope
  | CommentDeletedEnvelope
  | ProjectUpdatedEnvelope
  | NotificationCreatedEnvelope
  | RiskDetectedEnvelope
  | RiskUpdatedEnvelope
  | MembershipChangedEnvelope;

// ============================================================================
// 6. CLIENT-TO-SERVER (C2S) PROTOCOL
// ============================================================================

export interface HandshakeAuth {
  token?: string;
}

export interface SubscribeProjectPayload {
  projectId: string;
}

export interface UnsubscribeProjectPayload {
  projectId: string;
}

export interface SubscriptionAckResponse {
  ok: boolean;
  room?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface SocketErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ClientToServerEvents {
  'subscribe:project': (
    payload: SubscribeProjectPayload,
    ack?: (response: SubscriptionAckResponse) => void,
  ) => void;
  'unsubscribe:project': (
    payload: UnsubscribeProjectPayload,
    ack?: (response: SubscriptionAckResponse) => void,
  ) => void;
}

/**
 * 13 business events + 1 protocol error channel (§7.2)
 */
export interface ServerToClientEvents {
  'task.created': (envelope: TaskCreatedEnvelope) => void;
  'task.updated': (envelope: TaskUpdatedEnvelope) => void;
  'task.status_changed': (envelope: TaskStatusChangedEnvelope) => void;
  'task.assigned': (envelope: TaskAssignedEnvelope) => void;
  'task.deleted': (envelope: TaskDeletedEnvelope) => void;
  'comment.created': (envelope: CommentCreatedEnvelope) => void;
  'comment.updated': (envelope: CommentUpdatedEnvelope) => void;
  'comment.deleted': (envelope: CommentDeletedEnvelope) => void;
  'project.updated': (envelope: ProjectUpdatedEnvelope) => void;
  'notification.created': (envelope: NotificationCreatedEnvelope) => void;
  'risk.detected': (envelope: RiskDetectedEnvelope) => void;
  'risk.updated': (envelope: RiskUpdatedEnvelope) => void;
  'membership.changed': (envelope: MembershipChangedEnvelope) => void;
  error: (payload: SocketErrorPayload) => void;
}

// ============================================================================
// 7. REDIS PUB/SUB BUS SHAPE
// ============================================================================

export const REDIS_REALTIME_BUS_CHANNEL = 'rt:events' as const;

export interface RedisBusMessage {
  targetRoom: ProjectRoomId | UserRoomId;
  envelope: RealtimeEventEnvelope;
}
