# Phase 3 — Teams & Projects: Definition of Done

**Project:** Real-Time Team Project Management Platform with Predictive Insights  
**FYP Reference:** 2K23/SWEE/21, University of Sindh  
**Authority:** SRS v3.0 (single source of truth)  
**Document Status:** Complete & Verified (pending sign-off)  
**Phase Duration:** Chunks 3A → 3F

---

## 1. Executive Summary

Phase 3 delivers the Teams and Projects modules of the platform:
- Team CRUD with membership management
- Project CRUD with lifecycle (`Active` → `Archived`)
- Project-scoped RBAC (`Manager` / `Contributor` / `Viewer`)
- Realtime emission for `project.updated` and `membership.changed`
- Last-Manager guard (`D6`) — defense-in-depth
- Creator enrollment (`A2`) — automatic `Manager` on project create
- Team-scoped creation gate (`A4`) — PM must be team member
- Cross-team project membership permitted (`A5`)

Test suite at Phase 3 close: **412/412 passing (16 files)**.  
Smoke tests: Phase 1 (8/8), Phase 2 (11/11), Phase 3 (14/14 checks `[A]`–`[N]`).  
Typecheck PASS, Lint PASS. Zero mocks in production or tests.

---

## 2. Delivered Chunks

### Chunk 3A — Teams Foundation
Files:
- `src/modules/teams/teams.schemas.ts` (NEW)
- `src/modules/teams/teams.repository.ts` (NEW)
- `src/modules/teams/teams.service.ts` (NEW)
- `src/core/middleware/requireTeamMember.ts` (NEW)
- `src/modules/teams/index.ts` (NEW)
- `src/core/errors/codes.ts` (ADDITIVE +1 line: `AUTHZ_NOT_TEAM_MEMBER`)

Design: `A1` (creator as `Admin-Assigned` on team create), `A3` (strict `requireTeamMember` middleware).

### Chunk 3B — Teams Endpoints
Files:
- `src/modules/teams/teams.controller.ts` (NEW)
- `src/modules/teams/teams.routes.ts` (NEW)
- `src/routes/v1.ts` (EDIT additive: mount `/teams`)
- `src/modules/teams/index.ts` (EDIT additive)

8 routes: `POST /teams` (admin only), `GET /teams`, `GET /teams/:teamId`, `PATCH /teams/:teamId` (Admin+PM via E-005 `TEAM_MANAGE_MEMBERS`), `DELETE /teams/:teamId` (admin only, cascade), `GET/POST/DELETE /teams/:teamId/members`.

### Chunk 3C — Projects Foundation + Migration
Files:
- `prisma/schema.prisma` (ADDITIVE: `endDate` field)
- `prisma/migrations/20261112120000_phase_3_add_projects_end_date/migration.sql` (NEW)
- `src/modules/projects/projects.schemas.ts` (NEW)
- `src/modules/projects/projects.repository.ts` (NEW)
- `src/modules/projects/projects.service.ts` (NEW)
- `src/core/middleware/requireProjectMember.ts` (NEW)
- `src/modules/projects/index.ts` (NEW)

Design: `D1` (`end_date` added), `D3` (`Manager`/`Contributor`/`Viewer` only), `D6` (last-Manager guard), `A2` (creator → `Manager` in tx), `A4` (PM team check), `A5` (no team check on project membership), `A7` (project status enum Zod-only), `A8` (archive-once with `409`).

### Chunk 3D — Projects Endpoints + Realtime
Files:
- `src/core/middleware/requireProjectManager.ts` (NEW)
- `src/modules/projects/projects.controller.ts` (NEW)
- `src/modules/projects/projects.routes.ts` (NEW)
- `src/routes/v1.ts` (EDIT additive: mount `/projects`)
- `src/modules/projects/index.ts` (EDIT additive)

10 routes with three-gate chain on mutations:
`authenticate` → `authorize(Administrator, Project Manager)` → `requireProjectMember` → `requireProjectManager` → `validate` → controller.

