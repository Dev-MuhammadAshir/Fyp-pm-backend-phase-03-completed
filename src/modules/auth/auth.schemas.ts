/**
 * @file src/modules/auth/auth.schemas.ts
 * @description Zod validation schemas and inferred TypeScript types for authentication,
 * session management, and user administration.
 *
 * Implements SRS v3.0 §4.1 (Password policy & validation), §4.2 (Global Roles),
 * and Errata E-007 (Logout request payload).
 */

import { z } from "zod";

// ============================================================================
// 1. DOMAIN ENUMS & VALUE CONSTRAINTS
// ============================================================================

export const GLOBAL_ROLES = [
  "Administrator",
  "Project Manager",
  "Team Member",
  "Viewer",
] as const;

export const GlobalRoleSchema = z.enum(GLOBAL_ROLES);
export type GlobalRole = z.infer<typeof GlobalRoleSchema>;

/**
 * SRS §4.1 password policy + bcrypt algorithm limit.
 *
 * Minimum 8 chars, at least one uppercase, lowercase, digit, special.
 * Maximum 72 chars — bcrypt truncates input at 72 bytes; longer
 * passwords would silently collide at hash level (audit SEC-10).
 * Enforcing .max(72) at API boundary fails fast and prevents CPU
 * exhaustion via extremely long inputs.
 */
export const PasswordPolicySchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .max(
    72,
    "Password must be 72 characters or fewer (bcrypt algorithm limit)",
  )
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one digit")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

// ============================================================================
// 2. REQUEST SCHEMAS
// ============================================================================

/**
 * Login Request: min(1) password so login does not leak password policy rules.
 */
export const LoginRequestSchema = z.object({
  email: z.string().trim().email("Invalid email address format"),
  password: z.string().min(1, "Password is required"),
});

export const RefreshRequestSchema = z.object({
  refreshToken: z
    .string()
    .min(32, "Refresh token must be at least 32 characters long"),
});

/**
 * Errata E-007: Logout accepts refreshToken in body; does not require
 * an active or valid access token.
 */
export const LogoutRequestSchema = z.object({
  refreshToken: z
    .string()
    .min(32, "Refresh token must be at least 32 characters long"),
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: PasswordPolicySchema,
});

export const UpdateProfileRequestSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Full name cannot be empty")
      .max(100, "Full name cannot exceed 100 characters")
      .optional(),
    configuredCapacityHours: z
      .number()
      .int("Capacity must be an integer")
      .min(10, "Configured capacity must be at least 10 hours")
      .max(80, "Configured capacity cannot exceed 80 hours")
      .optional(),
  })
  .strict();

export const CreateUserRequestSchema = z.object({
  email: z.string().trim().email("Invalid email address format"),
  password: PasswordPolicySchema,
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Full name cannot exceed 100 characters"),
  globalRole: GlobalRoleSchema,
  configuredCapacityHours: z
    .number()
    .int("Capacity must be an integer")
    .min(10, "Configured capacity must be at least 10 hours")
    .max(80, "Configured capacity cannot exceed 80 hours")
    .default(40)
    .optional(),
});

export const UpdateUserRoleRequestSchema = z.object({
  globalRole: GlobalRoleSchema,
});

export const UpdateUserStatusRequestSchema = z.object({
  isActive: z.boolean(),
});

// ============================================================================
// 3. RESPONSE SCHEMAS
// ============================================================================

export const TokenPairResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

/**
 * Public User Response: Sensitive fields (e.g. passwordHash) are omitted.
 */
export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  globalRole: GlobalRoleSchema,
  configuredCapacityHours: z.number().int(),
  isActive: z.boolean(),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

// ============================================================================
// 4. INFERRED TYPES
// ============================================================================

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;
export type TokenPairResponse = z.infer<typeof TokenPairResponseSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
