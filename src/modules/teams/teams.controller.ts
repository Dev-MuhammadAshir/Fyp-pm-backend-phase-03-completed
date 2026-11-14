/**
 * @file src/modules/teams/teams.controller.ts
 * @description HTTP controller for Teams endpoints.
 *
 * Thin adapter: reads from req, delegates to teamsService, writes via
 * sendSuccess/sendPaginated. All errors bubbling from service are forwarded
 * to the Express error handler via next(err).
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess, sendPaginated } from "../../core/responses/index.js";
import {
  teamsService,
  type ServiceContext,
} from "./teams.service.js";
import type {
  ListTeamsQuery,
  CreateTeamRequest,
  UpdateTeamRequest,
  AddTeamMemberRequest,
} from "./teams.schemas.js";

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
 * Controller handlers for Teams endpoints.
 */
export const teamsController = {
  /**
   * POST /api/v1/teams — create a new team (Admin-only).
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as CreateTeamRequest;
      const data = await teamsService.create(input, buildContext(req));
      sendSuccess(res, data, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/teams — list visible teams (service filters by role).
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ListTeamsQuery;
      const result = await teamsService.list(query, buildContext(req));
      sendPaginated(res, result.rows, result.meta);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/teams/:teamId — get one team (member-only; admin bypasses).
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      const data = await teamsService.getById(teamId);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/teams/:teamId — update team metadata (Admin + PM; E-005).
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      const input = req.body as UpdateTeamRequest;
      const data = await teamsService.update(teamId, input, buildContext(req));
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/teams/:teamId — hard delete (Admin-only; cascades members + projects).
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      await teamsService.delete(teamId, buildContext(req));
      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/teams/:teamId/members — list members (member-only; admin bypasses).
   */
  async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      const data = await teamsService.listMembers(teamId);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/teams/:teamId/members — add member (Admin + PM).
   */
  async addMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      const input = req.body as AddTeamMemberRequest;
      const data = await teamsService.addMember(
        teamId,
        input,
        buildContext(req),
      );
      sendSuccess(res, data, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/teams/:teamId/members/:userId — remove member (Admin + PM).
   */
  async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const teamId = req.params.teamId!;
      const userId = req.params.userId!;
      await teamsService.removeMember(teamId, userId, buildContext(req));
      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  },
};
