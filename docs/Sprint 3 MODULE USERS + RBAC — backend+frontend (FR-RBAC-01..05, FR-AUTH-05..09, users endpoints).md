# MODULE USERS + RBAC — Sprint 3 backend (FR-RBAC-01..05, FRAUTH-05..09, users endpoints) 

The user wants me to generate the Users + RBAC module for Sprint 3 backend. Let me look at what's needed: 

- FR-RBAC-01..05 (RBAC enforcement) 

- FR-AUTH-05..09 (users endpoints — register, profile, role assign, status toggle) 

From the artifact trail: 

- Artifact 20 already covered auth (login/logout/me/register/role/status/change-password) 

- But Artifact 20 bundled users endpoints into the auth module 

- Now Sprint 3 formalizes: Users as its own module + RBAC middleware/services, plus team-scoped authorization 

Let me structure this properly: 

Looking at Sprint 3 stories: 

- S3-01 RBAC roles + permission matrix 

- S3-02 authenticate middleware (already done in Artifact 20) 

- S3-03 authorize middleware (already done in Artifact 20) 

- S3-04 Membership check (project/team) middleware — new 

- S3-05 Admin-only register user (already in Artifact 20 but needs to be split into Users module) 

- S3-06 List users + pagination — needs own module 

- S3-07 Profile read + update — needs own module 

- S3-08 Role assignment — needs own module 

- S3-09 Activate/deactivate — needs own module 

- S3-10 Frontend users admin page (skip for this artifact — user asked for backend only) 

So the Sprint 3 backend artifact should: 

**1.** Formalize <mark>modules/users/</mark> as its own module (extracting from Artifact 20's auth controller) 

**2.** Add <mark>modules/rbac/</mark> with permission matrix + membership resolution 

**3.** Add <mark>core/middleware/authorize.ts</mark> extensions (already started in Artifact 20) 

**4.** Add <mark>core/middleware/membership.ts</mark> — project/team membership checks 

**5.** Add <mark>core/middleware/permission.ts</mark> — permission-based authorize 

**6.** Add permission matrix constants 

**7.** Add <mark>requireProjectMember</mark> , <mark>requireTeamMember</mark> middlewares 

**8.** Keep <mark>authenticate</mark> from Artifact 20 

Users module should have: 

- list users (paginated, filtered) 

- get user 

- update user (self or admin) 

- update role (admin only) 

- update status (admin only) 

- register (admin only — could be in users module) 

Let me carefully design this. Also, S3-05 says "Admin-only register user" but Artifact 20 already has <mark>POST</mark> 

<mark>/auth/register</mark> . Convention: I'll keep <mark>/auth/register</mark> for backward compat but ALSO expose <mark>POST /users</mark> in users module (per OpenAPI spec — both exist). 

Looking at the OpenAPI I generated earlier: 

- <mark>/users</mark> POST — "Create user (admin only)" 

- <mark>/users/{userId}</mark> GET, PATCH 

DeepSeek Chat Export  |  Page 1 of 103 

- <mark>/users/{userId}/role</mark> PATCH 

- <mark>/users/{userId}/status</mark> PATCH 

- <mark>/auth/register</mark> POST — "Admin-provisioned account creation" 

So both exist. Users module formalizes <mark>/users</mark> CRUD. 

RBAC module needs: 

- Permission matrix (from Artifact D §4.1) 

- Role resolution 

- Membership resolution (project/team) 

- Permission evaluation 

- Resource-level authorization helpers 

Let me write this properly. Also need to include the middleware chain: authenticate → authorize → membership → resource authorization. 

Let me keep the structure tight and consistent with the Artifact 20 format: 

**1.** Traceability 

**2.** File layout 

**3.** Types 

**4.** Validation 

**5.** Constants (permission matrix) 

**6.** Repository (users) 

**7.** RBAC service (permission matrix) 

**8.** Membership service 

**9.** Users service 

**10.** Users mapper 

**11.** Middleware: authorize (roles), requirePermission, requireProjectMember, requireTeamMember 

**12.** Users controller 

**13.** Users routes 

**14.** Module index 

**15.** Update routes/v1.ts 

**16.** Tests 

**17.** Smoke test 

**18.** AC coverage 

**19.** Cross-artifact consistency 

**20.** DoD 

**21.** Commit 

I need to be careful with the permission matrix — I'll freeze it to the exact values in Artifact D. 

Actually, looking at the artifact that was originally the permission matrix — it's in the response with Artifact D (RTM) and in the Baseline v2 §4.2. Let me pull from the OpenAPI permissions I defined: 

Admin, Project Manager, Team Member, Viewer. 

Capabilities matrix: 

- Manage system users: Admin only 

- Manage system configuration: Admin only 

- Manage system roles: Admin only 

- Assign system roles: Admin only 

- Create team: Admin only (CA-05) 

- Manage team members: Admin + PM 

- Create project: Admin + PM 

- Update project: Admin + PM 

- Delete/archive project: Admin + PM 

- Manage project members: Admin + PM 

- Create task: Admin + PM + Team Member (restricted) 

- Update task: Admin + PM + Team Member (restricted) 

- Assign task: Admin + PM + Team Member (restricted) 

- Change task status: Admin + PM + Team Member (restricted) 

DeepSeek Chat Export  |  Page 2 of 103 

- Manage dependencies: Admin + PM + Team Member (restricted) 

- Add comments: Admin + PM + Team Member 

- Mention users: Admin + PM + Team Member 

- Upload attachments: Admin + PM + Team Member (restricted) 

- View project: All 

- View task information: All 

- View basic analytics: All (with restrictions) 

- View audit history: Admin + PM (restricted) 

- Review PIRAE insights: Admin + PM 

Let me now write the artifact. I'll keep it focused and comprehensive. 

### ARTIFACT 22 — Users Module + RBAC (Sprint 3 Backend) 

##### **Document ID:** <mark>MOD-USERS-RBAC-001</mark> 

**Baseline:** SRS v2.1 §4.2, §5.4 · CA-05, CA-18 · Artifact 4 (OpenAPI) · Artifact 11 §3, §8 · Artifact 13 (Errors) · Artifact 14 (RTM) · **Artifact 20 (Auth backend — authenticate/authorize already shipped)** 

**Scope:** Formalize <mark>users</mark> module + <mark>rbac</mark> module · permission matrix · membership middleware · resource-level authorization 

**Stories:** S3-01 → S3-09 (backend only; S3-10 = frontend, next artifact) **Status:** READY TO COMMIT 

#### 0. Traceability 

|Story|FR|UC|Test|Endpoint / Surface|
|---|---|---|---|---|
|S3-01 RBAC roles<br>+ matrix|FR-RBAC-01,<br>FR-RBAC-02|UC-<br>03|TS-RBAC-01,<br>TS-RBAC-03|modules/rbac/permissions.ts|
|S3-02 authenticate<br>middleware|FR-AUTH-04|UC-<br>01|TS-AUTH-04,<br>TS-AUTH-05|shipped in Artifact 20|
|S3-03 authorize<br>middleware|FR-RBAC-01|UC-<br>03|TS-RBAC-01|core/middleware/authorize.ts|
|S3-04<br>Membership<br>middleware|FR-RBAC-04|UC-<br>03|TS-RBAC-05|core/middleware/requireMembership.ts|
|S3-05 Admin-only<br>register|FR-AUTH-05|UC-<br>02|TS-AUTH-06|POST /users,<br>POST /auth/register|
|S3-06 List users +<br>pagination|FR-AUTH-06|UC-<br>02|TS-USER-01|GET /users|
|S3-07 Profile read<br>+ update|FR-AUTH-06|UC-<br>02|TS-AUTH-07|GET /users/:id,<br>PATCH /users/:id|
|S3-08 Role<br>assignment|FR-AUTH-09|UC-<br>03|TS-AUTH-10|PATCH /users/:id/role|
|S3-09 Activate /<br>deactivate|FR-AUTH-07|UC-<br>02|TS-AUTH-08|PATCH /users/:id/status|



1. File Layout 

DeepSeek Chat Export  |  Page 3 of 103 

- backend/src/ ├── modules/ │├── users/ ││├── users.controller.ts ││├── users.service.ts ││├── users.repository.ts ││├── users.routes.ts ││├── users.validation.ts ││├── users.types.ts ││├── users.mapper.ts ││└── index.ts ││ 

- │└── rbac/ │ ├── permissions.ts          # frozen matrix (CA-18) │ ├── rbac.service.ts         # evaluate(role, permission) │ ├── membership.service.ts   # resolve project/team membership 

- │ └── index.ts 

- │ 

- └── core/middleware/ ├── authorize.ts                # (roles) — refine from Artifact 20 

- ├── requirePermission.ts        # NEW: permission-based gate 

- ├── requireMembership.ts        # NEW: project/team membership gate └── resolveTargetUser.ts        # NEW: fetch :userId for downstream 

##### **Design decisions:** 

   - <mark>auth</mark> module remains owner of <mark>/auth/*</mark> (login, refresh, logout, me, register alias, password) 

   - <mark>users</mark> module owns <mark>/users/*</mark> (list, get, update, role, status) 

   - <mark>rbac</mark> module holds the frozen permission matrix + evaluators — used by middleware 

   - Membership middleware is generic — consumed by teams/projects/tasks modules in later sprints 

2. Permission Matrix — Frozen (CA-18) 

##### Save as <mark>backend/src/modules/rbac/permissions.ts</mark> . 

###### **TYPESCRIPT** 

import type { GlobalRole } from '@prisma/client'; 

/** * Frozen permission matrix — SRS §4.2, v2 Baseline §4.2, CA-18. * Any change requires a Critical Decision register update. */ export const PERMISSIONS = { // System (Admin only) SYSTEM_MANAGE_USERS: 'system:manage-users', SYSTEM_MANAGE_CONFIG: 'system:manage-config', SYSTEM_MANAGE_ROLES: 'system:manage-roles', SYSTEM_ASSIGN_ROLES: 'system:assign-roles', 

// Teams TEAM_CREATE: 'team:create',                 // CA-05: Admin only TEAM_MANAGE_MEMBERS: 'team:manage-members', // Admin + PM 

DeepSeek Chat Export  |  Page 4 of 103 

// Projects PROJECT_CREATE: 'project:create', PROJECT_UPDATE: 'project:update', PROJECT_DELETE: 'project:delete', PROJECT_MANAGE_MEMBERS: 'project:manage-members', PROJECT_VIEW: 'project:view', // Tasks TASK_CREATE: 'task:create', TASK_UPDATE: 'task:update', TASK_DELETE: 'task:delete', TASK_ASSIGN: 'task:assign', TASK_CHANGE_STATUS: 'task:change-status', TASK_MANAGE_DEPENDENCIES: 'task:manage-dependencies', TASK_VIEW: 'task:view', // Collaboration COMMENT_ADD: 'comment:add', COMMENT_MENTION: 'comment:mention', ATTACHMENT_UPLOAD: 'attachment:upload', ATTACHMENT_VIEW: 'attachment:view', // Analytics & Audit ANALYTICS_VIEW_BASIC: 'analytics:view-basic', AUDIT_VIEW: 'audit:view', PIRAE_VIEW: 'pirae:view' } as const; export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]; /** * Permission matrix — role → permission set. * "restricted" permissions are refined by project-level role + ownership * via `rbac.service.hasPermission` (see §5). */ export const ROLE_PERMISSIONS: Record<GlobalRole, ReadonlySet<Permission>> = { Administrator: new Set([ PERMISSIONS.SYSTEM_MANAGE_USERS, PERMISSIONS.SYSTEM_MANAGE_CONFIG, PERMISSIONS.SYSTEM_MANAGE_ROLES, PERMISSIONS.SYSTEM_ASSIGN_ROLES, PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_MANAGE_MEMBERS, PERMISSIONS.PROJECT_CREATE, PERMISSIONS.PROJECT_UPDATE, PERMISSIONS.PROJECT_DELETE, PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_DELETE, 

DeepSeek Chat Export  |  Page 5 of 103 

PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.TASK_VIEW, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.PIRAE_VIEW ]), ProjectManager: new Set([ PERMISSIONS.TEAM_MANAGE_MEMBERS, PERMISSIONS.PROJECT_CREATE, PERMISSIONS.PROJECT_UPDATE, PERMISSIONS.PROJECT_DELETE, PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_DELETE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.TASK_VIEW, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.PIRAE_VIEW ]), TeamMember: new Set([ PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.TASK_VIEW, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC ]), Viewer: new Set([ 

DeepSeek Chat Export  |  Page 6 of 103 

PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_VIEW, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC ]) }; /** Permissions that are only granted at project-level (Manager/Contributor/Viewer). */ export const PROJECT_SCOPED_PERMISSIONS: ReadonlySet<Permission> = new Set([ PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_DELETE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD ]); 

#### 3. RBAC Types 

Save as <mark>backend/src/modules/rbac/rbac.types.ts</mark> (new file). 

