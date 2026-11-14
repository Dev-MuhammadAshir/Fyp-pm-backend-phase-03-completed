/**
 * @file src/modules/teams/teams.routes.ts
 * @description Express routes for the Teams module.
 *
 * Middleware order: authenticate (applied to all routes) → per-route
 * authorization (authorize or requireTeamMember) → per-route validation
 * (validate with zod schemas) → controller handler.
 *
 * Authorization model (SRS §4.2, CA-05, FR-AUTH-12, FR-TEAM-03):
 *   - POST /teams               → Admin only (CA-05)
 *   - GET  /teams               → any authenticated (service filters by role)
 *   - GET  /teams/:id           → team member or Admin (requireTeamMember)
 *   - PATCH /teams/:id          → Admin or PM (TEAM_MANAGE_MEMBERS umbrella, E-005)
 *   - DELETE /teams/:id         → Admin only
 *   - GET  /teams/:id/members   → team member or Admin (requireTeamMember)
 *   - POST /teams/:id/members   → Admin or PM
 *   - DELETE /teams/:id/members/:userId → Admin or PM
 *
 * Realtime: NO events emitted in this chunk (D4 — team membership
 * changes are audit-only, per Phase 3 decision).
 */

import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { authorize } from "../../core/middleware/authorize.js";
import { requireTeamMember } from "../../core/middleware/requireTeamMember.js";
import { validate } from "../../core/middleware/validate.js";
import { teamsController } from "./teams.controller.js";
import {
  CreateTeamRequestSchema,
  UpdateTeamRequestSchema,
  AddTeamMemberRequestSchema,
  TeamIdParamSchema,
  TeamMemberParamSchema,
  ListTeamsQuerySchema,
} from "./teams.schemas.js";

export const teamsRouter = Router();

// All team routes require authentication
teamsRouter.use(authenticate);

// POST /api/v1/teams — create (Admin-only per CA-05 / FR-AUTH-12)
teamsRouter.post(
  "/",
  authorize("Administrator"),
  validate({ body: CreateTeamRequestSchema }),
  teamsController.create,
);

// GET /api/v1/teams — list (any authenticated; service filters by role)
teamsRouter.get(
  "/",
  validate({ query: ListTeamsQuerySchema }),
  teamsController.list,
);

// GET /api/v1/teams/:teamId — get one (member-only; admin bypasses)
teamsRouter.get(
  "/:teamId",
  requireTeamMember,
  teamsController.getById,
);

// PATCH /api/v1/teams/:teamId — update (Admin + PM)
// Errata E-005: TEAM_MANAGE_MEMBERS semantic umbrella. The SRS App A
// matrix grants "manage team members" to Admin + PM only; no separate
// TEAM_UPDATE permission exists. Route comment cites E-005.
teamsRouter.patch(
  "/:teamId",
  authorize("Administrator", "Project Manager"),
  validate({ params: TeamIdParamSchema, body: UpdateTeamRequestSchema }),
  teamsController.update,
);

// DELETE /api/v1/teams/:teamId — hard delete (Admin-only; cascades)
teamsRouter.delete(
  "/:teamId",
  authorize("Administrator"),
  validate({ params: TeamIdParamSchema }),
  teamsController.delete,
);

// GET /api/v1/teams/:teamId/members — list members (member-only; admin bypasses)
teamsRouter.get(
  "/:teamId/members",
  requireTeamMember,
  teamsController.listMembers,
);

// POST /api/v1/teams/:teamId/members — add member (Admin + PM)
teamsRouter.post(
  "/:teamId/members",
  authorize("Administrator", "Project Manager"),
  validate({
    params: TeamIdParamSchema,
    body: AddTeamMemberRequestSchema,
  }),
  teamsController.addMember,
);

// DELETE /api/v1/teams/:teamId/members/:userId — remove member (Admin + PM)
teamsRouter.delete(
  "/:teamId/members/:userId",
  authorize("Administrator", "Project Manager"),
  validate({ params: TeamMemberParamSchema }),
  teamsController.removeMember,
);
