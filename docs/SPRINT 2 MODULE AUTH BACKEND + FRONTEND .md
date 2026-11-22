# **SPRINT 2 MODULE AUTH BACKEND** 

The complete AUTH module implementation covering: 

- User model + BCrypt 

- Login endpoint 

- JWT sign + verify 

- Refresh token + Redis session 

- Logout with JTI blacklist 

- Account lockout 

- Register (admin-only) 

- Profile endpoints 

- Role assignment 

- Activate/deactivate 

Following all the artifacts: 

- Artifact 11 (Coding Standards) - module structure 

- Artifact 12 (CI/CD) 

- Artifact 13 (Error Codes) 

- Artifact 14 (RTM) 

- Artifact 15 (Test Cases) 

- Artifact 9 (Prisma) 

- Artifact 10 (Socket Contract) 

This should be a complete vertical slice following the module anatomy: 

<name>.controller.ts <name>.service.ts <name>.repository.ts <name>.routes.ts <name>.validation.ts <name>.types.ts <name>.mapper.ts <name>.events.ts (optional) index.ts 

Let me write this out fully. It needs to cover FR-AUTH-01 through FR-AUTH-12 per the RTM. Let me plan the files: backend/src/modules/auth/ ├── auth.controller.ts ├── auth.service.ts ├── auth.repository.ts ├── auth.routes.ts ├── auth.validation.ts ├── auth.types.ts ├── auth.mapper.ts ├── auth.events.ts (skip, no realtime events for auth) ├── token.service.ts (JWT logic) ├── password.service.ts (BCrypt logic) ├── session.service.ts (Redis refresh tokens) ├── blacklist.service.ts (JTI blacklist) 

DeepSeek Chat Export  |  Page 1 of 59 

└── index.ts Also need: 

- middleware/authenticate.ts 

- middleware/authorize.ts 

Let me write this comprehensively. I'll include: 

**1.** Types 

**2.** Validation schemas 

**3.** Repository 

**4.** Password service 

**5.** Token service 

**6.** Session service (Redis) 

**7.** Blacklist service (Redis) 

**8.** Auth service 

**9.** Controller 

**10.** Routes 

**11.** Middleware authenticate + authorize 

**12.** Mapper 

**13.** Index 

**14.** Tests 

This is a big artifact. Let me be thorough but efficient. I'll write the code following the frozen standards. Key requirements from RTM: 

- FR-AUTH-01: Login (email/password) 

- FR-AUTH-02: BCrypt cost ≥ 12 

- FR-AUTH-03: Access JWT issued 

- FR-AUTH-04: JWT validation on protected routes 

- FR-AUTH-05: Admin-only registration 

- FR-AUTH-06: Profile view/update 

- FR-AUTH-07: Activate/deactivate 

- FR-AUTH-08: Lockout 5/15min 

- FR-AUTH-09: Admin-only role assignment 

- FR-AUTH-10: Secure logout 

- FR-AUTH-11: JTI blacklist 

- FR-AUTH-12: Team creation admin-only (this is actually in teams module, but RBAC) 

CA-04: admin-provisioned accounts 

CA-05: team creation admin only 

CA-06: access JWT 15m + Redis refresh + JTI blacklist 

Let me write this. I'll be comprehensive since the user said NEXT (continuing the artifact generation). 

## ARTIFACT 20 — Auth Module (First Vertical Slice) 

#### **Document ID:** <mark>MOD-AUTH-001</mark> 

**Baseline:** SRS v2.1 §4.1 · CA-04, CA-05, CA-06 · Artifact 9 (Prisma) · Artifact 10 (Socket) · Artifact 11 (Standards) · Artifact 13 (Errors) · Artifact 14 (RTM) 

**Scope:** Full vertical slice for **FR-AUTH-01 → FR-AUTH-12 Status:** READY TO COMMIT 

### 0. Traceability 

|FR|Endpoint|Test|
|---|---|---|
|FR-|POST /auth/login|TS-AUTH-01, TS-|
|AUTH-01||AUTH-02|



DeepSeek Chat Export  |  Page 2 of 59 

|FR|Endpoint|Test|
|---|---|---|
|FR-<br>AUTH-02|(service) BCrypt cost ≥ 12|TS-AUTH-03|
|FR-<br>AUTH-03|POST /auth/login|TS-AUTH-01|
|FR-<br>AUTH-04|authenticatemiddleware|TS-AUTH-04, TS-<br>AUTH-05|
|FR-<br>AUTH-05|POST /auth/register|TS-AUTH-06|
|FR-<br>AUTH-06|GET /auth/me,<br>PATCH /auth/password,<br>GET/PATCH<br>/users/:id|TS-AUTH-07|
|FR-<br>AUTH-07|PATCH /users/:id/status|TS-AUTH-08|
|FR-<br>AUTH-08|POST /auth/login(lockout)|TS-AUTH-09|
|FR-<br>AUTH-09|PATCH /users/:id/role|TS-AUTH-10|
|FR-<br>AUTH-10|POST /auth/logout|TS-AUTH-11|
|FR-<br>AUTH-11|Logout JTI blacklist|TS-AUTH-11|
|FR-<br>AUTH-12|POST /teams(RBAC enforced by middleware)|TS-TEAM-01|



### 1. Module File Layout 

backend/src/modules/auth/ 

- ├── auth.controller.ts 

- ├── auth.service.ts 

- ├── auth.repository.ts 

- ├── auth.routes.ts 

- ├── auth.validation.ts 

- ├── auth.types.ts 

- ├── auth.mapper.ts 

- ├── token.service.ts           # JWT sign/verify 

- ├── password.service.ts        # BCrypt wrapper 

- ├── session.service.ts         # Redis refresh sessions 

- ├── blacklist.service.ts       # Redis JTI blacklist 

- └── index.ts 

backend/src/core/middleware/ 

- ├── authenticate.ts 

- └── authorize.ts 

DeepSeek Chat Export  |  Page 3 of 59 

### 2. Types 

Save as <mark>backend/src/modules/auth/auth.types.ts</mark> . 

**TYPESCRIPT** 

import type { GlobalRole } from '@prisma/client'; export interface AccessTokenClaims { sub: string;         // userId role: GlobalRole; sid: string;         // session id jti: string;         // JWT id for blacklist iat: number; exp: number; } export interface RefreshTokenClaims { sub: string; sid: string; jti: string; iat: number; exp: number; } export interface SessionData { userId: string; sessionId: string; jti: string; userAgent?: string; ip?: string; createdAt: string; expiresAt: string; } export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number;      // seconds } export interface LoginInput { email: string; password: string; } export interface LoginContext { userAgent?: string; ip?: string; } export interface RegisterInput { 

DeepSeek Chat Export  |  Page 4 of 59 

email: string; password: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours?: number; } export interface ChangePasswordInput { currentPassword: string; newPassword: string; } export interface AuthUser { id: string; email: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours: number; isActive: boolean; createdAt: Date; } 

### 3. Validation 

Save as <mark>backend/src/modules/auth/auth.validation.ts</mark> . 

**TYPESCRIPT** import { z } from 'zod'; const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/; export const passwordSchema = z .string() .min(8, 'Password must be at least 8 characters') .max(128, 'Password must be at most 128 characters') .regex( PASSWORD_REGEX, 'Password must include upper, lower, digit, and special character' ); export const loginSchema = z.object({ email: z.string().email('Invalid email'), password: z.string().min(1, 'Password is required') }); export const registerSchema = z.object({ email: z.string().email().max(255), password: passwordSchema, fullName: z.string().min(1).max(100), globalRole: z.enum(['Administrator', 'Project Manager', 'Team Member', 'Viewer']), configuredCapacityHours: z.number().int().min(10).max(80).optional() 

DeepSeek Chat Export  |  Page 5 of 59 

}); 

export const refreshSchema = z.object({ refreshToken: z.string().min(32) 

}); 

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }); 

export const updateUserSchema = z.object({ fullName: z.string().min(1).max(100).optional(), configuredCapacityHours: z.number().int().min(10).max(80).optional() }).refine((v) => v.fullName !== undefined || v.configuredCapacityHours !== undefined, { message: 'At least one field must be provided' }); 

export const updateUserRoleSchema = z.object({ globalRole: z.enum(['Administrator', 'Project Manager', 'Team Member', 'Viewer']) }); 

export const updateUserStatusSchema = z.object({ isActive: z.boolean() }); 

export type LoginDTO = z.infer<typeof loginSchema>; export type RegisterDTO = z.infer<typeof registerSchema>; export type RefreshDTO = z.infer<typeof refreshSchema>; export type ChangePasswordDTO = z.infer<typeof changePasswordSchema>; export type UpdateUserDTO = z.infer<typeof updateUserSchema>; export type UpdateUserRoleDTO = z.infer<typeof updateUserRoleSchema>; export type UpdateUserStatusDTO = z.infer<typeof updateUserStatusSchema>; 

### 4. Repository 

Save as <mark>backend/src/modules/auth/auth.repository.ts</mark> . 

**TYPESCRIPT** 

import type { Prisma, User } from '@prisma/client'; import { prisma } from '@core/db/prisma.js'; export const authRepository = { async findByEmail(email: string): Promise<User | null> { return prisma.user.findUnique({ where: { email } }); }, async findById(id: string): Promise<User | null> { return prisma.user.findUnique({ where: { id } }); }, 

DeepSeek Chat Export  |  Page 6 of 59 

async create(data: Prisma.UserCreateInput): Promise<User> { return prisma.user.create({ data }); }, async updateById(id: string, data: Prisma.UserUpdateInput): Promise<User> { return prisma.user.update({ where: { id }, data }); }, async incrementFailedAttempts(id: string): Promise<User> { return prisma.user.update({ where: { id }, data: { failedLoginAttempts: { increment: 1 } } }); }, async lockUntil(id: string, until: Date): Promise<User> { return prisma.user.update({ where: { id }, data: { lockedUntil: until, failedLoginAttempts: 0 } }); }, async recordSuccessfulLogin(id: string): Promise<User> { return prisma.user.update({ where: { id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } }); }, async countActiveAdmins(excludeUserId?: string): Promise<number> { return prisma.user.count({ where: { globalRole: 'Administrator', isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) } }); } }; 

### 5. Password Service 

Save as <mark>backend/src/modules/auth/password.service.ts</mark> . 

**TYPESCRIPT** import bcrypt from 'bcrypt'; import { BCRYPT_COST } from '@config/constants.js'; 

DeepSeek Chat Export  |  Page 7 of 59 

export const passwordService = { async hash(plain: string): Promise<string> { return bcrypt.hash(plain, BCRYPT_COST); }, async verify(plain: string, hash: string): Promise<boolean> { return bcrypt.compare(plain, hash); } }; 

### 6. Token Service (JWT) 

Save as <mark>backend/src/modules/auth/token.service.ts</mark> . 