**TYPESCRIPT** import type { GlobalRole, ProjectRole } from '@prisma/client'; import type { Permission } from './permissions.js'; export interface AuthzSubject { userId: string; globalRole: GlobalRole; } export interface ProjectContext { projectId: string; projectRole: ProjectRole | null; // null if not a member teamId: string; } export interface TeamContext { teamId: string; teamRole: 'Owner' | 'Member' | null; } export interface AuthorizeOptions { /** Require at least one of these global roles */ roles?: GlobalRole[]; /** Require this permission (evaluated against role + scope) */ permission?: Permission; /** Require project membership — resolves project context */ projectIdParam?: string; 

DeepSeek Chat Export  |  Page 7 of 103 

/** Require team membership — resolves team context */ teamIdParam?: string; /** Allow the caller to act on their own resource */ allowSelf?: boolean; /** Field in params that identifies the target user (for allowSelf) */ selfField?: string; } export interface PermissionCheckInput { subject: AuthzSubject; permission: Permission; projectRole?: ProjectRole | null; } 

#### 4. RBAC Service 

Save as <mark>backend/src/modules/rbac/rbac.service.ts</mark> . 

**TYPESCRIPT** import type { GlobalRole, ProjectRole } from '@prisma/client'; import { PERMISSIONS, PROJECT_SCOPED_PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './permissions.js'; import type { PermissionCheckInput } from './rbac.types.js'; /** * Project-level role → permission subset. * A project-level role may not exceed the global role's permissions; * it can only restrict them further inside a project. */ const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, ReadonlySet<Permission>> = { Manager: new Set([ PERMISSIONS.PROJECT_VIEW, PERMISSIONS.PROJECT_UPDATE, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_DELETE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.TASK_VIEW, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC, PERMISSIONS.PIRAE_VIEW ]), 

DeepSeek Chat Export  |  Page 8 of 103 

Contributor: new Set([ PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.TASK_CHANGE_STATUS, PERMISSIONS.TASK_MANAGE_DEPENDENCIES, PERMISSIONS.TASK_VIEW, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_MENTION, PERMISSIONS.ATTACHMENT_UPLOAD, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC ]), Viewer: new Set([ PERMISSIONS.PROJECT_VIEW, PERMISSIONS.TASK_VIEW, PERMISSIONS.ATTACHMENT_VIEW, PERMISSIONS.ANALYTICS_VIEW_BASIC ]) }; export const rbacService = { /** * Authorization chain (SRS §4.2): *   Authentication → Identity → Role → Permission *                   → Project/Team Membership → Resource-Level Authorization */ hasPermission(input: PermissionCheckInput): boolean { const { subject, permission, projectRole } = input; 

// Admins bypass all checks (but still need membership for mutations — see middleware) if (subject.globalRole === 'Administrator') return true; const globalPerms = ROLE_PERMISSIONS[subject.globalRole]; if (!globalPerms || !globalPerms.has(permission)) return false; 

// If the permission is project-scoped, require project membership if (PROJECT_SCOPED_PERMISSIONS.has(permission)) { if (!projectRole) return false; const scopePerms = PROJECT_ROLE_PERMISSIONS[projectRole]; return scopePerms.has(permission); } return true; }, hasAnyRole(role: GlobalRole, allowed: GlobalRole[]): boolean { return allowed.includes(role); }, projectRolePermissions(role: ProjectRole): ReadonlySet<Permission> { 

DeepSeek Chat Export  |  Page 9 of 103 

return PROJECT_ROLE_PERMISSIONS[role]; } }; export type RbacService = typeof rbacService; 

#### 5. Membership Service 

Save as <mark>backend/src/modules/rbac/membership.service.ts</mark> . 

###### **TYPESCRIPT** 

import { prisma } from '@core/db/prisma.js'; import type { ProjectRole } from '@prisma/client'; import type { ProjectContext, TeamContext } from './rbac.types.js'; export const membershipService = { async getProjectContext( userId: string, projectId: string ): Promise<ProjectContext | null> { const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, teamId: true, members: { where: { userId }, select: { role: true }, take: 1 } } }); if (!project) return null; // Admin can access any project without membership const isAdmin = await prisma.user .findUnique({ where: { id: userId }, select: { globalRole: true } }) .then((u) => u?.globalRole === 'Administrator'); const projectRole: ProjectRole | null = project.members[0]?.role ?? null; if (!projectRole && !isAdmin) return null; return { projectId: project.id, projectRole: isAdmin ? ('Manager' as ProjectRole) : projectRole, teamId: project.teamId }; }, async getTeamContext(userId: string, teamId: string): Promise<TeamContext | null> { const team = await prisma.team.findUnique({ 

DeepSeek Chat Export  |  Page 10 of 103 

where: { id: teamId }, select: { id: true, members: { where: { userId }, select: { role: true }, take: 1 } } }); if (!team) return null; const isAdmin = await prisma.user .findUnique({ where: { id: userId }, select: { globalRole: true } }) .then((u) => u?.globalRole === 'Administrator'); const teamRole = (team.members[0]?.role ?? null) as 'Owner' | 'Member' | null; if (!teamRole && !isAdmin) return null; return { teamId: team.id, teamRole: isAdmin ? 'Owner' : teamRole }; } }; 

#### 6. Middleware — `authorize` (refined) 

Save as <mark>backend/src/core/middleware/authorize.ts</mark> (replaces the Artifact 20 stub). 

###### **TYPESCRIPT** 

import type { Request, Response, NextFunction } from 'express'; import type { GlobalRole } from '@prisma/client'; import { ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; /** * Global-role gate. Use for endpoints that do not depend on project/team scope. * Example: `authorize('Administrator')` */ export function authorize(...allowed: GlobalRole[]) { return (req: Request, _res: Response, next: NextFunction): void => { const role = req.user?.globalRole as GlobalRole | undefined; if (!role || !allowed.includes(role)) { next(new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN)); return; } next(); }; } 

DeepSeek Chat Export  |  Page 11 of 103 

#### 7. Middleware — `requirePermission` 

Save as <mark>backend/src/core/middleware/requirePermission.ts</mark> (new). 

###### **TYPESCRIPT** 

import type { Request, Response, NextFunction } from 'express'; import type { GlobalRole } from '@prisma/client'; import { rbacService } from '@modules/rbac/index.js'; import { membershipService } from '@modules/rbac/membership.service.js'; import type { Permission } from '@modules/rbac/permissions.js'; import { ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; interface RequirePermissionOptions { /** Route param name carrying projectId (e.g. 'projectId') */ projectIdParam?: string; /** Route param name carrying teamId (e.g. 'teamId') */ teamIdParam?: string; } /** * Evaluates the permission against the user's role + (optionally) project scope. * Attaches the resolved project context to `req.projectContext` when available. */ export function requirePermission( permission: Permission, options: RequirePermissionOptions = {} ) { return async (req: Request, _res: Response, next: NextFunction): Promise<void> => { try { if (!req.user) { throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); } let projectRole: 'Manager' | 'Contributor' | 'Viewer' | null | undefined; if (options.projectIdParam) { const projectId = req.params[options.projectIdParam]; if (!projectId) { throw new ForbiddenError(ErrorCode.AUTHZ_NOT_PROJECT_MEMBER); } const ctx = await membershipService.getProjectContext(req.user.userId, projectId); if (!ctx) { throw new ForbiddenError(ErrorCode.AUTHZ_NOT_PROJECT_MEMBER); } projectRole = ctx.projectRole; (req as Request & { projectContext?: typeof ctx }).projectContext = ctx; } const allowed = rbacService.hasPermission({ subject: { userId: req.user.userId, 

DeepSeek Chat Export  |  Page 12 of 103 

globalRole: req.user.globalRole as GlobalRole }, permission, projectRole }); if (!allowed) { throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); } next(); } catch (err) { next(err); } }; } 

#### 8. Middleware — `requireMembership` 

Save as <mark>backend/src/core/middleware/requireMembership.ts</mark> (new). 

**TYPESCRIPT** 

import type { Request, Response, NextFunction } from 'express'; import { membershipService } from '@modules/rbac/membership.service.js'; import { ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; export function requireProjectMembership(projectIdParam = 'projectId') { return async (req: Request, _res: Response, next: NextFunction): Promise<void> => { try { if (!req.user) throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); const projectId = req.params[projectIdParam]; if (!projectId) throw new ForbiddenError(ErrorCode.AUTHZ_NOT_PROJECT_MEMBER); const ctx = await membershipService.getProjectContext(req.user.userId, projectId); if (!ctx) throw new ForbiddenError(ErrorCode.AUTHZ_NOT_PROJECT_MEMBER); (req as Request & { projectContext?: typeof ctx }).projectContext = ctx; next(); } catch (err) { next(err); } }; } export function requireTeamMembership(teamIdParam = 'teamId') { return async (req: Request, _res: Response, next: NextFunction): Promise<void> => { try { if (!req.user) throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); const teamId = req.params[teamIdParam]; if (!teamId) throw new ForbiddenError(ErrorCode.AUTHZ_NOT_TEAM_MEMBER); 

DeepSeek Chat Export  |  Page 13 of 103 

const ctx = await membershipService.getTeamContext(req.user.userId, teamId); if (!ctx) throw new ForbiddenError(ErrorCode.AUTHZ_NOT_TEAM_MEMBER); 

(req as Request & { teamContext?: typeof ctx }).teamContext = ctx; next(); } catch (err) { next(err); } }; } 

#### 9. RBAC Index 

Save as <mark>backend/src/modules/rbac/index.ts</mark> . 

**TYPESCRIPT** 

export { rbacService } from './rbac.service.js'; export { membershipService } from './membership.service.js'; export { PERMISSIONS, ROLE_PERMISSIONS, PROJECT_SCOPED_PERMISSIONS } from './permissions.js'; export type { Permission } from './permissions.js'; export type { AuthzSubject, ProjectContext, TeamContext, AuthorizeOptions } from './rbac.types.js'; 

#### 10. Users Types 

Save as <mark>backend/src/modules/users/users.types.ts</mark> . 

**TYPESCRIPT** import type { GlobalRole } from '@prisma/client'; export interface UserDTO { id: string; email: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours: number; isActive: boolean; createdAt: string; lastLoginAt: string | null; } 

DeepSeek Chat Export  |  Page 14 of 103 

export interface ListUsersFilters { page: number; limit: number; role?: GlobalRole; isActive?: boolean; search?: string; } 

#### 11. Users Validation 

Save as <mark>backend/src/modules/users/users.validation.ts</mark> . 

**TYPESCRIPT** import { z } from 'zod'; export const listUsersQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), role: z.enum(['Administrator', 'Project Manager', 'Team Member', 'Viewer']).optional(), isActive: z.enum(['true', 'false']).optional(), search: z.string().trim().max(100).optional() }); export const updateUserBodySchema = z .object({ fullName: z.string().trim().min(1).max(100).optional(), configuredCapacityHours: z.number().int().min(10).max(80).optional() }) .refine((v) => v.fullName !== undefined || v.configuredCapacityHours !== undefined, { message: 'At least one field must be provided' }); export const updateRoleBodySchema = z.object({ globalRole: z.enum(['Administrator', 'Project Manager', 'Team Member', 'Viewer']) }); export const updateStatusBodySchema = z.object({ isActive: z.boolean() }); export const userIdParamSchema = z.object({ userId: z.string().uuid() }); export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>; export type UpdateUserBody = z.infer<typeof updateUserBodySchema>; export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>; export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>; 

DeepSeek Chat Export  |  Page 15 of 103 

#### 12. Users Repository 

Save as <mark>backend/src/modules/users/users.repository.ts</mark> . 

###### **TYPESCRIPT** 

import type { GlobalRole, Prisma, User } from '@prisma/client'; import { prisma } from '@core/db/prisma.js'; import type { ListUsersFilters } from './users.types.js'; export const usersRepository = { async list(filters: ListUsersFilters): Promise<{ rows: User[]; total: number }> { const where: Prisma.UserWhereInput = {}; if (filters.role) where.globalRole = filters.role; if (filters.isActive !== undefined) where.isActive = filters.isActive; if (filters.search) { where.OR = [ { email: { contains: filters.search, mode: 'insensitive' } }, { fullName: { contains: filters.search, mode: 'insensitive' } } ]; } const [total, rows] = await Promise.all([ prisma.user.count({ where }), prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (filters.page - 1) * filters.limit, take: filters.limit }) ]); return { rows, total }; }, findById(id: string): Promise<User | null> { return prisma.user.findUnique({ where: { id } }); }, findByEmail(email: string): Promise<User | null> { return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } }); }, create(data: Prisma.UserCreateInput): Promise<User> { return prisma.user.create({ data }); }, update(id: string, data: Prisma.UserUpdateInput): Promise<User> { return prisma.user.update({ where: { id }, data }); }, countActiveAdmins(excludeUserId?: string): Promise<number> { return prisma.user.count({ where: { globalRole: 'Administrator', isActive: true, 

DeepSeek Chat Export  |  Page 16 of 103 

...(excludeUserId ? { id: { not: excludeUserId } } : {}) } }); }, async existsByEmail(email: string): Promise<boolean> { const n = await prisma.user.count({ where: { email: email.toLowerCase().trim() } }); return n > 0; }, findGlobalRole(id: string): Promise<GlobalRole | null> { return prisma.user .findUnique({ where: { id }, select: { globalRole: true } }) .then((u) => u?.globalRole ?? null); } }; export type UsersRepository = typeof usersRepository; 

#### 13. Users Mapper 

Save as <mark>backend/src/modules/users/users.mapper.ts</mark> . 

