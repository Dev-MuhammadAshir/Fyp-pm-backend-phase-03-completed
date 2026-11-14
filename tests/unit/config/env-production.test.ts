import { describe, it, expect } from "vitest";
import { envSchema } from "../../../src/config/env.js";

const baseValid = {
  NODE_ENV: "production" as const,
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET:
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2",
  JWT_REFRESH_SECRET:
    "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2",
};

describe("envSchema production secret enforcement (SEC-01)", () => {
  it("rejects dev_jwt prefixed JWT_ACCESS_SECRET in production", () => {
    const result = envSchema.safeParse({
      ...baseValid,
      JWT_ACCESS_SECRET:
        "dev_jwt_access_secret_key_minimum_32_characters_long_12345",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message).join(" | ");
      expect(msgs).toMatch(/JWT_ACCESS_SECRET.*development default/i);
    }
  });

  it("rejects dev_jwt prefixed JWT_REFRESH_SECRET in production", () => {
    const result = envSchema.safeParse({
      ...baseValid,
      JWT_REFRESH_SECRET:
        "dev_jwt_refresh_secret_key_minimum_32_characters_long_12345",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message).join(" | ");
      expect(msgs).toMatch(/JWT_REFRESH_SECRET.*development default/i);
    }
  });

  it("rejects identical access and refresh secrets in production", () => {
    const same = baseValid.JWT_ACCESS_SECRET;
    const result = envSchema.safeParse({
      ...baseValid,
      JWT_REFRESH_SECRET: same,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message).join(" | ");
      expect(msgs).toMatch(/must differ/i);
    }
  });

  it("accepts distinct strong secrets in production", () => {
    const result = envSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("allows dev_jwt defaults in development (unchanged dev flow)", () => {
    const result = envSchema.safeParse({
      ...baseValid,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET:
        "dev_jwt_access_secret_key_minimum_32_characters_long_12345",
      JWT_REFRESH_SECRET:
        "dev_jwt_refresh_secret_key_minimum_32_characters_long_12345",
    });
    expect(result.success).toBe(true);
  });
});
