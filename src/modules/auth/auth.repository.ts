/**
 * @file src/modules/auth/auth.repository.ts
 * @description Data-access layer for User entity authentication and profile operations.
 *
 * ARCHITECTURAL DESIGN:
 * This repository is the sole access path for User entity reads and mutations
 * within the auth module. All methods accept an optional `tx` client:
 * "When called from within prisma.$transaction, pass the tx client to ensure
 * reads/writes are transaction-scoped."
 */

import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";

export type DbClient = Prisma.TransactionClient | typeof prisma;

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
 * Atomically increments failed login attempts counter.
 */
export async function incrementFailedAttempts(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data: {
      failedLoginAttempts: {
        increment: 1,
      },
    },
  });
}

/**
 * Locks user account until specified timestamp and resets failed attempts counter.
 */
export async function setLockout(
  id: string,
  until: Date,
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data: {
      lockedUntil: until,
      failedLoginAttempts: 0,
    },
  });
}

/**
 * Records successful login: sets lastLoginAt to now, resets failed attempts to 0,
 * and clears any active lockout.
 */
export async function recordSuccessfulLogin(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data: {
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
}

/**
 * Updates user password hash.
 */
export async function updatePasswordHash(
  id: string,
  passwordHash: string,
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data: {
      passwordHash,
    },
  });
}

/**
 * Updates user profile fields (fullName and/or configuredCapacityHours).
 */
export async function updateProfile(
  id: string,
  data: {
    fullName?: string;
    configuredCapacityHours?: number;
  },
  tx?: Prisma.TransactionClient,
): Promise<User> {
  const db = tx ?? prisma;
  return db.user.update({
    where: { id },
    data,
  });
}

/**
 * Atomically increments the failed-login counter and, if the new count
 * reaches the lockout threshold, sets lockedUntil and resets the counter
 * to 0 — all inside a single database transaction. Prevents the read-
 * then-write race in the audit finding SEC-08.
 *
 * @param userId  User whose counter to increment
 * @param threshold  Lockout threshold (e.g., 5)
 * @param lockoutMs  Lockout duration in milliseconds (e.g., 15 * 60_000)
 * @returns { locked: true, lockedUntil } when threshold reached;
 *          { locked: false, attempts: newCount } otherwise
 */
export async function incrementAndMaybeLockout(
  userId: string,
  threshold: number,
  lockoutMs: number,
): Promise<
  | { locked: true; lockedUntil: Date }
  | { locked: false; attempts: number }
> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (updated.failedLoginAttempts >= threshold) {
      const lockedUntil = new Date(Date.now() + lockoutMs);
      await tx.user.update({
        where: { id: userId },
        data: {
          lockedUntil,
          failedLoginAttempts: 0,
        },
      });
      return { locked: true, lockedUntil };
    }

    return { locked: false, attempts: updated.failedLoginAttempts };
  });
}

export const authRepository = {
  findByEmail,
  findById,
  incrementFailedAttempts,
  setLockout,
  recordSuccessfulLogin,
  updatePasswordHash,
  updateProfile,
  incrementAndMaybeLockout,
};
