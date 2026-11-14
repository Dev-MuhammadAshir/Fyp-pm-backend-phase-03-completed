/**
 * @file src/core/middleware/authorize.ts
 * @description Role-based authorization middleware (RBAC).
 *
 * ARCHITECTURAL DESIGN:
 * Pure role gate with NO Administrator auto-bypass.
 * SRS §4.2 precedence-1 "Administrator accesses any project" applies to
 * project membership scope, NOT to endpoint-level RBAC gates. Routes that allow
 * admin access must declare "Administrator" explicitly in allowedRoles.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/codes.js";

export type GlobalRole =
  | "Administrator"
  | "Project Manager"
  | "Team Member"
  | "Viewer";

/**
 * Creates an authorization middleware restricting endpoint access to specific global roles.
 *
 * @param allowedRoles Array of global roles permitted to access the route
 * @returns Express RequestHandler
 */
export function authorize(...allowedRoles: GlobalRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(
        "Authentication required",
        401,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    if (!allowedRoles.includes(req.user.globalRole)) {
      throw new AppError(
        "Insufficient permissions to access this resource",
        403,
        ERROR_CODES.AUTHZ_FORBIDDEN,
      );
    }

    next();
  };
}
