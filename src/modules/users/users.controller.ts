/**
 * @file src/modules/users/users.controller.ts
 * @description Express controller handlers for User administration and RBAC endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendPaginated } from "../../core/responses/index.js";
import { usersService } from "./users.service.js";
import type {
  ListUsersQuery,
  CreateUserRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
} from "./users.schemas.js";

/**
 * Lists users with pagination and optional search/filters.
 * GET /api/v1/users
 */
export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = req.query as unknown as ListUsersQuery;
    const { users, meta } = await usersService.list(query);
    sendPaginated(res, users, meta, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Retrieves a user by ID.
 * GET /api/v1/users/:userId
 */
export async function getById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };
    const user = await usersService.getById(
      userId,
      req.user!.id,
      req.user!.globalRole,
    );
    sendSuccess(res, user, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Provisions a new user.
 * POST /api/v1/users
 */
export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as CreateUserRequest;
    const user = await usersService.create(body, {
      actorId: req.user!.id,
      actorRole: req.user!.globalRole,
      correlationId: req.correlationId,
    });
    sendSuccess(res, user, 201);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Updates a user's global role.
 * PATCH /api/v1/users/:userId/role
 */
export async function updateRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };
    const body = req.body as UpdateUserRoleRequest;
    const user = await usersService.updateRole(userId, body, {
      actorId: req.user!.id,
      actorRole: req.user!.globalRole,
      correlationId: req.correlationId,
    });
    sendSuccess(res, user, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Updates a user's active/inactive status.
 * PATCH /api/v1/users/:userId/status
 */
export async function updateStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId } = req.params as { userId: string };
    const body = req.body as UpdateUserStatusRequest;
    const user = await usersService.updateStatus(userId, body, {
      actorId: req.user!.id,
      actorRole: req.user!.globalRole,
      correlationId: req.correlationId,
    });
    sendSuccess(res, user, 200);
  } catch (err: unknown) {
    next(err);
  }
}

export const usersController = {
  list,
  getById,
  create,
  updateRole,
  updateStatus,
};
