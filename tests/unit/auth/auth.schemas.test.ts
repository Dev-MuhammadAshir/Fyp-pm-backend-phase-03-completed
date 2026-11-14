/**
 * @file tests/unit/auth/auth.schemas.test.ts
 * @description Pure unit tests for Zod validation schemas in auth.schemas.ts.
 *
 * Constraints:
 * - Pure schema validation only.
 * - Zero service, repository, or database imports.
 */

import { describe, it, expect } from "vitest";
import {
  PasswordPolicySchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  ChangePasswordRequestSchema,
  CreateUserRequestSchema,
  UpdateProfileRequestSchema,
  UpdateUserRoleRequestSchema,
  UpdateUserStatusRequestSchema,
  GLOBAL_ROLES,
} from "../../../src/modules/auth/auth.schemas.js";

describe("PasswordPolicySchema", () => {
  it("accepts a standard compliant password", () => {
    const valid = "Test@1234";
    expect(PasswordPolicySchema.parse(valid)).toBe(valid);
  });

  it("accepts a password with exactly 8 characters meeting all rules", () => {
    const valid8 = "Aa1!aaaa";
    expect(valid8).toHaveLength(8);
    expect(PasswordPolicySchema.parse(valid8)).toBe(valid8);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(() => PasswordPolicySchema.parse("Ab1!")).toThrow();
  });

  it("rejects passwords missing an uppercase character", () => {
    expect(() => PasswordPolicySchema.parse("test@1234")).toThrow();
  });

  it("rejects passwords missing a lowercase character", () => {
    expect(() => PasswordPolicySchema.parse("TEST@1234")).toThrow();
  });

  it("rejects passwords missing a digit", () => {
    expect(() => PasswordPolicySchema.parse("Test@abcd")).toThrow();
  });

  it("rejects passwords missing a special character", () => {
    expect(() => PasswordPolicySchema.parse("Test1234")).toThrow();
  });

  it("rejects passwords longer than 72 characters (bcrypt limit)", () => {
    const tooLong = "Aa1!" + "a".repeat(70); // 74 chars total
    expect(() => PasswordPolicySchema.parse(tooLong)).toThrow();
  });

  it("accepts passwords exactly 72 characters long", () => {
    const exactly72 = "Aa1!" + "a".repeat(68); // 72 chars
    expect(exactly72).toHaveLength(72);
    expect(PasswordPolicySchema.parse(exactly72)).toBe(exactly72);
  });
});

describe("LoginRequestSchema", () => {
  it("accepts valid email and single-character password", () => {
    const parsed = LoginRequestSchema.parse({
      email: "user@fyp.local",
      password: "x",
    });

    expect(parsed.email).toBe("user@fyp.local");
    expect(parsed.password).toBe("x");
  });

  it("trims surrounding whitespace from email address", () => {
    const parsed = LoginRequestSchema.parse({
      email: "  spaced@fyp.local  ",
      password: "validPassword",
    });

    expect(parsed.email).toBe("spaced@fyp.local");
  });

  it("rejects invalid email formats", () => {
    expect(() =>
      LoginRequestSchema.parse({ email: "not-an-email", password: "password" }),
    ).toThrow();
  });

  it("rejects empty password on login", () => {
    expect(() =>
      LoginRequestSchema.parse({ email: "user@fyp.local", password: "" }),
    ).toThrow();
  });

  it("rejects missing email or missing password", () => {
    expect(() => LoginRequestSchema.parse({ email: "user@fyp.local" })).toThrow();
    expect(() => LoginRequestSchema.parse({ password: "pass" })).toThrow();
  });
});

describe("LogoutRequestSchema", () => {
  it("accepts refreshToken with at least 32 characters per Errata E-007", () => {
    const validToken = "a".repeat(32);
    const parsed = LogoutRequestSchema.parse({ refreshToken: validToken });

    expect(parsed.refreshToken).toBe(validToken);
  });

  it("rejects refreshToken with fewer than 32 characters", () => {
    expect(() =>
      LogoutRequestSchema.parse({ refreshToken: "short-token" }),
    ).toThrow();
  });

  it("rejects missing refreshToken", () => {
    expect(() => LogoutRequestSchema.parse({})).toThrow();
  });
});

describe("ChangePasswordRequestSchema", () => {
  it("accepts valid current password and compliant new password", () => {
    const input = {
      currentPassword: "OldPassword1!",
      newPassword: "NewPassword1!",
    };
    const parsed = ChangePasswordRequestSchema.parse(input);

    expect(parsed).toEqual(input);
  });

  it("rejects a new password that violates password policy", () => {
    expect(() =>
      ChangePasswordRequestSchema.parse({
        currentPassword: "OldPassword1!",
        newPassword: "weak",
      }),
    ).toThrow();
  });

  it("rejects missing currentPassword or missing newPassword", () => {
    expect(() =>
      ChangePasswordRequestSchema.parse({ newPassword: "NewPassword1!" }),
    ).toThrow();
    expect(() =>
      ChangePasswordRequestSchema.parse({ currentPassword: "OldPassword1!" }),
    ).toThrow();
  });
});

