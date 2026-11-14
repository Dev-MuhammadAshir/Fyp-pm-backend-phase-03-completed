/**
 * @file src/modules/teams/index.ts
 * @description Public barrel surface for the Teams module.
 *
 * NON-NEGOTIABLE RULE:
 * External modules must import from this barrel file, never from deep internal paths.
 */

export * from "./teams.schemas.js";
export {
  teamsRepository,
  type TeamWithCount,
  type TeamMemberWithUser,
  type ListTeamsFilters,
  type ListTeamsVisibility,
} from "./teams.repository.js";
export {
  teamsService,
  type ServiceContext,
  type TeamDTO,
  type TeamMemberDTO,
  type PaginationMeta,
  type ListTeamsResult,
} from "./teams.service.js";
export { teamsController } from "./teams.controller.js";
export { teamsRouter } from "./teams.routes.js";
