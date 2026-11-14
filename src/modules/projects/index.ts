/**
 * @file src/modules/projects/index.ts
 * @description Public barrel surface for the Projects module.
 *
 * NON-NEGOTIABLE RULE:
 * External modules must import from this barrel file, never from deep
 * internal paths.
 *
 * NOTE: projectsController + projectsRouter are NOT included yet —
 * they arrive in Chunk 3D. This barrel will be extended then.
 */

export * from "./projects.schemas.js";

export {
  projectsRepository,
  type ProjectRole,
  type ProjectStatus,
  type Priority,
  type ProjectWithCount,
  type ProjectMemberWithUser,
  type ListProjectsFilters,
  type ListProjectsVisibility,
  type ProjectProgressData,
} from "./projects.repository.js";

export {
  projectsService,
  type ServiceContext,
  type ProjectDTO,
  type ProjectMemberDTO,
  type PaginationMeta,
  type ListProjectsResult,
  type ProjectProgressDTO,
} from "./projects.service.js";

export { projectsController } from "./projects.controller.js";
export { projectsRouter } from "./projects.routes.js";