describe("CreateUserRequestSchema", () => {
  it("accepts a fully specified valid user request", () => {
    const input = {
      email: "newuser@fyp.local",
      password: "Complex@1234",
      fullName: "Jane Doe",
      globalRole: "Project Manager",
      configuredCapacityHours: 35,
    };
    const parsed = CreateUserRequestSchema.parse(input);

    expect(parsed.email).toBe(input.email);
    expect(parsed.configuredCapacityHours).toBe(35);
  });

  it("allows configuredCapacityHours to be omitted", () => {
    const input = {
      email: "defaultcap@fyp.local",
      password: "Complex@1234",
      fullName: "Default Cap",
      globalRole: "Team Member",
    };
    const parsed = CreateUserRequestSchema.parse(input);

    expect(parsed.email).toBe(input.email);
    expect(parsed.configuredCapacityHours).toBeUndefined();
  });

  it("rejects configuredCapacityHours less than 10 or greater than 80", () => {
    const base = {
      email: "user@fyp.local",
      password: "Complex@1234",
      fullName: "Jane Doe",
      globalRole: "Team Member",
    };

    expect(() =>
      CreateUserRequestSchema.parse({ ...base, configuredCapacityHours: 9 }),
    ).toThrow();
    expect(() =>
      CreateUserRequestSchema.parse({ ...base, configuredCapacityHours: 81 }),
    ).toThrow();
  });

  it("rejects invalid global roles", () => {
    expect(() =>
      CreateUserRequestSchema.parse({
        email: "user@fyp.local",
        password: "Complex@1234",
        fullName: "Jane Doe",
        globalRole: "Admin", // Must be "Administrator"
      }),
    ).toThrow();
  });

  it("rejects empty fullName", () => {
    expect(() =>
      CreateUserRequestSchema.parse({
        email: "user@fyp.local",
        password: "Complex@1234",
        fullName: "   ",
        globalRole: "Team Member",
      }),
    ).toThrow();
  });
});

describe("UpdateProfileRequestSchema", () => {
  it("accepts fullName only", () => {
    const parsed = UpdateProfileRequestSchema.parse({ fullName: "New Name" });
    expect(parsed.fullName).toBe("New Name");
    expect(parsed.configuredCapacityHours).toBeUndefined();
  });

  it("accepts configuredCapacityHours only", () => {
    const parsed = UpdateProfileRequestSchema.parse({ configuredCapacityHours: 20 });
    expect(parsed.configuredCapacityHours).toBe(20);
    expect(parsed.fullName).toBeUndefined();
  });

  it("accepts both fullName and configuredCapacityHours", () => {
    const parsed = UpdateProfileRequestSchema.parse({
      fullName: "Full Name",
      configuredCapacityHours: 50,
    });
    expect(parsed.fullName).toBe("Full Name");
    expect(parsed.configuredCapacityHours).toBe(50);
  });

  it("rejects unknown extra fields due to strict mode", () => {
    expect(() =>
      UpdateProfileRequestSchema.parse({
        fullName: "Name",
        unknownProp: "illegal",
      }),
    ).toThrow();
  });

  it("rejects configuredCapacityHours outside the 10-80 range", () => {
    expect(() =>
      UpdateProfileRequestSchema.parse({ configuredCapacityHours: 5 }),
    ).toThrow();
    expect(() =>
      UpdateProfileRequestSchema.parse({ configuredCapacityHours: 85 }),
    ).toThrow();
  });
});

describe("UpdateUserRoleRequestSchema", () => {
  it("accepts all 4 frozen global roles", () => {
    for (const role of GLOBAL_ROLES) {
      const parsed = UpdateUserRoleRequestSchema.parse({ globalRole: role });
      expect(parsed.globalRole).toBe(role);
    }
  });

  it("rejects unauthorized roles such as Owner or Superuser", () => {
    expect(() =>
      UpdateUserRoleRequestSchema.parse({ globalRole: "Owner" }),
    ).toThrow();
    expect(() =>
      UpdateUserRoleRequestSchema.parse({ globalRole: "Superuser" }),
    ).toThrow();
  });

  it("rejects case mismatch like lowercase admin", () => {
    expect(() =>
      UpdateUserRoleRequestSchema.parse({ globalRole: "administrator" }),
    ).toThrow();
  });
});

describe("UpdateUserStatusRequestSchema", () => {
  it("accepts boolean true and false", () => {
    expect(UpdateUserStatusRequestSchema.parse({ isActive: true }).isActive).toBe(true);
    expect(UpdateUserStatusRequestSchema.parse({ isActive: false }).isActive).toBe(false);
  });

  it("rejects string 'true' or 'false' because strict boolean is required", () => {
    expect(() =>
      UpdateUserStatusRequestSchema.parse({ isActive: "true" }),
    ).toThrow();
    expect(() =>
      UpdateUserStatusRequestSchema.parse({ isActive: "false" }),
    ).toThrow();
  });

  it("rejects missing isActive property", () => {
    expect(() => UpdateUserStatusRequestSchema.parse({})).toThrow();
  });
});
