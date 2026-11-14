/**
 * @file src/modules/teams/teams.service.ts
 * @description Business logic and transactional orchestration for Team
 * management and Team membership operations.
 *
 * Implements SRS v3.0 §4.2 (RBAC scope: Administrators see all teams;
 * non-Administrators see only teams of which they are members), §6.2
 * (`team_members.role` strictly `'Admin-Assigned' | 'Member'`), and CA-12
 * (transactional append-only audit logs with correlationId on every mutation).
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";
import { logger } from "../../core/logger/index.js";
import type { PaginationMeta } from "../../core/responses/index.js";
import {
  teamsRepository,
  type ListTeamsVisibility,
  type TeamMemberWithUser,
  type TeamRole,
  type TeamWithCount,
} from "./teams.repository.js";
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  ListTeamsQuery,
  UpdateTeamRequest,
} from "./teams.schemas.js";

export type { PaginationMeta };

/**
 * Actor and request-tracing metadata supplied to team service operations.
 */
export interface ServiceContext {
  actorId: string;
  actorGlobalRole: string;
  correlationId?: string;
}

/**
 * Public Team representation returned by the Teams API.
 */
export interface TeamDTO {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

/**
 * Public TeamMember representation including safe user profile projection.
 */
export interface TeamMemberDTO {
  teamId: string;
  userId: string;
  role: TeamRole;
  assignedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

/**
 * Paginated result returned by `teamsService.list`.
 */
export interface ListTeamsResult {
  rows: TeamDTO[];
  meta: PaginationMeta;
}

/**
 * Transforms an internal `TeamWithCount` record into a public `TeamDTO`.
 */
function toTeamDTO(team: TeamWithCount): TeamDTO {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    memberCount: team._count.members,
    createdAt: team.createdAt.toISOString(),
  };
}

/**
 * Transforms an internal `TeamMemberWithUser` record into a public `TeamMemberDTO`.
 */
function toTeamMemberDTO(member: TeamMemberWithUser): TeamMemberDTO {
  const role: TeamRole =
    member.role === "Admin-Assigned" ? "Admin-Assigned" : "Member";

  return {
    teamId: member.teamId,
    userId: member.userId,
    role,
    assignedAt: member.assignedAt.toISOString(),
    user: {
      id: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
      globalRole: member.user.globalRole,
    },
  };
}

/**
 * Lists teams visible to the caller with pagination and optional name search.
 * Administrators see all teams; all other roles see only teams they belong to.
 */
export async function list(
  query: ListTeamsQuery,
  ctx: ServiceContext,
): Promise<ListTeamsResult> {
  const visibility: ListTeamsVisibility =
    ctx.actorGlobalRole === "Administrator"
      ? { scope: "ALL" }
      : { scope: "MEMBER_ONLY", userId: ctx.actorId };

  const { rows, total } = await teamsRepository.list(query, visibility);
  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    rows: rows.map(toTeamDTO),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
    },
  };
}

/**
 * Retrieves a single team by UUID.
 */
export async function getById(teamId: string): Promise<TeamDTO> {
  const team = await teamsRepository.findById(teamId);
  if (!team) {
    throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
  }
  return toTeamDTO(team);
}

/**
 * Creates a new team, enrolls the creating actor as an `"Admin-Assigned"` member,
 * and records two transactional audit entries (`Team` + `TeamMember`).
 */
export async function create(
  input: CreateTeamRequest,
  ctx: ServiceContext,
): Promise<TeamDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  const createdTeam = await prisma.$transaction(async (tx) => {
    const existing = await teamsRepository.findByName(input.name, tx);
    if (existing) {
      throw new AppError(
        "A team with this name already exists",
        409,
        ERROR_CODES.TEAM_ALREADY_EXISTS,
      );
    }

    const created = await teamsRepository.create(
      {
        name: input.name,
        description: input.description ?? null,
      },
      tx,
    );

    const creatorMembership = await teamsRepository.addMember(
      {
        teamId: created.id,
        userId: ctx.actorId,
        role: "Admin-Assigned",
        assignedBy: ctx.actorId,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Team",
        entityId: created.id,
        action: "CREATE",
        oldValues: {},
        newValues: {
          id: created.id,
          name: created.name,
          description: created.description,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "TeamMember",
        entityId: created.id,
        action: "CREATE",
        oldValues: {},
        newValues: {
          teamId: creatorMembership.teamId,
          userId: creatorMembership.userId,
          role: creatorMembership.role,
          assignedBy: creatorMembership.assignedBy,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });

    const refreshed = await teamsRepository.findById(created.id, tx);
    if (!refreshed) {
      logger.error(
        { teamId: created.id, correlationId },
        "Created team could not be reloaded inside transaction",
      );
      throw new AppError(
        "Failed to load created team",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }

    return refreshed;
  });

  return toTeamDTO(createdTeam);
}

/**
 * Updates a team's mutable metadata (`name`, `description`) with uniqueness
 * enforcement and transactional diff audit logging. Skips DB write and audit
 * entry if the submitted fields match current state (no-op).
 */
export async function update(
  teamId: string,
  input: UpdateTeamRequest,
  ctx: ServiceContext,
): Promise<TeamDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  const updatedTeam = await prisma.$transaction(async (tx) => {
    const before = await teamsRepository.findById(teamId, tx);
    if (!before) {
      throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
    }

    if (input.name !== undefined) {
      const existing = await teamsRepository.findByName(input.name, tx);
      if (existing && existing.id !== teamId) {
        throw new AppError(
          "A team with this name already exists",
          409,
          ERROR_CODES.TEAM_ALREADY_EXISTS,
        );
      }
    }

    const oldValues: Record<string, Prisma.InputJsonValue | null> = {};
    const newValues: Record<string, Prisma.InputJsonValue | null> = {};
    const updatePayload: { name?: string; description?: string | null } = {};

    if (input.name !== undefined && input.name !== before.name) {
      oldValues.name = before.name;
      newValues.name = input.name;
      updatePayload.name = input.name;
    }

    if (
      input.description !== undefined &&
      input.description !== before.description
    ) {
      oldValues.description = before.description;
      newValues.description = input.description;
      updatePayload.description = input.description;
    }

    if (Object.keys(newValues).length === 0) {
      return before;
    }

    await teamsRepository.update(teamId, updatePayload, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Team",
        entityId: teamId,
        action: "UPDATE",
        oldValues: oldValues as Prisma.InputJsonObject,
        newValues: newValues as Prisma.InputJsonObject,
        correlationId,
      },
    });

    const refreshed = await teamsRepository.findById(teamId, tx);
    if (!refreshed) {
      logger.error(
        { teamId, correlationId },
        "Updated team could not be reloaded inside transaction",
      );
      throw new AppError(
        "Failed to load updated team",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }

    return refreshed;
  });

  return toTeamDTO(updatedTeam);
}