Realtime emission (`D4`):
- `project.updated` on `PATCH /projects/:projectId` (7-field diff)
- `membership.changed` on `POST/PATCH/DELETE /projects/:projectId/members` with actions `"added" | "role_updated" | "removed"`
- NO emit for `POST /projects` or `DELETE /projects/:projectId` (no frozen event)

### Chunk 3E.1 — Unit Schema Tests
Files:
- `tests/unit/teams/teams.schemas.test.ts` (NEW — 42 tests)
- `tests/unit/projects/projects.schemas.test.ts` (NEW — 54 tests)

96 tests. Pure Zod validation.

### Chunk 3E.1-R2 — Auth Barrel Cycle Fix
Files:
- `src/modules/auth/index.ts` (EDIT: removed `authRouter` re-export)
- `src/routes/v1.ts` (EDIT: import `authRouter` from `auth.routes.js`)
- Test file corrections (5 bugs corrected against frozen schemas)

Design: Pre-existing cycle (`authenticate` → `auth/index` → `auth.routes` → `authenticate`) was exposed by 3E.1. Root cause fixed by removing router re-export from auth barrel. `v1.ts` imports router directly from `auth.routes.js`. Routing-layer exception to Rule #12 justified (routers consumed only by routing composition).

### Chunk 3E.2a — Teams API Integration Tests
Files:
- `tests/helpers/team-project-helpers.ts` (NEW)
- `tests/api/teams.api.test.ts` (NEW)

42 tests. Real Supertest + real Prisma + real Redis + real bcryptjs.

### Chunk 3E.2b — Projects API Integration Tests
Files:
- `tests/helpers/team-project-helpers.ts` (EDIT: add project methods)
- `tests/api/projects.api.test.ts` (NEW)

51 tests. Covers `A2`, `A4`, `A5`, `A8`, `D6` explicitly.

### Chunk 3F — Phase 3 Smoke + DoD (this chunk)
Files:
- `scripts/smoke/phase-3.smoke.ts` (NEW)
- `docs/PHASE_3_DOD.md` (NEW)
- `package.json` (EDIT: add `smoke:phase-3` script)

---

## 3. Verification Matrix

| Category | Result |
|---|---|
| Total tests | **412 passing / 412 (16 files)** (verified against local Docker Postgres + Redis) |
| Test runtime | ~106s |
| Phase 1 smoke | 8/8 passing (unchanged) |
| Phase 2 smoke | 11/11 passing (unchanged) |
| Phase 3 smoke | **14/14 steps `[A]`–`[N]`** (`npm run smoke:phase-3`) |
| typecheck | PASS (`tsc --noEmit`, 0 errors) |
| lint | PASS (`eslint . --max-warnings 0`, 0 warnings) |
| Mocks/stubs/fakes | 0 (grep-verified) |
| FLUSHDB | 0 |
| Seed user mutation | 0 (all tests use temp users) |

---

## 4. SRS Compliance

| Requirement | Status | Evidence |
|---|---|---|
| **FR-TEAM-01** (create, admin-only) | ✅ | 3B + 3E.2a |
| **FR-TEAM-02** (manage members) | ✅ | 3B + 3E.2a |
| **FR-TEAM-03** (membership restricted to PM/Admin) | ✅ | 3B + 3E.2a |
| **FR-TEAM-04** (unauthorized provisioning prevented) | ✅ | 3E.2a (all 403 tests) |
| **FR-TEAM-05** (audit) | ✅ | 3A + 3E.2a (audit assertions) |
| **FR-PROJ-01** (create projects) | ✅ | 3D + 3E.2b |
| **FR-PROJ-02** (dates, priority, status) | ✅ | 3C (`end_date` migration + schema) |
| **FR-PROJ-03** (manage members) | ✅ | 3D + 3E.2b |
| **FR-PROJ-04** (project roles) | ✅ | 3C + 3D + 3E.2b |
| **FR-PROJ-05** (monitor progress) | ✅ | 3D + 3E.2b (progress endpoint) |
| **FR-PROJ-06** (project-level permissions) | ✅ | 3D (`requireProjectManager`) + 3E.2b |
| **FR-PROJ-07** (audit) | ✅ | 3C + 3E.2b (audit assertions) |
| **CA-05** (team creation admin-only) | ✅ | 3B + 3E.2a |
| **CA-18** (unified permission matrix) | ✅ | 3D (three-gate chain) |
| **Errata E-001** (Owner role rejected) | ✅ | 3A/3C (`Admin-Assigned`/`Member` only) |
| **Errata E-005** (`TEAM_MANAGE_MEMBERS` umbrella) | ✅ | 3B (`PATCH` route) |
| **D4** (`membership.changed` scope) | ✅ | 3D + 3E.2b + 3F (emission verified) |