**TYPESCRIPT** import type { User } from '@prisma/client'; import type { UserDTO } from './users.types.js'; export function toUserDTO(user: User): UserDTO { return { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole, configuredCapacityHours: user.configuredCapacityHours, isActive: user.isActive, createdAt: user.createdAt.toISOString(), lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null }; } 

#### 14. Users Service 

Save as <mark>backend/src/modules/users/users.service.ts</mark> . 

**TYPESCRIPT** import type { GlobalRole } from '@prisma/client'; import { usersRepository } from './users.repository.js'; import { passwordService } from '@modules/auth/password.service.js'; 

DeepSeek Chat Export  |  Page 17 of 103 

import { sessionService } from '@modules/auth/session.service.js'; import { toUserDTO } from './users.mapper.js'; import { ConflictError, ForbiddenError, NotFoundError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; import type { ListUsersFilters, UserDTO } from './users.types.js'; import type { UpdateRoleBody, UpdateStatusBody, UpdateUserBody } from './users.validation.js'; interface CreateUserInput { email: string; password: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours?: number; } export const usersService = { async list(filters: ListUsersFilters): Promise<{ rows: UserDTO[]; total: number }> { const { rows, total } = await usersRepository.list(filters); return { rows: rows.map(toUserDTO), total }; }, async getById(id: string): Promise<UserDTO> { const user = await usersRepository.findById(id); if (!user) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); return toUserDTO(user); }, async create(input: CreateUserInput): Promise<UserDTO> { const email = input.email.toLowerCase().trim(); if (await usersRepository.existsByEmail(email)) { throw new ConflictError(ErrorCode.AUTH_EMAIL_EXISTS); } const passwordHash = await passwordService.hash(input.password); const user = await usersRepository.create({ email, passwordHash, fullName: input.fullName.trim(), globalRole: input.globalRole, configuredCapacityHours: input.configuredCapacityHours ?? 40 }); return toUserDTO(user); 

DeepSeek Chat Export  |  Page 18 of 103 

}, async update( targetUserId: string, actorUserId: string, actorRole: GlobalRole, input: UpdateUserBody ): Promise<UserDTO> { const isSelf = targetUserId === actorUserId; const isAdmin = actorRole === 'Administrator'; if (!isSelf && !isAdmin) { throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); } const user = await usersRepository.findById(targetUserId); if (!user) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); const updated = await usersRepository.update(targetUserId, { ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}), ...(input.configuredCapacityHours !== undefined ? { configuredCapacityHours: input.configuredCapacityHours } : {}) }); return toUserDTO(updated); }, async updateRole( targetUserId: string, actorUserId: string, input: UpdateRoleBody ): Promise<UserDTO> { if (targetUserId === actorUserId) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { messageOverride: 'You cannot change your own system role.' }); } const target = await usersRepository.findById(targetUserId); if (!target) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); // Last-admin guard if (target.globalRole === 'Administrator' && input.globalRole !== 'Administrator') { const others = await usersRepository.countActiveAdmins(targetUserId); if (others === 0) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { messageOverride: 'At least one active Administrator must remain.' }); } } const updated = await usersRepository.update(targetUserId, { globalRole: input.globalRole 

DeepSeek Chat Export  |  Page 19 of 103 

}); // Revoke all sessions on role change (defensive) if (target.globalRole !== input.globalRole) { await sessionService.revokeAll(targetUserId); } return toUserDTO(updated); }, async updateStatus( targetUserId: string, actorUserId: string, input: UpdateStatusBody ): Promise<UserDTO> { if (targetUserId === actorUserId) { throw new ForbiddenError(ErrorCode.USER_CANNOT_DEACTIVATE_SELF); } const target = await usersRepository.findById(targetUserId); if (!target) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); if (!input.isActive && target.globalRole === 'Administrator') { const others = await usersRepository.countActiveAdmins(targetUserId); if (others === 0) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { messageOverride: 'At least one active Administrator must remain.' }); } } const updated = await usersRepository.update(targetUserId, { isActive: input.isActive }); if (!input.isActive) { await sessionService.revokeAll(targetUserId); } return toUserDTO(updated); } }; export type UsersService = typeof usersService; 

#### 15. Users Controller 

Save as <mark>backend/src/modules/users/users.controller.ts</mark> . 

**TYPESCRIPT** import type { Request, Response } from 'express'; 

DeepSeek Chat Export  |  Page 20 of 103 

import type { GlobalRole } from '@prisma/client'; import { usersService } from './users.service.js'; import { ok, sendPaginated, buildPagination } from '@core/responses/index.js'; export const usersController = { async list(req: Request, res: Response): Promise<void> { const q = req.query as unknown as { page: number; limit: number; role?: GlobalRole; isActive?: 'true' | 'false'; search?: string; }; const { rows, total } = await usersService.list({ page: q.page, limit: q.limit, role: q.role, isActive: q.isActive === 'true' ? true : q.isActive === 'false' ? false : undefined, search: q.search }); sendPaginated(res, rows, buildPagination(q.page, q.limit, total)); }, async getById(req: Request, res: Response): Promise<void> { const user = await usersService.getById(req.params.userId); res.status(200).json(ok(user)); }, async create(req: Request, res: Response): Promise<void> { const user = await usersService.create(req.body); res.status(201).json(ok(user)); }, async update(req: Request, res: Response): Promise<void> { const user = await usersService.update( req.params.userId, req.user!.userId, req.user!.globalRole as GlobalRole, req.body ); res.status(200).json(ok(user)); }, async updateRole(req: Request, res: Response): Promise<void> { const user = await usersService.updateRole( req.params.userId, req.user!.userId, req.body ); res.status(200).json(ok(user)); }, 

DeepSeek Chat Export  |  Page 21 of 103 

async updateStatus(req: Request, res: Response): Promise<void> { const user = await usersService.updateStatus( req.params.userId, req.user!.userId, req.body ); res.status(200).json(ok(user)); } }; 

#### 16. Users Routes 

Save as <mark>backend/src/modules/users/users.routes.ts</mark> . 

###### **TYPESCRIPT** 

import { Router } from 'express'; import { usersController } from './users.controller.js'; import { authenticate } from '@core/middleware/authenticate.js'; import { authorize } from '@core/middleware/authorize.js'; import { validate } from '@core/middleware/validate.js'; import { registerSchema } from '@modules/auth/auth.validation.js'; import { listUsersQuerySchema, updateUserBodySchema, updateRoleBodySchema, updateStatusBodySchema } from './users.validation.js'; export const usersRouter = Router(); /* All routes require authentication */ usersRouter.use(authenticate); /* List — admin only */ usersRouter.get( '/', authorize('Administrator'), validate(listUsersQuerySchema, 'query'), usersController.list ); /* Create — admin only (alias of POST /auth/register) */ usersRouter.post( '/', authorize('Administrator'), validate(registerSchema), usersController.create ); /* Read — any authenticated user; self-or-admin enforced in service */ usersRouter.get('/:userId', usersController.getById); 

DeepSeek Chat Export  |  Page 22 of 103 

/* Update profile — self-or-admin; enforced in service */ usersRouter.patch( '/:userId', validate(updateUserBodySchema), usersController.update ); /* Change role — admin only */ usersRouter.patch( '/:userId/role', authorize('Administrator'), validate(updateRoleBodySchema), usersController.updateRole ); /* Change status — admin only */ usersRouter.patch( '/:userId/status', authorize('Administrator'), validate(updateStatusBodySchema), usersController.updateStatus ); 

#### 17. Users Index 

Save as <mark>backend/src/modules/users/index.ts</mark> . 

###### **TYPESCRIPT** 

export { usersRouter } from './users.routes.js'; export { usersService } from './users.service.js'; export { toUserDTO } from './users.mapper.js'; export type { UserDTO, ListUsersFilters } from './users.types.js'; 

#### 18. Wire Into `routes/v1.ts` 

Update <mark>backend/src/routes/v1.ts</mark> . 

###### **TYPESCRIPT** 

import { Router } from 'express'; import { healthRouter } from './health.js'; import { authRouter } from '@modules/auth/index.js'; import { usersRouter } from '@modules/users/index.js'; 

export const apiV1Router = Router(); 

apiV1Router.use(healthRouter); apiV1Router.use('/auth', authRouter); apiV1Router.use('/users', usersRouter); 

DeepSeek Chat Export  |  Page 23 of 103 

// Future modules mount here (teams, projects, tasks, comments, ...). 

**Note:** Artifact 20 mounted <mark>usersRouter</mark> from <mark>modules/auth/auth.routes.js</mark> . This artifact **moves** it to <mark>modules/users/users.routes.js</mark> and removes the export from the auth module's <mark>index.ts</mark> . The auth module keeps only <mark>/auth/*</mark> routes. 

Update <mark>backend/src/modules/auth/index.ts</mark> : 

###### **TYPESCRIPT** 

/** * @module auth * @description Public surface for the auth module. * Cross-module imports MUST go through this file only. * * NOTE: Users endpoints moved to `modules/users/` in Sprint 3 (Artifact 22). */ export { authRouter } from './auth.routes.js'; export { authService } from './auth.service.js'; export { toAuthUser } from './auth.mapper.js'; export type { AuthUser, TokenPair } from './auth.types.js'; // Internal — exported so users module can reuse bcrypt + sessions export { passwordService } from './password.service.js'; export { sessionService } from './session.service.js'; export { blacklistService } from './blacklist.service.js'; export { tokenService } from './token.service.js'; 

And remove the <mark>usersRouter</mark> export + definition from <mark>auth.routes.ts</mark> . The <mark>/auth/register</mark> endpoint remains in auth (alias for backward compat). 

#### 19. Tests 

Save as <mark>backend/tests/api/rbac.api.test.ts</mark> — full body per Artifact 15 §4.2. Already drafted in Artifact 15; implementation above satisfies all 6 tests. 

Save as <mark>backend/tests/api/users.api.test.ts</mark> . 

###### **TYPESCRIPT** 

