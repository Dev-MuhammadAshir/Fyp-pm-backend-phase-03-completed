// System Constants per SRS v3.0, OpenAPI 3.1 & Decision Register
export const APP_CONSTANTS = {
  API_PREFIX: "/api/v1",
  DEFAULT_PORT: 3000,

  // Token lifetimes
  ACCESS_TOKEN_EXPIRY_SEC: 900, // 15 min (SRS CA-06, AC-AUTH-11)
  REFRESH_TOKEN_EXPIRY_SEC: 604800, // 7 days

  // Security thresholds
  BCRYPT_SALT_ROUNDS: 12, // SRS DC-10
  MAX_FAILED_LOGIN_ATTEMPTS: 5, // SRS FR-AUTH-08, NFR-SEC-06
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 min

  // Rate Limiting (NFR-SEC-08)
  RATE_LIMIT_MAX: 100, // 100 req / 15 min per user
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,

  // Attachments (CA-10, FR-ATT-01..05)
  ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024, // 10 MB cap
  ALLOWED_MIME_TYPES: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ] as const,

  // Comments (FR-COMM-03, BR-COL-02)
  COMMENT_EDIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes

  // Pagination defaults (FR-API-04, FR-API-05)
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,

  // Room naming patterns (SRS §7.3)
  ROOMS: {
    project: (projectId: string) => `project:${projectId}`,
    user: (userId: string) => `user:${userId}`,
  },

  // 13 Frozen Realtime Events (SRS §7.2, CA-07)
  EVENTS: {
    TASK_CREATED: "task.created",
    TASK_UPDATED: "task.updated",
    TASK_STATUS_CHANGED: "task.status_changed",
    TASK_ASSIGNED: "task.assigned",
    TASK_DELETED: "task.deleted",
    COMMENT_CREATED: "comment.created",
    COMMENT_UPDATED: "comment.updated",
    COMMENT_DELETED: "comment.deleted",
    PROJECT_UPDATED: "project.updated",
    NOTIFICATION_CREATED: "notification.created",
    RISK_DETECTED: "risk.detected",
    RISK_UPDATED: "risk.updated",
    MEMBERSHIP_CHANGED: "membership.changed",
  } as const,
} as const;