---

## 5. Design Decisions Applied

### D1 — `projects.end_date`
Added via additive migration `20261112120000_phase_3_add_projects_end_date`. Nullable `TIMESTAMPTZ`. No CHECK. Traces to SRS FR-PROJ-02 + Catalogue G-03.

### D3 — Team roles
Only `Admin-Assigned` | `Member`. NO `"Owner"` (SRS §6.2 CHECK + CH-44 + Errata E-001). No last-team-owner invariant.

### D4 — `membership.changed` scope
Emitted for project membership changes to `project:<projectId>` room. Team membership changes are audit-only (no socket event).

### D6 — Last-Manager guard
Defense-in-depth parallel to last-admin guard (Phase 2). Prevents removing/demoting the sole `Manager` of a project. Uses `AUTHZ_FORBIDDEN` + custom message (NOT a new error code per A9). JSDoc notes: *"Not SRS-mandated; defense-in-depth parallel to last-admin guard per Phase 3 Decision 6."*

### A2 — Creator becomes Manager
On project create, inside same transaction, insert `ProjectMember` row for creator with `role="Manager"`. Tested in 3E.2b and verified in smoke step `[E]`.

### A4 — PM must be team member to create projects
Service-layer check: if `actorGlobalRole === "Project Manager"`, verify team membership before create. Administrator skips. Tested in `tests/api/projects.api.test.ts` (not repeated in single-team smoke script `phase-3.smoke.ts`).

### A5 — Project members need not be team members
Service validates user exists + `isActive` only. No team membership check. Tested in 3E.2b.

### A7 — Project status enum (Zod-only)
`Active` | `OnHold` | `Completed` | `Archived`. Validated via Zod `ProjectStatusSchema` (also enforced by SQL CHECK in migration `20261104155425`). Tests verify `"Done"` is rejected (task enum, not project enum).

### A8 — Archive semantics
`DELETE /projects/:projectId` sets `status="Archived"` (soft archive). Second archive → `409 CONFLICT`. Tested in 3E.2b and verified in smoke steps `[M]`–`[N]`.

### M1–M5 — Phase 2 consistency
- M1: `correlationId?: string` with `?? randomUUID()` fallback (matches Phase 2)
- M2: `ServiceContext.actorGlobalRole` (not `actorRole`)
- M3: `ListTeamsResult.rows` (not `teams`)
- M4: DTO dates as ISO-8601 strings
- M5: no internal membership re-check in `getById`/`listMembers`

### D-A — No advisory locks
Team/project name uniqueness enforced at service layer only. Race window at FYP scale documented. Phase 13 adds UNIQUE constraints + P2002 handling.

---

## 6. Known Limitations

### L-3.1 — Team/Project name uniqueness race (deferred)
Concurrent creates with same name may both pass `findByName` check before commit (rare at FYP scale, no advisory lock per D-A). Phase 13: DB UNIQUE constraint + Prisma P2002 handling → 409.

### L-3.2 — `project.updated` extra query
`PATCH /projects/:projectId` emits `project.updated` using pre-update `getById` fetch to compute diff. Adds one extra query per update (~5ms). Concurrent updates may race between `before` fetch and `update` commit — documented, acceptable for FYP scope. Phase 13: move diff into service with richer return type.

### L-3.3 — Socket lifecycle mid-connection (deferred)
Role changes and deactivations take effect immediately for REST requests (via DB `isActive` + role checks). Existing WebSocket connections are NOT force-disconnected on role change or deactivation. A previously-authorized socket may continue receiving events until disconnect. Phase 13: socket lifecycle management (SEC-07 from Phase 2 audit).

