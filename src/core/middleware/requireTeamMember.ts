/**
 * @file src/core/middleware/requireTeamMember.ts
 * @description Express authorization middleware verifying team membership.
 *
 * ARCHITECTURAL DESIGN:
 * Per SRS v3.0 §4.2 precedence-1 ("Administrator accesses any resource"),
 * callers with globalRole === "Administrator" bypass the team_members lookup
 * and receive `teamContext = { teamId, teamRole: "Admin-Assigned" }`.
 * All non-Administrator callers must hold a row in `team_members` for `:teamId`;
 * otherwise the middleware throws HTTP 403 `AUTHZ_NOT_TEAM_MEMBER`.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/codes.js";

/**
 * Team membership context attached to `req.teamContext` after verification.
 */
export interface TeamRequestContext {
  teamId: string;
  teamRole: "Admin-Assigned" | "Member";
}

declare global {
  namespace Express {
    interface Request {
      teamContext?: TeamRequestContext;
    }
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express middleware enforcing that `req.user` is either an Administrator
 * or a member of the team specified by `req.params.teamId`.
 */
export async function requireTeamMember(
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

    const teamId = req.params.teamId;
    if (!teamId || typeof teamId !== "string" || !UUID_REGEX.test(teamId)) {
      throw new AppError(
        "Invalid team ID format",
        422,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (req.user.globalRole === "Administrator") {
      req.teamContext = {
        teamId,
        teamRole: "Admin-Assigned",
      };
      next();
      return;
    }

    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: req.user.id,
        },
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      throw new AppError(
        "You are not a member of this team",
        403,
        ERROR_CODES.AUTHZ_NOT_TEAM_MEMBER,
      );
    }

    req.teamContext = {
      teamId,
      teamRole:
        membership.role === "Admin-Assigned" ? "Admin-Assigned" : "Member",
    };

    next();
  } catch (err: unknown) {
    next(err);
  }
}
