/**
 * @file src/core/middleware/requireProjectManager.ts
 * @description Express middleware enforcing Manager project-role refinement.
 *
 * SRS §4.2 authorization chain step 5 (Resource-Level Authorization).
 * Reads `req.projectContext.projectRole` — set by `requireProjectMember`.
 * Rejects non-Manager roles with 403 AUTHZ_FORBIDDEN.
 *
 * Administrator bypass is already handled by `requireProjectMember`
 * (sets projectRole="Manager" for admins). So this middleware does NOT
 * check global role.
 *
 * Must run AFTER `requireProjectMember`.
 *
 * Three-gate chain used by 5 routes: PATCH/DELETE /projects/:id,
 * POST/PATCH/DELETE /projects/:id/members[/:userId].
 */

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/codes.js";

/**
 * Express middleware checking that the caller holds the Manager role on the project.
 */
export async function requireProjectManager(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(
        "Authentication required",
        401,
        ERROR_CODES.UNAUTHORIZED,
      );
    }
    if (!req.projectContext) {
      // Programmer error: route chain missing requireProjectMember.
      throw new AppError(
        "Internal authorization configuration error",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }
    if (req.projectContext.projectRole !== "Manager") {
      throw new AppError(
        "Manager role required on this project",
        403,
        ERROR_CODES.AUTHZ_FORBIDDEN,
      );
    }
    next();
  } catch (err: unknown) {
    next(err);
  }
}
