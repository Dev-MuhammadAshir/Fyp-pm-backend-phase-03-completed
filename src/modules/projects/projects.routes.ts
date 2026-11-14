/**
 * @file src/modules/projects/projects.routes.ts
 * @description Express routes for the Projects module.
 *
 * Authorization chain (SRS §4.2):
 *   - Single-gate routes: authenticate only (POST /projects, GET /projects
 *     rely on service-level filtering for visibility).
 *   - Membership-gated reads: authenticate → requireProjectMember.
 *   - Manager-gated mutations: authenticate → authorize(Admin, PM) →
 *     requireProjectMember → requireProjectManager.
 *
 * Realtime (D4 + project.updated in-scope):
 *   - PATCH /projects/:id emits `project.updated` (diff from controller).
 *   - POST/PATCH/DELETE member routes emit `membership.changed`.
 *   - POST /projects and DELETE /projects/:id (archive) emit nothing.
 */

import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { authorize } from "../../core/middleware/authorize.js";
import { requireProjectMember } from "../../core/middleware/requireProjectMember.js";
import { requireProjectManager } from "../../core/middleware/requireProjectManager.js";
import { validate } from "../../core/middleware/validate.js";
import { projectsController } from "./projects.controller.js";
import {
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  AddProjectMemberRequestSchema,
  UpdateProjectMemberRoleRequestSchema,
  ProjectIdParamSchema,
  ProjectMemberParamSchema,
  ListProjectsQuerySchema,
} from "./projects.schemas.js";

export const projectsRouter = Router();
projectsRouter.use(authenticate);

// #1 — create (Admin or PM; A4 checked in service)
projectsRouter.post(
  "/",
  authorize("Administrator", "Project Manager"),
  validate({ body: CreateProjectRequestSchema }),
  projectsController.create,
);

// #2 — list (any authenticated; service filters by role)
projectsRouter.get(
  "/",
  validate({ query: ListProjectsQuerySchema }),
  projectsController.list,
);

// #8 — change role (Manager+; emits membership.changed / role_updated)
projectsRouter.patch(
  "/:projectId/members/:userId",
  authorize("Administrator", "Project Manager"),
  requireProjectMember,
  requireProjectManager,
  validate({
    params: ProjectMemberParamSchema,
    body: UpdateProjectMemberRoleRequestSchema,
  }),
  projectsController.updateMemberRole,
);

// #9 — remove member (Manager+; emits membership.changed / removed)
projectsRouter.delete(
  "/:projectId/members/:userId",
  authorize("Administrator", "Project Manager"),
  requireProjectMember,
  requireProjectManager,
  validate({ params: ProjectMemberParamSchema }),
  projectsController.removeMember,
);

// #6 — list members (member or admin)
projectsRouter.get(
  "/:projectId/members",
  requireProjectMember,
  projectsController.listMembers,
);

// #7 — add member (Manager+; emits membership.changed / added)
projectsRouter.post(
  "/:projectId/members",
  authorize("Administrator", "Project Manager"),
  requireProjectMember,
  requireProjectManager,
  validate({
    params: ProjectIdParamSchema,
    body: AddProjectMemberRequestSchema,
  }),
  projectsController.addMember,
);

// #10 — progress (member or admin)
projectsRouter.get(
  "/:projectId/progress",
  requireProjectMember,
  projectsController.getProgress,
);

// #3 — get one (member or admin)
projectsRouter.get(
  "/:projectId",
  requireProjectMember,
  projectsController.getById,
);

// #4 — update (Manager+; emits project.updated)
projectsRouter.patch(
  "/:projectId",
  authorize("Administrator", "Project Manager"),
  requireProjectMember,
  requireProjectManager,
  validate({ params: ProjectIdParamSchema, body: UpdateProjectRequestSchema }),
  projectsController.update,
);

// #5 — archive (Manager+; no realtime)
projectsRouter.delete(
  "/:projectId",
  authorize("Administrator", "Project Manager"),
  requireProjectMember,
  requireProjectManager,
  validate({ params: ProjectIdParamSchema }),
  projectsController.archive,
);
