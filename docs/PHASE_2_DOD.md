# Phase 2 — Auth Hardening: Definition of Done

**Project:** Real-Time Team Project Management Platform with Predictive Insights  
**FYP Reference:** 2K23/SWEE/21, University of Sindh  
**Authority:** SRS v3.0 (single source of truth)  
**Document Status:** Complete & Verified (pending sign-off)  
**Phase Duration:** Chunks A → D.3  

---

## 1. Executive Summary

Phase 2 delivers the complete authentication and user-administration backend for the platform. Admin-provisioned accounts, JWT sessions, refresh-token rotation, JTI blacklist, account lockout, and full RBAC user management are all implemented, tested, and operational.

All mutations are transactional with audit logging, all active sessions are revoked upon role change or deactivation, all passwords are encrypted with `bcryptjs` using cost factor $\ge 12$, and all inputs are strictly validated with Zod schemas.

---

## 2. Delivered Chunks

### Chunk A — Foundation (`dd4dd53`)
- `src/core/errors/codes.ts`: Added `REFRESH_TOKEN_INVALID` and `REFRESH_TOKEN_REVOKED`.
- `src/types/express.d.ts`: Request user augmentation (`userId`, `email`, `globalRole`, `jti`, `tokenType`).
- `src/modules/auth/auth.schemas.ts`: Strict Zod validation schemas (`LoginRequestSchema`, `RefreshTokenRequestSchema`, `LogoutRequestSchema`, `UpdateProfileRequestSchema`, `ChangePasswordRequestSchema`).
- `src/modules/auth/password.service.ts`: `bcryptjs` password hashing enforcing cost $\ge 12$ via `env.BCRYPT_SALT_ROUNDS`.
- `src/modules/auth/token.service.ts`: JWT access and refresh token issuance/verification, Redis session storage with pipeline optimization, and JTI blacklisting.
- `src/core/middleware/authenticate.ts`: Bearer token extraction, JTI blacklist verification, active status check.
- `src/core/middleware/authorize.ts`: Global role RBAC gate without implicit Administrator bypass.
- `src/modules/auth/index.ts`: Public module barrel export.

### Chunk B — Auth Endpoints (`bf6d7ca`)
- `src/modules/auth/auth.repository.ts`: User lookup, lockout tracking, and profile mutations supporting optional transactions.
- `src/modules/auth/auth.service.ts`: `login` (lockout on 5 consecutive failures, active account gate), `refresh` (rotation and old session revocation), `logout` (Errata E-007 compliant), `getMe`, `updateProfile`, `changePassword` (session revocation + JTI blacklist).
- `src/modules/auth/auth.controller.ts`: REST endpoint controllers with standard response envelope.
- `src/modules/auth/auth.routes.ts`: Routes mounted under `/api/v1/auth`.

### Chunk C — Users Module + Gateway Refactor
- `src/modules/users/users.schemas.ts`: Strict schemas (`ListUsersQuerySchema` with `isActive` enum+transform footgun fix, `UserIdParamSchema`, role/status update schemas).
- `src/modules/users/users.repository.ts`: User directory pagination, search, role filtering, `countActiveAdmins`.
- `src/modules/users/users.service.ts`: User provisioning with password hashing, self-guards, last-admin protection, session revocation on role/status changes, transactional audit logging without password leaks.
- `src/modules/users/users.controller.ts`: REST controllers using `sendPaginated` and `sendSuccess`.
- `src/modules/users/users.routes.ts`: Routes mounted under `/api/v1/users` restricted to Administrator.
- `src/modules/users/index.ts`: Public module barrel export.
- `src/realtime/gateway.ts`: Handshake authentication refactored to delegate to `tokenService.verifyAccessToken(token)`, checking JTI blacklist and active account status in DB.

### Chunk D.1 — Unit Tests (82 tests)
- `tests/unit/auth/password.service.test.ts` (8 tests): Cost factor verification, hash generation, mismatch rejection, empty string handling.
- `tests/unit/auth/token.service.test.ts` (15 tests): Access/refresh token lifecycle, JTI blacklist, targeted DEL Redis cleanup without FLUSHDB.
- `tests/unit/auth/auth.schemas.test.ts` (34 tests): Password policy, email lowercase trimming, valid role enum isolation.
- `tests/unit/users/users.schemas.test.ts` (25 tests): Pagination defaults, `isActive: "false"` transform assert, UUID param format.

### Chunk D.2a — Auth API Integration Tests (37 tests)
- `tests/api/auth.api.test.ts` (37 tests): Full HTTP flow via Supertest covering login (8), lockout (4×401 $\rightarrow$ 423 $\rightarrow$ 423), refresh rotation (6), E-007 logout with expired token (5), me GET (6), me PATCH (7), password change with session revocation (5).

