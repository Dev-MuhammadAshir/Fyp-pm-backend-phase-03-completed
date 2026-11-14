/**
 * @file src/modules/auth/auth.controller.ts
 * @description Express controllers for authentication and session endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../../core/responses/index.js";
import { authService } from "./auth.service.js";

/**
 * Handles user login with credentials.
 * POST /api/v1/auth/login
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.login(req.body, {
      correlationId: req.correlationId,
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });

    sendSuccess(res, result, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles refresh token rotation.
 * POST /api/v1/auth/refresh
 */
export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    sendSuccess(res, result, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles user logout.
 * POST /api/v1/auth/logout
 */
export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.logout(
      req.body.refreshToken,
      req.header("authorization"),
    );
    sendSuccess(res, null, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Retrieves the profile of the currently authenticated user.
 * GET /api/v1/auth/me
 */
export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.getMe(req.user!.id);
    sendSuccess(res, user, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Updates self-service profile attributes.
 * PATCH /api/v1/auth/me
 */
export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const updated = await authService.updateProfile(req.user!.id, req.body, {
      correlationId: req.correlationId,
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    sendSuccess(res, updated, 200);
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Updates user password and revokes active sessions.
 * PATCH /api/v1/auth/password
 */
export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.changePassword(
      req.user!.id,
      req.body,
      req.user!.jti,
      {
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.header("user-agent"),
      },
      req.header("authorization"),
    );
    sendSuccess(res, null, 200);
  } catch (err: unknown) {
    next(err);
  }
}

export const authController = {
  login,
  refresh,
  logout,
  me,
  updateProfile,
  changePassword,
};
