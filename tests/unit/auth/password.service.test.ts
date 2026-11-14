/**
 * @file tests/unit/auth/password.service.test.ts
 * @description Unit tests for passwordService (bcryptjs hashing, salt cost, and verification).
 *
 * Constraints: Pure unit tests. No DB, no Redis, no app boot.
 */

import { describe, it, expect } from "vitest";
import {
  passwordService,
  hashPassword,
  comparePassword,
} from "../../../src/modules/auth/password.service.js";
import { env } from "../../../src/config/env.js";

describe("passwordService.hashPassword", () => {
  it("hashes a plain password and returns a valid bcrypt string", async () => {
    const hash = await hashPassword("Test@1234");

    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);
  });

  it("uses cost factor >= 12 matching env.BCRYPT_SALT_ROUNDS", async () => {
    const hash = await hashPassword("Any@Password1");
    const costMatch = hash.match(/^\$2[ab]\$(\d{2})\$/);

    expect(costMatch).not.toBeNull();
    expect(costMatch?.[1]).toBeDefined();
    const cost = parseInt(costMatch![1] as string, 10);

    expect(cost).toBeGreaterThanOrEqual(12);
    expect(cost).toBe(env.BCRYPT_SALT_ROUNDS);
  });

  it("produces different hashes for the same plaintext password due to random salting", async () => {
    const h1 = await hashPassword("Same@Password1");
    const h2 = await hashPassword("Same@Password1");

    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^\$2[ab]\$\d{2}\$/);
    expect(h2).toMatch(/^\$2[ab]\$\d{2}\$/);
  });
});

describe("passwordService.comparePassword", () => {
  it("returns true for matching password and hash", async () => {
    const hash = await hashPassword("Correct@1234");
    const isMatch = await comparePassword("Correct@1234", hash);

    expect(isMatch).toBe(true);
  });

  it("returns false for non-matching password", async () => {
    const hash = await hashPassword("Correct@1234");
    const isMatch = await comparePassword("Wrong@1234", hash);

    expect(isMatch).toBe(false);
  });

  it("returns false for empty password string", async () => {
    const hash = await hashPassword("Correct@1234");
    const isMatch = await comparePassword("", hash);

    expect(isMatch).toBe(false);
  });

  /**
   * Verified runtime behavior:
   * bcryptjs.compare("any", "") resolves to Promise<false> when given an empty hash string;
   * it does not throw an exception.
   */
  it("returns false when comparing against an empty hash", async () => {
    const isMatch = await comparePassword("Any@1234", "");
    expect(isMatch).toBe(false);
  });

  it("exports matching methods on the passwordService singleton object", async () => {
    const hash = await passwordService.hashPassword("Service@1234");
    expect(await passwordService.comparePassword("Service@1234", hash)).toBe(true);
  });
});
