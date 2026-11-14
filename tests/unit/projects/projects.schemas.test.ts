/**
 * @file tests/unit/projects/projects.schemas.test.ts
 * @description Unit tests for Projects Zod schemas (Chunk 3C).
 *
 * Pure Zod — no DB, no Redis, no HTTP, no mocks.
 * Tests validation rules: required fields, string bounds, enum
 * membership, date parsing/transform, strict mode, at-least-one-field refine.
 */

import { describe, it, expect } from "vitest";
import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  AddProjectMemberRequestSchema,
  UpdateProjectMemberRoleRequestSchema,
  ProjectIdParamSchema,
  ProjectMemberParamSchema,
  ListProjectsQuerySchema,
} from "../../../src/modules/projects/index.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("CreateProjectRequestSchema", () => {
  it("accepts a valid minimal payload with teamId and title", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "My Project",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamId).toBe(VALID_UUID);
      expect(result.data.title).toBe("My Project");
      expect(result.data.description).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
      expect(result.data.startDate).toBeUndefined();
      expect(result.data.endDate).toBeUndefined();
      expect(result.data.deadline).toBeUndefined();
    }
  });

  it("accepts a valid full payload with all fields populated", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Full Project",
      description: "Project description",
      priority: "HIGH",
      startDate: "2026-06-01T09:00:00Z",
      endDate: "2026-12-01T17:00:00Z",
      deadline: "2026-12-31T23:59:59Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Full Project");
      expect(result.data.description).toBe("Project description");
      expect(result.data.priority).toBe("HIGH");
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
      expect(result.data.deadline).toBeInstanceOf(Date);
    }
  });

  it("accepts description set to null", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      description: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("accepts priority in enum such as HIGH", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      priority: "HIGH",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("HIGH");
    }
  });

  it("accepts priority omitted and leaves it undefined", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBeUndefined();
    }
  });

  it("accepts startDate as ISO-8601 with Z suffix and transforms to Date", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.startDate?.toISOString()).toBe(
        "2026-06-15T10:00:00.000Z",
      );
    }
  });

  it("accepts startDate with positive offset +05:00 and transforms to Date", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: "2026-06-15T10:00:00+05:00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
    }
  });

  it("accepts startDate set to null", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeNull();
    }
  });

  it("accepts startDate omitted as undefined", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeUndefined();
    }
  });

  it("rejects startDate with date only format lacking time and offset", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: "2026-06-15",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["startDate"]);
    }
  });

  it("rejects startDate lacking timezone offset suffix", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: "2026-06-15T10:00:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["startDate"]);
    }
  });

  it("rejects startDate with arbitrary invalid date string", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      startDate: "not-a-date",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["startDate"]);
    }
  });

  it("rejects invalid teamId that is not a UUID", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: "not-a-uuid",
      title: "Project",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["teamId"]);
    }
  });

  it("rejects missing title field", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects title when empty or whitespace only", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "   ",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects title longer than 150 characters", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "T".repeat(151),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects lowercase priority due to case sensitivity", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      priority: "medium",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["priority"]);
    }
  });

  it("rejects unknown keys due to strict mode", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: VALID_UUID,
      title: "Project",
      unknownKey: "value",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects an unknown status field (strict mode)", () => {
    const result = CreateProjectRequestSchema.safeParse({
      teamId: "550e8400-e29b-41d4-a716-446655440000",
      title: "X",
      status: "Active",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateProjectRequestSchema", () => {
  it("accepts title only", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      title: "Updated Title",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Updated Title");
    }
  });

  it("accepts status only", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      status: "Completed",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("Completed");
    }
  });

  it("accepts priority only", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      priority: "CRITICAL",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("CRITICAL");
    }
  });

  it("accepts startDate only as valid ISO-8601 string", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      startDate: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
    }
  });

  it("accepts all fields together in an update", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      title: "New Title",
      description: "New Desc",
      status: "Active",
      priority: "LOW",
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-06-01T00:00:00Z",
      deadline: "2026-07-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty object because at least one field must be provided", () => {
    const result = UpdateProjectRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys alongside a valid field due to strict mode", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      title: "Valid Title",
      foo: "bar",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects an invalid status not present in ProjectStatus enum", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      status: "Done",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["status"]);
    }
  });

  it("rejects an invalid priority not present in Priority enum", () => {
    const result = UpdateProjectRequestSchema.safeParse({
      priority: "URGENT",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["priority"]);
    }
  });
});