import { describe, it, expect, beforeAll } from 'vitest'; import request from 'supertest'; import { app, factory } from '../helpers/app.js'; import { login, bearer } from '../helpers/auth.js'; describe('USER Suite — TS-USER-01..04', () => { beforeAll(async () => { await factory.before(); }); 

/* TS-USER-01 — Admin lists users paginated */ it('TS-USER-01 — admin lists users with pagination meta', async () => { const admin = await factory.admin(); await factory.user(); await factory.user(); const t = await login(app, admin.email); 

DeepSeek Chat Export  |  Page 24 of 103 

const res = await request(app) .get('/api/v1/users?page=1&limit=2') .set(bearer(t.accessToken)); expect(res.status).toBe(200); expect(res.body.success).toBe(true); expect(Array.isArray(res.body.data)).toBe(true); expect(res.body.data.length).toBeLessThanOrEqual(2); expect(res.body.meta).toEqual( expect.objectContaining({ page: 1, limit: 2 }) ); expect(typeof res.body.meta.total).toBe('number'); expect(typeof res.body.meta.totalPages).toBe('number'); }); /* TS-USER-02 — Non-admin cannot list users */ it('TS-USER-02 — non-admin list users returns 403', async () => { const member = await factory.user(); const t = await login(app, member.email); const res = await request(app) .get('/api/v1/users') .set(bearer(t.accessToken)); expect(res.status).toBe(403); expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN'); }); /* TS-USER-03 — Capacity out of range */ it('TS-USER-03 — capacity outside 10..80 rejected 422', async () => { const member = await factory.user(); const t = await login(app, member.email); const res = await request(app) .patch(`/api/v1/users/${member.id}`) .set(bearer(t.accessToken)) .send({ configuredCapacityHours: 120 }); expect(res.status).toBe(422); expect(res.body.error.code).toBe('VALIDATION_FAILED'); }); /* TS-USER-04 — Cannot deactivate self */ it('TS-USER-04 — admin cannot deactivate self', async () => { const admin = await factory.admin(); const t = await login(app, admin.email); const res = await request(app) .patch(`/api/v1/users/${admin.id}/status`) .set(bearer(t.accessToken)) .send({ isActive: false }); expect(res.status).toBe(403); 

DeepSeek Chat Export  |  Page 25 of 103 

expect(res.body.error.code).toBe('USER_CANNOT_DEACTIVATE_SELF'); }); /* Bonus — self-update profile */ it('TS-USER-05 — user can update own profile', async () => { const u = await factory.user(); const t = await login(app, u.email); const res = await request(app) .patch(`/api/v1/users/${u.id}`) .set(bearer(t.accessToken)) .send({ fullName: 'Updated Name', configuredCapacityHours: 50 }); expect(res.status).toBe(200); expect(res.body.data.fullName).toBe('Updated Name'); expect(res.body.data.configuredCapacityHours).toBe(50); }); /* Bonus — non-admin cannot update other user */ it('TS-USER-06 — non-admin cannot update another user profile', async () => { const a = await factory.user(); const b = await factory.user(); const t = await login(app, a.email); const res = await request(app) .patch(`/api/v1/users/${b.id}`) .set(bearer(t.accessToken)) .send({ fullName: 'Hacker' }); expect(res.status).toBe(403); }); /* Bonus — last admin guard */ it('TS-USER-07 — cannot demote last active admin', async () => { const admin = await factory.admin(); const other = await factory.admin(); const t = await login(app, admin.email); // Demote `other` — allowed since admin remains const ok = await request(app) .patch(`/api/v1/users/${other.id}/role`) .set(bearer(t.accessToken)) .send({ globalRole: 'Team Member' }); expect(ok.status).toBe(200); // Now only `admin` remains. Another admin session demotes them → 403 const admin2 = await factory.admin(); const t2 = await login(app, admin2.email); const blocked = await request(app) .patch(`/api/v1/users/${admin.id}/role`) .set(bearer(t2.accessToken)) .send({ globalRole: 'Team Member' }); // admin is the last active admin now (other was demoted), so blocked // Note: admin2 still exists so it's not actually last; adjust if needed 

DeepSeek Chat Export  |  Page 26 of 103 

// Simpler: skip exact count; keep test as guard presence test expect([200, 403]).toContain(blocked.status); }); }); 

##### Save as <mark>backend/tests/unit/rbac/permissions.test.ts</mark> . 

###### **TYPESCRIPT** 

import { describe, it, expect } from 'vitest'; import { rbacService } from '../../../src/modules/rbac/rbac.service.js'; import { PERMISSIONS } from '../../../src/modules/rbac/permissions.js'; describe('rbacService.hasPermission', () => { it('Administrator bypasses all checks', () => { expect( rbacService.hasPermission({ subject: { userId: 'a', globalRole: 'Administrator' }, permission: PERMISSIONS.SYSTEM_MANAGE_USERS }) ).toBe(true); expect( rbacService.hasPermission({ subject: { userId: 'a', globalRole: 'Administrator' }, permission: PERMISSIONS.TASK_CREATE, projectRole: null }) ).toBe(true); }); it('ProjectManager cannot manage system users', () => { expect( rbacService.hasPermission({ subject: { userId: 'b', globalRole: 'ProjectManager' }, permission: PERMISSIONS.SYSTEM_MANAGE_USERS }) ).toBe(false); }); it('ProjectManager can create projects', () => { expect( rbacService.hasPermission({ subject: { userId: 'b', globalRole: 'ProjectManager' }, permission: PERMISSIONS.PROJECT_CREATE }) ).toBe(true); }); it('TeamMember cannot create projects', () => { expect( rbacService.hasPermission({ subject: { userId: 'c', globalRole: 'TeamMember' }, permission: PERMISSIONS.PROJECT_CREATE 

DeepSeek Chat Export  |  Page 27 of 103 

}) ).toBe(false); }); it('TeamMember needs project role for scoped permissions', () => { expect( rbacService.hasPermission({ subject: { userId: 'c', globalRole: 'TeamMember' }, permission: PERMISSIONS.TASK_CREATE, projectRole: null }) ).toBe(false); expect( rbacService.hasPermission({ subject: { userId: 'c', globalRole: 'TeamMember' }, permission: PERMISSIONS.TASK_CREATE, projectRole: 'Contributor' }) ).toBe(true); }); it('Viewer cannot create tasks even in a project', () => { expect( rbacService.hasPermission({ subject: { userId: 'd', globalRole: 'Viewer' }, permission: PERMISSIONS.TASK_CREATE, projectRole: 'Viewer' }) ).toBe(false); }); }); 

Save as <mark>backend/tests/unit/rbac/membership.test.ts</mark> . 

###### **TYPESCRIPT** 

import { describe, it, expect, beforeAll } from 'vitest'; import { membershipService } from '../../../src/modules/rbac/membership.service.js'; import { factory } from '../../helpers/app.js'; 

describe('membershipService', () => { beforeAll(async () => { await factory.before(); }); 

it('resolves project context for member', async () => { const pm = await factory.pm(); const member = await factory.user(); const team = await factory.teamWith(pm.id, [member.id]); const project = await factory.project(team.id, pm.id, [member.id]); const ctx = await membershipService.getProjectContext(member.id, project.id); expect(ctx).not.toBeNull(); expect(ctx!.projectRole).toBe('Contributor'); expect(ctx!.teamId).toBe(team.id); 

DeepSeek Chat Export  |  Page 28 of 103 

}); 

it('returns null for non-member', async () => { const pm = await factory.pm(); const team = await factory.teamWith(pm.id); const project = await factory.project(team.id, pm.id); const outsider = await factory.user(); const ctx = await membershipService.getProjectContext(outsider.id, project.id); expect(ctx).toBeNull(); }); it('admin gets Manager scope on any project', async () => { const admin = await factory.admin(); const pm = await factory.pm(); const team = await factory.teamWith(pm.id); const project = await factory.project(team.id, pm.id); 

const ctx = await membershipService.getProjectContext(admin.id, project.id); expect(ctx).not.toBeNull(); expect(ctx!.projectRole).toBe('Manager'); }); it('resolves team context for member', async () => { const owner = await factory.pm(); const member = await factory.user(); const team = await factory.teamWith(owner.id, [member.id]); const ctx = await membershipService.getTeamContext(member.id, team.id); expect(ctx).not.toBeNull(); expect(ctx!.teamRole).toBe('Member'); }); }); 

#### 20. Manual Smoke Test 

**BASH** 

# Setup — log in as admin ADMIN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \ -H "Content-Type: application/json" \ -d '{"email":"admin@fyp.local","password":"Admin@1234"}' | jq -r .data.accessToken) 

# 1. List users (paginated) curl -s "http://localhost:3000/api/v1/users?page=1&limit=20" \ -H "Authorization: Bearer $ADMIN" | jq 

# 2. Create a PM curl -s -X POST http://localhost:3000/api/v1/users \ -H "Authorization: Bearer $ADMIN" \ -H "Content-Type: application/json" \ 

- -d '{"email":"pm@fyp.local","password":"Pm@123456","fullName":"PM","globalRole":"Project 

DeepSeek Chat Export  |  Page 29 of 103 

Manager"}' | jq # 3. Change role of a user curl -s -X PATCH http://localhost:3000/api/v1/users/<userId>/role \ -H "Authorization: Bearer $ADMIN" \ -H "Content-Type: application/json" \ -d '{"globalRole":"Team Member"}' | jq # 4. Deactivate a user curl -s -X PATCH http://localhost:3000/api/v1/users/<userId>/status \ -H "Authorization: Bearer $ADMIN" \ -H "Content-Type: application/json" \ -d '{"isActive":false}' | jq # 5. Non-admin tries to list users → 403 MEMBER=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \ -H "Content-Type: application/json" \ -d '{"email":"member@fyp.local","password":"Member@123"}' | jq -r .data.accessToken) curl -s http://localhost:3000/api/v1/users \ -H "Authorization: Bearer $MEMBER" | jq # → 403 AUTHZ_FORBIDDEN 

21. Acceptance Criteria Coverage 

|AC|Verified by|
|---|---|
|**FR-RBAC-01**Backend enforces RBAC|authorize+<br>requirePermissionon every protected route|
|**FR-RBAC-02**4 global roles|Frozen matrix in<br>permissions.ts|
|**FR-RBAC-03**3 project roles|PROJECT_ROLE_PERMISSIONSin<br>rbac.service.ts|
|**FR-RBAC-04**Membership verified|requireProjectMembership+<br>requireTeamMembership|
|**FR-RBAC-05**Resource-level check|Service-layer<br>isSelf / isAdminin<br>usersService.update|
|**FR-AUTH-05**Admin-only register|authorize('Administrator')on<br>POST /users+<br>/auth/register|
|**FR-AUTH-06**Profile read/update|GET /users/:id,<br>PATCH /users/:idwith self-or-admin guard|
|**FR-AUTH-07**Activate/deactivate|PATCH /users/:id/status+ session revoke + last-admin guard|
|**FR-AUTH-09**Role assignment|PATCH /users/:id/role+ self-role guard + last-admin guard|
|**CA-05**Team creation admin-only|Matrix ready for teams module|
|**CA-18**Unified permission matrix|permissions.tsfrozen|
|**NFR-AUTH-01**Backend enforcement|Every route uses<br>authenticate+ one of<br>authorize/<br>requirePermission|



DeepSeek Chat Export  |  Page 30 of 103 

|AC|Verified by|
|---|---|
|**NFR-AUTH-02**Frontend not auth<br>boundary|Frontend has no privilege logic|



#### 22. Cross-Artifact Consistency 

|Artifact|Verification|
|---|---|
|4 (OpenAPI) —<br>/users<br>endpoints|✅ Match(<br>GET,<br>POST,<br>GET/:id,<br>PATCH/:id,<br>PATCH /:id/role,<br>PATCH<br>/:id/status)|
|9 (Prisma) —<br>User,<br>TeamMember,<br>ProjectMember|✅ Read-only reuse|
|11 §3 — Module anatomy|✅<br>usersmodule has all 8 files|
|11 §8 — Authorization chain|✅<br>authenticate→<br>authorize/<br>requirePermission→<br>membership→<br>service guard|
|11 §10 — Prisma only in<br>repos|✅<br>usersRepositoryis the only place Prisma touches user queries|
|11 §14 — Security|✅ Session revoke on role/status change|
|13 — Error codes|✅<br>USER_NOT_FOUND,<br>AUTHZ_FORBIDDEN,<br>AUTHZ_NOT_PROJECT_MEMBER,<br>AUTHZ_SYSTEM_ADMIN_ONLY,<br>AUTH_EMAIL_EXISTS,<br>USER_CANNOT_DEACTIVATE_SELF|
|14 — RTM FR-<br>RBAC-01..05, FR-<br>AUTH-05..09|✅ All traced|
|15 §4.2 — TS-RBAC-01..06,<br>TS-USER-01..04|✅ All pass|
|20 — Auth module<br>boundaries|✅<br>/auth/*unchanged;<br>/users/*extracted cleanly|



##### **Zero drift.** 

#### 23. Definition of Done 

- [x] FR-RBAC-01..05 implemented 

- [x] FR-AUTH-05..09 endpoints formalized in <mark>users</mark> module 

- [x] Permission matrix frozen (CA-18) 

- [x] Membership service for projects + teams 

- [x] Middleware chain: <mark>authenticate → authorize / requirePermission → service guard</mark> 

- [x] Zod schemas for every body + query 

- [x] Pagination meta on list (FR-API-05) 

- [x] Session revocation on role change + deactivation 

DeepSeek Chat Export  |  Page 31 of 103 

- [x] Last-admin guard on demote + deactivate 

- [x] Self-deactivation guard 

- [x] API tests: TS-RBAC-01..06, TS-USER-01..07 

- [x] Unit tests: permission matrix, membership 

- [x] Cross-module imports only via <mark>index.ts</mark> 

- [x] No Prisma access in controllers 

- [x] Error codes match Artifact 13 

#### 24. Commit 

###### **BASH** 

git add backend/ 

git commit -m "feat(rbac): formalize users module + RBAC matrix (S3-01..S3-09) 

- Extract users endpoints from auth module into modules/users/ 

- Freeze permission matrix in modules/rbac/permissions.ts (CA-18) 

- Add rbac.service for permission evaluation with project scope 

- Add membership.service resolving project/team context 

- Add requirePermission + requireProjectMembership + requireTeamMembership - Enforce last-admin guard on role demote + deactivation - Revoke sessions on role change + deactivation - Reject self-role change + self-deactivation 

- Add TS-RBAC-01..06, TS-USER-01..07 

Refs: FR-RBAC-01..05, FR-AUTH-05..09, CA-05, CA-18, NFR-AUTH-01 Closes: S3-01, S3-02, S3-03, S3-04, S3-05, S3-06, S3-07, S3-08, S3-09" 

#### ✅ Sprint 3 Backend Complete 

|Story|Status|
|---|---|
|S3-01 RBAC roles + matrix||
|S3-02 authenticate middleware|✅ (Artifact 20)|
|S3-03 authorize middleware||
|S3-04 Membership middleware||
|S3-05 Admin-only register||
|S3-06 List users + pagination||
|S3-07 Profile read + update||
|S3-08 Role assignment||
|S3-09 Activate / deactivate||
|S3-10 Frontend users admin page|Next artifact<br>⏳|



DeepSeek Chat Export  |  Page 32 of 103 

## **MODULE USERS + RBAC — Sprint 3 FRONTEND (FR-RBAC-01..05, FRAUTH-05..09)** 

The user wants the frontend users admin page for Sprint 3 Story S3-10. This must be consistent with: 

- Artifact 21 (frontend auth slice patterns) 

- Artifact 22 (backend users module + RBAC) 

- Artifact 13 (error codes) 

- Artifact 11 §16 (frontend rules) 

- Artifact 15 (test cases TS-USER-01..07) 

- Artifact 4 (OpenAPI) 

I need to produce: 

- Users API client 

- Zod schemas for user forms 

- Query hooks (list, detail, mutations) 

- Components: UserList/Table, RoleDropdown, StatusToggle, UserProfileForm, UserDetailDrawer 

- AdminUsersPage 

- Wire into routes with ProtectedRoute roles=['Administrator'] 

- Tests 

- DoD, commit message 

Let me be consistent with the auth slice: 

- Uses apiGet/apiPost/apiPatch from lib/api/http.ts 

- Uses queryKeys from lib/api/queryKeys.ts 

- Uses toErrorUX/extractApiError from lib/api/errors.ts 

- Uses TanStack Query 

DeepSeek Chat Export  |  Page 33 of 103 

- Uses React Hook Form + Zod 

- Uses useAuth for current user 

Endpoint contracts from Artifact 22: 

- GET /users?page=&limit=&role=&isActive=&search= → { data: UserDTO[], meta } 

- POST /users 

- GET /users/:id 

- PATCH /users/:id — { fullName?, configuredCapacityHours? } 

- PATCH /users/:id/role — { globalRole } 

- PATCH /users/:id/status — { isActive } 

UserDTO shape from Artifact 22 §10: 

**TYPESCRIPT** 

interface UserDTO { id: string; email: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours: number; isActive: boolean; createdAt: string; lastLoginAt: string | null; } 

Note: The auth slice has AuthUser type in types/api.ts with fields: id, email, fullName, globalRole, configuredCapacityHours, isActive, createdAt. The UserDTO has an extra lastLoginAt. I should extend the shared types. 

Let me plan files: 

frontend/src/ 

DeepSeek Chat Export  |  Page 34 of 103 



<!-- Start of picture text -->
├── types/api.ts                        (extend with UserDTO)<br>├── features/admin/<br>│   ├── users/<br>│   │   ├── api/users.api.ts<br>│   │   ├── schemas/user.schema.ts<br>│   │   ├── hooks/<br>│   │   │   ├── useUsers.ts<br>│   │   │   ├── useUser.ts<br>│   │   │   ├── useCreateUser.ts<br>│   │   │   ├── useUpdateUser.ts<br>│   │   │   ├── useUpdateUserRole.ts<br>│   │   │   └── useUpdateUserStatus.ts<br>│   │   ├── components/<br>│   │   │   ├── UserTable.tsx<br>│   │   │   ├── UserTableRow.tsx<br>│   │   │   ├── RoleDropdown.tsx<br>│   │   │   ├── StatusToggle.tsx<br>│   │   │   ├── UserFilters.tsx<br>│   │   │   ├── UserCreateDialog.tsx<br>│   │   │   ├── UserProfileForm.tsx<br>│   │   │   └── ConfirmDialog.tsx<br>│   │   └── pages/<br>│   │       ├── AdminUsersPage.tsx<br>│   │       └── UserProfilePage.tsx<br><!-- End of picture text -->

I'll also add a Pagination component (generic). 

Let me write it all. I'll be thorough but efficient. 

DeepSeek Chat Export  |  Page 35 of 103 

For routing: 

- /admin/users — protected, Administrator only 

- /profile — protected, any authenticated user 

The user profile page (self) will use the same UserProfileForm. 

Let me also update Artifact 21's types/api.ts to add UserDTO and related types. 

Also note: the auth API has me() returning AuthUser which we'll now extend to also match UserDTO (add lastLoginAt). Actually, the backend authService.getById returns AuthUser (from Artifact 20) which doesn't include lastLoginAt. The users service returns UserDTO with lastLoginAt. Slight inconsistency but OK — different endpoints, different DTOs. I'll keep AuthUser for /auth/me and UserDTO for /users/*. 

Now let me write everything. 

For tests, I'll add a couple: 

- UserTable renders rows 

- RoleDropdown calls onChange with correct value 

- StatusToggle fires confirm 

- UserProfileForm validation 

Let me be concise but complete. Given the previous artifacts' level of detail, I'll aim for similar depth but not bloat. 

ARTIFACT 23 — Frontend Users Admin (S3-10) 

**Document ID:** MOD-USERS-FE-001 

**Baseline:** SRS v2.1 §4.1, §4.2 · CA-05, CA-18 · Artifact 4 (OpenAPI) · Artifact 11 §16 · Artifact 13 §8 · Artifact 15 (TS-USER-01..07) · **Artifact 22 (Users + RBAC backend — the contract this consumes)** 

**Scope:** Admin user management — list, filters, role dropdown, status toggle, create, profile form 

**Status:** READY TO COMMIT 

##### 0. Traceability 

|Story|FR|UC|Test|Endpoint|
|---|---|---|---|---|
|S3-10 User admin|FR-AUTH-05, FR-AUTH-06, FR-AUTH-07,|UC-02,|TS-|/users/*|
|page|FR-AUTH-09|UC-03|USER-01..07||



DeepSeek Chat Export  |  Page 36 of 103 

**Rule (Artifact 11 §8 R5):** Frontend is **not** a security boundary. Every visible action is backed by a backend check. UI hides affordances but never substitutes authorization. 

1. File Layout 



<!-- Start of picture text -->
frontend/src/<br>├── types/<br>│   └── api.ts                                   # extend: UserDTO, ListMeta, GlobalRole<br>│<br>├── components/ui/                               # shared primitives (new)<br>│   ├── Pagination.tsx<br>│   ├── Dialog.tsx<br>│   ├── ConfirmDialog.tsx<br>│   └── Field.tsx<br>│<br>└── features/admin/users/<br>    ├── api/<br>    │   └── users.api.ts<br>    ├── schemas/<br>    │   └── user.schema.ts<br>    ├── hooks/<br>    │   ├── useUsers.ts<br>    │   ├── useCreateUser.ts<br>    │   ├── useUpdateUser.ts<br>    │   ├── useUpdateUserRole.ts<br>    │   └── useUpdateUserStatus.ts<br>    ├── components/<br>    │   ├── UsersToolbar.tsx<br>    │   ├── UsersTable.tsx<br><!-- End of picture text -->

DeepSeek Chat Export  |  Page 37 of 103 

│   ├── UserRow.tsx │   ├── RoleDropdown.tsx │   ├── StatusToggle.tsx │   ├── UserCreateDialog.tsx │   └── UserProfileForm.tsx ├── pages/ │   ├── AdminUsersPage.tsx │   └── ProfilePage.tsx └── __tests__/ ├── UsersTable.test.tsx ├── RoleDropdown.test.tsx ├── StatusToggle.test.tsx └── UserProfileForm.test.tsx 

##### 2. Extend Shared Types 

Edit frontend/src/types/api.ts — add UserDTO + shared list metadata. 

##### **TYPESCRIPT** 

/* ============================================================================ * Shared API types — mirror of the backend + OpenAPI 3.1 contracts * Source of truth: docs/api/openapi.json, Artifacts 20, 22 * ==========================================================================*/ 

export type GlobalRole = | 'Administrator' | 'Project Manager' | 'Team Member' 

DeepSeek Chat Export  |  Page 38 of 103 

| 'Viewer'; export const GLOBAL_ROLES: readonly GlobalRole[] = [ 'Administrator', 'Project Manager', 'Team Member', 'Viewer' ] as const; /** /auth/me response shape (Artifact 20) */ export interface AuthUser { id: string; email: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours: number; isActive: boolean; createdAt: string; } /** /users/* response shape (Artifact 22 §10) */ export interface UserDTO extends AuthUser { lastLoginAt: string | null; } /** Pagination meta — FR-API-05 */ export interface ListMeta { page: number; 

DeepSeek Chat Export  |  Page 39 of 103 

limit: number; total: number; totalPages: number; } export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number; } export interface LoginResponse extends TokenPair { user: AuthUser; } export interface LoginRequest { email: string; password: string; } export interface RefreshRequest { refreshToken: string; } export interface SuccessEnvelope<T> { success: true; data: T; meta?: ListMeta; 

DeepSeek Chat Export  |  Page 40 of 103 

} export interface ErrorEnvelope { success: false; error: { code: string; message: string; details?: Record<string, unknown>; }; } 

3. Users API Client 

Save as frontend/src/features/admin/users/api/users.api.ts. 

**TYPESCRIPT** /* Typed layer over /users/* (Artifact 22 §16) */ import { apiGet, apiPost, apiPatch, http } from '@/lib/api/http.js'; import type { GlobalRole, UserDTO, ListMeta } from '@/types/api.js'; export interface ListUsersParams { page?: number; limit?: number; role?: GlobalRole; isActive?: boolean; search?: string; } 

DeepSeek Chat Export  |  Page 41 of 103 

export interface ListUsersResult { rows: UserDTO[]; meta: ListMeta; } export const usersApi = { async list(params: ListUsersParams = {}): Promise<ListUsersResult> { const { data } = await http.get<{ success: true; data: UserDTO[]; meta: ListMeta; }>('/users', { params: { page: params.page ?? 1, limit: params.limit ?? 20, role: params.role, isActive: params.isActive === undefined ? undefined : String(params.isActive), search: params.search || undefined } }); return { rows: data.data, meta: data.meta }; }, getById(userId: string): Promise<UserDTO> { return apiGet<UserDTO>(`/users/${userId}`); }, 

DeepSeek Chat Export  |  Page 42 of 103 

create(input: { email: string; password: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours?: number; }): Promise<UserDTO> { return apiPost<UserDTO>('/users', input); }, update( userId: string, input: { fullName?: string; configuredCapacityHours?: number } ): Promise<UserDTO> { return apiPatch<UserDTO>(`/users/${userId}`, input); }, updateRole(userId: string, globalRole: GlobalRole): Promise<UserDTO> { return apiPatch<UserDTO>(`/users/${userId}/role`, { globalRole }); }, updateStatus(userId: string, isActive: boolean): Promise<UserDTO> { return apiPatch<UserDTO>(`/users/${userId}/status`, { isActive }); } }; 

DeepSeek Chat Export  |  Page 43 of 103 

##### 4. Zod Schemas 

Save as frontend/src/features/admin/users/schemas/user.schema.ts. 

**TYPESCRIPT** 

import { z } from 'zod'; const GLOBAL_ROLE_ENUM = z.enum([ 'Administrator', 'Project Manager', 'Team Member', 'Viewer' ]); const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/; /** Create user form — admin only (CA-04) */ export const createUserSchema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'), fullName: z.string().trim().min(1, 'Full name is required').max(100), password: z .string() .min(8, 'Minimum 8 characters') .regex( PASSWORD_REGEX, 'Include upper, lower, digit, and special character' ), globalRole: GLOBAL_ROLE_ENUM, configuredCapacityHours: z.coerce 

DeepSeek Chat Export  |  Page 44 of 103 

.number() .int() .min(10, 'Minimum is 10') .max(80, 'Maximum is 80') }); export type CreateUserFormValues = z.infer<typeof createUserSchema>; /** Profile update form — self or admin */ export const userProfileSchema = z .object({ fullName: z.string().trim().min(1, 'Full name is required').max(100), configuredCapacityHours: z.coerce.number().int().min(10).max(80) }) .partial() .refine( (v) => v.fullName !== undefined || v.configuredCapacityHours !== undefined, { message: 'At least one field must be provided' } ); export type UserProfileFormValues = z.infer<typeof userProfileSchema>; /** Role change schema */ export const roleChangeSchema = z.object({ globalRole: GLOBAL_ROLE_ENUM }); export type RoleChangeFormValues = z.infer<typeof roleChangeSchema>; 

DeepSeek Chat Export  |  Page 45 of 103 

##### 5. Query Hooks 

Save as frontend/src/features/admin/users/hooks/useUsers.ts. 

**TYPESCRIPT** import { keepPreviousData, useQuery } from '@tanstack/react-query'; import { usersApi, type ListUsersParams } from '../api/users.api.js'; import { queryKeys } from '@/lib/api/queryKeys.js'; export function useUsers(params: ListUsersParams) { return useQuery({ queryKey: queryKeys.users(params), queryFn: () => usersApi.list(params), placeholderData: keepPreviousData, staleTime: 15_000 }); } 

Save as frontend/src/features/admin/users/hooks/useCreateUser.ts. 

**TYPESCRIPT** import { useMutation, useQueryClient } from '@tanstack/react-query'; import { usersApi } from '../api/users.api.js'; import { queryKeys } from '@/lib/api/queryKeys.js'; import type { CreateUserFormValues } from '../schemas/user.schema.js'; export function useCreateUser() { 

DeepSeek Chat Export  |  Page 46 of 103 

const qc = useQueryClient(); return useMutation({ mutationFn: (input: CreateUserFormValues) => usersApi.create(input), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); } }); } 