### L-3.4 — Router exports from users/teams/projects barrels
Auth barrel no longer exports `authRouter` (fixed in 3E.1-R2 to break cycle). `users`/`teams`/`projects` barrels still export their routers — this does not create cycles but is inconsistent. Phase 13 cleanup: uniformly remove router re-exports from ALL module barrels.

### L-3.5 — Health route mounting consistency (`/health` vs `/api/v1/health`)
`src/app.ts` mounts `healthRouter` at `/health`, whereas `src/routes/v1.ts` calls `v1Router.use(healthRouter)` without a `"/health"` sub-path (mounting `healthRouter.get("/")` at `/api/v1/` instead of `/api/v1/health`). `scripts/smoke/phase-3.smoke.ts` probes `/health` first with fallback to `/api/v1/health`. Phase 13 cleanup can align `/api/v1/health` if desired.

### L-3.6 — Cross-module Prisma reads in service/repository
`projects.repository.ts` directly queries `prisma.teamMember` (`findTeamMembership`) and `prisma.task` (`getProgressData`). `projects.service.ts` directly queries `tx.user` (`addMember`). These are data-layer reads, not cross-module service imports — permitted under Rule #12 (which governs service-layer dependencies, not direct data access). Phase 13 could extract cross-module shared repositories if coupling grows.

---

## 7. Phase 4 Deferrals

Scheduled for Phase 4 (Tasks + Kanban) or later:
- Tasks module (`FR-TASK-01..16`): CRUD, assignment, subtasks, dependencies, status transitions
- Kanban workflow (`FR-KAN-01..05`): drag/drop transitions, dependency DONE-gate
- Task dependency graph (`FR-TASK-07`, `FR-TASK-15`)
- Task-specific realtime events (`task.created`, `task.updated`, `task.status_changed`, `task.assigned`, `task.deleted`)
- Socket lifecycle: force-disconnect on role change / deactivation
- Realtime emission for `project.updated` extended scope (task changes reflected in project metrics — informational only)
- Rate limiting (Phase 13 per SRS §2.7)
- Outbox pattern for durable events (Phase 13)

---

## 8. Phase 3 Sign-Off Checklist

- [x] 3A: Teams Foundation (schemas, repository, service, middleware)
- [x] 3B: Teams Endpoints (8 routes)
- [x] 3C: Projects Foundation + `end_date` migration
- [x] 3D: Projects Endpoints (10 routes) + realtime emission
- [x] 3E.1: Unit schema tests (96 tests)
- [x] 3E.1-R2: Auth barrel cycle fix
- [x] 3E.2a: Teams API integration tests (42 tests)
- [x] 3E.2b: Projects API integration tests (51 tests)
- [x] 3F: Smoke (`scripts/smoke/phase-3.smoke.ts`) + DoD (this document)

**Test totals:**
- Phase 0–2 baseline: 228
- Phase 3 additions: 184 (96 unit + 42 teams + 51 projects − 5 cycle-fix corrections)
- **Total: 412/412 passing**

**Verification (local Docker Postgres + Redis target):**
- Phase 1 smoke: 8/8 (regression)
- Phase 2 smoke: 11/11 (regression)
- Phase 3 smoke: 14/14 steps `[A]`–`[N]` (`npm run smoke:phase-3`)
- typecheck: PASS
- lint: PASS
- Zero mocks (grep)
- Zero FLUSHDB
- Zero seed user mutation

**Status: [ ] PHASE 3 CLOSED — proceed to Phase 4 (Tasks + Kanban)**

---

## 9. Sign-Off

Developer: ______________________   Date: __________

Attach evidence:
- `npm test` summary (412/412)
- `npm run smoke:phase-1` output (8/8)
- `npm run smoke:phase-2` output (11/11)
- `npm run smoke:phase-3` output (14/14)
- `git log --oneline -15` (Phase 3 commits)
- `git tag` (`phase-3-closed` visible)