### Chunk D.2b — Users API Integration Tests (46 tests)
- `tests/api/users.api.test.ts` (46 tests): User directory list (10), user provisioning (9), self-or-admin profile access (7), role update with self-guard and audit (9), status update with self-guard and audit (11).

### Chunk D.3 — Smoke + DoD (this chunk)
- `scripts/smoke/phase-2.smoke.ts`: 11-step operational end-to-end smoke test against live database and Redis.
- `docs/PHASE_2_DOD.md`: Phase 2 Definition of Done specification.
- `package.json`: Added `npm run smoke:phase-2` script.

---

## 3. Verification Matrix

| Category | Evidence |
|---|---|
| Total tests | **179 passing** (0 failures) |
| Test runtime | ~52s (real bcrypt cost-12, real DB, real Redis) |
| Phase 2 smoke | `[SMOKE] 11/11 passed` (see `scripts/smoke/phase-2.smoke.ts`) |
| Phase 1 smoke (regression) | 8/8 passing (unchanged after gateway refactor) |
| typecheck | PASS (`tsc --noEmit`) |
| lint | PASS (`eslint . --max-warnings 0`) |
| Mocks/stubs/fakes | 0 (verified via repository audit) |
| FLUSHDB on Redis | 0 (targeted DEL only) |
| Seed user mutation | 0 (all mutations target temporary test users) |

*Smoke step [G] note:* Smoke step [G] uses `GET /users?page=1&limit=100` (not `limit=20` default) because local DB may contain accumulated soft-deleted test users from prior npm test runs (L-01). Assertion uses `data.some(u => u.id === testUserId)` — does NOT assert `meta.total` count (which varies with soft-deleted accumulation).

---

## 4. SRS Compliance

| Requirement ID | Description | Status | Verification Evidence |
|---|---|---|---|
| **FR-AUTH-01** | Account login via email & password | ✅ Complete | Tested in `auth.api.test.ts` & smoke step [B] |
| **FR-AUTH-02** | Password hashing with bcrypt cost $\ge 12$ | ✅ Complete | Tested in `password.service.test.ts` (`env.BCRYPT_SALT_ROUNDS`) |
| **FR-AUTH-03** | Issue short-lived access JWT (15m) & refresh token (7d) | ✅ Complete | Tested in `token.service.test.ts` & `auth.api.test.ts` |
| **FR-AUTH-04** | Stateless JWT validation on protected endpoints | ✅ Complete | Tested in `authenticate.ts` & all API test files |
| **FR-AUTH-05** | Administrator provisions user accounts | ✅ Complete | Tested in `users.api.test.ts` & smoke step [E] |
| **FR-AUTH-06** | User profile view & update (`/auth/me`) | ✅ Complete | Tested in `auth.api.test.ts` & smoke step [C] |
| **FR-AUTH-07** | Account activation & deactivation by Administrator | ✅ Complete | Tested in `users.api.test.ts` & smoke steps [I], [J] |
| **FR-AUTH-08** | Account lockout after 5 failed login attempts (15 min) | ✅ Complete | Tested in `auth.api.test.ts` (returns HTTP 423) |
| **FR-AUTH-09** | Role assignment & updates restricted to Administrator | ✅ Complete | Tested in `users.api.test.ts` & smoke step [H] |
| **FR-AUTH-10/11**| Logout & token invalidation via Redis JTI blacklist | ✅ Complete | Tested in `auth.api.test.ts` & smoke step [K] |
| **FR-AUTH-12** | Team creation restricted to Administrator | ⏸️ Deferred | Phase 3 (Teams module) |
| **FR-RBAC-01..05**| RBAC authorization matrix & permission gates | ✅ Complete | Tested in `users.api.test.ts` (403 for non-admins) |
| **CA-04** | Admin-provisioned accounts only (no public registration) | ✅ Complete | Enforced via admin gate on `POST /api/v1/users` |
| **CA-05** | Team creation admin-only | ⏸️ Deferred | Phase 3 (Teams module) |
| **CA-06** | JWT 15m + refresh 7d + Redis JTI blacklist | ✅ Complete | Tested in `token.service.test.ts` and API suites |
| **CA-12** | Audit log append-only enforcement | ✅ Complete | Enforced via DB trigger; tested in test suites |
| **CA-18** | Frozen Global Role matrix enforcement | ✅ Complete | Tested in `authorize.ts` and `users.routes.ts` |
| **NFR-SEC-02** | Bcrypt cost factor $\ge 12$ | ✅ Complete | Verified in `password.service.ts` |
| **NFR-SEC-04** | JTI blacklisting for token revocation | ✅ Complete | Verified in `token.service.ts` and `authenticate.ts` |
| **NFR-SEC-06** | Account lockout security | ✅ Complete | Verified in `auth.service.ts` |
| **NFR-SESS-01** | Redis-backed session management | ✅ Complete | Verified in `token.service.ts` |
| **Errata E-007** | Logout accepts refreshToken in payload | ✅ Complete | Tested in `auth.api.test.ts` |
| **Errata G-20** | Expired access token accepted for logout | ✅ Complete | Tested in `auth.api.test.ts` |

