/**
 * @file src/modules/users/users.service.ts
 * @description Business logic for User administration, listings, and RBAC operations.
 *
 * Implements SRS v3.0 §4.2 (Role Matrix & Permissions), §4.7, and Appendix A:
 * - Admin-only user directory and provisioning.
 * - Self-access or Administrator access for individual profiles.
 * - Self-modification prevention (cannot demote or deactivate self).
 * - Last active Administrator protection.
 * - Refresh session revocation upon role alteration or deactivation.
 * - Transactional audit logging for every mutation.
 */

import { randomUUID } from "node:crypto";
import type { User as PrismaUser } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";
import {
  passwordService,
  tokenService,
  UserResponse,
  GlobalRole,
} from "../auth/index.js";
import { usersRepository } from "./users.repository.js";
import type {
  ListUsersQuery,
  CreateUserRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
} from "./users.schemas.js";
import type { PaginationMeta } from "../../core/responses/index.js";

export interface RequestContext {
  actorId: string;
  actorRole: string;
  correlationId?: string;
}

export interface ListUsersServiceResult {
  users: UserResponse[];
  meta: PaginationMeta;
}

/**
 * Advisory lock ID for serializing administrator role/status mutations.
 * Arbitrary 32-bit integer — only requirement is consistency across the
 * codebase. Prevents concurrent demote/deactivate races that could leave
 * the system with zero active administrators (audit finding SEC-03).
 */
const ADMIN_MUTATION_LOCK_ID = 987654321;

/**
 * Transforms internal Prisma User model into public UserResponse, stripping password hash.
 */
function toUserResponse(user: PrismaUser): UserResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    globalRole: user.globalRole as GlobalRole,
    configuredCapacityHours: user.configuredCapacityHours,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Lists users with pagination and optional search/filters.
 */
export async function list(
  query: ListUsersQuery,
): Promise<ListUsersServiceResult> {
  const { rows, total } = await usersRepository.list(query);
  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    users: rows.map(toUserResponse),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
    },
  };
}

/**
 * Retrieves a user by ID.
 * Allowed if the caller is Administrator OR if the caller is requesting their own profile.
 */
export async function getById(
  targetUserId: string,
  actorId: string,
  actorRole: string,
): Promise<UserResponse> {
  if (actorRole !== "Administrator" && actorId !== targetUserId) {
    throw new AppError(
      "You do not have permission to view this user profile",
      403,
      ERROR_CODES.AUTHZ_FORBIDDEN,
    );
  }

  const user = await usersRepository.findById(targetUserId);
  if (!user) {
    throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
  }

  return toUserResponse(user);
}

/**
 * Provisions a new user account with initial role and capacity.
 * Enforces email uniqueness and password policy, and logs an audit record.
 */
export async function create(
  input: CreateUserRequest,
  ctx: RequestContext,
): Promise<UserResponse> {
  const isEmailTaken = await usersRepository.emailExists(input.email);
  if (isEmailTaken) {
    throw new AppError(
      "A user with this email already exists",
      409,
      ERROR_CODES.USER_ALREADY_EXISTS,
    );
  }

  const passwordHash = await passwordService.hashPassword(input.password);
  const configuredCapacityHours = input.configuredCapacityHours ?? 40;

  const newUser = await prisma.$transaction(async (tx) => {
    const created = await usersRepository.create(
      {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        globalRole: input.globalRole,
        configuredCapacityHours,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "User",
        entityId: created.id,
        action: "CREATE",
        oldValues: {},
        newValues: {
          id: created.id,
          email: created.email,
          fullName: created.fullName,
          globalRole: created.globalRole,
          configuredCapacityHours: created.configuredCapacityHours,
          isActive: created.isActive,
        },
        correlationId: ctx.correlationId ?? randomUUID(),
      },
    });

    return created;
  });

  return toUserResponse(newUser);
}

/**
 * Updates a user's global role.
 * - Prevents self-modification.
 * - Protects against demoting the last active Administrator.
 * - Revokes all active refresh sessions to force token re-issue with updated claims.
 */
export async function updateRole(
  targetUserId: string,
  input: UpdateUserRoleRequest,
  ctx: RequestContext,
): Promise<UserResponse> {
  if (ctx.actorId === targetUserId) {
    throw new AppError(
      "Administrators cannot change their own global role",
      403,
      ERROR_CODES.AUTHZ_FORBIDDEN,
    );
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    // Serialize admin mutations (SEC-03). Auto-released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_ID})`;

    const before = await usersRepository.findById(targetUserId, tx);
    if (!before) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    // Last-admin guard
    if (
      before.globalRole === "Administrator" &&
      input.globalRole !== "Administrator"
    ) {
      const remainingAdmins = await usersRepository.countActiveAdmins(
        targetUserId,
        tx,
      );
      if (remainingAdmins === 0) {
        throw new AppError(
          "Cannot demote the last active Administrator",
          403,
          ERROR_CODES.LAST_ADMIN_PROTECTED,
        );
      }
    }

    const after = await usersRepository.update(
      targetUserId,
      { globalRole: input.globalRole },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "User",
        entityId: targetUserId,
        action: "UPDATE",
        oldValues: {
          globalRole: before.globalRole,
        },
        newValues: {
          globalRole: after.globalRole,
        },
        correlationId: ctx.correlationId ?? randomUUID(),
      },
    });

    return after;
  });

  // Revoke active sessions outside of transaction
  await tokenService.revokeAllRefreshSessions(targetUserId);

  return toUserResponse(updatedUser);
}

/**
 * Updates a user's active/inactive status.
 * - Prevents self-deactivation.
 * - Protects against deactivating the last active Administrator.
 * - Revokes all active refresh sessions if the account is deactivated.
 */
export async function updateStatus(
  targetUserId: string,
  input: UpdateUserStatusRequest,
  ctx: RequestContext,
): Promise<UserResponse> {
  if (ctx.actorId === targetUserId) {
    throw new AppError(
      "Administrators cannot deactivate their own account",
      403,
      ERROR_CODES.AUTHZ_FORBIDDEN,
    );
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    // Serialize admin mutations (SEC-03). Auto-released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_ID})`;

    const before = await usersRepository.findById(targetUserId, tx);
    if (!before) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    // Last-admin guard
    if (before.globalRole === "Administrator" && !input.isActive) {
      const remainingAdmins = await usersRepository.countActiveAdmins(
        targetUserId,
        tx,
      );
      if (remainingAdmins === 0) {
        throw new AppError(
          "Cannot deactivate the last active Administrator",
          403,
          ERROR_CODES.LAST_ADMIN_PROTECTED,
        );
      }
    }

    const after = await usersRepository.update(
      targetUserId,
      { isActive: input.isActive },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "User",
        entityId: targetUserId,
        action: "UPDATE",
        oldValues: {
          isActive: before.isActive,
        },
        newValues: {
          isActive: after.isActive,
        },
        correlationId: ctx.correlationId ?? randomUUID(),
      },
    });

    return after;
  });

  // If deactivated, revoke all refresh sessions
  if (!input.isActive) {
    await tokenService.revokeAllRefreshSessions(targetUserId);
  }

  return toUserResponse(updatedUser);
}

export const usersService = {
  list,
  getById,
  create,
  updateRole,
  updateStatus,
};