describe("AddProjectMemberRequestSchema", () => {
  it("accepts Manager role", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Manager",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("Manager");
    }
  });

  it("accepts Contributor role", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Contributor",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("Contributor");
    }
  });

  it("accepts Viewer role", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Viewer",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("Viewer");
    }
  });

  it("defaults role to Contributor when omitted", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("Contributor");
    }
  });

  it("rejects invalid role not in ProjectRole enum such as Owner", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      role: "Owner",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects invalid userId string", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: "invalid-user-uuid",
      role: "Contributor",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["userId"]);
    }
  });

  it("rejects unknown keys due to strict mode", () => {
    const result = AddProjectMemberRequestSchema.safeParse({
      userId: VALID_UUID,
      extra: "field",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("UpdateProjectMemberRoleRequestSchema", () => {
  it("accepts a valid Manager role update", () => {
    const result = UpdateProjectMemberRoleRequestSchema.safeParse({
      role: "Manager",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("Manager");
    }
  });

  it("rejects an empty object where role is required", () => {
    const result = UpdateProjectMemberRoleRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects invalid role such as Owner", () => {
    const result = UpdateProjectMemberRoleRequestSchema.safeParse({
      role: "Owner",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects unknown keys due to strict mode", () => {
    const result = UpdateProjectMemberRoleRequestSchema.safeParse({
      role: "Viewer",
      extra: "key",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });
});

describe("ProjectIdParamSchema", () => {
  it("accepts a valid UUID string", () => {
    const result = ProjectIdParamSchema.safeParse({ projectId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectId).toBe(VALID_UUID);
    }
  });

  it("rejects non-UUID string", () => {
    const result = ProjectIdParamSchema.safeParse({ projectId: "abc-123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["projectId"]);
    }
  });
});

describe("ProjectMemberParamSchema", () => {
  it("accepts valid UUIDs for both projectId and userId", () => {
    const result = ProjectMemberParamSchema.safeParse({
      projectId: VALID_UUID,
      userId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectId).toBe(VALID_UUID);
      expect(result.data.userId).toBe(VALID_UUID_2);
    }
  });

  it("rejects invalid projectId", () => {
    const result = ProjectMemberParamSchema.safeParse({
      projectId: "bad-project-id",
      userId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["projectId"]);
    }
  });

  it("rejects invalid userId", () => {
    const result = ProjectMemberParamSchema.safeParse({
      projectId: VALID_UUID,
      userId: "bad-user-id",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["userId"]);
    }
  });
});

describe("ListProjectsQuerySchema", () => {
  it("applies defaults of page 1 and limit 20 when given empty query", () => {
    const result = ListProjectsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.teamId).toBeUndefined();
      expect(result.data.status).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
    }
  });

  it("coerces string representations of page and limit to numbers", () => {
    const result = ListProjectsQuerySchema.safeParse({
      page: "2",
      limit: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
    }
  });

  it("accepts valid status filter e.g. status=Active", () => {
    const result = ListProjectsQuerySchema.safeParse({
      status: "Active",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("Active");
    }
  });

  it("accepts valid priority filter e.g. priority=HIGH", () => {
    const result = ListProjectsQuerySchema.safeParse({
      priority: "HIGH",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("HIGH");
    }
  });

  it("accepts valid teamId filter", () => {
    const result = ListProjectsQuerySchema.safeParse({
      teamId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamId).toBe(VALID_UUID);
    }
  });

  it("rejects invalid status filter e.g. status=Done", () => {
    const result = ListProjectsQuerySchema.safeParse({
      status: "Done",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["status"]);
    }
  });

  it("rejects invalid priority filter e.g. priority=URGENT", () => {
    const result = ListProjectsQuerySchema.safeParse({
      priority: "URGENT",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["priority"]);
    }
  });

  it("rejects invalid teamId that is not a UUID", () => {
    const result = ListProjectsQuerySchema.safeParse({
      teamId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["teamId"]);
    }
  });

  it("rejects page value less than 1 and limit value greater than 100", () => {
    const resultPage = ListProjectsQuerySchema.safeParse({ page: "0" });
    expect(resultPage.success).toBe(false);

    const resultLimit = ListProjectsQuerySchema.safeParse({ limit: "101" });
    expect(resultLimit.success).toBe(false);
  });

  it("rejects non-numeric string for page", () => {
    const result = ListProjectsQuerySchema.safeParse({ page: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["page"]);
    }
  });
});
