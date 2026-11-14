/**
 * @file src/modules/teams/teams.schemas.ts
 * @description Zod validation schemas and inferred types for Team management
 * and Team membership operations.
 *
 * Implements SRS v3.0 §6.2 (`teams`, `team_members` CHECK constraints) and
 * OpenAPI 3.1 contract specifications.
 */

import { z } from "zod";

// ============================================================================
// 1. DOMAIN ENUMS & CONSTRAINTS
// ============================================================================

/**
 * Frozen team membership roles matching PostgreSQL CHECK constraint:
 * `team_members_role_check CHECK (role IN ('Admin-Assigned', 'Member'))`.
 */
export const TEAM_ROLES = ["Admin-Assigned", "Member"] as const;

/**
 * Zod schema validating a team member role (`"Admin-Assigned"` | `"Member"`).
 */
export const TeamRoleSchema = z.enum(TEAM_ROLES);

// ============================================================================
// 2. ROUTE PARAMETER SCHEMAS
// ============================================================================

/**
 * Validates the `:teamId` route parameter as a UUID.
 */
export const TeamIdParamSchema = z.object({
  teamId: z.string().uuid("Invalid team ID format"),
});

/**
 * Validates the `:teamId` and `:userId` route parameters for team member routes.
 */
export const TeamMemberParamSchema = z.object({
  teamId: z.string().uuid("Invalid team ID format"),
  userId: z.string().uuid("Invalid user ID format"),
});

// ============================================================================
// 3. QUERY & REQUEST SCHEMAS
// ============================================================================

/**
 * Validates pagination and search query parameters for listing teams.
 */
export const ListTeamsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int("Page must be an integer")
    .min(1, "Page must be at least 1")
    .default(1),
  limit: z.coerce
    .number()
    .int("Limit must be an integer")
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(20),
  search: z
    .string()
    .trim()
    .min(1, "Search cannot be empty")
    .max(100, "Search cannot exceed 100 characters")
    .optional(),
});

/**
 * Validates request body for creating a new team (`POST /api/v1/teams`).
 */
export const CreateTeamRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Team name is required")
      .max(100, "Team name cannot exceed 100 characters"),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .nullable()
      .optional(),
  })
  .strict();

/**
 * Validates request body for updating a team (`PATCH /api/v1/teams/:teamId`).
 * At least one of `name` or `description` must be provided.
 */
export const UpdateTeamRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Team name cannot be empty")
      .max(100, "Team name cannot exceed 100 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "At least one field (name or description) must be provided",
  });

/**
 * Validates request body for adding a user to a team
 * (`POST /api/v1/teams/:teamId/members`).
 */
export const AddTeamMemberRequestSchema = z
  .object({
    userId: z.string().uuid("Invalid user ID format"),
    role: TeamRoleSchema.default("Member"),
  })
  .strict();

// ============================================================================
// 4. INFERRED TYPES
// ============================================================================

/** Team membership role (`"Admin-Assigned"` | `"Member"`). */
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/** Validated `:teamId` parameter payload. */
export type TeamIdParam = z.infer<typeof TeamIdParamSchema>;

/** Validated `:teamId` and `:userId` parameter payload. */
export type TeamMemberParam = z.infer<typeof TeamMemberParamSchema>;

/** Validated query parameters for listing teams. */
export type ListTeamsQuery = z.infer<typeof ListTeamsQuerySchema>;

/** Validated payload for creating a team. */
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

/** Validated payload for updating a team. */
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>;

/** Validated payload for adding a team member. */
export type AddTeamMemberRequest = z.infer<typeof AddTeamMemberRequestSchema>;
