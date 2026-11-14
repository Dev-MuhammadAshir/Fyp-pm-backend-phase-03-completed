/**
 * @file tests/helpers/auth-test-helpers.ts
 * @description Helper functions for authentication API integration tests.
 *
 * Implements temp user lifecycle, session cleanup, login automation,
 * and test JWT builders.
 */

import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../../src/core/db/prisma.js";
import { redis } from "../../src/infra/redis/client.js";
import { env } from "../../src/config/env.js";
import { passwordService } from "../../src/modules/auth/password.service.js";

export interface TempUser {
  id: string;
  email: string;
  password: string;
  globalRole: "Administrator" | "Project Manager" | "Team Member" | "Viewer";
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
  globalRole: string;
}

/**
 * Creates an isolated temporary user in the database with hashed password.
 */
export async function seedTempUser(
  overrides?: Partial<TempUser>,
): Promise<TempUser> {
  const email = overrides?.email ?? `test-${randomUUID()}@fyp.local`;
  const password = overrides?.password ?? "TestUser@1234";
  const globalRole = overrides?.globalRole ?? "Team Member";

  const passwordHash = await passwordService.hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: "Test User",
      globalRole,
      configuredCapacityHours: 40,
      isActive: true,
    },
  });

  return {
    id: user.id,
    email: user.email,
    password,
    globalRole: user.globalRole as TempUser["globalRole"],
  };
}

/**
 * Deletes a temporary user and all associated Redis refresh sessions.
 * Idempotent: safe to invoke multiple times; never throws.
 */
export async function deleteTempUser(id: string): Promise<void> {
  try {
    // 1. Fetch all active refresh session JTIs for this user
    const userKey = `auth:refresh:user:${id}`;
    const jtis = await redis.smembers(userKey);

    // 2. Build list of Redis keys to purge
    const keys = jtis.map((jti) => `auth:refresh:${jti}`);
    keys.push(userKey);

    // 3. Purge session keys from Redis
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Redis cleanup is best-effort during teardown
  }

  // 4. Remove the user row from PostgreSQL
  await prisma.user.delete({ where: { id } }).catch(() => {});
}

/**
 * Executes a login request via Supertest and returns tokens and user metadata.
 * Throws a detailed error if login does not return HTTP 200.
 */
export async function loginAs(
  app: Express,
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });

  if (res.status !== 200 || !res.body?.success) {
    throw new Error(
      `loginAs failed for ${email} with status ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }

  return {
    accessToken: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
    expiresIn: res.body.data.expiresIn as number,
    userId: res.body.data.user.id as string,
    globalRole: res.body.data.user.globalRole as string,
  };
}

/**
 * Formats a Bearer token authorization header object.
 */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Builds an expired access token with the production JWT claims shape.
 * Used for testing Errata E-007 compliance (logout with expired bearer token).
 */
export function buildExpiredAccessToken(user: {
  id: string;
  email: string;
  globalRole: string;
}): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      type: "access",
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      jwtid: randomUUID(),
      expiresIn: "1ms",
    },
  );
}