---

## 5. Known Limitations & Explicit Deferrals

### L-01: Soft-deleted test users accumulate in local test runs
Test cleanup cannot hard-delete users with audit history (audit_logs append-only trigger blocks foreign key cascading via ON DELETE SET NULL). Tests fall back to soft-delete (`isActive=false`, `email=deleted-<uuid>@fyp.local`).
- **Impact:** Local development database accumulates `deleted-*` rows from running `npm test`.
- **Mitigation:** Production users are never deleted per SRS. Local development reset can be performed with `npx prisma migrate reset && npm run prisma:seed`.

### L-02: Audit oldValues/newValues field-level diffs not asserted in tests
Audit row presence verified in tests (row exists, actorId correct, entityType='User', action='UPDATE', no passwordHash substring). Field-level oldValues/newValues correctness deferred to Chunk C code review — transaction correctly captures before/after state via before-read-inside-tx pattern.

### L-03: Last-admin guard firing path is defense-in-depth
The `LAST_ADMIN_PROTECTED` code path in `users.service.ts` is defense-in-depth: it can only fire when `countActiveAdmins(excludeTarget, tx) === 0`, which requires the requesting actor to be deactivated mid-request (race condition) or a code bug. In standard operational flow, the actor is always an active admin and seed admin exists, while the self-guard fires first if the administrator attempts to demote or deactivate themselves.
- **Coverage:** Verified via code review and indirect tests confirming multiple active admins can demote other admins without false triggers.

### L-04: Password change access-token blacklist not explicitly tested
`PATCH /auth/password` revokes all active refresh sessions and immediately blacklists the current access token's JTI. The test suite asserts that refresh sessions are revoked and the user can log in with their new password. The immediate access token blacklist is code-reviewed.
- **Deferral:** Add explicit access token JTI blacklist assertion during Phase 3 test polish.

### L-05: Empty-password login test gap
Empty-password login (`POST /auth/login` with `password: ""`) is rejected by `LoginRequestSchema` (`z.string().min(1)`) but has no explicit test. Deferral: add to Phase 3 test polish.

### L-06: PATCH /auth/me empty body returns 200 no-op
Both schema fields (`fullName` and `configuredCapacityHours`) in `UpdateProfileRequestSchema` are optional and `.strict()`. Sending `{}` results in a valid no-op update (no audit row, no field changes, HTTP 200 returned). This matches specification behavior and is documented with an inline test comment in `auth.api.test.ts`.

---

## 6. Phase 3 Deferrals (Scope of Next Phase)

The following components are deferred to Phase 3 (Teams & Projects):
- Teams module (CRUD, membership assignment) — `FR-TEAM-01..05`
- Project module (CRUD, member assignment, project-scoped RBAC) — `FR-PROJ-01..07`
- Project membership authorization middleware (`requireProjectMember`)
- Project-level role resolution (Manager / Contributor / Viewer refinement over global roles)
- Team room strategy and broadcast delivery for `membership.changed` events
- Optional `POST /auth/register` alias for `POST /users` (if requested; SRS does not mandate public registration)
- Polish tests for L-04 (password change JTI blacklist) and L-05 (empty password login validation)

---

## 7. Phase 2 Sign-Off Checklist

- [x] Chunk A: Foundation services, schemas, and RBAC middleware
- [x] Chunk B: 6 authentication endpoints with lockout and rotation
- [x] Chunk C: 5 user administration endpoints with self-guards and gateway refactor
- [x] Chunk D.1: 82 unit tests (password, token, auth schemas, user schemas)
- [x] Chunk D.2a: 37 auth API integration tests
- [x] Chunk D.2b: 46 users API integration tests
- [x] Chunk D.3: 11-step operational smoke test & DoD
- [x] 179/179 automated tests passing
- [x] TypeScript typecheck PASS (`tsc --noEmit`)
- [x] ESLint PASS (`eslint . --max-warnings 0`)
- [x] Phase 1 real-time smoke test still 8/8 passing (zero regressions)
- [x] Phase 2 operational smoke test 11/11 passing
- [x] Zero mocks, stubs, or fake adapters in production code or tests
- [x] No `FLUSHDB` or destructive Redis commands executed
- [x] Seed user accounts remain read-only and unmutated
- [x] Errata E-007 (logout request payload) verified
- [x] Errata G-20 (logout with expired access token) verified
- [x] Core architecture decisions applied: CA-04, CA-06, CA-12, CA-18

**Status:** [x] **PHASE 2 CLOSED — Ready to proceed to Phase 3 (Teams & Projects)**

---

## 8. Sign-Off

**Lead Engineer:** AI System Assistant  
**Date:** November 8, 2026  
**Reference Git Head:** Phase 2 Completion Baseline  
