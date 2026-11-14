/**
 * @file tests/unit/teams/teams.schemas.test.ts
 * @description Unit tests for Teams Zod schemas (Chunk 3A).
 *
 * Pure Zod — no DB, no Redis, no HTTP, no mocks.
 * Tests validation rules: required fields, string bounds, enum
 * membership, strict mode, at-least-one-field refine.
 */

import { describe, it, expect } from "vitest";
import {
  CreateTeamRequestSchema,
  UpdateTeamRequestSchema,
  AddTeamMemberRequestSchema,
  TeamIdParamSchema,
  TeamMemberParamSchema,
  ListTeamsQuerySchema,
} from "../../../src/modules/teams/index.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("CreateTeamRequestSchema", () => {
  it("accepts a valid minimal payload with name only", () => {
    const result = CreateTeamRequestSchema.safeParse({ name: "Core Team" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Core Team");
      expect(result.data.description).toBeUndefined();
    }
  });

  it("accepts a valid payload with name and description", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Core Team",
      description: "Core engineering team",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Core Team");
      expect(result.data.description).toBe("Core engineering team");
    }
  });

  it("accepts description set to null", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Core Team",
      description: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("accepts description omitted (undefined)", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Core Team",
      description: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });

  it("rejects an empty object where name is required", () => {
    const result = CreateTeamRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects an empty name string", () => {
    const result = CreateTeamRequestSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects a name consisting only of whitespace", () => {
    const result = CreateTeamRequestSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("accepts a name with exactly 100 characters", () => {
    const result = CreateTeamRequestSchema.safeParse({ name: "A".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects a name longer than 100 characters", () => {
    const result = CreateTeamRequestSchema.safeParse({ name: "A".repeat(101) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("accepts a description with exactly 2000 characters", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Valid Team",
      description: "D".repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description longer than 2000 characters", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Valid Team",
      description: "D".repeat(2001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["description"]);
    }
  });

  it("rejects unknown keys due to strict mode", () => {
    const result = CreateTeamRequestSchema.safeParse({
      name: "Valid Team",
      foo: "bar",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("UpdateTeamRequestSchema", () => {
  it("accepts name only", () => {
    const result = UpdateTeamRequestSchema.safeParse({ name: "Updated Name" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Updated Name");
      expect(result.data.description).toBeUndefined();
    }
  });

  it("accepts description only", () => {
    const result = UpdateTeamRequestSchema.safeParse({
      description: "Updated description",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Updated description");
      expect(result.data.name).toBeUndefined();
    }
  });

  it("accepts description set to null only", () => {
    const result = UpdateTeamRequestSchema.safeParse({ description: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("accepts both name and description together", () => {
    const result = UpdateTeamRequestSchema.safeParse({
      name: "Updated Name",
      description: "Updated description",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Updated Name");
      expect(result.data.description).toBe("Updated description");
    }
  });

  it("rejects an empty object because at least one field must be provided", () => {
    const result = UpdateTeamRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys alongside a valid field due to strict mode", () => {
    const result = UpdateTeamRequestSchema.safeParse({
      name: "Valid Name",
      foo: "bar",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects an empty name string after trim", () => {
    const result = UpdateTeamRequestSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects a name longer than 100 characters", () => {
    const result = UpdateTeamRequestSchema.safeParse({ name: "A".repeat(101) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects a description longer than 2000 characters", () => {
    const result = UpdateTeamRequestSchema.safeParse({
      description: "D".repeat(2001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["description"]);
    }
  });
});

describe("AddTeamMemberRequestSchema", () => {
  it("accepts a valid payload with Admin-Assigned role", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Admin-Assigned",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(VALID_UUID);
      expect(result.data.role).toBe("Admin-Assigned");
    }
  });

  it("accepts a valid payload with Member role", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Member",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(VALID_UUID);
      expect(result.data.role).toBe("Member");
    }
  });

  it("defaults role to Member when role is omitted", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(VALID_UUID);
      expect(result.data.role).toBe("Member");
    }
  });

  it("rejects an invalid role not in the enum such as Owner", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Owner",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects role with incorrect casing such as admin-assigned", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "admin-assigned",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects non-UUID userId string", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: "not-a-valid-uuid",
      role: "Member",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["userId"]);
    }
  });

  it("rejects unknown keys due to strict mode", () => {
    const result = AddTeamMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Member",
      extra: "field",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("TeamIdParamSchema", () => {
  it("accepts a valid UUID string", () => {
    const result = TeamIdParamSchema.safeParse({ teamId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamId).toBe(VALID_UUID);
    }
  });

  it("rejects a non-UUID string", () => {
    const result = TeamIdParamSchema.safeParse({ teamId: "123-abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["teamId"]);
    }
  });
});

describe("TeamMemberParamSchema", () => {
  it("accepts valid UUIDs for both teamId and userId", () => {
    const result = TeamMemberParamSchema.safeParse({
      teamId: VALID_UUID,
      userId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamId).toBe(VALID_UUID);
      expect(result.data.userId).toBe(VALID_UUID_2);
    }
  });

  it("rejects an invalid teamId", () => {
    const result = TeamMemberParamSchema.safeParse({
      teamId: "invalid-team",
      userId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["teamId"]);
    }
  });

  it("rejects an invalid userId", () => {
    const result = TeamMemberParamSchema.safeParse({
      teamId: VALID_UUID,
      userId: "invalid-user",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["userId"]);
    }
  });
});

describe("ListTeamsQuerySchema", () => {
  it("applies defaults of page 1 and limit 20 when given an empty query", () => {
    const result = ListTeamsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.search).toBeUndefined();
    }
  });

  it("coerces string representations of page and limit to numbers", () => {
    const result = ListTeamsQuerySchema.safeParse({
      page: "3",
      limit: "50",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects an empty string for search as invalid", () => {
    const result = ListTeamsQuerySchema.safeParse({ search: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["search"]);
    }
  });

  it("accepts a valid search string of non-empty content", () => {
    const result = ListTeamsQuerySchema.safeParse({ search: "Alpha" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("Alpha");
    }
  });

  it("accepts a search string with exactly 100 characters", () => {
    const result = ListTeamsQuerySchema.safeParse({ search: "s".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects a search string longer than 100 characters", () => {
    const result = ListTeamsQuerySchema.safeParse({ search: "s".repeat(101) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["search"]);
    }
  });

  it("rejects page value less than 1", () => {
    const result = ListTeamsQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["page"]);
    }
  });

  it("rejects limit value greater than 100", () => {
    const result = ListTeamsQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["limit"]);
    }
  });

  it("rejects non-numeric string for page", () => {
    const result = ListTeamsQuerySchema.safeParse({ page: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["page"]);
    }
  });
});
