/**
 * @file src/modules/users/users.repository.ts
 * @description Data-access layer for User administration, listings, and RBAC operations.
 *
 * ARCHITECTURAL DESIGN:
 * Follows the repository pattern with transaction-client propagation.
 * Every method accepts an optional `tx?: Prisma.TransactionClient` to participate
 * in atomic transactions.
 */

import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import type { ListUsersQuery } from "./users.schemas.js";

export interface ListUsersResult {
  rows: User[];
  total: number;
}

/**
 * Lists users with optional pagination, insensitive text search on email/fullName,
 * role filter, and active-status filter.
 */
export async function list(
  params: ListUsersQuery,
  tx?: Prisma.TransactionClient,
): Promise<ListUsersResult> {
  const db = tx ?? prisma;
  const where: Prisma.UserWhereInput = {};

  if (params.search) {
    where.OR = [
      {
        email: {
          contains: params.search,
          mode: "insensitive",
        },
      },
      {
        fullName: {
          contains: params.search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (params.role) {
    where.globalRole = params.role;
  }

  if (params.isActive !== undefined) {
    where.isActive = params.isActive;
  }

  const skip = (params.page - 1) * params.limit;
  const take = params.limit;

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
    }),
    db.user.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Finds a user by primary key UUID.
 */
export async function findById(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<User | null> {
  const db = tx ?? prisma;
  return db.user.findUnique({
    where: { id },
  });
}

/**
 * Finds a user by email (case-insensitive via lowercase + trim).
 */
export async function findByEmail(
  email: string,
  tx?: Prisma.TransactionClient,
): Promise<User | null> {
  const db = tx ?? prisma;
  return db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

/**
 * Checks whether an email address is already registered.
 */
export async function emailExists(
  email: string,
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  const db = tx ?? prisma;
  const count = await db.user.count({
    where: { email: email.toLowerCase().trim() },
  });
  return count > 0;
}

/**
 * Inserts a new user record.
 */
export async function create(
  data: {
    email: string;
    passwordHash: string;
    fullName: string;
    globalRole: string;
    configuredCapacityHours: number;
  },
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.create({
    data: {
      email: data.email.toLowerCase().trim(),
      passwordHash: data.passwordHash,
      fullName: data.fullName,
      globalRole: data.globalRole,
      configuredCapacityHours: data.configuredCapacityHours,
      isActive: true,
    },
  });
}

/**
 * Updates a user record by primary key.
 */
export async function update(
  id: string,
  data: Prisma.UserUpdateInput,
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data,
  });
}

/**
 * Counts active Administrators, optionally excluding a specific user ID.
 * Used for the last active administrator safety check.
 */
export async function countActiveAdmins(
  excludeUserId?: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const db = tx ?? prisma;
  const where: Prisma.UserWhereInput = {
    globalRole: "Administrator",
    isActive: true,
  };

  if (excludeUserId) {
    where.id = { not: excludeUserId };
  }

  return db.user.count({ where });
}

export const usersRepository = {
  list,
  findById,
  findByEmail,
  emailExists,
  create,
  update,
  countActiveAdmins,
};