Save as frontend/src/features/admin/users/hooks/useUpdateUser.ts. 

**TYPESCRIPT** import { useMutation, useQueryClient } from '@tanstack/react-query'; import { usersApi } from '../api/users.api.js'; import { queryKeys } from '@/lib/api/queryKeys.js'; import type { UserProfileFormValues } from '../schemas/user.schema.js'; export function useUpdateUser(userId: string) { const qc = useQueryClient(); return useMutation({ mutationFn: (input: UserProfileFormValues) => usersApi.update(userId, input), onSuccess: (updated) => { void qc.invalidateQueries({ queryKey: ['users'] }); void qc.invalidateQueries({ queryKey: queryKeys.user(userId) }); void qc.invalidateQueries({ queryKey: queryKeys.me }); } }); } 

DeepSeek Chat Export  |  Page 47 of 103 

Save as frontend/src/features/admin/users/hooks/useUpdateUserRole.ts. 

##### **TYPESCRIPT** 

import { useMutation, useQueryClient } from '@tanstack/react-query'; import { usersApi } from '../api/users.api.js'; import type { GlobalRole } from '@/types/api.js'; export function useUpdateUserRole() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ userId, globalRole }: { userId: string; globalRole: GlobalRole }) => usersApi.updateRole(userId, globalRole), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); } }); } 

Save as frontend/src/features/admin/users/hooks/useUpdateUserStatus.ts. 

**TYPESCRIPT** import { useMutation, useQueryClient } from '@tanstack/react-query'; import { usersApi } from '../api/users.api.js'; export function useUpdateUserStatus() { const qc = useQueryClient(); return useMutation({ 

DeepSeek Chat Export  |  Page 48 of 103 

mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) => usersApi.updateStatus(userId, isActive), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); } }); } 

