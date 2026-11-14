/**
 * @file src/modules/projects/projects.controller.ts
 * @description HTTP controller for Projects endpoints.
 *
 * Delegates to frozen projectsService. Emits `project.updated` (1 site)
 * and `membership.changed` (3 sites) via `emitBestEffort`.
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendPaginated } from "../../core/responses/index.js";
import { logger } from "../../core/logger/index.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";
import { projectsService, type ServiceContext } from "./projects.service.js";
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  AddProjectMemberRequest,
  UpdateProjectMemberRoleRequest,
  ListProjectsQuery,
} from "./projects.schemas.js";
import { publishRealtime } from "../../infra/redis/publisher.js";
import {
  projectRoom,
  REALTIME_EVENTS,
  type RealtimeEventName,
  type ProjectRoomId,
  type UserRoomId,
  type ProjectUpdatedData,
  type MembershipChangedData,
} from "../../../shared/socket.contract.js";

/**
 * Builds the ServiceContext from the authenticated request.
 * Assumes authenticate middleware has run (req.user is set).
 * Uses req.correlationId from Phase 0 requestId middleware.
 */
function buildContext(req: Request): ServiceContext {
  return {
    actorId: req.user!.id,
    actorGlobalRole: req.user!.globalRole,
    correlationId: req.correlationId,
  };
}

/**
 * Best-effort realtime emit. Never throws. Logs a warning on failure.
 * Per R3, publisher.ts logs internally, but we wrap defensively so an
 * unexpected sync throw still can't fail the HTTP response.
 */
async function emitBestEffort<T>(
  event: RealtimeEventName,
  projectId: string | undefined,
  actorId: string,
  data: T,
  rooms: (ProjectRoomId | UserRoomId)[],
): Promise<void> {
  try {
    await publishRealtime(event, projectId, actorId, data, rooms);
  } catch (err: unknown) {
    logger.warn({ err, projectId, event }, "Realtime emit failed (non-fatal)");
  }
}

/**
 * Computes a changes diff over the 7 mutable ProjectDTO fields.
 * Returns an empty object if nothing changed.
 */
function diffProject(
  before: {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    startDate: string | null;
    endDate: string | null;
    deadline: string | null;
  },
  after: {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    startDate: string | null;
    endDate: string | null;
    deadline: string | null;
  },
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  if (before.title !== after.title) changes.title = after.title;
  if (before.description !== after.description)
    changes.description = after.description;
  if (before.status !== after.status) changes.status = after.status;
  if (before.priority !== after.priority) changes.priority = after.priority;
  if (before.startDate !== after.startDate) changes.startDate = after.startDate;
  if (before.endDate !== after.endDate) changes.endDate = after.endDate;
  if (before.deadline !== after.deadline) changes.deadline = after.deadline;
  return changes;
}

/**
 * Controller handlers for Projects endpoints.
 */
export const projectsController = {
  /**
   * POST /api/v1/projects — create a new project (Admin or PM; A4 enforced in service).
   * No realtime emission.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as CreateProjectRequest;
      const data = await projectsService.create(input, buildContext(req));
      sendSuccess(res, data, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/projects — list visible projects (service filters by role).
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListProjectsQuery;
      const result = await projectsService.list(query, buildContext(req));
      sendPaginated(res, result.rows, result.meta);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/projects/:projectId — get one project (member or admin).
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const data = await projectsService.getById(projectId);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/projects/:projectId — update project metadata (Manager+).
   * Emits `project.updated` if changes are detected.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const input = req.body as UpdateProjectRequest;
      const before = await projectsService.getById(projectId);
      const after = await projectsService.update(
        projectId,
        input,
        buildContext(req),
      );
      const changes = diffProject(before, after);
      if (Object.keys(changes).length > 0) {
        const payload: ProjectUpdatedData = {
          projectId,
          changes,
        };
        await emitBestEffort(
          REALTIME_EVENTS.PROJECT_UPDATED,
          projectId,
          req.user!.id,
          payload,
          [projectRoom(projectId)],
        );
      }
      sendSuccess(res, after);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/projects/:projectId — archive project (Manager+).
   * No realtime emission.
   */
  async archive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const data = await projectsService.archive(projectId, buildContext(req));
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/projects/:projectId/members — list project members (member or admin).
   */
  async listMembers(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const data = await projectsService.listMembers(projectId);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/projects/:projectId/members — add member (Manager+).
   * Emits `membership.changed` with action="added".
   */
  async addMember(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const input = req.body as AddProjectMemberRequest;
      const data = await projectsService.addMember(
        projectId,
        input,
        buildContext(req),
      );
      const payload: MembershipChangedData = {
        userId: data.userId,
        role: data.role,
        action: "added",
      };
      await emitBestEffort(
        REALTIME_EVENTS.MEMBERSHIP_CHANGED,
        projectId,
        req.user!.id,
        payload,
        [projectRoom(projectId)],
      );
      sendSuccess(res, data, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/projects/:projectId/members/:userId — update member role (Manager+).
   * Emits `membership.changed` with action="role_updated".
   */
  async updateMemberRole(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const userId = req.params.userId!;
      const input = req.body as UpdateProjectMemberRoleRequest;
      const data = await projectsService.updateMemberRole(
        projectId,
        userId,
        input,
        buildContext(req),
      );
      const payload: MembershipChangedData = {
        userId: data.userId,
        role: data.role,
        action: "role_updated",
      };
      await emitBestEffort(
        REALTIME_EVENTS.MEMBERSHIP_CHANGED,
        projectId,
        req.user!.id,
        payload,
        [projectRoom(projectId)],
      );
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/projects/:projectId/members/:userId — remove member (Manager+).
   * Pre-fetches old role, executes remove, then emits `membership.changed` with action="removed".
   */
  async removeMember(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const userId = req.params.userId!;
      // Pre-fetch to capture old role for payload
      const members = await projectsService.listMembers(projectId);
      const existing = members.find((m) => m.userId === userId);
      if (!existing) {
        throw new AppError(
          "Project member not found",
          404,
          ERROR_CODES.PROJECT_MEMBER_NOT_FOUND,
        );
      }
      const oldRole = existing.role;
      await projectsService.removeMember(projectId, userId, buildContext(req));
      const payload: MembershipChangedData = {
        userId,
        role: oldRole,
        action: "removed",
      };
      await emitBestEffort(
        REALTIME_EVENTS.MEMBERSHIP_CHANGED,
        projectId,
        req.user!.id,
        payload,
        [projectRoom(projectId)],
      );
      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/projects/:projectId/progress — get task progress metrics (member or admin).
   */
  async getProgress(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId = req.params.projectId!;
      const data = await projectsService.getProgress(projectId);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },
};
