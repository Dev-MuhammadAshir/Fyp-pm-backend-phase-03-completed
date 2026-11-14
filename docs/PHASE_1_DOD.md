# Phase 1 — Real-Time Infrastructure: Definition of Done (DoD)

**Project:** Real-Time Team Project Management Platform with Predictive Insights  
**FYP Reference:** 2K23/SWEE/21, University of Sindh  
**Document Status:** Complete & Verified  
**Authority Hierarchy:** SRS v3.0 (`SRS_3.0_CONSOLIDATED_BASELINE_e782668d.md`) is the single source of truth. OpenAPI (`OpenApi-Specification.txt`) is the companion contract.

---

## 1. Executive Summary

Phase 1 establishes the foundational real-time infrastructure for the platform. It provides a horizontal, multi-instance-capable Pub/Sub event bridge using Redis 7 and Socket.IO 4.8 mounted on Node.js 24 LTS and Express 4.21. All 13 frozen business events, the two canonical room formats, standard message envelopes, handshake authentication, and authorization rules are strictly implemented and verified.

---

## 2. Frozen Architectural Decisions & Constraints

| Decision ID | Description | Implementation Detail |
|:---|:---|:---|
| **CA-01** | Strict Schema Alignment | All domain enums (`RealtimeTaskStatus`, `RealtimePriority`, `RealtimeRiskType`, `RealtimeRiskSeverity`, `RealtimeRiskStatus`) match PostgreSQL schema types. |
| **CA-07** | 13 Frozen Real-Time Events | Exactly 13 events defined in `shared/socket.contract.ts`. No extra business events, no renames, no deletions. |
| **CA-09** | Standard Real-Time Envelope | All server-to-client events follow SRS §7.1: `{ eventId, event, timestamp, actorId, projectId?, data }`. |
| **CA-13** | Canonical Room Strategy | Exactly two room formats per SRS §7.3: `project:${projectId}` and `user:${userId}`. Generated via `projectRoom()` and `userRoom()` helper functions. |
| **Rule 2** | Backend-Only Scope | Pure TypeScript backend running on Node.js 24 LTS. No frontend libraries or mock substitutes. |
| **Rule 9** | Project Role Refinement | `Administrator` role bypasses project membership checks. All other roles require explicit `projectMember` records in PostgreSQL. |
| **Rule 16** | Strict TypeScript Typing | Zero `any` in production code. Full discriminated union (`RealtimeEventEnvelope`) keyed on `event`. |
| **Bus Design** | Single Global Redis Channel | Single Redis channel `rt:events` with payload `{ targetRoom, envelope }`. Avoids channel explosion across projects and supports horizontal scaling. |
| **Handshake Auth** | Token Extraction Priority | Primary token lookup at `socket.handshake.auth.token`; fallback to `Authorization: Bearer <token>` in handshake headers. |
| **Account Status** | FR-RT-03 MVP Check | Handshake queries PostgreSQL to verify `user.isActive === true`. Inactive or missing accounts receive `AUTH_ACCOUNT_INACTIVE`. |

---

## 3. Frozen Event Catalog (SRS §7.2)

| # | Event Name | Trigger | Target Room | Payload Fields |
|:---|:---|:---|:---|:---|
| 1 | `task.created` | Task inserted | `project:${projectId}` | `{ taskId, title, status, priority }` |
| 2 | `task.updated` | Task attributes modified | `project:${projectId}` | `{ taskId, changes }` |
| 3 | `task.status_changed` | Kanban state change | `project:${projectId}` | `{ taskId, oldStatus, newStatus }` |
| 4 | `task.assigned` | Assignee added/removed | `project:${projectId}` + `user:${assigneeId}` | `{ taskId, assigned: { userId, action } }` |
| 5 | `task.deleted` | Task archived/deleted | `project:${projectId}` | `{ taskId }` |
| 6 | `comment.created` | Comment inserted | `project:${projectId}` | `{ commentId, taskId, body }` |
| 7 | `comment.updated` | Comment edited (<= 15 min) | `project:${projectId}` | `{ commentId, taskId, body, updatedAt }` |
| 8 | `comment.deleted` | Comment deleted | `project:${projectId}` | `{ commentId, taskId }` |
| 9 | `project.updated` | Project fields modified | `project:${projectId}` | `{ projectId, changes }` |
| 10 | `notification.created` | Notification persisted | `user:${userId}` | `{ notificationId, type, payload }` |
| 11 | `risk.detected` | PIRAE risk assessment generated | `project:${projectId}` | `{ riskId, riskType, severity, reason }` |
| 12 | `risk.updated` | PIRAE risk status updated | `project:${projectId}` | `{ riskId, status, resolvedAt }` |
| 13 | `membership.changed` | Project member added/removed/updated | `project:${projectId}` | `{ userId, role, action }` |

*Note on protocol channels:* In addition to the 13 frozen domain events, a protocol-level `error` event is exposed to notify clients of room authorization or input errors (`{ code, message, details? }`).

---

## 4. Component Inventory