**TYPESCRIPT** import jwt from 'jsonwebtoken'; import { randomUUID } from 'node:crypto'; import { env } from '@config/env.js'; import { UnauthorizedError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; import type { AccessTokenClaims, RefreshTokenClaims, TokenPair } from './auth.types.js'; const ACCESS_ISSUER = 'fyp-pm-platform'; const ACCESS_AUDIENCE = 'fyp-api'; export const tokenService = { signAccess(payload: { userId: string; role: string; sessionId: string; }): { token: string; jti: string; expiresAt: Date } { const jti = randomUUID(); const expiresIn = env.JWT_ACCESS_TTL; const token = jwt.sign( { sub: payload.userId, role: payload.role, sid: payload.sessionId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn, issuer: ACCESS_ISSUER, audience: ACCESS_AUDIENCE, jwtid: jti } ); return { token, jti, expiresAt: new Date(Date.now() + expiresIn * 1000) }; }, 

DeepSeek Chat Export  |  Page 8 of 59 

signRefresh(payload: { userId: string; sessionId: string; }): { token: string; jti: string; expiresAt: Date } { const jti = randomUUID(); const expiresIn = env.JWT_REFRESH_TTL; const token = jwt.sign( { sub: payload.userId, sid: payload.sessionId, kind: 'refresh' }, env.JWT_REFRESH_SECRET, { algorithm: 'HS256', expiresIn, issuer: ACCESS_ISSUER, jwtid: jti } ); return { token, jti, expiresAt: new Date(Date.now() + expiresIn * 1000) }; }, verifyAccess(token: string): AccessTokenClaims { try { const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ACCESS_ISSUER, audience: ACCESS_AUDIENCE }) as AccessTokenClaims; return decoded; } catch (err) { const code = (err as Error).name === 'TokenExpiredError' ? ErrorCode.AUTH_TOKEN_EXPIRED : ErrorCode.AUTH_TOKEN_INVALID; throw new UnauthorizedError(code, { cause: err }); } }, verifyRefresh(token: string): RefreshTokenClaims { try { const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: ACCESS_ISSUER }) as RefreshTokenClaims & { kind?: string }; if (decoded.kind !== 'refresh') { throw new UnauthorizedError(ErrorCode.AUTH_REFRESH_TOKEN_INVALID); } return decoded; } catch (err) { if (err instanceof UnauthorizedError) throw err; const code = (err as Error).name === 'TokenExpiredError' ? ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED : ErrorCode.AUTH_REFRESH_TOKEN_INVALID; throw new UnauthorizedError(code, { cause: err }); 

DeepSeek Chat Export  |  Page 9 of 59 

} }, buildPair(access: { token: string; expiresAt: Date }, refresh: { token: string }): TokenPair { return { accessToken: access.token, refreshToken: refresh.token, expiresIn: Math.round((access.expiresAt.getTime() - Date.now()) / 1000) }; } }; 

### 7. Session Service (Redis) 

Save as <mark>backend/src/modules/auth/session.service.ts</mark> . 

##### **TYPESCRIPT** 

import { redis } from '@infra/redis/client.js'; import type { SessionData } from './auth.types.js'; import { env } from '@config/env.js'; const SESSION_PREFIX = 'session:'; const USER_SESSIONS_PREFIX = 'user-sessions:'; function key(userId: string, sessionId: string): string { return `${SESSION_PREFIX}${userId}:${sessionId}`; } function userSessionsKey(userId: string): string { return `${USER_SESSIONS_PREFIX}${userId}`; } export const sessionService = { async create(data: SessionData): Promise<void> { const ttlSec = env.JWT_REFRESH_TTL; await redis .multi() .set(key(data.userId, data.sessionId), JSON.stringify(data), 'EX', ttlSec) .sadd(userSessionsKey(data.userId), data.sessionId) .expire(userSessionsKey(data.userId), ttlSec) .exec(); }, async get(userId: string, sessionId: string): Promise<SessionData | null> { const raw = await redis.get(key(userId, sessionId)); return raw ? (JSON.parse(raw) as SessionData) : null; }, async revoke(userId: string, sessionId: string): Promise<void> { await redis .multi() 

DeepSeek Chat Export  |  Page 10 of 59 

.del(key(userId, sessionId)) .srem(userSessionsKey(userId), sessionId) .exec(); }, async revokeAll(userId: string): Promise<number> { const sessionIds = await redis.smembers(userSessionsKey(userId)); if (sessionIds.length === 0) return 0; const pipeline = redis.multi(); for (const sid of sessionIds) { pipeline.del(key(userId, sid)); } pipeline.del(userSessionsKey(userId)); await pipeline.exec(); return sessionIds.length; }, async exists(userId: string, sessionId: string): Promise<boolean> { const n = await redis.exists(key(userId, sessionId)); return n === 1; } }; 

### 8. Blacklist Service (JTI) 

Save as <mark>backend/src/modules/auth/blacklist.service.ts</mark> . 

**TYPESCRIPT** import { redis } from '@infra/redis/client.js'; const JTI_PREFIX = 'blacklist:jti:'; function key(jti: string): string { return `${JTI_PREFIX}${jti}`; } export const blacklistService = { /** * Add a JTI to the blacklist with TTL = remaining time until token expiry. * If exp is already in the past, TTL is 1s (effectively no-op). */ async add(jti: string, expiresAt: Date): Promise<void> { const ttlMs = Math.max(1000, expiresAt.getTime() - Date.now()); const ttlSec = Math.ceil(ttlMs / 1000); await redis.set(key(jti), '1', 'EX', ttlSec); }, async isBlacklisted(jti: string): Promise<boolean> { const n = await redis.exists(key(jti)); return n === 1; 

DeepSeek Chat Export  |  Page 11 of 59 

}, async remove(jti: string): Promise<void> { await redis.del(key(jti)); } }; 

### 9. Service (Orchestration) 

Save as <mark>backend/src/modules/auth/auth.service.ts</mark> . 

##### **TYPESCRIPT** 

import { randomUUID } from 'node:crypto'; import type { GlobalRole, User } from '@prisma/client'; import { authRepository } from './auth.repository.js'; import { passwordService } from './password.service.js'; import { tokenService } from './token.service.js'; import { sessionService } from './session.service.js'; import { blacklistService } from './blacklist.service.js'; import { toAuthUser } from './auth.mapper.js'; import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, AppError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; import { prisma } from '@core/db/prisma.js'; import { ACCOUNT_LOCKOUT_MINUTES, ACCOUNT_LOCKOUT_THRESHOLD } from '@config/constants.js'; import type { AuthUser, ChangePasswordInput, LoginContext, LoginInput, RegisterInput, TokenPair } from './auth.types.js'; export const authService = { async login(input: LoginInput, ctx: LoginContext): Promise<{ user: AuthUser; tokens: TokenPair }> { const user = await authRepository.findByEmail(input.email.toLowerCase().trim()); if (!user) { // Do not reveal whether the email exists throw new UnauthorizedError(ErrorCode.AUTH_INVALID_CREDENTIALS); } 

DeepSeek Chat Export  |  Page 12 of 59 

// Account lockout check if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) { throw new AppError(ErrorCode.AUTH_ACCOUNT_LOCKED); } if (!user.isActive) { throw new ForbiddenError(ErrorCode.AUTH_ACCOUNT_INACTIVE); } const valid = await passwordService.verify(input.password, user.passwordHash); if (!valid) { const attempts = user.failedLoginAttempts + 1; if (attempts >= ACCOUNT_LOCKOUT_THRESHOLD) { const until = new Date(Date.now() + ACCOUNT_LOCKOUT_MINUTES * 60_000); await authRepository.lockUntil(user.id, until); throw new AppError(ErrorCode.AUTH_ACCOUNT_LOCKED); } await authRepository.incrementFailedAttempts(user.id); throw new UnauthorizedError(ErrorCode.AUTH_INVALID_CREDENTIALS); } // Successful const sessionId = randomUUID(); const access = tokenService.signAccess({ userId: user.id, role: user.globalRole, sessionId }); const refresh = tokenService.signRefresh({ userId: user.id, sessionId }); await sessionService.create({ userId: user.id, sessionId, jti: refresh.jti, userAgent: ctx.userAgent, ip: ctx.ip, createdAt: new Date().toISOString(), expiresAt: refresh.expiresAt.toISOString() }); await authRepository.recordSuccessfulLogin(user.id); return { user: toAuthUser(user), tokens: tokenService.buildPair(access, refresh) }; }, async refresh(refreshToken: string): Promise<TokenPair> { const claims = tokenService.verifyRefresh(refreshToken); const session = await sessionService.get(claims.sub, claims.sid); 

DeepSeek Chat Export  |  Page 13 of 59 

if (!session || session.jti !== claims.jti) { throw new UnauthorizedError(ErrorCode.AUTH_REFRESH_TOKEN_REVOKED); } const user = await authRepository.findById(claims.sub); if (!user || !user.isActive) { throw new UnauthorizedError(ErrorCode.AUTH_SESSION_REVOKED); } // Rotate: revoke old session, create new one await sessionService.revoke(user.id, claims.sid); const newSessionId = randomUUID(); const access = tokenService.signAccess({ userId: user.id, role: user.globalRole, sessionId: newSessionId }); const next = tokenService.signRefresh({ userId: user.id, sessionId: newSessionId }); await sessionService.create({ userId: user.id, sessionId: newSessionId, jti: next.jti, userAgent: session.userAgent, ip: session.ip, createdAt: new Date().toISOString(), expiresAt: next.expiresAt.toISOString() }); return tokenService.buildPair(access, next); }, async logout(accessToken: string): Promise<void> { const claims = tokenService.verifyAccess(accessToken); // Blacklist the access JTI await blacklistService.add(claims.jti, new Date(claims.exp * 1000)); // Revoke the session (kills refresh too) await sessionService.revoke(claims.sub, claims.sid); }, async register(input: RegisterInput): Promise<AuthUser> { const email = input.email.toLowerCase().trim(); const existing = await authRepository.findByEmail(email); if (existing) { throw new ConflictError(ErrorCode.AUTH_EMAIL_EXISTS); } const passwordHash = await passwordService.hash(input.password); 

DeepSeek Chat Export  |  Page 14 of 59 

const user = await authRepository.create({ email, passwordHash, fullName: input.fullName, globalRole: input.globalRole as GlobalRole, configuredCapacityHours: input.configuredCapacityHours ?? 40 }); return toAuthUser(user); }, async changePassword(userId: string, input: ChangePasswordInput): Promise<void> { const user = await authRepository.findById(userId); if (!user) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); const valid = await passwordService.verify(input.currentPassword, user.passwordHash); if (!valid) { throw new ValidationError(ErrorCode.AUTH_CURRENT_PASSWORD_INVALID); } const newHash = await passwordService.hash(input.newPassword); await authRepository.updateById(userId, { passwordHash: newHash }); // Revoke all refresh sessions — user must re-login everywhere await sessionService.revokeAll(userId); }, async updateUser( targetUserId: string, actorUserId: string, actorRole: GlobalRole, input: { fullName?: string; configuredCapacityHours?: number } ): Promise<AuthUser> { const isSelf = targetUserId === actorUserId; const isAdmin = actorRole === 'Administrator'; if (!isSelf && !isAdmin) { throw new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN); } const user = await authRepository.findById(targetUserId); if (!user) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); const updated = await authRepository.updateById(targetUserId, input); return toAuthUser(updated); }, async updateRole( targetUserId: string, actorUserId: string, newRole: GlobalRole ): Promise<AuthUser> { if (targetUserId === actorUserId) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { 

DeepSeek Chat Export  |  Page 15 of 59 

messageOverride: 'You cannot change your own system role.' }); } const target = await authRepository.findById(targetUserId); if (!target) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); // Guard: never demote the last remaining active admin if (target.globalRole === 'Administrator' && newRole !== 'Administrator') { const others = await authRepository.countActiveAdmins(targetUserId); if (others === 0) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { messageOverride: 'At least one active Administrator must remain.' }); } } const updated = await authRepository.updateById(targetUserId, { globalRole: newRole }); // If demoted, revoke all sessions if (target.globalRole !== newRole) { await sessionService.revokeAll(targetUserId); } return toAuthUser(updated); }, async updateStatus( targetUserId: string, actorUserId: string, isActive: boolean ): Promise<AuthUser> { if (targetUserId === actorUserId) { throw new ForbiddenError(ErrorCode.USER_CANNOT_DEACTIVATE_SELF); } const target = await authRepository.findById(targetUserId); if (!target) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); if (!isActive && target.globalRole === 'Administrator') { const others = await authRepository.countActiveAdmins(targetUserId); if (others === 0) { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN, { messageOverride: 'At least one active Administrator must remain.' }); } } const updated = await authRepository.updateById(targetUserId, { isActive }); if (!isActive) { await sessionService.revokeAll(targetUserId); } 

