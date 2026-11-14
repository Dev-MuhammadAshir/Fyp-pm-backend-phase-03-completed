/**
 * @file src/modules/auth/auth.routes.ts
 * @description Express router for authentication and self-service profile endpoints.
 *
 * MOUNT PATH: /api/v1/auth (configured in src/routes/v1.ts)
 */

import { Router } from "express";
import { validate } from "../../core/middleware/validate.js";
import { authenticate } from "../../core/middleware/authenticate.js";
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  UpdateProfileRequestSchema,
  ChangePasswordRequestSchema,
} from "./auth.schemas.js";
import { authController } from "./auth.controller.js";

export const authRouter = Router();

// ============================================================================
// Public Endpoints
// ============================================================================

authRouter.post(
  "/login",
  validate({ body: LoginRequestSchema }),
  authController.login,
);

authRouter.post(
  "/refresh",
  validate({ body: RefreshRequestSchema }),
  authController.refresh,
);

/**
 * Errata E-007: Logout accepts refreshToken in body and does not require
 * authenticate middleware so expired access tokens do not prevent session cleanup.
 */
authRouter.post(
  "/logout",
  validate({ body: LogoutRequestSchema }),
  authController.logout,
);

// ============================================================================
// Authenticated Endpoints
// ============================================================================

authRouter.get(
  "/me",
  authenticate,
  authController.me,
);

authRouter.patch(
  "/me",
  authenticate,
  validate({ body: UpdateProfileRequestSchema }),
  authController.updateProfile,
);

authRouter.patch(
  "/password",
  authenticate,
  validate({ body: ChangePasswordRequestSchema }),
  authController.changePassword,
);
