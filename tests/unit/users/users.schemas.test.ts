/**
 * @file tests/unit/users/users.schemas.test.ts
 * @description Pure unit tests for Zod validation schemas in users.schemas.ts.
 *
 * Emphasizes verification of the query boolean coercion footgun fix for `isActive`.
 */

import { describe, it, expect } from "vitest";
import {
  ListUsersQuerySchema,
  UserIdParamSchema,
  UpdateUserRoleRequestSchema,
  UpdateUserStatusRequestSchema,
} from "../../../src/modules/users/users.schemas.js";

describe("ListUsersQuerySchema — isActive footgun", () => {
  it("omits isActive and leaves it undefined when not provided in query", () => {
    const parsed = ListUsersQuerySchema.parse({});

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.isActive).toBeUndefined();
  });

  it("transforms query string 'true' to boolean true", () => {
    const parsed = ListUsersQuerySchema.parse({ isActive: "true" });
    expect(parsed.isActive).toBe(true);
  });

  /**
   * CRITICAL FOOTGUN VERIFICATION:
   * In standard Zod, z.coerce.boolean().parse("false") evaluates to true
   * because Boolean("false") === true in JavaScript (any non-empty string is truthy).
   * Our enum + transform implementation guarantees "false" transforms to boolean false.
   */
  it("transforms query string 'false' to boolean false (prevents Zod coercion footgun)", () => {
    const parsed = ListUsersQuerySchema.parse({ isActive: "false" });
    expect(parsed.isActive).toBe(false);
  });

  it("rejects non-boolean string values like 'abc'", () => {
    expect(() => ListUsersQuerySchema.parse({ isActive: "abc" })).toThrow();
  });

  it("rejects numeric representations like '0' or '1'", () => {
    expect(() => ListUsersQuerySchema.parse({ isActive: "0" })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ isActive: "1" })).toThrow();
  });

  it("rejects empty string query parameter", () => {
    expect(() => ListUsersQuerySchema.parse({ isActive: "" })).toThrow();
  });
});

describe("ListUsersQuerySchema — pagination and limits", () => {
  it("applies default pagination values (page=1, limit=20)", () => {
    const parsed = ListUsersQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it("accepts valid custom numeric pagination values", () => {
    const parsed = ListUsersQuerySchema.parse({ page: 3, limit: 50 });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
  });

  it("coerces string representations of numbers to integers", () => {
    const parsed = ListUsersQuerySchema.parse({ page: "5", limit: "25" });
    expect(parsed.page).toBe(5);
    expect(parsed.limit).toBe(25);
  });

  it("rejects page values less than 1", () => {
    expect(() => ListUsersQuerySchema.parse({ page: 0 })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ page: -1 })).toThrow();
  });

  it("rejects limit values less than 1 or greater than 100", () => {
    expect(() => ListUsersQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects non-numeric page or limit strings", () => {
    expect(() => ListUsersQuerySchema.parse({ page: "first" })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ limit: "all" })).toThrow();
  });
});

describe("ListUsersQuerySchema — search and role filters", () => {
  it("accepts an optional valid role filter", () => {
    const parsed = ListUsersQuerySchema.parse({ role: "Administrator" });
    expect(parsed.role).toBe("Administrator");
  });

  it("rejects invalid role filters not in the frozen GlobalRole enum", () => {
    expect(() => ListUsersQuerySchema.parse({ role: "Owner" })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ role: "SuperAdmin" })).toThrow();
  });

  it("accepts and trims an optional search string", () => {
    const parsed = ListUsersQuerySchema.parse({ search: "  alice  " });
    expect(parsed.search).toBe("alice");
  });

  it("rejects empty search string", () => {
    expect(() => ListUsersQuerySchema.parse({ search: "" })).toThrow();
  });
});

describe("UserIdParamSchema", () => {
  it("accepts a valid UUID v4 format", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    const parsed = UserIdParamSchema.parse({ userId: validUuid });

    expect(parsed.userId).toBe(validUuid);
  });

  it("rejects non-UUID strings", () => {
    expect(() => UserIdParamSchema.parse({ userId: "not-a-uuid" })).toThrow();
    expect(() => UserIdParamSchema.parse({ userId: "12345" })).toThrow();
  });

  it("rejects empty or missing userId", () => {
    expect(() => UserIdParamSchema.parse({ userId: "" })).toThrow();
    expect(() => UserIdParamSchema.parse({})).toThrow();
  });
});

describe("UpdateUserRoleRequestSchema", () => {
  it("accepts all 4 valid global roles", () => {
    const roles = ["Administrator", "Project Manager", "Team Member", "Viewer"] as const;
    for (const role of roles) {
      expect(UpdateUserRoleRequestSchema.parse({ globalRole: role }).globalRole).toBe(role);
    }
  });

  it("rejects invalid role values", () => {
    expect(() => UpdateUserRoleRequestSchema.parse({ globalRole: "Admin" })).toThrow();
    expect(() => UpdateUserRoleRequestSchema.parse({ globalRole: "Maintainer" })).toThrow();
  });

  it("rejects missing globalRole", () => {
    expect(() => UpdateUserRoleRequestSchema.parse({})).toThrow();
  });
});

describe("UpdateUserStatusRequestSchema", () => {
  it("accepts boolean isActive true and false", () => {
    expect(UpdateUserStatusRequestSchema.parse({ isActive: true }).isActive).toBe(true);
    expect(UpdateUserStatusRequestSchema.parse({ isActive: false }).isActive).toBe(false);
  });

  it("rejects non-boolean isActive types", () => {
    expect(() => UpdateUserStatusRequestSchema.parse({ isActive: "true" })).toThrow();
    expect(() => UpdateUserStatusRequestSchema.parse({ isActive: 1 })).toThrow();
  });

  it("rejects missing isActive property", () => {
    expect(() => UpdateUserStatusRequestSchema.parse({})).toThrow();
  });
});