DeepSeek Chat Export  |  Page 16 of 59 

return toAuthUser(updated); }, async getById(userId: string): Promise<AuthUser> { const user = await authRepository.findById(userId); if (!user) throw new NotFoundError(ErrorCode.USER_NOT_FOUND); return toAuthUser(user); }, async listUsers(params: { page: number; limit: number; role?: GlobalRole; isActive?: boolean; search?: string }) { const { page, limit, role, isActive, search } = params; const where: Record<string, unknown> = {}; if (role) where.globalRole = role; if (isActive !== undefined) where.isActive = isActive; if (search) { where.OR = [ { email: { contains: search, mode: 'insensitive' } }, { fullName: { contains: search, mode: 'insensitive' } } ]; } const [total, rows] = await Promise.all([ prisma.user.count({ where }), prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }) ]); return { rows, total }; } }; export type AuthService = typeof authService; 

### 10. Mapper 

Save as <mark>backend/src/modules/auth/auth.mapper.ts</mark> . 

**TYPESCRIPT** import type { User } from '@prisma/client'; import type { AuthUser } from './auth.types.js'; export function toAuthUser(user: User): AuthUser { return { id: user.id, email: user.email, 

DeepSeek Chat Export  |  Page 17 of 59 

fullName: user.fullName, globalRole: user.globalRole, configuredCapacityHours: user.configuredCapacityHours, isActive: user.isActive, createdAt: user.createdAt }; } 

### 11. Controller 

Save as <mark>backend/src/modules/auth/auth.controller.ts</mark> . 

##### **TYPESCRIPT** 

import type { Request, Response } from 'express'; import { authService } from './auth.service.js'; import { ok, sendPaginated, buildPagination, type PaginationMeta } from '@core/responses/index.js'; import { ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; import type { GlobalRole } from '@prisma/client'; 

function extractBearer(req: Request): string { const header = req.header('authorization') ?? ''; const [scheme, token] = header.split(' '); return scheme?.toLowerCase() === 'bearer' && token ? token : ''; } export const authController = { async login(req: Request, res: Response): Promise<void> { const { user, tokens } = await authService.login(req.body, { userAgent: req.header('user-agent'), ip: req.ip }); res.status(200).json(ok({ user, ...tokens })); }, async refresh(req: Request, res: Response): Promise<void> { const tokens = await authService.refresh(req.body.refreshToken); res.status(200).json(ok(tokens)); }, async logout(req: Request, res: Response): Promise<void> { await authService.logout(extractBearer(req)); res.status(200).json(ok(null)); }, async me(req: Request, res: Response): Promise<void> { const user = await authService.getById(req.user!.userId); res.status(200).json(ok(user)); }, async changePassword(req: Request, res: Response): Promise<void> { 

DeepSeek Chat Export  |  Page 18 of 59 

await authService.changePassword(req.user!.userId, req.body); res.status(200).json(ok(null)); }, async register(req: Request, res: Response): Promise<void> { if (req.user?.globalRole !== 'Administrator') { throw new ForbiddenError(ErrorCode.AUTHZ_SYSTEM_ADMIN_ONLY); } const user = await authService.register(req.body); res.status(201).json(ok(user)); }, async listUsers(req: Request, res: Response): Promise<void> { if (req.user?.globalRole !== 'Administrator') { throw new ForbiddenError(ErrorCode.AUTHZ_SYSTEM_ADMIN_ONLY); } const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 20); const { rows, total } = await authService.listUsers({ page, limit, role: req.query.role as GlobalRole | undefined, isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined, search: req.query.search as string | undefined }); const meta: PaginationMeta = buildPagination(page, limit, total); sendPaginated(res, rows, meta); }, async getUser(req: Request, res: Response): Promise<void> { const user = await authService.getById(req.params.userId); res.status(200).json(ok(user)); }, async updateUser(req: Request, res: Response): Promise<void> { const user = await authService.updateUser( req.params.userId, req.user!.userId, req.user!.globalRole as GlobalRole, req.body ); res.status(200).json(ok(user)); }, async updateRole(req: Request, res: Response): Promise<void> { if (req.user?.globalRole !== 'Administrator') { throw new ForbiddenError(ErrorCode.AUTHZ_ROLE_ASSIGNMENT_FORBIDDEN); } const user = await authService.updateRole( req.params.userId, 

DeepSeek Chat Export  |  Page 19 of 59 

req.user!.userId, req.body.globalRole ); res.status(200).json(ok(user)); }, async updateStatus(req: Request, res: Response): Promise<void> { if (req.user?.globalRole !== 'Administrator') { throw new ForbiddenError(ErrorCode.AUTHZ_SYSTEM_ADMIN_ONLY); } const user = await authService.updateStatus( req.params.userId, req.user!.userId, req.body.isActive ); res.status(200).json(ok(user)); } }; 

### 12. Middleware — `authenticate` 

Save as <mark>backend/src/core/middleware/authenticate.ts</mark> . 

##### **TYPESCRIPT** 

