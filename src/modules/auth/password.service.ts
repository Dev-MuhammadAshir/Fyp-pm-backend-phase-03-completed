/**
 * @file src/modules/auth/password.service.ts
 * @description Secure password hashing and verification service using bcryptjs.
 *
 * ARCHITECTURAL CONSTRAINTS & DEVIATION:
 * 1. Uses `bcryptjs` (pure JavaScript) instead of native `bcrypt` per project
 *    runtime constraints to eliminate C++ compilation dependencies.
 * 2. Enforces NFR-SEC-02 cost factor >= 12 via `env.BCRYPT_SALT_ROUNDS`,
 *    which is strictly validated at application startup by Zod.
 */

import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";

/**
 * Hashes a plaintext password using bcryptjs with the configured salt rounds.
 *
 * @param plain Plaintext password to hash
 * @returns Promise resolving to the bcrypt password hash
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

/**
 * Compares a plaintext password against a stored bcrypt hash.
 *
 * @param plain Plaintext password provided during authentication
 * @param hash Stored bcrypt hash
 * @returns Promise resolving to true if passwords match, false otherwise
 */
export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const passwordService = {
  hashPassword,
  comparePassword,
};