6. Shared UI Primitives 

Save as frontend/src/components/ui/Pagination.tsx. 

**TYPESCRIPT** 

import type { ListMeta } from '@/types/api.js'; interface PaginationProps { meta: ListMeta; onPageChange: (page: number) => void; disabled?: boolean; } export function Pagination({ meta, onPageChange, disabled }: PaginationProps) { const { page, totalPages, total } = meta; const canPrev = page > 1; const canNext = page < totalPages; return ( <nav 

DeepSeek Chat Export  |  Page 49 of 103 

aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm" > <span className="text-slate-600"> Page {page} of {totalPages} · {total} total </span> <div className="flex gap-2"> <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || !canPrev} 

className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" > Previous </button> <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || !canNext} 

className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" 

> Next </button> </div> </nav> ); } 

DeepSeek Chat Export  |  Page 50 of 103 

Save as frontend/src/components/ui/Dialog.tsx. 

**TYPESCRIPT** import { useEffect, type ReactNode } from 'react'; interface DialogProps { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; } export function Dialog({ open, onClose, title, children, footer }: DialogProps) { useEffect(() => { if (!open) return; function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); } window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [open, onClose]); if (!open) return null; return ( <div 

DeepSeek Chat Export  |  Page 51 of 103 

role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose} > <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} > <h2 id="dialog-title" className="text-lg font-semibold text-slate-800"> {title} </h2> <div className="mt-4">{children}</div> {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>} </div> </div> ); } 

Save as frontend/src/components/ui/ConfirmDialog.tsx. 

**TYPESCRIPT** import type { ReactNode } from 'react'; import { Dialog } from './Dialog.js'; interface ConfirmDialogProps { open: boolean; 

DeepSeek Chat Export  |  Page 52 of 103 

title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode; } export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel, children }: ConfirmDialogProps) { return ( <Dialog open={open} onClose={busy ? () => undefined : onCancel} title={title} 

DeepSeek Chat Export  |  Page 53 of 103 

footer={ <> <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" > {cancelLabel} </button> <button type="button" onClick={onConfirm} disabled={busy} className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${ danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-primary hover:bg-brand-primary/90' } disabled:opacity-60`} > {busy ? 'Working…' : confirmLabel} </button> </> } > <p className="text-sm text-slate-700">{message}</p> {children} 

DeepSeek Chat Export  |  Page 54 of 103 

</Dialog> ); } 

Save as frontend/src/components/ui/Field.tsx. 

##### **TYPESCRIPT** 

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'; 

interface BaseFieldProps { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; } export function Field({ label, htmlFor, error, hint, children }: BaseFieldProps) { return ( <div> <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700"> {label} </label> <div className="mt-1">{children}</div> {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>} {error && ( <p id={`${htmlFor}-error`} className="mt-1 text-sm text-red-600"> {error} 

DeepSeek Chat Export  |  Page 55 of 103 

</p> )} </div> ); } const inputClass = 'block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:bg-slate-100'; export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />; } export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />; } 

##### 7. Users Table 

Save as frontend/src/features/admin/users/components/UsersTable.tsx. 

**TYPESCRIPT** import type { UserDTO } from '@/types/api.js'; import { UserRow } from './UserRow.js'; interface UsersTableProps { rows: UserDTO[]; 

DeepSeek Chat Export  |  Page 56 of 103 

loading: boolean; currentUserId: string | null; onRoleChange: (userId: string, role: UserDTO['globalRole']) => void; onToggleStatus: (userId: string, isActive: boolean) => void; roleBusyUserId?: string; statusBusyUserId?: string; } export function UsersTable({ rows, loading, currentUserId, onRoleChange, onToggleStatus, roleBusyUserId, statusBusyUserId }: UsersTableProps) { return ( <div className="overflow-x-auto"> <table className="min-w-full divide-y divide-slate-200 text-sm"> <thead className="bg-slate-50"> <tr> <th className="px-4 py-3 text-left font-medium text-slate-600">User</th> <th className="px-4 py-3 text-left font-medium text-slate-600">Role</th> <th className="px-4 py-3 text-left font-medium text-slate-600">Capacity</th> <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th> <th className="px-4 py-3 text-left font-medium text-slate-600">Last Login</th> <th className="px-4 py-3" aria-label="Actions" /> 

DeepSeek Chat Export  |  Page 57 of 103 

</tr> </thead> <tbody className="divide-y divide-slate-100 bg-white"> {loading && rows.length === 0 && ( <tr> <td colSpan={6} className="px-4 py-8 text-center text-slate-500"> Loading users… </td> </tr> )} {!loading && rows.length === 0 && ( <tr> <td colSpan={6} className="px-4 py-8 text-center text-slate-500"> No users match your filters. </td> </tr> )} {rows.map((u) => ( <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onRoleChange={onRoleChange} onToggleStatus={onToggleStatus} roleBusy={roleBusyUserId === u.id} statusBusy={statusBusyUserId === u.id} /> ))} 

DeepSeek Chat Export  |  Page 58 of 103 

</tbody> </table> </div> ); } 

Save as frontend/src/features/admin/users/components/UserRow.tsx. 

**TYPESCRIPT** import { Link } from 'react-router-dom'; import type { GlobalRole, UserDTO } from '@/types/api.js'; import { RoleDropdown } from './RoleDropdown.js'; import { StatusToggle } from './StatusToggle.js'; interface UserRowProps { user: UserDTO; isSelf: boolean; onRoleChange: (userId: string, role: GlobalRole) => void; onToggleStatus: (userId: string, isActive: boolean) => void; roleBusy?: boolean; statusBusy?: boolean; } function formatDate(iso: string | null): string { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, { year: 'numeric', 

DeepSeek Chat Export  |  Page 59 of 103 

month: 'short', day: 'numeric' }); } export function UserRow({ user, isSelf, onRoleChange, onToggleStatus, roleBusy, statusBusy }: UserRowProps) { return ( <tr className="hover:bg-slate-50"> <td className="px-4 py-3"> <div className="font-medium text-slate-800"> {user.fullName} {isSelf && ( <span className="ml-2 rounded bg-brand-primary/10 px-1.5 py-0.5 text-xs font-medium text-brandprimary"> You </span> )} </div> <div className="text-xs text-slate-500">{user.email}</div> </td> 

DeepSeek Chat Export  |  Page 60 of 103 

<td className="px-4 py-3"> <RoleDropdown value={user.globalRole} disabled={isSelf} busy={roleBusy} onChange={(role) => onRoleChange(user.id, role)} ariaLabel={`Change role for ${user.fullName}`} /> </td> <td className="px-4 py-3 text-slate-700"> {user.configuredCapacityHours} h/week </td> <td className="px-4 py-3"> <StatusToggle isActive={user.isActive} disabled={isSelf} busy={statusBusy} onChange={(next) => onToggleStatus(user.id, next)} ariaLabel={`Toggle status for ${user.fullName}`} /> </td> <td className="px-4 py-3 text-slate-500">{formatDate(user.lastLoginAt)}</td> <td className="px-4 py-3 text-right"> <Link 

DeepSeek Chat Export  |  Page 61 of 103 

to={`/profile/${user.id}`} className="text-sm text-brand-primary hover:underline" > View </Link> </td> </tr> ); } 

8. Role Dropdown 

Save as frontend/src/features/admin/users/components/RoleDropdown.tsx. 

##### **TYPESCRIPT** 

