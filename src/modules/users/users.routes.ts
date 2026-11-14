/**
 * @file src/modules/users/users.routes.ts
 * @description Express routing definition for User directory and administration endpoints.
 *
 * Implements SRS v3.0 §4.2 (Global Roles & RBAC Matrix).
 */

import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { authorize } from "../../core/middleware/authorize.js";
import { validate } from "../../core/middleware/validate.js";
import { usersController } from "./users.controller.js";
import {
  ListUsersQuerySchema,
  CreateUserRequestSchema,
  UserIdParamSchema,
  UpdateUserRoleRequestSchema,
  UpdateUserStatusRequestSchema,
} from "./users.schemas.js";

export const usersRouter = Router();

/**
 * GET /api/v1/users
 * Lists users with optional pagination, filters, and search.
 * Restricted to Administrator.
 */
usersRouter.get(
  "/",
  authenticate,
  authorize("Administrator"),
  validate({ query: ListUsersQuerySchema }),
  usersController.list,
);

/**
 * POST /api/v1/users
 * Provisions a new user account.
 * Restricted to Administrator.
 */
usersRouter.post(
  "/",
  authenticate,
  authorize("Administrator"),
  validate({ body: CreateUserRequestSchema }),
  usersController.create,
);

/**
 * GET /api/v1/users/:userId
 * Retrieves user details by ID.
 * Allowed for Administrator or self (checked in service).
 */
usersRouter.get(
  "/:userId",
  authenticate,
  validate({ params: UserIdParamSchema }),
  usersController.getById,
);

/**
 * PATCH /api/v1/users/:userId/role
 * Updates a user's global role.
 * Restricted to Administrator.
 */
usersRouter.patch(
  "/:userId/role",
  authenticate,
  authorize("Administrator"),
  validate({
    params: UserIdParamSchema,
    body: UpdateUserRoleRequestSchema,
  }),
  usersController.updateRole,
);

/**
 * PATCH /api/v1/users/:userId/status
 * Updates a user's active/inactive status.
 * Restricted to Administrator.
 */
usersRouter.patch(
  "/:userId/status",
  authenticate,
  authorize("Administrator"),
  validate({
    params: UserIdParamSchema,
    body: UpdateUserStatusRequestSchema,
  }),
  usersController.updateStatus,
);
