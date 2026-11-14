/**
 * @file src/modules/projects/projects.schemas.ts
 * @description Zod validation schemas and inferred TypeScript types for Projects.
 *
 * Implements SRS v3.0 §6.2 (CHECK constraints on ProjectMember role),
 * OpenAPI 3.1 ProjectStatus / Priority specifications, and G-03 date fields.
 */

import { z } from "zod";

// ============================================================================
// 1. DOMAIN ENUMS & CONSTRAINTS
// ============================================================================

/**
 * Frozen project member roles matching PostgreSQL CHECK constraint:
 * `project_members_role_check CHECK (role IN ('Manager', 'Contributor', 'Viewer'))`.
 */
export const PROJECT_ROLES = ["Manager", "Contributor", "Viewer"] as const;

/**
 * Zod schema validating a project member role.
 */
export const ProjectRoleSchema = z.enum(PROJECT_ROLES);

/**
 * OpenAPI ProjectStatus enumeration (Zod-only validation, no DB CHECK constraint).
 */
export const PROJECT_STATUSES = [
  "Active",
  "OnHold",
  "Completed",
  "Archived",
] as const;

/**
 * Zod schema validating project lifecycle status.
 */
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);

/**
 * OpenAPI Priority enumeration (ALL CAPS).
 */
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * Zod schema validating project priority.
 */
export const PrioritySchema = z.enum(PRIORITIES);

// ============================================================================
// 2. DATE TRANSFORMER
// ============================================================================

/**
 * Parses and transforms ISO-8601 date strings with offset into JavaScript Date instances.
 */
const isoDateTransform = z
  .string()
  .datetime({ offset: true, message: "Must be ISO-8601 with offset" })
  .transform((v) => new Date(v))
  .nullable()
  .optional();

// ============================================================================
// 3. ROUTE PARAMETER SCHEMAS
// ============================================================================

/**
 * Validates the `:projectId` route parameter as a UUID.
 */
export const ProjectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
});

/**
 * Validates the `:projectId` and `:userId` route parameters for project member routes.
 */
export const ProjectMemberParamSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
  userId: z.string().uuid("Invalid user ID format"),
});

// ============================================================================
// 4. QUERY & REQUEST SCHEMAS
// ============================================================================

/**
 * Validates pagination and filter query parameters for listing projects.
 */
export const ListProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  teamId: z.string().uuid().optional(),
  status: ProjectStatusSchema.optional(),
  priority: PrioritySchema.optional(),
});

/**
 * Validates request body for creating a new project (`POST /api/v1/projects`).
 */
export const CreateProjectRequestSchema = z
  .object({
    teamId: z.string().uuid("Invalid team ID format"),
    title: z.string().trim().min(1, "Title is required").max(150),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: PrioritySchema.optional(),
    startDate: isoDateTransform,
    endDate: isoDateTransform,
    deadline: isoDateTransform,
  })
  .strict();

/**
 * Validates request body for updating project metadata (`PATCH /api/v1/projects/:projectId`).
 * Requires at least one field to be supplied.
 */
export const UpdateProjectRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    priority: PrioritySchema.optional(),
    startDate: isoDateTransform,
    endDate: isoDateTransform,
    deadline: isoDateTransform,
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.startDate !== undefined ||
      data.endDate !== undefined ||
      data.deadline !== undefined,
    { message: "At least one field must be provided" },
  );

/**
 * Validates request body for adding a user to a project (`POST /api/v1/projects/:projectId/members`).
 */
export const AddProjectMemberRequestSchema = z
  .object({
    userId: z.string().uuid("Invalid user ID format"),
    role: ProjectRoleSchema.default("Contributor"),
  })
  .strict();

/**
 * Validates request body for updating a project member's role (`PATCH /api/v1/projects/:projectId/members/:userId`).
 */
export const UpdateProjectMemberRoleRequestSchema = z
  .object({
    role: ProjectRoleSchema,
  })
  .strict();

// ============================================================================
// 5. INFERRED TYPES
// ============================================================================

/** Project membership role (`"Manager"` | `"Contributor"` | `"Viewer"`). */
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

/** Project lifecycle status (`"Active"` | `"OnHold"` | `"Completed"` | `"Archived"`). */
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Project priority level (`"LOW"` | `"MEDIUM"` | `"HIGH"` | `"CRITICAL"`). */
export type Priority = z.infer<typeof PrioritySchema>;

/** Validated `:projectId` parameter payload. */
export type ProjectIdParam = z.infer<typeof ProjectIdParamSchema>;

/** Validated `:projectId` and `:userId` parameter payload. */
export type ProjectMemberParam = z.infer<typeof ProjectMemberParamSchema>;

/** Validated query parameters for listing projects. */
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

/** Validated payload for creating a project. */
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/** Validated payload for updating project metadata. */
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

/** Validated payload for adding a project member. */
export type AddProjectMemberRequest = z.infer<typeof AddProjectMemberRequestSchema>;

/** Validated payload for updating a project member's role. */
export type UpdateProjectMemberRoleRequest = z.infer<
  typeof UpdateProjectMemberRoleRequestSchema
>;
