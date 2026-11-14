/**
 * @file src/core/middleware/requireProjectMember.ts
 * @description Express authorization middleware verifying project membership.
 *
 * ARCHITECTURAL DESIGN:
 * Per SRS §4.2 precedence-1 ("Administrator accesses any project"),
 * callers with globalRole === "Administrator" bypass the project_members lookup.
 * Even with bypass, the middleware verifies that the target project exists
 * (throwing 404 PROJECT_NOT_FOUND if missing) and attaches
 * `req.projectContext = { projectId, projectRole: "Manager", teamId: project.teamId }`.
 *
 * Non-Administrator callers require an existing row in `project_members` for `:projectId`;
 * otherwise the middleware throws HTTP 403 `AUTHZ_NOT_PROJECT_MEMBER`.
 *
 * Preconditions:
 * - Must run AFTER `authenticate` middleware (`req.user` is populated).
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/codes.js";

/**
 * Project membership context attached to `req.projectContext` after verification.
 */
export interface ProjectRequestContext {
  projectId: string;
  projectRole: "Manager" | "Contributor" | "Viewer";
  teamId: string;
}

declare global {
  namespace Express {
    interface Request {
      projectContext?: ProjectRequestContext;
    }
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express middleware enforcing that `req.user` is either an Administrator
 * or an active member of the project specified by `req.params.projectId`.
 */
export async function requireProjectMember(
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

    const projectId = req.params.projectId;
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !UUID_REGEX.test(projectId)
    ) {
      throw new AppError(
        "Invalid project ID format",
        422,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Admin bypass (SRS §4.2 precedence-1). Still verify the project exists.
    if (req.user.globalRole === "Administrator") {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      });
      if (!project) {
        throw new AppError(
          "Project not found",
          404,
          ERROR_CODES.PROJECT_NOT_FOUND,
        );
      }
      req.projectContext = {
        projectId,
        projectRole: "Manager",
        teamId: project.teamId,
      };
      next();
      return;
    }

    // Non-admin: fetch project + membership in one query.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        teamId: true,
        members: {
          where: { userId: req.user.id },
          select: { role: true },
          take: 1,
        },
      },
    });

    if (!project) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    const membership = project.members[0];
    if (!membership) {
      throw new AppError(
        "You are not a member of this project",
        403,
        ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER,
      );
    }

    req.projectContext = {
      projectId,
      projectRole: membership.role as "Manager" | "Contributor" | "Viewer",
      teamId: project.teamId,
    };

    next();
  } catch (err: unknown) {
    next(err);
  }
}