```
fyp-pm-backend/
├── shared/
│   └── socket.contract.ts          # Frozen real-time contract (13 events, rooms, envelopes, types)
├── src/
│   ├── core/
│   │   └── errors/
│   │       └── codes.ts            # Added AUTH_TOKEN_*, AUTHZ_NOT_PROJECT_MEMBER
│   ├── infra/
│   │   └── redis/
│   │       ├── publisher.ts        # publishRealtime() broadcasting to rt:events
│   │       └── subscriber.ts       # startRealtimeSubscriber() forwarding to Socket.IO rooms
│   ├── realtime/
│   │   └── gateway.ts              # initSocketGateway(), auth middleware, room join/leave
│   └── server.ts                   # Gateway attachment and graceful teardown
├── tests/
│   ├── helpers/
│   │   └── socket-test-helpers.ts  # buildTestJwt, connectTestSocket, waitForEvent
│   ├── unit/
│   │   └── realtime/
│   │       └── contract.test.ts    # Contract verification (13 events, room helpers, envelope)
│   └── realtime/
│       └── gateway.rt.test.ts      # 10 integration test cases (a–j) on ephemeral port
├── scripts/
│   └── smoke/
│       └── phase-1.smoke.ts        # Operational E2E smoke runner (steps [A] through [H])
└── docs/
    └── PHASE_1_DOD.md              # Phase 1 Definition of Done (this document)
```

---

## 5. Verification Matrix & Concrete Commands

### 5.1 Static Analysis & Linting

```bash
# 1. TypeScript Strict Typechecking
npm run typecheck

# 2. ESLint Zero Warnings Check
npm run lint
```
*Criteria:* Zero errors, zero warnings.

### 5.2 Unit Tests

```bash
# Run unit test suite (contract tests)
npx vitest run tests/unit/realtime/contract.test.ts
```
*Pass Criteria (4/4 tests):*
- Exact 13 frozen events matching SRS §7.2
- `projectRoom` and `userRoom` formatting and typing
- `REDIS_REALTIME_BUS_CHANNEL` equals `'rt:events'`
- JSON serialization/deserialization retains standard envelope shape

### 5.3 Gateway Integration Tests

```bash
# Run integration test suite (requires PostgreSQL on :5433, Redis on :6379, and seeded data)
npm run prisma:seed
npx vitest run tests/realtime/gateway.rt.test.ts
```
*Pass Criteria (10/10 tests):*
- `(a)` Valid token connects and auto-joins personal `user:{userId}` room
- `(b)` Missing token handshake rejected with `AUTH_TOKEN_MISSING`
- `(c)` Expired token handshake rejected with `AUTH_TOKEN_EXPIRED`
- `(d)` Tampered token signature rejected with `AUTH_TOKEN_INVALID`
- `(e)` Inactive account rejected with `AUTH_ACCOUNT_INACTIVE` (FR-RT-03)
- `(f)` Authorized project member can subscribe and receive project room events
- `(g)` Non-member subscription rejected with `AUTHZ_NOT_PROJECT_MEMBER`
- `(h)` Administrator bypasses project membership requirement (Rule 9)
- `(i)` Unsubscription prevents subsequent room event delivery
- `(j)` Redis Pub/Sub broadcast fans out to multiple connected subscribers

### 5.4 Operational End-to-End Smoke Test

```bash
# Execute standalone smoke test runner
npm run smoke:phase-1
```
*Pass Criteria (8/8 steps):*
```
[SMOKE] Mode: existing (http://127.0.0.1:3000) OR boot (ephemeral http://127.0.0.1:XXXXX)
[A] Health endpoint verified (status: healthy, database: up, redis: up)
[B] Redis Pub/Sub verified (rt:events subscriber count: >= 1)
[C] JWT handshake & personal room verified (notification.created received in user:<pmId>)
[D] Project member subscription verified (pm@fyp.local subscribed to project:<projectId>)
[E] Administrator bypass verified (admin@fyp.local subscribed to project:<projectId>)
[F] Non-member subscription rejected (AUTHZ_NOT_PROJECT_MEMBER)
[G] Fan-out broadcast verified (task.created eventId delivered to both PM and Admin)
[H] Project unsubscription verified (pm@fyp.local unsubscribed, subsequent event not received)
[SMOKE] 8/8 passed
[SMOKE] PHASE 1 OK ✓
```

---

## 6. Known Gaps & Phase 2 Deferred Items

Per project requirements, Phase 1 delivers real-time infrastructure without premature authentication module features. The following items are explicitly scheduled for Phase 2:

1. **JTI Token Revocation / Blacklist in Redis:**  
   *Current State (Phase 1):* Handshake validates JWT cryptographic signature, expiry, and user active status via PostgreSQL.  
   *Phase 2 Implementation:* Handshake middleware will check `jti` against Redis revocation blacklist (`auth:blacklist:<jti>`) maintained by token revocation services. Documented via single-line JSDoc in `src/realtime/gateway.ts`.

2. **Refresh Session Verification:**  
   *Current State (Phase 1):* Only access tokens are accepted at Socket.IO handshake.  
   *Phase 2 Implementation:* Integration with `tokenService.verifyAccess` for unified session validation across REST and WebSockets.

---

## 7. Phase 1 Sign-Off Checklist

- [x] All 13 real-time events match SRS §7.2 exactly.
- [x] Room naming strategy strictly follows `project:${projectId}` and `user:${userId}`.
- [x] Single global Redis bus channel `rt:events` handling `{ targetRoom, envelope }`.
- [x] Handshake authentication enforces valid JWT with fallback header support.
- [x] User active status checked via PostgreSQL on connection (FR-RT-03).
- [x] Personal user room auto-joined upon successful connection.
- [x] Project membership authorization enforced on `subscribe:project`.
- [x] Administrator bypass verified per Rule 9.
- [x] Clean project room unsubscription verified.
- [x] No mocks, fakes, or stubs in production or test paths.
- [x] No `any` types in production codebase.
- [x] Full operational smoke test suite passing (8/8 steps).
- [x] Phase 1 officially complete and ready for Phase 2 (Authentication & User Management).
