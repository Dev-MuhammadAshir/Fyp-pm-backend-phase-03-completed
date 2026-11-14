/**
 * @file src/modules/users/users.schemas.ts
 * @description Zod validation schemas and inferred types for User management and RBAC admin operations.
 *
 * Implements SRS v3.0 §4.2 (Global Roles & User Directory) and OpenAPI 3.1 specifications.
 */

import { z } from "zod";
import {
  GlobalRoleSchema,
  GlobalRole,
  CreateUserRequestSchema,
  CreateUserRequest,
  UserResponseSchema,
  UserResponse,
} from "../auth/index.js";

// ============================================================================
// 1. ROUTE PARAMETER SCHEMAS
// ============================================================================

export const UserIdParamSchema = z.object({
  userId: z.string().uuid("Invalid user ID format"),
});

// ============================================================================
// 2. QUERY & REQUEST SCHEMAS
// ============================================================================

/**
 * Zod Footgun Precaution:
 * Do NOT use z.coerce.boolean() because in JavaScript/Zod,
 * Boolean("false") evaluates to true (any non-empty string is truthy).
 * Instead, we use an enum of ['true', 'false'] and transform it to boolean,
 * returning 422 VALIDATION_ERROR on any invalid value (e.g. ?isActive=abc).
 */
export const ListUsersQuerySchema = z.object({
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
  search: z.string().trim().min(1, "Search cannot be empty").optional(),
  role: GlobalRoleSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const UpdateUserRoleRequestSchema = z.object({
  globalRole: GlobalRoleSchema,
});

export const UpdateUserStatusRequestSchema = z.object({
  isActive: z.boolean({
    required_error: "isActive is required",
    invalid_type_error: "isActive must be a boolean",
  }),
});

// ============================================================================
// 3. RE-EXPORTS FROM AUTH MODULE
// ============================================================================

export {
  GlobalRoleSchema,
  CreateUserRequestSchema,
  UserResponseSchema,
};

export type {
  GlobalRole,
  CreateUserRequest,
  UserResponse,
};

// ============================================================================
// 4. INFERRED TYPES
// ============================================================================

export type UserIdParam = z.infer<typeof UserIdParamSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;