/**
 * Permanently deletes a team and records a transactional `DELETE` audit row.
 */
export async function deleteTeam(
  teamId: string,
  ctx: ServiceContext,
): Promise<void> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const existing = await teamsRepository.findById(teamId, tx);
    if (!existing) {
      throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
    }

    await teamsRepository.delete(teamId, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Team",
        entityId: teamId,
        action: "DELETE",
        oldValues: {
          id: existing.id,
          name: existing.name,
          description: existing.description,
        } as Prisma.InputJsonObject,
        newValues: {},
        correlationId,
      },
    });
  });
}

/**
 * Lists all members of a team.
 */
export async function listMembers(
  teamId: string,
): Promise<TeamMemberDTO[]> {
  const team = await teamsRepository.findById(teamId);
  if (!team) {
    throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
  }
  const members = await teamsRepository.listMembers(teamId);
  return members.map(toTeamMemberDTO);
}

/**
 * Adds an active user to a team with the specified role (`"Admin-Assigned"` | `"Member"`)
 * and records a transactional `CREATE` audit log entry.
 */
export async function addMember(
  teamId: string,
  input: AddTeamMemberRequest,
  ctx: ServiceContext,
): Promise<TeamMemberDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const team = await teamsRepository.findById(teamId, tx);
    if (!team) {
      throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
    }

    const targetUser = await tx.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!targetUser) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    if (!targetUser.isActive) {
      throw new AppError(
        "Cannot add an inactive user to a team",
        422,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const existingMembership = await teamsRepository.findMember(
      teamId,
      input.userId,
      tx,
    );
    if (existingMembership) {
      throw new AppError(
        "User is already a member of this team",
        409,
        ERROR_CODES.TEAM_MEMBER_ALREADY_EXISTS,
      );
    }

    const created = await teamsRepository.addMember(
      {
        teamId,
        userId: input.userId,
        role: input.role,
        assignedBy: ctx.actorId,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "TeamMember",
        entityId: teamId,
        action: "CREATE",
        oldValues: {},
        newValues: {
          teamId: created.teamId,
          userId: created.userId,
          role: created.role,
          assignedBy: created.assignedBy,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });
  });

  const members = await teamsRepository.listMembers(teamId);
  const added = members.find((member) => member.userId === input.userId);
  if (!added) {
    logger.error(
      { teamId, userId: input.userId, correlationId },
      "Added team member could not be reloaded after transaction commit",
    );
    throw new AppError(
      "Failed to load newly added team member",
      500,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }

  return toTeamMemberDTO(added);
}

/**
 * Removes a user from a team and records a transactional `DELETE` audit log entry.
 */
export async function removeMember(
  teamId: string,
  userId: string,
  ctx: ServiceContext,
): Promise<void> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const team = await teamsRepository.findById(teamId, tx);
    if (!team) {
      throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
    }

    const existing = await teamsRepository.findMember(teamId, userId, tx);
    if (!existing) {
      throw new AppError(
        "Team member not found",
        404,
        ERROR_CODES.TEAM_MEMBER_NOT_FOUND,
      );
    }

    await teamsRepository.removeMember(teamId, userId, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "TeamMember",
        entityId: teamId,
        action: "DELETE",
        oldValues: {
          teamId: existing.teamId,
          userId: existing.userId,
          role: existing.role,
          assignedBy: existing.assignedBy,
        } as Prisma.InputJsonObject,
        newValues: {},
        correlationId,
      },
    });
  });
}

/**
 * Teams domain service singleton.
 */
export const teamsService = {
  list,
  getById,
  create,
  update,
  delete: deleteTeam,
  listMembers,
  addMember,
  removeMember,
};