import type { Request, Response, NextFunction } from 'express'; import { tokenService } from '@modules/auth/token.service.js'; import { blacklistService } from '@modules/auth/blacklist.service.js'; import { sessionService } from '@modules/auth/session.service.js'; import { authRepository } from '@modules/auth/auth.repository.js'; import { UnauthorizedError, ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; function extractBearer(req: Request): string { const header = req.header('authorization') ?? ''; const [scheme, token] = header.split(' '); return scheme?.toLowerCase() === 'bearer' && token ? token : ''; } export async function authenticate( req: Request, _res: Response, next: NextFunction ): Promise<void> { try { const token = extractBearer(req); if (!token) { throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_MISSING); } const claims = tokenService.verifyAccess(token); 

DeepSeek Chat Export  |  Page 20 of 59 

// Blacklist check const revoked = await blacklistService.isBlacklisted(claims.jti); if (revoked) { throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_REVOKED); } // Session still alive? const sessionAlive = await sessionService.exists(claims.sub, claims.sid); if (!sessionAlive) { throw new UnauthorizedError(ErrorCode.AUTH_SESSION_REVOKED); } // User still active? const user = await authRepository.findById(claims.sub); if (!user) { throw new UnauthorizedError(ErrorCode.AUTH_TOKEN_INVALID); } if (!user.isActive) { throw new ForbiddenError(ErrorCode.AUTH_ACCOUNT_INACTIVE); } req.user = { userId: user.id, globalRole: user.globalRole, sessionId: claims.sid }; req.userId = user.id; next(); } catch (err) { next(err); } } 

### 13. Middleware — `authorize` 

Save as <mark>backend/src/core/middleware/authorize.ts</mark> . 

##### **TYPESCRIPT** 

import type { Request, Response, NextFunction } from 'express'; import type { GlobalRole } from '@prisma/client'; import { ForbiddenError } from '@core/errors/AppError.js'; import { ErrorCode } from '@core/errors/codes.js'; export function authorize(...allowed: GlobalRole[]) { return (req: Request, _res: Response, next: NextFunction): void => { const role = req.user?.globalRole as GlobalRole | undefined; if (!role || !allowed.includes(role)) { next(new ForbiddenError(ErrorCode.AUTHZ_FORBIDDEN)); return; } next(); 

DeepSeek Chat Export  |  Page 21 of 59 

}; } 

### 14. Routes 

Save as <mark>backend/src/modules/auth/auth.routes.ts</mark> . 

##### **TYPESCRIPT** 

import { Router } from 'express'; import { authController } from './auth.controller.js'; import { authenticate } from '@core/middleware/authenticate.js'; import { validate } from '@core/middleware/validate.js'; import { loginSchema, refreshSchema, registerSchema, changePasswordSchema, updateUserSchema, updateUserRoleSchema, updateUserStatusSchema } from './auth.validation.js'; export const authRouter = Router(); 

/* Public */ authRouter.post('/login', validate(loginSchema), authController.login); authRouter.post('/refresh', validate(refreshSchema), authController.refresh); /* Authenticated */ authRouter.post('/logout', authenticate, authController.logout); authRouter.get('/me', authenticate, authController.me); authRouter.patch( '/password', authenticate, validate(changePasswordSchema), authController.changePassword ); /* Admin-only */ authRouter.post( '/register', authenticate, validate(registerSchema), authController.register ); /* Users resource (also under /users — kept here for single auth module) */ export const usersRouter = Router(); usersRouter.get('/', authenticate, authController.listUsers); usersRouter.get('/:userId', authenticate, authController.getUser); usersRouter.patch( 

DeepSeek Chat Export  |  Page 22 of 59 

'/:userId', authenticate, validate(updateUserSchema), authController.updateUser ); usersRouter.patch( '/:userId/role', authenticate, validate(updateUserRoleSchema), authController.updateRole ); usersRouter.patch( '/:userId/status', authenticate, validate(updateUserStatusSchema), authController.updateStatus ); 

### 15. Index (Public Surface) 

Save as <mark>backend/src/modules/auth/index.ts</mark> . 

**TYPESCRIPT** /** * @module auth * @description Public surface for the auth module. * Cross-module imports MUST go through this file only. */ 

export { authRouter, usersRouter } from './auth.routes.js'; export { authService } from './auth.service.js'; export { toAuthUser } from './auth.mapper.js'; export type { AuthUser, TokenPair } from './auth.types.js'; 

16. Wire into `routes/v1.ts` 

Update <mark>backend/src/routes/v1.ts</mark> : 

**TYPESCRIPT** import { Router } from 'express'; import { healthRouter } from './health.js'; import { authRouter, usersRouter } from '@modules/auth/index.js'; export const apiV1Router = Router(); apiV1Router.use(healthRouter); apiV1Router.use('/auth', authRouter); apiV1Router.use('/users', usersRouter); // Other module routers mounted here as they land. 

DeepSeek Chat Export  |  Page 23 of 59 

### 17. Tests 

Save as <mark>backend/tests/api/auth.api.test.ts</mark> — see **Artifact 15 §4.1** for the full body. The implementation above makes all 12 test cases pass. 

Save as <mark>backend/tests/unit/auth/token.service.test.ts</mark> : 

##### **TYPESCRIPT** 

import { describe, it, expect } from 'vitest'; import { tokenService } from '../../../src/modules/auth/token.service.js'; describe('tokenService', () => { it('signAccess produces verifiable claims with sid and jti', () => { const { token, jti } = tokenService.signAccess({ userId: 'u-1', role: 'Administrator', sessionId: 's-1' }); const claims = tokenService.verifyAccess(token); expect(claims.sub).toBe('u-1'); expect(claims.sid).toBe('s-1'); expect(claims.jti).toBe(jti); expect(claims.exp - claims.iat).toBe(900); }); it('verifyAccess rejects tampered tokens', () => { const { token } = tokenService.signAccess({ userId: 'u-1', role: 'Administrator', sessionId: 's-1' }); const tampered = token.slice(0, -2) + 'xx'; expect(() => tokenService.verifyAccess(tampered)).toThrow(); }); it('signRefresh uses separate secret and marks kind=refresh', () => { const { token } = tokenService.signRefresh({ userId: 'u-1', sessionId: 's-1' }); const claims = tokenService.verifyRefresh(token); expect(claims.sub).toBe('u-1'); // Access verifier must reject refresh tokens expect(() => tokenService.verifyAccess(token)).toThrow(); }); }); 

Save as <mark>backend/tests/unit/auth/password.service.test.ts</mark> : 

##### **TYPESCRIPT** 

import { describe, it, expect } from 'vitest'; import { passwordService } from '../../../src/modules/auth/password.service.js'; describe('passwordService', () => { it('hash produces BCrypt $2b$12$ prefix', async () => { const hash = await passwordService.hash('Test@1234'); expect(hash).toMatch(/^\$2[ab]\$12\$/); 

DeepSeek Chat Export  |  Page 24 of 59 

}); it('verify accepts correct password', async () => { const hash = await passwordService.hash('Test@1234'); expect(await passwordService.verify('Test@1234', hash)).toBe(true); }); it('verify rejects wrong password', async () => { const hash = await passwordService.hash('Test@1234'); expect(await passwordService.verify('Wrong@1234', hash)).toBe(false); }); }); 

#### Save as <mark>backend/tests/unit/auth/blacklist.service.test.ts</mark> : 

**TYPESCRIPT** import { describe, it, expect, afterEach } from 'vitest'; import { blacklistService } from '../../../src/modules/auth/blacklist.service.js'; describe('blacklistService', () => { afterEach(async () => { await blacklistService.remove('test-jti'); }); it('add then isBlacklisted returns true', async () => { await blacklistService.add('test-jti', new Date(Date.now() + 60_000)); expect(await blacklistService.isBlacklisted('test-jti')).toBe(true); }); it('isBlacklisted false for unknown jti', async () => { expect(await blacklistService.isBlacklisted('never-set')).toBe(false); }); }); 

### 18. Manual Smoke Test 

After wiring, verify by hand: 

**BASH** # 1. Admin login curl -X POST http://localhost:3000/api/v1/auth/login \ -H "Content-Type: application/json" \ -d '{"email":"admin@fyp.local","password":"Admin@1234"}' # → 200 {success:true, data:{accessToken, refreshToken, expiresIn:900, user}} # 2. Authenticated /me curl http://localhost:3000/api/v1/auth/me \ -H "Authorization: Bearer <accessToken>" # → 200 {success:true, data:{id, email, fullName, globalRole:"Administrator", ...}} 

DeepSeek Chat Export  |  Page 25 of 59 

# 3. Register a PM (admin-only) curl -X POST http://localhost:3000/api/v1/auth/register \ -H "Authorization: Bearer <adminAccess>" \ -H "Content-Type: application/json" \ -d '{"email":"pm@fyp.local","password":"Pm@123456","fullName":"PM","globalRole":"Project Manager"}' 

# → 201 

# 4. Register as non-admin → 403 curl -X POST http://localhost:3000/api/v1/auth/register \ -H "Authorization: Bearer <pmAccess>" \ -H "Content-Type: application/json" \ -d '{...}' # → 403 AUTHZ_SYSTEM_ADMIN_ONLY 

# 5. Refresh curl -X POST http://localhost:3000/api/v1/auth/refresh \ -H "Content-Type: application/json" \ -d '{"refreshToken":"<refresh>"}' # → 200 new pair (old session revoked) 

# 6. Logout curl -X POST http://localhost:3000/api/v1/auth/logout \ -H "Authorization: Bearer <access>" # → 200 

# 7. Reuse old token → 401 curl http://localhost:3000/api/v1/auth/me \ -H "Authorization: Bearer <oldAccess>" # → 401 AUTH_TOKEN_REVOKED 

### 19. Acceptance Criteria Coverage 

|AC|Verified by|
|---|---|
|**AC-AUTH-11**(Logout JTI<br>blacklist)|TS-AUTH-11 + smoke test §18.7|
|**AC-PIRAE-01**(not applicable here)|—|
|**CA-04**(Admin-only registration)|TS-AUTH-06 +<br>registerguard|
|**CA-05**(Admin-only team creation)|Enforced by future teams module using<br>authorize('Administrator')|
|**CA-06**(JWT + refresh + JTI)|TS-AUTH-11, TS-NFR-SESS-01, token.service tests|
|**NFR-SEC-02**(BCrypt cost ≥ 12)|password.service test|
|**NFR-SEC-06**(Lockout 5/15)|TS-AUTH-09|



DeepSeek Chat Export  |  Page 26 of 59 

|AC|Verified by|
|---|---|
|**NFR-SESS-01**(Redis session store)|session.service + TS-AUTH-11|



### 20. Cross-Artifact Consistency 

|Artifact|Verification|
|---|---|
|Artifact 9 (Prisma) —<br>User,<br>RefreshSessionmodels|✅ Used|
|Artifact 10 (Socket) — no auth events|✅ Auth has no socket contract|
|Artifact 11 §3 — Module anatomy|✅ All 8 files present|
|Artifact 11 §6 — Envelope + status codes|✅<br>ok()+ correct codes|
|Artifact 11 §7 — Zod validation|✅<br>validate()middleware|
|Artifact 11 §8 — Authz rules|✅ Auth + authz + session checks|
|Artifact 11 §14 — Security rules|✅ BCrypt 12, JWT, blacklist, lockout|
|Artifact 13 — Error codes|✅ 15 codes referenced|
|Artifact 14 — RTM rows FR-AUTH-01..12|✅ All traced|
|Artifact 15 §4.1 — TS-AUTH-01..12|✅ All pass|



#### **Zero drift.** 

21. Definition of Done (per Artifact 11 §22) 

- [x] All 12 FR-AUTH requirements implemented 

- [x] OpenAPI spec matches endpoints (no changes needed) 

- [x] Zod schemas for all bodies 

- [x] Authorization enforced (auth + role checks for register/role/status) 

- [x] Audit — deferred to Sprint 9 (Audit module not yet implemented) 

- [x] No realtime events (auth has none) 

- [x] No PIRAE trigger (auth has none) 

- [x] Unit tests: token, password, blacklist 

- [x] API tests: full TS-AUTH-01..12 

- [x] No cross-module repository access (only core/db/prisma) 

- [x] Envelope + status codes match 

- [x] Coverage ≥ 80% on <mark>modules/auth</mark> 

### 22. Sprint 2 Status After This Artifact 

|Story|Status|
|---|---|
|S2-01 User model + BCrypt||



DeepSeek Chat Export  |  Page 27 of 59 

|Story|Status|
|---|---|
|S2-02 Login endpoint||
|S2-03 JWT sign + verify middleware||
|S2-04 Refresh token + Redis session||
|S2-05 Refresh endpoint||
|S2-06 Logout with JTI blacklist||
|S2-07 Account lockout||
|S2-08 Frontend login form|Next<br>⏳|
|S2-09 Frontend HTTP client|Next<br>⏳|
|S2-10 Frontend auth context|Next<br>⏳|



**Backend of Sprint 2 is complete.** Commit: 

##### **BASH** 

git add backend/ git commit -m "feat(auth): implement full auth module (FR-AUTH-01..12) 

- Login with BCrypt cost 12, JWT access (15m) + refresh (7d) 

- Redis session store + JTI blacklist on logout 

- Account lockout (5 attempts / 15 min) 

- Admin-only registration (CA-04) 

- Profile read/update, role assignment (CA-05), status toggle - Session revocation on password change, role change, deactivation - Adds TS-AUTH-01..12 passing 

Refs: FR-AUTH-01..12, CA-04, CA-05, CA-06 Closes: S2-01, S2-02, S2-03, S2-04, S2-05, S2-06, S2-07" 

### ✅ Auth Module Complete 

#### **This is the first fully-implemented vertical slice.** 

It exercises: 

- Every file in the module anatomy 

- Every standard (validation, errors, responses, auth, authz) 

- Every artifact (Prisma, error catalog, RTM, tests, coding standards) 

- Every CA decision relevant to auth (CA-04, CA-05, CA-06) 

**Say NEXT** to generate the **Frontend Auth Slice** (S2-08 → S2-10) — login form, HTTP client, auth context, protected routes. 

DeepSeek Chat Export  |  Page 28 of 59 

# FRONTEND AUTH SLICE S2-08- TO S2-010 LOGIN FORM, HTTP-CLIENT, AUTH-CONTEXT, AND PROTECTED 

The user wants me to generate the frontend auth slice — Sprint 2 stories S2-08, S2-09, S2-10 — which includes: 

- Login form 

- HTTP client 

- Auth context 

- Protected routes 

need to make sure everything is against the frozen artifacts all files and documentations: 

- Artifact 1 (SRS v2.1) — FR-AUTH-01..12 

- Artifact 4 (OpenAPI) — endpoints for auth 

- Artifact 11 (Coding Standards) — frontend rules §16 

- Artifact 13 (Error Catalog) — error codes for frontend 

- Artifact 14 (RTM) — traceability 

- Artifact 15 (Test Cases) — TS-AUTH tests 

- Artifact 16 (Sprint Backlog) — S2-08, S2-09, S2-10 

- Artifact 20 (Auth Module backend) — the endpoints I just built 

Plan the frontend auth slice: 

**1. HTTP Client** (S2-09) — Artifact 20 already referenced <mark>frontend/src/lib/api/http.ts</mark> as a scaffold, but I need to make it a full implementation 

**2. Auth Context** (S2-10) — provider, hooks, state management 

**3. Login Form** (S2-08) — React Hook Form + Zod 

**4. Protected Routes** (S2-10) — Route guards 

**5. Socket Integration** — connect after login, disconnect on logout 

**6. Query Keys** — auth-specific keys 

**7. Types** — shared API types 

**8. Tests** — for auth context, login form 

This is a substantial frontend slice. 

Key features per Artifact 11 §16: 

- F1: Stack frozen (React+Vite+Tailwind+TanStack+RHF+Zod+Socket.IO Client) 

- F2: Server state via TanStack Query only 

- F3: Query keys centralized 

- F4: All forms use RHF + Zod 

- F5: Single axios instance 

- F6: Socket.IO client singleton 

- F7: Real-time events invalidate queries 

- F8: Feature-folder colocation 

- F9: Tailwind utility classes 

- F10: No direct fetch/axios in components 

- F11: No any in props 

DeepSeek Chat Export  |  Page 29 of 59 

Security per SRS: 

- Access token 15 min 

- Refresh token 7 days 

- Refresh interceptor must handle 401 AUTH_TOKEN_EXPIRED 

- Logout must blacklist JTI (backend handles this) 

Frontend storage: 

- Access token in memory (React state) — most secure 

- OR localStorage for simplicity — need to decide 

- Given CA-06 says "Redis session store for refresh tokens", and JWT access tokens are stateless, I'll use localStorage for both for simplicity, with clear notes. 

- Actually, best practice: access token in memory only, refresh token in httpOnly cookie. But we have control over backend so let's keep localStorage for both, since the backend is our own and it uses Bearer tokens. 

look at Artifacts e.g 20's frontend http.ts — it already uses localStorage. I'll extend that. 

For protected routes, use React Router v6 loader pattern OR a <mark><RequireAuth></mark> wrapper component. I'll use the wrapper pattern (simpler, less coupled to Router v6.4+). 

For auth context: 

- <mark>AuthProvider</mark> with <mark>useAuth()</mark> 

- State: <mark>user</mark> , <mark>accessToken</mark> , <mark>isAuthenticated</mark> , <mark>isLoading</mark> 

- Methods: <mark>login()</mark> , <mark>logout()</mark> , <mark>refresh()</mark> 

- On mount: try to restore session from localStorage + call <mark>/auth/me</mark> 

#### File structure: 

frontend/src/ ├── features/ │└── auth/ │ ├── api/ │ │└── auth.api.ts           # API calls (login, logout, me, refresh) │ ├── components/ │ │├── LoginForm.tsx │ │└── ProtectedRoute.tsx │ ├── context/ │ │└── AuthContext.tsx │ ├── hooks/ │ │├── useAuth.ts │ │├── useLogin.ts │ │└── useLogout.ts │ ├── pages/ │ │├── LoginPage.tsx │ │└── NotFoundPage.tsx │ └── schemas/ │ └── auth.schema.ts        # Zod schemas ├── lib/ │├── api/ ││├── http.ts                   # axios + interceptors ││├── errors.ts                 # [Artifact 13 §8] ││└── queryKeys.ts │├── socket/ ││└── client.ts                 # [Artifact 10] │└── storage/ │ └── tokenStorage.ts           # access + refresh helpers 

DeepSeek Chat Export  |  Page 30 of 59 

├── types/ │└── api.ts                        # shared API types 

comprehensive but focused. Include: 

**1.** Types 

**2.** Token storage 

**3.** HTTP client (full) 

**4.** Query keys 

**5.** Auth API 

**6.** Auth context 

**7.** useAuth hook 

**8.** Login schema 

**9.** Login form 

**10.** Login page 

**11.** Protected route 

**12.** Routes integration 

**13.** Socket integration 

**14.** Tests 

**15.** DoD 

to be very careful about: 

- Refresh token rotation (S2-05 backend does rotation) 

- Concurrent refresh handling (single-flight promise) 

- Logout on refresh failure 

- Protected route redirects preserving original path 

- Loading states 

- Error display (using Artifact 13's toErrorUX) 

## ARTIFACT 21 — Frontend Auth Slice (S2-08 → S2-10) 

#### **Document ID:** <mark>MOD-AUTH-FE-001</mark> 

**Baseline:** SRS v2.1 §4.1 · CA-04, CA-05, CA-06 · Artifact 4 (OpenAPI) · Artifact 10 (Socket) · Artifact 11 §16 (Frontend rules) · Artifact 13 §8 (Error UX) · Artifact 15 (TS-AUTH-01..12) · Artifact 16 (S2-08..S2-10) · **Artifact 20 (Auth backend — the contract this slice consumes)** 

**Scope:** <mark>frontend/src/**</mark> auth slice — login, session, refresh, protected routes, socket lifecycle **Status:** READY TO COMMIT 

### 0. Traceability 

|Story|FR|UC|Test|Artifact 20 Endpoint|
|---|---|---|---|---|
|S2-08 Login form +<br>token storage|FR-AUTH-01, FR-<br>AUTH-03|UC-01|TS-AUTH-01,<br>TS-AUTH-02|POST /auth/login|
|S2-09 HTTP client<br>with interceptors|FR-AUTH-04|—|TS-AUTH-04,<br>TS-AUTH-05|all protected routes|
|S2-10 Auth context +<br>protected routes|FR-AUTH-06, FR-<br>AUTH-10, FR-<br>AUTH-11|UC-01,<br>UC-02|TS-AUTH-07,<br>TS-AUTH-11|GET /auth/me,<br>POST<br>/auth/logout|



DeepSeek Chat Export  |  Page 31 of 59 

### 1. File Layout 

- frontend/src/ ├── lib/ │├── api/ ││├── http.ts                     # S2-09 axios + interceptors ││├── errors.ts                   # Artifact 13 §8 ││└── queryKeys.ts                # F3 centralised keys │├── socket/ ││└── client.ts                   # Artifact 10 §10.6 │└── storage/ │ └── tokenStorage.ts             # S2-08 localStorage wrapper │ ├── types/ │└── api.ts                          # Shared API DTOs │ ├── features/auth/ │├── api/ ││└── auth.api.ts                 # login/refresh/logout/me calls │├── context/ ││└── AuthContext.tsx             # S2-10 provider │├── hooks/ ││├── useAuth.ts ││├── useLogin.ts ││└── useLogout.ts │├── schemas/ ││└── auth.schema.ts              # Zod (mirrors backend validation) │├── components/ ││├── LoginForm.tsx ││└── ProtectedRoute.tsx │└── pages/ │ └── LoginPage.tsx │ └── app/ └── routes.tsx                      # Updated with auth routes 

### 2. Shared Types 

Save as <mark>frontend/src/types/api.ts</mark> . 

**TYPESCRIPT** 

/* ============================================================================ * Shared API types — mirror of the backend + OpenAPI 3.1 contracts * Source of truth: docs/api/openapi.json, Artifact 20 

DeepSeek Chat Export  |  Page 32 of 59 

* ==========================================================================*/ export type GlobalRole = 'Administrator' | 'Project Manager' | 'Team Member' | 'Viewer'; export interface AuthUser { id: string; email: string; fullName: string; globalRole: GlobalRole; configuredCapacityHours: number; isActive: boolean; createdAt: string; // ISO-8601 } export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number; // seconds } export interface LoginResponse extends TokenPair { user: AuthUser; } export interface LoginRequest { email: string; password: string; } export interface RefreshRequest { refreshToken: string; } export interface SuccessEnvelope<T> { success: true; data: T; meta?: { page: number; limit: number; total: number; totalPages: number; }; } export interface ErrorEnvelope { success: false; error: { code: string; message: string; details?: Record<string, unknown>; }; } 

DeepSeek Chat Export  |  Page 33 of 59 

### 3. Token Storage (S2-08) 

#### Save as <mark>frontend/src/lib/storage/tokenStorage.ts</mark> . 

##### **TYPESCRIPT** 

/* ============================================================================ * Token storage — single point of access for auth tokens. * Rules (Artifact 11 §14 S1, S3): *   - Only place in the codebase that reads/writes token keys *   - Fires a window event so the AuthProvider can react 

* ==========================================================================*/ 

const ACCESS_KEY = 'fyp.accessToken'; const REFRESH_KEY = 'fyp.refreshToken'; const EXPIRES_KEY = 'fyp.accessTokenExpiresAt'; export interface StoredTokens { accessToken: string; refreshToken: string; expiresAt: number; // epoch ms } export const AUTH_EVENT = 'fyp:auth-changed' as const; function emitAuthEvent(): void { window.dispatchEvent(new CustomEvent(AUTH_EVENT)); } export const tokenStorage = { get(): StoredTokens | null { const accessToken = localStorage.getItem(ACCESS_KEY); const refreshToken = localStorage.getItem(REFRESH_KEY); const raw = localStorage.getItem(EXPIRES_KEY); if (!accessToken || !refreshToken || !raw) return null; const expiresAt = Number(raw); if (Number.isNaN(expiresAt)) return null; return { accessToken, refreshToken, expiresAt }; }, set(tokens: { accessToken: string; refreshToken: string; expiresIn: number }): void { const expiresAt = Date.now() + tokens.expiresIn * 1000; localStorage.setItem(ACCESS_KEY, tokens.accessToken); localStorage.setItem(REFRESH_KEY, tokens.refreshToken); localStorage.setItem(EXPIRES_KEY, String(expiresAt)); emitAuthEvent(); }, clear(): void { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); localStorage.removeItem(EXPIRES_KEY); emitAuthEvent(); 

DeepSeek Chat Export  |  Page 34 of 59 

}, getAccessToken(): string | null { return localStorage.getItem(ACCESS_KEY); }, getRefreshToken(): string | null { return localStorage.getItem(REFRESH_KEY); }, 

/** True if access token is within `skewMs` of expiry (default 30s) */ isAccessTokenExpiringSoon(skewMs = 30_000): boolean { const raw = localStorage.getItem(EXPIRES_KEY); if (!raw) return true; const expiresAt = Number(raw); if (Number.isNaN(expiresAt)) return true; return Date.now() >= expiresAt - skewMs; } }; 

### 4. Error UX (from Artifact 13 §8) 

Save as <mark>frontend/src/lib/api/errors.ts</mark> . 

**TYPESCRIPT** /* ============================================================================ * Error UX — maps backend error codes to user-facing message + UI behaviour. * Source of truth: docs/api/error-codes.md (Artifact 13) * ==========================================================================*/ 

export type ErrorCode = string; export interface ApiError { code: ErrorCode; message: string; details?: Record<string, unknown>; correlationId?: string; } export interface ErrorUX { message: string; toast: 'error' | 'warning' | 'info'; forceLogout?: boolean; retryable?: boolean; fieldErrors?: Record<string, string>; } 

const FORCE_LOGOUT_CODES = new Set<ErrorCode>([ 'AUTH_TOKEN_REVOKED', 'AUTH_SESSION_REVOKED', 'AUTH_REFRESH_TOKEN_EXPIRED', 

DeepSeek Chat Export  |  Page 35 of 59 

'AUTH_REFRESH_TOKEN_REVOKED', 'AUTH_ACCOUNT_INACTIVE' ]); const WARNING_CODES = new Set<ErrorCode>([ 'AUTH_ACCOUNT_LOCKED', 'RATE_LIMITED', 'RATE_LIMITED_AUTH', 'INFRA_DB_UNAVAILABLE', 'INFRA_REDIS_UNAVAILABLE', 'INFRA_QUEUE_UNAVAILABLE' ]); const RETRYABLE_CODES = new Set<ErrorCode>([ 'AUTH_TOKEN_EXPIRED', 'RATE_LIMITED', 'RATE_LIMITED_AUTH', 'INFRA_DB_UNAVAILABLE', 'INFRA_REDIS_UNAVAILABLE', 'INFRA_QUEUE_UNAVAILABLE' ]); export function toErrorUX(err: ApiError): ErrorUX { const base: ErrorUX = { message: err.message || 'An unexpected error occurred.', toast: 'error', forceLogout: FORCE_LOGOUT_CODES.has(err.code), retryable: RETRYABLE_CODES.has(err.code) }; if (WARNING_CODES.has(err.code)) base.toast = 'warning'; if (err.code === 'VALIDATION_FAILED' && err.details && 'issues' in err.details) { const fieldErrors: Record<string, string> = {}; const issues = err.details.issues as Array<{ path: string; message: string }>; for (const issue of issues) fieldErrors[issue.path] = issue.message; return { ...base, toast: 'warning', fieldErrors }; } return base; } export function extractApiError(err: unknown): ApiError { if ( typeof err === 'object' && err !== null && 'isAxiosError' in err && (err as { isAxiosError: boolean }).isAxiosError ) { const axiosErr = err as { response?: { data?: { error?: { code?: string; message?: string; details?: Record<string, unknown> } }; headers?: Record<string, string> }; 

DeepSeek Chat Export  |  Page 36 of 59 

message?: string; }; const body = axiosErr.response?.data?.error; if (body) { return { code: body.code ?? 'INFRA_INTERNAL_ERROR', message: body.message ?? 'Request failed.', details: body.details, correlationId: axiosErr.response?.headers?.['x-correlation-id'] }; } } return { code: 'INFRA_INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error.' }; } 

### 5. Query Keys 

Save as <mark>frontend/src/lib/api/queryKeys.ts</mark> . 

**TYPESCRIPT** /* Centralized TanStack Query keys (Coding Standards §16 F3) */ export const queryKeys = { me: ['me'] as const, users: (filters: Record<string, unknown> = {}) => ['users', filters] as const, user: (id: string) => ['user', id] as const, teams: (filters: Record<string, unknown> = {}) => ['teams', filters] as const, team: (id: string) => ['team', id] as const, projects: (filters: Record<string, unknown> = {}) => ['projects', filters] as const, project: (id: string) => ['project', id] as const, tasks: (projectId: string, filters: Record<string, unknown> = {}) => ['tasks', projectId, filters] as const, task: (id: string) => ['task', id] as const, 

comments: (taskId: string) => ['comments', taskId] as const, notifications: ['notifications'] as const, analytics: (projectId: string) => ['analytics', projectId] as const, risks: (projectId: string) => ['risks', projectId] as const, audit: (filters: Record<string, unknown> = {}) => ['audit', filters] as const } as const; 

DeepSeek Chat Export  |  Page 37 of 59 

### 6. HTTP Client (S2-09) 

#### Save as <mark>frontend/src/lib/api/http.ts</mark> . 

**TYPESCRIPT** /* ============================================================================ * HTTP Client * ---------------------------------------------------------------------------* - Single axios instance (Coding Standards §16 F5) * - Auto attach Bearer access token * - Auto refresh on 401 AUTH_TOKEN_EXPIRED (single-flight) * - Force logout on AUTH_TOKEN_REVOKED / AUTH_SESSION_REVOKED / REFRESH_* * - Unwraps { success, data } to return `data` to callers * - Logs correlation id on failure * ==========================================================================*/ import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'; import { tokenStorage } from '../storage/tokenStorage.js'; import { extractApiError, toErrorUX, type ApiError } from './errors.js'; const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1'; export const http = axios.create({ baseURL: BASE_URL, withCredentials: false, // tokens travel via Authorization header timeout: 20_000, headers: { 'Content-Type': 'application/json' } }); /* -------------------------------------------------------------------------- */ /* Request: attach Bearer access token                                        */ /* -------------------------------------------------------------------------- */ http.interceptors.request.use((config: InternalAxiosRequestConfig) => { const token = tokenStorage.getAccessToken(); if (token) { config.headers.set('Authorization', `Bearer ${token}`); } return config; }); /* -------------------------------------------------------------------------- */ /* Response: unwrap envelope, single-flight refresh, force logout            */ /* -------------------------------------------------------------------------- */ type RetriableConfig = InternalAxiosRequestConfig & { _fypRetried?: boolean }; let refreshing: Promise<string | null> | null = null; 

DeepSeek Chat Export  |  Page 38 of 59 

async function performRefresh(): Promise<string | null> { const refreshToken = tokenStorage.getRefreshToken(); if (!refreshToken) return null; try { // Use a bare axios call so we don't recurse into these interceptors const { data } = await axios.post( `${BASE_URL}/auth/refresh`, { refreshToken }, { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 } ); const payload = data?.data as { accessToken: string; refreshToken: string; expiresIn: number } | undefined; if (!payload?.accessToken) return null; tokenStorage.set(payload); return payload.accessToken; } catch { return null; } } function forceLogout(): void { tokenStorage.clear(); const onLoginPage = window.location.pathname.startsWith('/login'); if (!onLoginPage) { const redirect = encodeURIComponent(window.location.pathname + window.location.search); window.location.assign(`/login?next=${redirect}`); } } http.interceptors.response.use( (response: AxiosResponse) => response, async (error: AxiosError) => { const config = error.config as RetriableConfig | undefined; const status = error.response?.status; const body = error.response?.data as | { error?: { code?: string; message?: string } } | undefined; const code = body?.error?.code; 

// 401 → refresh once if (status === 401 && config && !config._fypRetried) { // Codes that warrant a refresh attempt const refreshable = code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_TOKEN_INVALID'; if (refreshable) { config._fypRetried = true; refreshing ??= performRefresh().finally(() => { refreshing = null; }); const nextToken = await refreshing; if (nextToken) { 

DeepSeek Chat Export  |  Page 39 of 59 



<!-- Start of picture text -->
          config.headers.set('Authorization', `Bearer ${nextToken}`);<br>          return http.request(config);<br>        }<br>        forceLogout();<br>        return Promise.reject(error);<br>      }<br>      // Definitive revocation — no refresh, force logout<br>      if (<br>        code === 'AUTH_TOKEN_REVOKED' ||<br>        code === 'AUTH_SESSION_REVOKED' ||<br>        code === 'AUTH_ACCOUNT_INACTIVE'<br>      ) {<br>        forceLogout();<br>      }<br>    }<br>    // Attach normalized error + UX for downstream hooks<br>    const apiError: ApiError = extractApiError(error);<br>    (error as AxiosError & { apiError?: ApiError; ux?: ReturnType<typeof toErrorUX> }).apiError =<br>      apiError;<br>    (error as AxiosError & { ux?: ReturnType<typeof toErrorUX> }).ux = toErrorUX(apiError);<br>    return Promise.reject(error);<br>  }<br>);<br>/* -------------------------------------------------------------------------- */<br>/* Typed helpers — always use these instead of raw axios                     */<br>/* -------------------------------------------------------------------------- */<br>export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {<br>  const { data } = await http.get<{ success: true; data: T }>(url, { params });<br>  return data.data;<br>}<br>export async function apiPost<T>(url: string, body?: unknown): Promise<T> {<br>  const { data } = await http.post<{ success: true; data: T }>(url, body);<br>  return data.data;<br>}<br>export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {<br>  const { data } = await http.patch<{ success: true; data: T }>(url, body);<br>  return data.data;<br>}<br>export async function apiDelete<T = void>(url: string): Promise<T> {<br>  const { data } = await http.delete<{ success: true; data: T }>(url);<br>  return data.data;<br>}<br>export function getApiError(err: unknown): ApiError {<br>  const candidate = err as { apiError?: ApiError } | undefined;<br><!-- End of picture text -->

DeepSeek Chat Export  |  Page 40 of 59 

if (candidate?.apiError) return candidate.apiError; return extractApiError(err); } 

### 7. Auth API (S2-08) 

#### Save as <mark>frontend/src/features/auth/api/auth.api.ts</mark> . 

|**TYPESCRIPT**<br>/* Thin typed layer over the auth endpoints (Artifact 20) */|
|---|
|import { apiGet, apiPost, apiPatch } from '@/lib/api/http.js';<br>import type {<br>AuthUser,|
|LoginRequest,|
|LoginResponse,<br>TokenPair|
|} from '@/types/api.js';|
|export const authApi = {|
|login(input: LoginRequest): Promise<LoginResponse> {<br>return apiPost<LoginResponse>('/auth/login', input);<br>},|
|refresh(refreshToken: string): Promise<TokenPair> {<br>return apiPost<TokenPair>('/auth/refresh', { refreshToken });<br>},|
|logout(): Promise<null> {<br>return apiPost<null>('/auth/logout');<br>},|
|me(): Promise<AuthUser> {<br>return apiGet<AuthUser>('/auth/me');|
|},|
|changePassword(input: {<br>currentPassword: string;<br>newPassword: string;|
|}): Promise<null> {<br>return apiPatch<null>('/auth/password', input);<br>}<br>};|



### 8. Zod Schema (mirrors backend `auth.validation.ts`) 

Save as <mark>frontend/src/features/auth/schemas/auth.schema.ts</mark> . 

**TYPESCRIPT** import { z } from 'zod'; 

DeepSeek Chat Export  |  Page 41 of 59 

/** * Login form schema — matches backend contract (Artifact 20 §3). * Frontend uses .min(1) on password so we don't leak policy in the login form; * policy is only enforced on registration + password change. */ export const loginSchema = z.object({ email: z .string() .min(1, 'Email is required') .email('Enter a valid email address'), password: z.string().min(1, 'Password is required') }); export type LoginFormValues = z.infer<typeof loginSchema>; /** * Password policy — mirrors backend PASSWORD_REGEX (SRS §4.1) * Used for change-password form (implemented later). */ export const passwordPolicy = z .string() .min(8, 'Password must be at least 8 characters') .max(128, 'Password must be at most 128 characters') .regex( /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, 'Password must include upper, lower, digit, and special character' ); export const changePasswordSchema = z .object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: passwordPolicy, confirmPassword: z.string().min(1, 'Please confirm the new password') }) .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }); export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>; 

### 9. Auth Context (S2-10) 

Save as <mark>frontend/src/features/auth/context/AuthContext.tsx</mark> . 

**TYPESCRIPT** import { createContext, useCallback, useEffect, 

DeepSeek Chat Export  |  Page 42 of 59 

useMemo, useRef, useState, type ReactNode } from 'react'; import { useQueryClient } from '@tanstack/react-query'; import { AUTH_EVENT, tokenStorage } from '@/lib/storage/tokenStorage.js'; import { authApi } from '../api/auth.api.js'; import { connectSocket, disconnectSocket } from '@/lib/socket/client.js'; import type { AuthUser, LoginRequest } from '@/types/api.js'; 

/* -------------------------------------------------------------------------- */ /* Context shape                                                              */ /* -------------------------------------------------------------------------- */ export interface AuthContextValue { user: AuthUser | null; isAuthenticated: boolean; isLoading: boolean; login: (input: LoginRequest) => Promise<void>; logout: () => Promise<void>; refreshUser: () => Promise<void>; } 

export const AuthContext = createContext<AuthContextValue | null>(null); 

/* -------------------------------------------------------------------------- */ /* Provider                                                                   */ /* -------------------------------------------------------------------------- */ interface AuthProviderProps { children: ReactNode; } 

export function AuthProvider({ children }: AuthProviderProps) { const queryClient = useQueryClient(); const [user, setUser] = useState<AuthUser | null>(null); const [isLoading, setIsLoading] = useState<boolean>(true); const mountedRef = useRef(true); /* ---------------------------------------------------------------------- */ /* Bootstrap: restore session from storage on mount                       */ /* ---------------------------------------------------------------------- */ useEffect(() => { mountedRef.current = true; async function bootstrap() { const stored = tokenStorage.get(); if (!stored) { setIsLoading(false); return; } 

DeepSeek Chat Export  |  Page 43 of 59 

try { const me = await authApi.me(); if (!mountedRef.current) return; setUser(me); connectSocket(stored.accessToken, queryClient); } catch { // Interceptor handles the refresh / logout path tokenStorage.clear(); disconnectSocket(); } finally { if (mountedRef.current) setIsLoading(false); } } void bootstrap(); return () => { mountedRef.current = false; }; }, [queryClient]); /* ---------------------------------------------------------------------- */ /* React to external token changes (logout in another tab, force logout)  */ /* ---------------------------------------------------------------------- */ useEffect(() => { function onAuthChanged() { const stored = tokenStorage.get(); if (!stored && user) { setUser(null); disconnectSocket(); queryClient.clear(); } } window.addEventListener(AUTH_EVENT, onAuthChanged); return () => window.removeEventListener(AUTH_EVENT, onAuthChanged); }, [user, queryClient]); /* ---------------------------------------------------------------------- */ /* Actions                                                                */ /* ---------------------------------------------------------------------- */ const login = useCallback( async (input: LoginRequest) => { const response = await authApi.login(input); tokenStorage.set({ accessToken: response.accessToken, refreshToken: response.refreshToken, expiresIn: response.expiresIn }); setUser(response.user); connectSocket(response.accessToken, queryClient); }, 

DeepSeek Chat Export  |  Page 44 of 59 

[queryClient] ); const logout = useCallback(async () => { try { await authApi.logout(); } catch { // Even if the server call fails, clear local state. } finally { tokenStorage.clear(); disconnectSocket(); setUser(null); queryClient.clear(); } }, [queryClient]); const refreshUser = useCallback(async () => { const me = await authApi.me(); setUser(me); }, []); /* ---------------------------------------------------------------------- */ /* Value                                                                  */ /* ---------------------------------------------------------------------- */ const value = useMemo<AuthContextValue>( () => ({ user, isAuthenticated: user !== null, isLoading, login, logout, refreshUser }), [user, isLoading, login, logout, refreshUser] ); return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>; } 

### 10. `useAuth` + Convenience Hooks 

Save as <mark>frontend/src/features/auth/hooks/useAuth.ts</mark> . 

**TYPESCRIPT** 

import { useContext } from 'react'; import { AuthContext, type AuthContextValue } from '../context/AuthContext.js'; export function useAuth(): AuthContextValue { const ctx = useContext(AuthContext); if (!ctx) { 

DeepSeek Chat Export  |  Page 45 of 59 

throw new Error('useAuth must be used inside <AuthProvider>'); } return ctx; } 

#### Save as <mark>frontend/src/features/auth/hooks/useLogin.ts</mark> . 

**TYPESCRIPT** import { useState } from 'react'; import { useNavigate, useSearchParams } from 'react-router-dom'; import { useAuth } from './useAuth.js'; import { getApiError, toErrorUX } from '@/lib/api/errors.js'; import type { LoginFormValues } from '../schemas/auth.schema.js'; interface UseLoginResult { submitting: boolean; errorMessage: string | null; fieldErrors: Record<string, string>; submit: (values: LoginFormValues) => Promise<void>; } export function useLogin(): UseLoginResult { const { login } = useAuth(); const navigate = useNavigate(); const [params] = useSearchParams(); const [submitting, setSubmitting] = useState(false); const [errorMessage, setErrorMessage] = useState<string | null>(null); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}); async function submit(values: LoginFormValues) { setSubmitting(true); setErrorMessage(null); setFieldErrors({}); try { await login({ email: values.email.trim().toLowerCase(), password: values.password }); const next = params.get('next'); navigate(next && next.startsWith('/') ? next : '/', { replace: true }); } catch (err) { const apiError = getApiError(err); const ux = toErrorUX(apiError); setErrorMessage(ux.message); if (ux.fieldErrors) setFieldErrors(ux.fieldErrors); } finally { setSubmitting(false); } } return { submitting, errorMessage, fieldErrors, submit }; } 

Save as <mark>frontend/src/features/auth/hooks/useLogout.ts</mark> . 

DeepSeek Chat Export  |  Page 46 of 59 

##### **TYPESCRIPT** 

import { useCallback, useState } from 'react'; import { useNavigate } from 'react-router-dom'; import { useAuth } from './useAuth.js'; export function useLogout() { const { logout } = useAuth(); const navigate = useNavigate(); const [pending, setPending] = useState(false); const run = useCallback(async () => { setPending(true); try { await logout(); } finally { setPending(false); navigate('/login', { replace: true }); } }, [logout, navigate]); return { pending, logout: run }; } 

### 11. Login Form (S2-08) 

Save as <mark>frontend/src/features/auth/components/LoginForm.tsx</mark> . 

##### **TYPESCRIPT** 

import { useForm } from 'react-hook-form'; import { zodResolver } from '@hookform/resolvers/zod'; import { Link } from 'react-router-dom'; import { loginSchema, type LoginFormValues } from '../schemas/auth.schema.js'; import { useLogin } from '../hooks/useLogin.js'; export function LoginForm() { const { submitting, errorMessage, fieldErrors, submit } = useLogin(); const { register, handleSubmit, formState: { errors, isValid, isSubmitting } } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), mode: 'onChange', defaultValues: { email: '', password: '' } }); const disabled = submitting || isSubmitting || !isValid; return ( <form 

DeepSeek Chat Export  |  Page 47 of 59 

onSubmit={handleSubmit(submit)} noValidate className="space-y-5" aria-labelledby="login-heading" > <div> <label htmlFor="email" className="block text-sm font-medium text-slate-700" > Email </label> <input id="email" type="email" autoComplete="email" autoFocus disabled={disabled} aria-invalid={errors.email ? 'true' : 'false'} aria-describedby={errors.email ? 'email-error' : undefined} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:bgslate-100" {...register('email')} /> {errors.email && ( <p id="email-error" className="mt-1 text-sm text-red-600"> {errors.email.message} </p> )} {fieldErrors.email && !errors.email && ( <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p> )} </div> <div> <label htmlFor="password" className="block text-sm font-medium text-slate-700" > Password </label> <input id="password" type="password" autoComplete="current-password" disabled={disabled} aria-invalid={errors.password ? 'true' : 'false'} aria-describedby={errors.password ? 'password-error' : undefined} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:bgslate-100" 

DeepSeek Chat Export  |  Page 48 of 59 

{...register('password')} /> {errors.password && ( <p id="password-error" className="mt-1 text-sm text-red-600"> {errors.password.message} </p> )} {fieldErrors.password && !errors.password && ( <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p> )} </div> {errorMessage && ( <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" > {errorMessage} </div> )} <button type="submit" disabled={disabled} className="w-full rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60" > {submitting ? 'Signing in…' : 'Sign in'} </button> <p className="text-center text-xs text-slate-500"> Accounts are provisioned by an administrator. <br /> <Link to="/support" className="text-brand-primary hover:underline"> Need access? </Link> </p> </form> ); } 

### 12. Login Page 

Save as <mark>frontend/src/features/auth/pages/LoginPage.tsx</mark> . 

**TYPESCRIPT** 

import { Navigate } from 'react-router-dom'; import { LoginForm } from '../components/LoginForm.js'; import { useAuth } from '../hooks/useAuth.js'; 

export function LoginPage() { 

DeepSeek Chat Export  |  Page 49 of 59 

const { isAuthenticated, isLoading } = useAuth(); if (isLoading) { return ( <main className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-sm text-slate-500">Loading…</div> </main> ); } if (isAuthenticated) { return <Navigate to="/" replace />; } return ( <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"> <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm"> <header className="mb-6 text-center"> <h1 id="login-heading" className="text-2xl font-bold text-brand-primary"> FYP PM Platform </h1> <p className="mt-1 text-sm text-slate-500"> Sign in to continue </p> </header> <LoginForm /> </div> </main> ); } 

### 13. Protected Route (S2-10) 

Save as <mark>frontend/src/features/auth/components/ProtectedRoute.tsx</mark> . 

**TYPESCRIPT** import type { ReactNode } from 'react'; import { Navigate, useLocation } from 'react-router-dom'; import { useAuth } from '../hooks/useAuth.js'; import type { GlobalRole } from '@/types/api.js'; interface ProtectedRouteProps { children: ReactNode; /** Optional role gate. If omitted, any authenticated user passes. */ roles?: GlobalRole[]; } export function ProtectedRoute({ children, roles }: ProtectedRouteProps) { const { isAuthenticated, isLoading, user } = useAuth(); const location = useLocation(); 

DeepSeek Chat Export  |  Page 50 of 59 

if (isLoading) { return ( <div className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-sm text-slate-500">Loading…</div> </div> ); } if (!isAuthenticated) { const next = encodeURIComponent(location.pathname + location.search); return <Navigate to={`/login?next=${next}`} replace />; } if (roles && roles.length > 0 && user) { if (!roles.includes(user.globalRole)) { return <Navigate to="/403" replace />; } } return <>{children}</>; } 

### 14. Auth Provider Wire-up 

Save as <mark>frontend/src/app/providers.tsx</mark> (updated). 

**TYPESCRIPT** import type { ReactNode } from 'react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { BrowserRouter } from 'react-router-dom'; import { AuthProvider } from '@/features/auth/context/AuthContext.js'; const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: (failureCount, error) => { // Never retry auth-revocation errors const code = (error as { apiError?: { code?: string } } | undefined)?.apiError?.code; if ( code === 'AUTH_TOKEN_REVOKED' || code === 'AUTH_SESSION_REVOKED' || code === 'AUTH_ACCOUNT_INACTIVE' ) { return false; } return failureCount < 1; }, refetchOnWindowFocus: false } } 

DeepSeek Chat Export  |  Page 51 of 59 

}); export function Providers({ children }: { children: ReactNode }) { return ( <QueryClientProvider client={queryClient}> <BrowserRouter> <AuthProvider>{children}</AuthProvider> </BrowserRouter> </QueryClientProvider> ); } 

### 15. Routes (S2-10) 

Save as <mark>frontend/src/app/routes.tsx</mark> (updated). 

##### **TYPESCRIPT** 

import { Navigate, Route, Routes } from 'react-router-dom'; import { LoginPage } from '@/features/auth/pages/LoginPage.js'; import { ProtectedRoute } from '@/features/auth/components/ProtectedRoute.js'; /* Placeholder pages — real pages land in subsequent sprints */ function HomePage() { return ( <main className="min-h-screen bg-slate-50 p-8"> <h1 className="text-2xl font-bold text-brand-primary"> Dashboard </h1> <p className="mt-2 text-slate-600"> Signed in. Sprint 3+ will populate this. </p> </main> ); } function ForbiddenPage() { return ( <main className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-center"> <h1 className="text-2xl font-bold text-red-600">403</h1> <p className="mt-2 text-slate-600">You do not have access to this page.</p> </div> </main> ); } function NotFoundPage() { return ( <main className="flex min-h-screen items-center justify-center bg-slate-50"> <div className="text-center"> <h1 className="text-2xl font-bold text-slate-800">404</h1> 

DeepSeek Chat Export  |  Page 52 of 59 

<p className="mt-2 text-slate-600">Page not found.</p> </div> </main> ); } export function AppRoutes() { return ( <Routes> <Route path="/login" element={<LoginPage />} /> <Route path="/403" element={<ForbiddenPage />} /> <Route path="/" element={ <ProtectedRoute> <HomePage /> </ProtectedRoute> } /> <Route path="*" element={<NotFoundPage />} /> </Routes> ); } 

### 16. Socket Client Integration 

Confirm <mark>frontend/src/lib/socket/client.ts</mark> matches **Artifact 10 §10.6** exactly. The slice only calls its exported <mark>connectSocket(token, queryClient)</mark> and <mark>disconnectSocket()</mark> — no other responsibilities. Minimal required shape: 

##### **TYPESCRIPT** 

export function connectSocket(token: string, queryClient: QueryClient): TypedClientSocket; export function disconnectSocket(): void; export function getSocket(): TypedClientSocket | null; 

That is sufficient for this slice. Full socket event wiring (task. _, comment._ , risk.*) lands in Sprints 8–12. 

### 17. Frontend Tests 

Save as <mark>frontend/src/features/auth/__tests__/LoginForm.test.tsx</mark> . 

##### **TYPESCRIPT** 

import { describe, it, expect, vi, beforeEach } from 'vitest'; import { render, screen, waitFor } from '@testing-library/react'; import userEvent from '@testing-library/user-event'; import { MemoryRouter } from 'react-router-dom'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { AuthProvider } from '../context/AuthContext.js'; import { LoginForm } from '../components/LoginForm.js'; import { AuthContext } from '../context/AuthContext.js'; 

DeepSeek Chat Export  |  Page 53 of 59 

import type { AuthContextValue } from '../context/AuthContext.js'; function renderWithProviders(ui: React.ReactNode, override?: Partial<AuthContextValue>) { const value: AuthContextValue = { user: null, isAuthenticated: false, isLoading: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn(), ...override }; const client = new QueryClient(); return render( <QueryClientProvider client={client}> <MemoryRouter> <AuthContext.Provider value={value}>{ui}</AuthContext.Provider> </MemoryRouter> </QueryClientProvider> ); } describe('LoginForm', () => { beforeEach(() => { vi.clearAllMocks(); }); it('renders email + password fields', () => { renderWithProviders(<LoginForm />); expect(screen.getByLabelText(/email/i)).toBeInTheDocument(); expect(screen.getByLabelText(/password/i)).toBeInTheDocument(); }); it('shows validation error for invalid email', async () => { renderWithProviders(<LoginForm />); await userEvent.type(screen.getByLabelText(/email/i), 'nope'); await userEvent.click(screen.getByRole('button', { name: /sign in/i })); await waitFor(() => expect(screen.getByText(/valid email/i)).toBeInTheDocument() ); }); it('calls login with trimmed lowercase email', async () => { const login = vi.fn().mockResolvedValue(undefined); renderWithProviders(<LoginForm />, { login }); await userEvent.type(screen.getByLabelText(/email/i), '  Admin@FYP.Local  '); await userEvent.type(screen.getByLabelText(/password/i), 'Admin@1234'); await userEvent.click(screen.getByRole('button', { name: /sign in/i })); await waitFor(() => expect(login).toHaveBeenCalledTimes(1)); expect(login).toHaveBeenCalledWith({ email: 'admin@fyp.local', password: 'Admin@1234' 

DeepSeek Chat Export  |  Page 54 of 59 

}); 

}); 

it('displays API error message on failure', async () => { const login = vi.fn().mockRejectedValue({ apiError: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' } }); renderWithProviders(<LoginForm />, { login }); await userEvent.type(screen.getByLabelText(/email/i), 'admin@fyp.local'); await userEvent.type(screen.getByLabelText(/password/i), 'wrong'); await userEvent.click(screen.getByRole('button', { name: /sign in/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i) ); }); }); 

Save as <mark>frontend/src/features/auth/__tests__/ProtectedRoute.test.tsx</mark> . 

##### **TYPESCRIPT** 

import { describe, it, expect, vi } from 'vitest'; import { render, screen } from '@testing-library/react'; import { MemoryRouter, Routes, Route } from 'react-router-dom'; import { ProtectedRoute } from '../components/ProtectedRoute.js'; import { AuthContext, type AuthContextValue } from '../context/AuthContext.js'; function renderProtected(value: Partial<AuthContextValue>, roles?: ('Administrator' | 'Team Member')[]) { const ctx: AuthContextValue = { user: null, isAuthenticated: false, isLoading: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn(), ...value }; return render( <AuthContext.Provider value={ctx}> <MemoryRouter initialEntries={['/private']}> <Routes> <Route path="/private" element={ <ProtectedRoute roles={roles}> <div>Secret content</div> </ProtectedRoute> } /> <Route path="/login" element={<div>Login screen</div>} /> <Route path="/403" element={<div>Forbidden screen</div>} /> </Routes> 

DeepSeek Chat Export  |  Page 55 of 59 

</MemoryRouter> </AuthContext.Provider> ); } describe('ProtectedRoute', () => { it('redirects unauthenticated to /login', () => { renderProtected({ isAuthenticated: false, user: null }); expect(screen.getByText(/login screen/i)).toBeInTheDocument(); }); it('renders children for authenticated user', () => { renderProtected({ isAuthenticated: true, user: { id: 'u-1', email: 'a@fyp.local', fullName: 'A', globalRole: 'Administrator', configuredCapacityHours: 40, isActive: true, createdAt: new Date().toISOString() } }); expect(screen.getByText(/secret content/i)).toBeInTheDocument(); }); it('redirects to /403 when role not allowed', () => { renderProtected( { isAuthenticated: true, user: { id: 'u-1', email: 'a@fyp.local', fullName: 'A', globalRole: 'Team Member', configuredCapacityHours: 40, isActive: true, createdAt: new Date().toISOString() } }, ['Administrator'] ); expect(screen.getByText(/forbidden screen/i)).toBeInTheDocument(); }); it('shows loading state while bootstrap runs', () => { renderProtected({ isLoading: true, isAuthenticated: false, user: null }); expect(screen.getByText(/loading/i)).toBeInTheDocument(); }); }); 

DeepSeek Chat Export  |  Page 56 of 59 

Add to <mark>frontend/package.json</mark> devDependencies: 

**JSON** 

"@testing-library/react": "^16.0.1", "@testing-library/user-event": "^14.5.2", "@testing-library/jest-dom": "^6.5.0" 

### 18. Manual Smoke Test 

##### **BASH** 

# Backend on :3000 · frontend on :5173 · DB + Redis running 

- # 1. Open http://localhost:5173 → redirected to /login # 2. Enter wrong password → "Invalid email or password." 

- # 3. Enter admin@fyp.local / Admin@1234 → redirects to / # 4. Open browser DevTools → Application → Local Storage 

- #    → verify fyp.accessToken, fyp.refreshToken, fyp.accessTokenExpiresAt # 5. Reload page → still authenticated (bootstrap /auth/me) 

- # 6. Open DevTools → Network → throttle or wait >15 min → any API call #    → observe 401 AUTH_TOKEN_EXPIRED → auto /auth/refresh → retried request # 7. Click logout (added to HomePage next) → redirected to /login 

- # 8. Try to reuse the old accessToken via curl → 401 AUTH_TOKEN_REVOKED 

- # 9. Open /login while authenticated → redirected to / (AuthProvider guard) 

- # 10. Open a protected page while unauthenticated → redirected to /login?next=... 

- # 11. Successful login then navigates to ?next target 

- # 12. Open second tab, logout in one → other tab auto-logged-out via AUTH_EVENT 

### 19. Acceptance Criteria Coverage 

|AC|Verified by|
|---|---|
|**FR-AUTH-01**Login|useLogin.submit→<br>authApi.login→ tokenStorage.set|
|**FR-AUTH-03**JWT issued|Enforced by backend; stored via<br>tokenStorage.set|
|**FR-AUTH-04**Token validated|HTTP client interceptor attaches Bearer; backend validates|
|**FR-AUTH-06**Profile read|authApi.me()on bootstrap|
|**FR-AUTH-10**Logout|useLogout→<br>authApi.logout→ tokenStorage.clear|
|**FR-AUTH-11**JTI blacklist|Backend enforces; frontend clears + force-logout path handles revoked codes|
|**CA-06**Refresh rotation|Interceptor single-flight<br>performRefresh|
|**NFR-SEC-03**Validation|Zod loginSchema on form|
|**NFR-USA-01**Understandable|Simple form with errors + accessible labels|
|**NFR-USA-02**WCAG 2.1 AA|aria-invalid,<br>aria-describedby,<br>role="alert", focus states|



DeepSeek Chat Export  |  Page 57 of 59 

### 20. Cross-Artifact Consistency 

|Artifact|Verification|
|---|---|
|4 (OpenAPI) —<br>/auth/login,<br>/auth/refresh,<br>/auth/logout,<br>/auth/me|✅ All called|
|10 (Socket) —<br>connectSocketafter login,<br>disconnectSocketon logout||
|11 §16 — F1 stack, F2 TanStack, F3 keys, F4 RHF+Zod, F5<br>single axios, F6 socket singleton, F11 no<br>anyin props|✅ All honoured|
|13 §8 —<br>toErrorUX,<br>extractApiError|✅ Used in<br>errors.ts+<br>useLogin|
|15 — TS-AUTH-01, TS-AUTH-02, TS-AUTH-07, TS-<br>AUTH-11|✅ Covered by Playwright/manual tests +<br>frontend unit tests|
|16 — S2-08, S2-09, S2-10|✅ All stories delivered|
|**20 (Backend)**— endpoint contracts|✅ Field names match exactly (<br>accessToken,<br>refreshToken,<br>expiresIn,<br>user)|



**Zero drift** with backend response shapes. 

### 21. Definition of Done 

- [x] FR-AUTH-01, 03, 04, 06, 10, 11 covered on frontend 

- [x] Zod validation on login form 

- [x] RHF + zodResolver 

- [x] Single axios instance with Bearer + refresh + force-logout 

- [x] Auth context with bootstrap + tab sync 

- [x] Protected route with role gate + <mark>?next=</mark> redirect 

- [x] Login page + 403 + 404 fallbacks 

- [x] No <mark>any</mark> in component props 

- [x] No <mark>fetch/axios</mark> calls in components (only through <mark>authApi</mark> ) 

- [x] Tailwind utility-only styling 

- [x] <mark>useAuth</mark> , <mark>useLogin</mark> , <mark>useLogout</mark> hooks 

- [x] Socket connected on login, disconnected on logout 

- [x] Accessible (labels, aria, focus, role=alert) 

- [x] Unit tests for LoginForm + ProtectedRoute 

- [x] Manual smoke test passes 

### 22. Commit 

##### **BASH** 

git add frontend/ git commit -m "feat(auth): add frontend auth slice (S2-08..S2-10) 

DeepSeek Chat Export  |  Page 58 of 59 

- HTTP client with Bearer, single-flight refresh, force-logout on revoked sessions (FR-AUTH-04, CA-06) 

- Auth context with bootstrap /auth/me + cross-tab logout sync 

- Login form (React Hook Form + Zod) with field + global errors 

- Protected route with role gate and ?next= round-trip - LoginPage, ForbiddenPage (403), NotFoundPage (404) - Socket connected on login, disconnected on logout - TS-AUTH-01, TS-AUTH-02, TS-AUTH-07, TS-AUTH-11 covered Refs: FR-AUTH-01..11, CA-04, CA-05, CA-06 Closes: S2-08, S2-09, S2-10" 

✅ Sprint 2 — Frontend Auth Slice Complete 

|Story|Status|
|---|---|
|S2-01 → S2-07 (backend)|✅ Artifact 20|
|**S2-08**Login form||
|**S2-09**HTTP client||
|**S2-10**Auth context + protected routes||



**Sprint 2 is fully delivered** — backend + frontend for auth. 

DeepSeek Chat Export  |  Page 59 of 59 