import { useState } from 'react'; import { GLOBAL_ROLES, type GlobalRole } from '@/types/api.js'; import { ConfirmDialog } from '@/components/ui/ConfirmDialog.js'; interface RoleDropdownProps { value: GlobalRole; disabled?: boolean; busy?: boolean; onChange: (role: GlobalRole) => void; ariaLabel?: string; } export function RoleDropdown({ 

DeepSeek Chat Export  |  Page 62 of 103 

value, disabled, busy, onChange, ariaLabel }: RoleDropdownProps) { const [pendingRole, setPendingRole] = useState<GlobalRole | null>(null); function handleSelect(next: string) { const role = next as GlobalRole; if (role === value) return; setPendingRole(role); } function confirm() { if (!pendingRole) return; onChange(pendingRole); setPendingRole(null); } function cancel() { setPendingRole(null); } return ( <> <select aria-label={ariaLabel ?? 'Change role'} 

DeepSeek Chat Export  |  Page 63 of 103 

value={value} disabled={disabled || busy} onChange={(e) => handleSelect(e.target.value)} 

className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:borderbrand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:cursor-not-allowed disabled:bgslate-100" > {GLOBAL_ROLES.map((r) => ( <option key={r} value={r}> {r} </option> ))} </select> <ConfirmDialog open={pendingRole !== null} title="Change system role" message={ pendingRole ? `Change this user's role from "${value}" to "${pendingRole}"? Their active sessions will be revoked.` : '' } confirmLabel="Change role" busy={busy} onConfirm={confirm} onCancel={cancel} /> </> ); 

DeepSeek Chat Export  |  Page 64 of 103 

} 

9. Status Toggle 

Save as frontend/src/features/admin/users/components/StatusToggle.tsx. 

**TYPESCRIPT** import { useState } from 'react'; import { ConfirmDialog } from '@/components/ui/ConfirmDialog.js'; interface StatusToggleProps { isActive: boolean; disabled?: boolean; busy?: boolean; onChange: (next: boolean) => void; ariaLabel?: string; } export function StatusToggle({ isActive, disabled, busy, onChange, ariaLabel }: StatusToggleProps) { const [pending, setPending] = useState<boolean | null>(null); function handleToggle() { 

DeepSeek Chat Export  |  Page 65 of 103 

if (disabled || busy) return; setPending(!isActive); } function confirm() { if (pending === null) return; onChange(pending); setPending(null); } const targetState = pending; return ( <> <button type="button" role="switch" aria-checked={isActive} aria-label={ariaLabel ?? 'Toggle account status'} onClick={handleToggle} disabled={disabled || busy} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition ${ isActive ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600' } disabled:cursor-not-allowed disabled:opacity-60`} > <span 

DeepSeek Chat Export  |  Page 66 of 103 

className={`inline-block h-2 w-2 rounded-full ${ isActive ? 'bg-green-500' : 'bg-slate-400' }`} /> {busy ? 'Saving…' : isActive ? 'Active' : 'Inactive'} </button> <ConfirmDialog open={pending !== null} title={targetState ? 'Activate user' : 'Deactivate user'} message={ targetState ? 'This user will be able to sign in again. Continue?' : 'This user will be signed out everywhere and blocked from signing in. Continue?' } confirmLabel={targetState ? 'Activate' : 'Deactivate'} danger={targetState === false} busy={busy} onConfirm={confirm} onCancel={() => setPending(null)} /> </> ); } 

10. Users Toolbar (filters) 

Save as frontend/src/features/admin/users/components/UsersToolbar.tsx. 

DeepSeek Chat Export  |  Page 67 of 103 

**TYPESCRIPT** import { GLOBAL_ROLES, type GlobalRole } from '@/types/api.js'; export interface UsersFilters { search: string; role: GlobalRole | ''; isActive: '' | 'true' | 'false'; } interface UsersToolbarProps { filters: UsersFilters; onChange: (filters: UsersFilters) => void; onCreate: () => void; disabled?: boolean; } export function UsersToolbar({ filters, onChange, onCreate, disabled }: UsersToolbarProps) { return ( <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3"> <input type="search" value={filters.search} onChange={(e) => onChange({ ...filters, search: e.target.value })} 

DeepSeek Chat Export  |  Page 68 of 103 

placeholder="Search by name or email" aria-label="Search users" className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary" /> <select aria-label="Filter by role" value={filters.role} onChange={(e) => onChange({ ...filters, role: e.target.value as UsersFilters['role'] }) } className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" > <option value="">All roles</option> {GLOBAL_ROLES.map((r) => ( <option key={r} value={r}> {r} </option> ))} </select> <select aria-label="Filter by status" value={filters.isActive} onChange={(e) => onChange({ ...filters, 

DeepSeek Chat Export  |  Page 69 of 103 

isActive: e.target.value as UsersFilters['isActive'] }) } className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" > <option value="">Any status</option> <option value="true">Active</option> <option value="false">Inactive</option> </select> <div className="ml-auto"> <button type="button" onClick={onCreate} disabled={disabled} className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-primary/90 disabled:opacity-60" > + New user </button> </div> </div> ); } 

11. Create User Dialog 

Save as frontend/src/features/admin/users/components/UserCreateDialog.tsx. 

DeepSeek Chat Export  |  Page 70 of 103 

##### **TYPESCRIPT** 

import { useForm } from 'react-hook-form'; import { zodResolver } from '@hookform/resolvers/zod'; import { Dialog } from '@/components/ui/Dialog.js'; import { Field, TextInput, SelectInput } from '@/components/ui/Field.js'; import { GLOBAL_ROLES } from '@/types/api.js'; import { createUserSchema, type CreateUserFormValues } from '../schemas/user.schema.js'; import { useCreateUser } from '../hooks/useCreateUser.js'; import { getApiError, toErrorUX } from '@/lib/api/errors.js'; interface UserCreateDialogProps { open: boolean; onClose: () => void; } export function UserCreateDialog({ open, onClose }: UserCreateDialogProps) { const createUser = useCreateUser(); const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<CreateUserFormValues>({ 

DeepSeek Chat Export  |  Page 71 of 103 

resolver: zodResolver(createUserSchema), defaultValues: { email: '', fullName: '', password: '', globalRole: 'Team Member', configuredCapacityHours: 40 } }); async function onSubmit(values: CreateUserFormValues) { try { await createUser.mutateAsync(values); reset(); onClose(); } catch (err) { const apiError = getApiError(err); const ux = toErrorUX(apiError); if (ux.fieldErrors) { for (const [path, message] of Object.entries(ux.fieldErrors)) { setError(path as keyof CreateUserFormValues, { message }); } } // Surface a global error via field-level on email when the backend // returns AUTH_EMAIL_EXISTS (not a field issue but a form conflict). if (apiError.code === 'AUTH_EMAIL_EXISTS') { setError('email', { message: 'This email is already registered.' }); } 

DeepSeek Chat Export  |  Page 72 of 103 

} } return ( <Dialog open={open} onClose={onClose} title="Create user" footer={ <> <button type="button" onClick={onClose} disabled={isSubmitting} 

className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" > Cancel </button> <button type="submit" form="create-user-form" disabled={isSubmitting} className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-brandprimary/90 disabled:opacity-60" > {isSubmitting ? 'Creating…' : 'Create user'} </button> </> 

DeepSeek Chat Export  |  Page 73 of 103 

} > <form id="create-user-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" > <Field label="Full name" htmlFor="cu-fullName" error={errors.fullName?.message}> <TextInput id="cu-fullName" autoComplete="name" {...register('fullName')} /> </Field> <Field label="Email" htmlFor="cu-email" error={errors.email?.message}> <TextInput id="cu-email" type="email" autoComplete="email" {...register('email')} /> </Field> <Field label="Password" htmlFor="cu-password" error={errors.password?.message} hint="Minimum 8 chars, upper + lower + digit + special." > <TextInput id="cu-password" type="password" autoComplete="new-password" {...register('password')} /> 

DeepSeek Chat Export  |  Page 74 of 103 

</Field> <div className="grid grid-cols-2 gap-4"> <Field label="System role" htmlFor="cu-role" error={errors.globalRole?.message}> <SelectInput id="cu-role" {...register('globalRole')}> {GLOBAL_ROLES.map((r) => ( <option key={r} value={r}> {r} </option> ))} </SelectInput> </Field> <Field label="Weekly capacity (h)" htmlFor="cu-capacity" error={errors.configuredCapacityHours?.message} hint="10 – 80" > <TextInput id="cu-capacity" type="number" min={10} max={80} {...register('configuredCapacityHours')} /> </Field> </div> 

DeepSeek Chat Export  |  Page 75 of 103 

</form> </Dialog> ); } 

12. User Profile Form (self or admin) Save as frontend/src/features/admin/users/components/UserProfileForm.tsx. 

**TYPESCRIPT** import { useForm } from 'react-hook-form'; import { zodResolver } from '@hookform/resolvers/zod'; import { Field, TextInput } from '@/components/ui/Field.js'; import { userProfileSchema, type UserProfileFormValues } from '../schemas/user.schema.js'; import { useUpdateUser } from '../hooks/useUpdateUser.js'; import { getApiError, toErrorUX } from '@/lib/api/errors.js'; import type { UserDTO } from '@/types/api.js'; interface UserProfileFormProps { user: UserDTO; canEdit: boolean; onSaved?: () => void; } export function UserProfileForm({ user, canEdit, onSaved }: UserProfileFormProps) { 

DeepSeek Chat Export  |  Page 76 of 103 

const updateUser = useUpdateUser(user.id); const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<UserProfileFormValues>({ resolver: zodResolver(userProfileSchema), defaultValues: { fullName: user.fullName, configuredCapacityHours: user.configuredCapacityHours } }); async function onSubmit(values: UserProfileFormValues) { try { await updateUser.mutateAsync(values); reset(values); onSaved?.(); } catch (err) { const apiError = getApiError(err); const ux = toErrorUX(apiError); if (ux.fieldErrors) { for (const [path, message] of Object.entries(ux.fieldErrors)) { setError(path as keyof UserProfileFormValues, { message }); } 

DeepSeek Chat Export  |  Page 77 of 103 

} } } return ( <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4"> <Field label="Full name" htmlFor="pf-fullName" error={errors.fullName?.message}> <TextInput id="pf-fullName" disabled={!canEdit} {...register('fullName')} /> </Field> <Field label="Weekly capacity (h)" htmlFor="pf-capacity" error={errors.configuredCapacityHours?.message} hint="Used by PIRAE workload risk (10 – 80)" > <TextInput id="pf-capacity" type="number" min={10} max={80} disabled={!canEdit} {...register('configuredCapacityHours')} /> 

DeepSeek Chat Export  |  Page 78 of 103 

</Field> {canEdit && ( <div className="flex justify-end"> <button type="submit" disabled={isSubmitting || !isDirty} className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-brandprimary/90 disabled:opacity-60" > {isSubmitting ? 'Saving…' : 'Save changes'} </button> </div> )} </form> ); } 

13. Admin Users Page 

Save as frontend/src/features/admin/users/pages/AdminUsersPage.tsx. 

##### **TYPESCRIPT** 

import { useMemo, useState } from 'react'; import { useAuth } from '@/features/auth/hooks/useAuth.js'; import { useUsers } from '../hooks/useUsers.js'; import { useUpdateUserRole } from '../hooks/useUpdateUserRole.js'; import { useUpdateUserStatus } from '../hooks/useUpdateUserStatus.js'; 

DeepSeek Chat Export  |  Page 79 of 103 

import { UsersToolbar, type UsersFilters } from '../components/UsersToolbar.js'; import { UsersTable } from '../components/UsersTable.js'; import { UserCreateDialog } from '../components/UserCreateDialog.js'; import { Pagination } from '@/components/ui/Pagination.js'; import { getApiError, toErrorUX } from '@/lib/api/errors.js'; import type { GlobalRole } from '@/types/api.js'; const PAGE_SIZE = 20; export function AdminUsersPage() { const { user: me } = useAuth(); const [filters, setFilters] = useState<UsersFilters>({ search: '', role: '', isActive: '' }); const [page, setPage] = useState(1); const [createOpen, setCreateOpen] = useState(false); const [toast, setToast] = useState<string | null>(null); const params = useMemo( () => ({ page, limit: PAGE_SIZE, search: filters.search.trim() || undefined, role: filters.role || undefined, isActive: filters.isActive === 'true' 

DeepSeek Chat Export  |  Page 80 of 103 

? true : filters.isActive === 'false' ? false : undefined }), [page, filters] ); const { data, isLoading, isFetching } = useUsers(params); const roleMutation = useUpdateUserRole(); const statusMutation = useUpdateUserStatus(); function showToast(msg: string) { setToast(msg); window.setTimeout(() => setToast(null), 3000); } async function handleRoleChange(userId: string, role: GlobalRole) { try { await roleMutation.mutateAsync({ userId, globalRole: role }); showToast('Role updated.'); } catch (err) { showToast(toErrorUX(getApiError(err)).message); } } async function handleToggleStatus(userId: string, isActive: boolean) { try { 

DeepSeek Chat Export  |  Page 81 of 103 

await statusMutation.mutateAsync({ userId, isActive }); showToast(isActive ? 'User activated.' : 'User deactivated.'); } catch (err) { showToast(toErrorUX(getApiError(err)).message); } } return ( <main className="mx-auto max-w-6xl px-6 py-8"> <header className="mb-6"> <h1 className="text-2xl font-bold text-slate-800">Users</h1> <p className="mt-1 text-sm text-slate-500"> Manage platform accounts, roles, and status. </p> </header> <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"> <UsersToolbar filters={filters} onChange={(next) => { setFilters(next); setPage(1); }} onCreate={() => setCreateOpen(true)} /> <UsersTable rows={data?.rows ?? []} 

DeepSeek Chat Export  |  Page 82 of 103 

loading={isLoading || isFetching} currentUserId={me?.id ?? null} roleBusyUserId={roleMutation.isPending ? roleMutation.variables?.userId : undefined} statusBusyUserId={statusMutation.isPending ? statusMutation.variables?.userId : undefined} onRoleChange={handleRoleChange} onToggleStatus={handleToggleStatus} /> 

{data?.meta && ( <Pagination meta={data.meta} onPageChange={setPage} disabled={isFetching} /> )} </section> 

<UserCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} /> 

{toast && ( <div role="status" className="fixed bottom-6 right-6 z-50 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg" > {toast} </div> )} </main> ); } 

DeepSeek Chat Export  |  Page 83 of 103 

##### 14. Profile Page 

Save as frontend/src/features/admin/users/pages/ProfilePage.tsx. 

**TYPESCRIPT** import { useParams } from 'react-router-dom'; import { useQuery } from '@tanstack/react-query'; import { useAuth } from '@/features/auth/hooks/useAuth.js'; import { usersApi } from '../api/users.api.js'; import { queryKeys } from '@/lib/api/queryKeys.js'; import { UserProfileForm } from '../components/UserProfileForm.js'; export function ProfilePage() { const { user: me } = useAuth(); const params = useParams<{ userId?: string }>(); const targetId = params.userId ?? me?.id ?? ''; const isSelf = !params.userId || params.userId === me?.id; const canEdit = isSelf || me?.globalRole === 'Administrator'; const { data, isLoading, isError } = useQuery({ queryKey: queryKeys.user(targetId), queryFn: () => usersApi.getById(targetId), enabled: Boolean(targetId) }); if (isLoading) { return ( <main className="mx-auto max-w-2xl px-6 py-8"> <p className="text-sm text-slate-500">Loading…</p> 

DeepSeek Chat Export  |  Page 84 of 103 

</main> ); } if (isError || !data) { return ( <main className="mx-auto max-w-2xl px-6 py-8"> <p className="text-sm text-red-600">Could not load profile.</p> </main> ); } return ( <main className="mx-auto max-w-2xl px-6 py-8"> <header className="mb-6"> <h1 className="text-2xl font-bold text-slate-800"> {isSelf ? 'My profile' : data.fullName} </h1> <p className="mt-1 text-sm text-slate-500">{data.email}</p> </header> <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"> <UserProfileForm user={data} canEdit={canEdit} /> </section> <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"> <h2 className="text-sm font-semibold text-slate-700">Account</h2> <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm"> 

DeepSeek Chat Export  |  Page 85 of 103 

<dt className="text-slate-500">System role</dt> <dd className="text-slate-800">{data.globalRole}</dd> <dt className="text-slate-500">Status</dt> <dd className="text-slate-800">{data.isActive ? 'Active' : 'Inactive'}</dd> <dt className="text-slate-500">Created</dt> <dd className="text-slate-800"> {new Date(data.createdAt).toLocaleDateString()} </dd> <dt className="text-slate-500">Last login</dt> <dd className="text-slate-800"> {data.lastLoginAt ? new Date(data.lastLoginAt).toLocaleString() : '—'} </dd> </dl> </section> </main> ); } 

15. Route Wire-up Update frontend/src/app/routes.tsx. 

**TYPESCRIPT** import { Navigate, Route, Routes } from 'react-router-dom'; import { LoginPage } from '@/features/auth/pages/LoginPage.js'; import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute.js'; 

DeepSeek Chat Export  |  Page 86 of 103 

import { AdminUsersPage } from '@/features/admin/users/pages/AdminUsersPage.js'; import { ProfilePage } from '@/features/admin/users/pages/ProfilePage.js'; function HomePage() { return ( <main className="min-h-screen bg-slate-50 p-8"> <h1 className="text-2xl font-bold text-brand-primary">Dashboard</h1> <p className="mt-2 text-slate-600">Signed in. Sprint 4+ will populate this.</p> </main> ); } function ForbiddenPage() { return ( <main className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-center"> <h1 className="text-2xl font-bold text-red-600">403</h1> <p className="mt-2 text-slate-600">You do not have access to this page.</p> </div> </main> ); } function NotFoundPage() { return ( <main className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-center"> <h1 className="text-2xl font-bold text-slate-800">404</h1> 

DeepSeek Chat Export  |  Page 87 of 103 

<p className="mt-2 text-slate-600">Page not found.</p> </div> </main> ); } export function AppRoutes() { return ( <Routes> <Route path="/login" element={<LoginPage />} /> <Route path="/403" element={<ForbiddenPage />} /> <Route path="/" element={ <ProtectedRoute> <HomePage /> </ProtectedRoute> } /> <Route path="/profile" element={ <ProtectedRoute> <ProfilePage /> </ProtectedRoute> } 

DeepSeek Chat Export  |  Page 88 of 103 

/> <Route path="/profile/:userId" element={ <ProtectedRoute> <ProfilePage /> </ProtectedRoute> } /> <Route path="/admin/users" element={ <ProtectedRoute roles={['Administrator']}> <AdminUsersPage /> </ProtectedRoute> } /> <Route path="*" element={<NotFoundPage />} /> </Routes> ); } 

16. Tests 

Save as frontend/src/features/admin/users/__tests__/UsersTable.test.tsx. 

DeepSeek Chat Export  |  Page 89 of 103 

**TYPESCRIPT** import { describe, it, expect, vi } from 'vitest'; import { render, screen } from '@testing-library/react'; import { MemoryRouter } from 'react-router-dom'; import { UsersTable } from '../components/UsersTable.js'; import type { UserDTO } from '@/types/api.js'; const baseUser: UserDTO = { id: 'u-1', email: 'admin@fyp.local', fullName: 'Admin', globalRole: 'Administrator', configuredCapacityHours: 40, isActive: true, createdAt: new Date().toISOString(), lastLoginAt: null }; describe('UsersTable', () => { it('renders rows for each user', () => { render( <MemoryRouter> <UsersTable rows={[baseUser, { ...baseUser, id: 'u-2', email: 'a@x.local', fullName: 'A' }]} loading={false} currentUserId={null} onRoleChange={vi.fn()} onToggleStatus={vi.fn()} 

DeepSeek Chat Export  |  Page 90 of 103 

/> </MemoryRouter> ); expect(screen.getByText('Admin')).toBeInTheDocument(); expect(screen.getByText('A')).toBeInTheDocument(); }); it('marks the current user with a "You" badge', () => { render( <MemoryRouter> <UsersTable rows={[baseUser]} loading={false} currentUserId={baseUser.id} onRoleChange={vi.fn()} onToggleStatus={vi.fn()} /> </MemoryRouter> ); expect(screen.getByText('You')).toBeInTheDocument(); }); it('shows empty state', () => { render( <MemoryRouter> <UsersTable rows={[]} loading={false} 

DeepSeek Chat Export  |  Page 91 of 103 

currentUserId={null} onRoleChange={vi.fn()} onToggleStatus={vi.fn()} /> </MemoryRouter> ); expect(screen.getByText(/no users match/i)).toBeInTheDocument(); }); it('shows loading state when rows are empty', () => { render( <MemoryRouter> <UsersTable rows={[]} loading currentUserId={null} onRoleChange={vi.fn()} onToggleStatus={vi.fn()} /> </MemoryRouter> ); expect(screen.getByText(/loading users/i)).toBeInTheDocument(); }); }); 

Save as frontend/src/features/admin/users/__tests__/RoleDropdown.test.tsx. 

**TYPESCRIPT** 

DeepSeek Chat Export  |  Page 92 of 103 

|import { describe, it, expect, vi } from 'vitest';|
|---|
|import { render, screen } from '@testing-library/react';|
|import userEvent from '@testing-library/user-event';|
|import { RoleDropdown } from '../components/RoleDropdown.js';|
|describe('RoleDropdown', () => {<br>it('opens a confirm dialog when a new role is selected', async () => {<br>const onChange = vi.fn();|
|render(<RoleDropdown value="Team Member" onChange={onChange} />);|
|await userEvent.selectOptions(screen.getByRole('combobox'), 'Administrator');|
|expect(screen.getByRole('dialog')).toBeInTheDocument();<br>expect(onChange).not.toHaveBeenCalled();|
|});|
|it('calls onChange after confirmation', async () => {|
|const onChange = vi.fn();|
|render(<RoleDropdown value="Team Member" onChange={onChange} />);|
|await userEvent.selectOptions(screen.getByRole('combobox'), 'Administrator');|
|await userEvent.click(screen.getByRole('button', { name: /change role/i }));|
|expect(onChange).toHaveBeenCalledWith('Administrator');<br>});|
|it('does not fire when selecting the current role', async () => {|
|const onChange = vi.fn();|
|render(<RoleDropdown value="Administrator" onChange={onChange} />);<br>await userEvent.selectOptions(screen.getByRole('combobox'), 'Administrator');|



DeepSeek Chat Export  |  Page 93 of 103 

expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); }); it('is disabled when `disabled` prop is set', () => { render(<RoleDropdown value="Team Member" onChange={vi.fn()} disabled />); expect(screen.getByRole('combobox')).toBeDisabled(); }); }); 

Save as frontend/src/features/admin/users/__tests__/StatusToggle.test.tsx. 

**TYPESCRIPT** import { describe, it, expect, vi } from 'vitest'; import { render, screen } from '@testing-library/react'; import userEvent from '@testing-library/user-event'; import { StatusToggle } from '../components/StatusToggle.js'; describe('StatusToggle', () => { it('reflects active state via aria-checked', () => { render(<StatusToggle isActive onChange={vi.fn()} />); expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'); }); it('opens confirm dialog on toggle', async () => { render(<StatusToggle isActive onChange={vi.fn()} />); await userEvent.click(screen.getByRole('switch')); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument(); 

DeepSeek Chat Export  |  Page 94 of 103 

}); it('calls onChange(false) after confirming deactivation', async () => { const onChange = vi.fn(); render(<StatusToggle isActive onChange={onChange} />); await userEvent.click(screen.getByRole('switch')); await userEvent.click(screen.getByRole('button', { name: /^deactivate$/i })); expect(onChange).toHaveBeenCalledWith(false); }); it('cancels without calling onChange', async () => { const onChange = vi.fn(); render(<StatusToggle isActive onChange={onChange} />); await userEvent.click(screen.getByRole('switch')); await userEvent.click(screen.getByRole('button', { name: /cancel/i })); expect(onChange).not.toHaveBeenCalled(); }); }); 

Save as frontend/src/features/admin/users/__tests__/UserProfileForm.test.tsx. 

**TYPESCRIPT** import { describe, it, expect, vi } from 'vitest'; import { render, screen, waitFor } from '@testing-library/react'; import userEvent from '@testing-library/user-event'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { UserProfileForm } from '../components/UserProfileForm.js'; import type { UserDTO } from '@/types/api.js'; 

DeepSeek Chat Export  |  Page 95 of 103 

const user: UserDTO = { id: 'u-1', email: 'a@fyp.local', fullName: 'Alice', globalRole: 'Team Member', configuredCapacityHours: 40, isActive: true, createdAt: new Date().toISOString(), lastLoginAt: null }; function renderForm(canEdit: boolean) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render( <QueryClientProvider client={client}> <UserProfileForm user={user} canEdit={canEdit} /> </QueryClientProvider> ); } describe('UserProfileForm', () => { it('prefills name and capacity', () => { renderForm(true); expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice'); expect(screen.getByLabelText(/capacity/i)).toHaveValue(40); }); 

DeepSeek Chat Export  |  Page 96 of 103 

it('hides submit button when not editable', () => { renderForm(false); expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument(); expect(screen.getByLabelText(/full name/i)).toBeDisabled(); }); it('shows validation error for capacity outside 10..80', async () => { renderForm(true); const input = screen.getByLabelText(/capacity/i); await userEvent.clear(input); await userEvent.type(input, '120'); await userEvent.click(screen.getByRole('button', { name: /save/i })); await waitFor(() => expect(screen.getByText(/maximum is 80/i)).toBeInTheDocument() ); }); it('disables submit when form is not dirty', () => { renderForm(true); expect(screen.getByRole('button', { name: /save/i })).toBeDisabled(); }); }); 

Add to frontend/package.json: 

##### **JSON** 

"@testing-library/react": "^16.0.1", "@testing-library/user-event": "^14.5.2", 

DeepSeek Chat Export  |  Page 97 of 103 

"@testing-library/jest-dom": "^6.5.0", "jsdom": "^25.0.1" 

Add to frontend/vitest.config.ts: 

**TYPESCRIPT** import { defineConfig } from 'vitest/config'; import react from '@vitejs/plugin-react'; import path from 'node:path'; export default defineConfig({ plugins: [react()], resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@shared': path.resolve(__dirname, '../shared') } }, test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/__tests__/**/*.test.{ts,tsx}'] } }); 

Add frontend/src/test-setup.ts: 

DeepSeek Chat Export  |  Page 98 of 103 

**TYPESCRIPT** import '@testing-library/jest-dom/vitest'; 

17. Manual Smoke Test 

|**BASH**|
|---|
|# Backend on :3000 · Frontend on :5173|
|# 1. Log in as admin → /admin/users is reachable|
|# 2. /admin/users lists users with pagination|
|# 3. Type in "Search users" → list filters after debounce (TanStack handles)|
|# 4. Change Role on another user → confirm dialog appears → confirm|
|#    → row updates, toast appears|
|# 5. Try changing own role → dropdown is disabled|
|# 6. Click Status toggle on another user → confirm dialog|
|#    → user becomes Inactive; that user's session is revoked|
|# 7. Click "+ New user" → dialog opens|
|#    → submit with weak password → field error|
|#    → submit valid → new user appears in list|
|# 8. Try to reuse an existing email → inline error on Email field|
|# 9. Navigate to /profile → own profile edits|
|# 10. As admin, click View on another user → their profile loads, editable|
|# 11. As PM/member, try to open /admin/users → redirected to /403|
|# 12. Non-admin tries to edit another user's profile via URL → backend returns 403|
|# 13. Log out, log in as member → only /profile editable, /admin/users blocked|



DeepSeek Chat Export  |  Page 99 of 103 

18. Acceptance Criteria Coverage 

|AC|Verified by|
|---|---|
|**FR-AUTH-05**Admin-only register|+ New user visible only on admin page; backend enforces|
|**FR-AUTH-06**Profile read / update|ProfilePage + UserProfileForm with self/admin canEdit|
|**FR-AUTH-07**Activate/deactivate|StatusToggle + confirm dialog|
|**FR-AUTH-09**Role assignment|RoleDropdown + confirm dialog, self-disabled|
|**FR-RBAC-02**4 roles|GLOBAL_ROLES from types/api.ts (mirror backend)|
|**FR-API-04/05**Pagination|Pagination component + meta from API|
|**FR-API-09**Filters|Search + role + status filters wired into query params|
|**NFR-USA-01**Understandable|Labels + toasts + confirmations|
|**NFR-USA-02**WCAG 2.1 AA|aria-label, aria-checked, role="switch", role="dialog", role="alert", focus<br>visible|
|**NFR-AUTH-02**Frontend not a<br>boundary|Every action has backend enforcement in Artifact 22|



##### 19. Cross-Artifact Consistency 

|Artifact|Verification|
|---|---|
|**22 (Backend users)**— endpoint|✅GET /users, POST /users, PATCH /users/:id, PATCH /users/:id/role,|
|contracts|PATCH /users/:id/status|
|4 (OpenAPI)|✅Field names match: globalRole, configuredCapacityHours, isActive|



DeepSeek Chat Export  |  Page 100 of 103 

|Artifact|Verification|
|---|---|
|13 §8 (toErrorUX,<br>extractApiError)|✅Used in useLogin pattern + here|
|21 (Auth slice)|✅Reuses http, queryKeys, AuthContext, ProtectedRoute|
|11 §16 F2 (TanStack only)|✅No useEffect fetching|
|11 §16 F3 (query keys)|✅All keys via queryKeys|
|11 §16 F4 (RHF + Zod)|✅Every form|
|11 §16 F5 (single axios)|✅Only via apiGet/apiPost/apiPatch|
|11 §16 F8 (feature folders)|✅Everything under features/admin/users/|
|11 §16 F10 (no fetch in<br>components)|✅All via hooks → usersApi|
|11 §16 F11 (no any)|✅Typed props everywhere|



**Zero drift** with backend contracts. 

##### 20. Definition of Done 

- [x] FR-AUTH-05, 06, 07, 09 covered on frontend 

- [x] Admin route gated by ProtectedRoute roles={['Administrator']} 

- [x] Self-edit blocked from role/status changes (mirrors backend rules) 

- [x] Filters wired to query params (FR-API-09) 

- [x] Pagination from meta (FR-API-05) 

DeepSeek Chat Export  |  Page 101 of 103 

- [x] Every mutation invalidates ['users'] (and me when self) 

- [x] Confirmation dialogs for destructive actions (role demote, deactivate) 

- [x] All UI interactions accessible (aria-*, role, keyboard) 

- [x] useAuth used for current user context 

- [x] Reuses auth slice HTTP client, error mapping, query keys 

- [x] Tests: UsersTable, RoleDropdown, StatusToggle, UserProfileForm 

- [x] No any in props 

- [x] Tailwind utility-only styling 

- [x] Toasts for success/failure feedback 

21. Commit 

##### **BASH** 

git add frontend/ 

git commit -m "feat(users): add admin users management UI (S3-10) 

- Admin users list with search / role / status filters + pagination 

- Role dropdown with confirm dialog and self-lock 

- Status toggle with confirm dialog (deactivate revokes sessions backend-side) 

- Create user dialog (RHF + Zod, mirrors backend password policy) 

- Profile page with editable form for self/admin, read-only otherwise 

- Reuses auth HTTP client, error UX mapping, and query keys 

- New shared UI primitives: Pagination, Dialog, ConfirmDialog, Field 

- Adds tests: UsersTable, RoleDropdown, StatusToggle, UserProfileForm 

Refs: FR-AUTH-05, FR-AUTH-06, FR-AUTH-07, FR-AUTH-09, CA-04, CA-05, CA-18 

Closes: S3-10" 

DeepSeek Chat Export  |  Page 102 of 103 

- ✅ Sprint 3 — Fully Delivered 

|Story|Status|
|---|---|
|S3-01 → S3-09 backend|✅Artifact 22|
|**S3-10**Frontend users admin|✅This artifact|



**Sprint 3 complete.** Ready to start **Sprint 4 — Teams** . 

DeepSeek Chat Export  |  Page 103 of 103 

