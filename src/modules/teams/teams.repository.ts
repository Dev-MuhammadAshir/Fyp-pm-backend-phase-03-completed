/**
 * @file src/modules/teams/teams.repository.ts
 * @description Data-access layer for Team and TeamMember persistence.
 *
 * ARCHITECTURAL DESIGN:
 * Follows the repository pattern with optional `Prisma.TransactionClient`
 * propagation so every mutation executes atomically inside `prisma.$transaction`.
 */

import type { Prisma, Team, TeamMember } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import type { TeamRole } from "./teams.schemas.js";

export type { TeamRole };

/**
 * Team entity bundled with its active member count aggregate.
 */
export interface TeamWithCount extends Team {
  _count: {
    members: number;
  };
}

/**
 * TeamMember entity bundled with safe public user summary fields
 * (explicitly excluding passwordHash and lock/attempt metadata).
 */
export interface TeamMemberWithUser extends TeamMember {
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

/**
 * Pagination and text search parameters for listing teams.
 */
export interface ListTeamsFilters {
  page: number;
  limit: number;
  search?: string;
}

/**
 * Visibility scope derived from actor's global role:
 * - `"ALL"` for Administrators (SRS §4.2 precedence-1 access).
 * - `"MEMBER_ONLY"` for all non-Administrator roles.
 */
export type ListTeamsVisibility =
  | { scope: "ALL" }
  | { scope: "MEMBER_ONLY"; userId: string };

/**
 * Lists teams with pagination, optional case-insensitive name search,
 * and RBAC visibility scoping.
 */
export async function list(
  filters: ListTeamsFilters,
  visibility: ListTeamsVisibility,
  tx?: Prisma.TransactionClient,
): Promise<{ rows: TeamWithCount[]; total: number }> {
  const db = tx ?? prisma;
  const where: Prisma.TeamWhereInput = {};

  if (visibility.scope === "MEMBER_ONLY") {
    where.members = {
      some: {
        userId: visibility.userId,
      },
    };
  }

  if (filters.search) {
    where.name = {
      contains: filters.search,
      mode: "insensitive",
    };
  }

  const skip = (filters.page - 1) * filters.limit;
  const take = filters.limit;

  const [rows, total] = await Promise.all([
    db.team.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: {
        _count: {
          select: { members: true },
        },
      },
    }),
    db.team.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Finds a single team by UUID primary key, including its member count.
 */
export async function findById(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<TeamWithCount | null> {
  const db = tx ?? prisma;
  return db.team.findUnique({
    where: { id },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });
}

/**
 * Finds a team by name (case-insensitive, trimmed) for uniqueness enforcement.
 */
export async function findByName(
  name: string,
  tx?: Prisma.TransactionClient,
): Promise<Team | null> {
  const db = tx ?? prisma;
  return db.team.findFirst({
    where: {
      name: {
        equals: name.trim(),
        mode: "insensitive",
      },
    },
  });
}

/**
 * Finds a specific user's membership record within a team.
 */
export async function findMember(
  teamId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<TeamMember | null> {
  const db = tx ?? prisma;
  return db.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });
}

/**
 * Lists all members of a team ordered chronologically by assignment timestamp,
 * including safe user profile projections.
 */
export async function listMembers(
  teamId: string,
  tx?: Prisma.TransactionClient,
): Promise<TeamMemberWithUser[]> {
  const db = tx ?? prisma;
  return db.teamMember.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          globalRole: true,
        },
      },
    },
    orderBy: [{ assignedAt: "asc" }, { userId: "asc" }],
  });
}

/**
 * Inserts a new team record.
 */
export async function create(
  data: { name: string; description?: string | null },
  tx?: Prisma.TransactionClient,
): Promise<Team> {
  const db = tx ?? prisma;
  return db.team.create({
    data: {
      name: data.name,
      description: data.description ?? null,
    },
  });
}

/**
 * Updates mutable fields (`name` and/or `description`) of a team record.
 */
export async function update(
  id: string,
  data: { name?: string; description?: string | null },
  tx?: Prisma.TransactionClient,
): Promise<Team> {
  const db = tx ?? prisma;
  const updateData: Prisma.TeamUpdateInput = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (data.description !== undefined) {
    updateData.description = data.description;
  }

  return db.team.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Permanently deletes a team record by UUID primary key.
 */
export async function deleteTeam(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<Team> {
  const db = tx ?? prisma;
  return db.team.delete({
    where: { id },
  });
}

/**
 * Inserts a new team membership row.
 */
export async function addMember(
  data: {
    teamId: string;
    userId: string;
    role: TeamRole;
    assignedBy: string | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<TeamMember> {
  const db = tx ?? prisma;
  return db.teamMember.create({
    data: {
      teamId: data.teamId,
      userId: data.userId,
      role: data.role,
      assignedBy: data.assignedBy,
    },
  });
}

/**
 * Deletes an existing team membership row by composite key `(teamId, userId)`.
 */
export async function removeMember(
  teamId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<TeamMember> {
  const db = tx ?? prisma;
  return db.teamMember.delete({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });
}

/**
 * Teams data-access repository singleton.
 */
export const teamsRepository = {
  list,
  findById,
  findByName,
  findMember,
  listMembers,
  create,
  update,
  delete: deleteTeam,
  addMember,
  removeMember,
};
