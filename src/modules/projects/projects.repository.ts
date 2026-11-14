/**
 * @file src/modules/projects/projects.repository.ts
 * @description Data-access layer for Project and ProjectMember persistence.
 *
 * ARCHITECTURAL DESIGN:
 * Follows the repository pattern with optional `Prisma.TransactionClient`
 * propagation so every mutation executes atomically inside `prisma.$transaction`.
 */

import type { Prisma, Project, ProjectMember } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import type {
  ProjectRole,
  ProjectStatus,
  Priority,
} from "./projects.schemas.js";

export type { ProjectRole, ProjectStatus, Priority };

/**
 * Project entity bundled with its member count aggregate.
 */
export interface ProjectWithCount extends Project {
  _count: {
    members: number;
  };
}

/**
 * ProjectMember entity bundled with safe public user summary fields.
 */
export interface ProjectMemberWithUser extends ProjectMember {
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

/**
 * Pagination and filter parameters for listing projects.
 */
export interface ListProjectsFilters {
  page: number;
  limit: number;
  teamId?: string;
  status?: ProjectStatus;
  priority?: Priority;
}

/**
 * Visibility scope derived from caller's global role:
 * - `"ALL"` for Administrators (SRS §4.2 precedence-1 access).
 * - `"MEMBER_ONLY"` for all non-Administrator roles.
 */
export type ListProjectsVisibility =
  | { scope: "ALL" }
  | { scope: "MEMBER_ONLY"; userId: string };

/**
 * Aggregated progress metrics for a project.
 */
export interface ProjectProgressData {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionPercentage: number;
}

/**
 * Lists projects with pagination, optional filters, and RBAC visibility scoping.
 */
export async function list(
  filters: ListProjectsFilters,
  visibility: ListProjectsVisibility,
  tx?: Prisma.TransactionClient,
): Promise<{ rows: ProjectWithCount[]; total: number }> {
  const db = tx ?? prisma;
  const where: Prisma.ProjectWhereInput = {};

  if (visibility.scope === "MEMBER_ONLY") {
    where.members = {
      some: {
        userId: visibility.userId,
      },
    };
  }

  if (filters.teamId) {
    where.teamId = filters.teamId;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.priority) {
    where.priority = filters.priority;
  }

  const skip = (filters.page - 1) * filters.limit;
  const take = filters.limit;

  const [rows, total] = await Promise.all([
    db.project.findMany({
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
    db.project.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Finds a single project by UUID primary key, including its member count.
 */
export async function findById(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<ProjectWithCount | null> {
  const db = tx ?? prisma;
  return db.project.findUnique({
    where: { id },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });
}

/**
 * Checks whether a user holds a membership record in a specific team.
 * Direct Prisma query at data layer to verify A4 team membership constraint.
 */
export async function findTeamMembership(
  teamId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  const db = tx ?? prisma;
  const row = await db.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
    select: {
      userId: true,
    },
  });
  return row !== null;
}

/**
 * Finds a user's membership record in a project by composite key `(projectId, userId)`.
 */
export async function findMember(
  projectId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<ProjectMember | null> {
  const db = tx ?? prisma;
  return db.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
  });
}

/**
 * Lists all members of a project ordered by role and join timestamp,
 * including safe user profile projections.
 */
export async function listMembers(
  projectId: string,
  tx?: Prisma.TransactionClient,
): Promise<ProjectMemberWithUser[]> {
  const db = tx ?? prisma;
  return db.projectMember.findMany({
    where: { projectId },
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
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
}

/**
 * Inserts a new project record.
 */
export async function create(
  data: {
    teamId: string;
    title: string;
    description: string | null;
    priority: Priority;
    startDate?: Date | null;
    endDate?: Date | null;
    deadline?: Date | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<Project> {
  const db = tx ?? prisma;
  return db.project.create({
    data: {
      teamId: data.teamId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      deadline: data.deadline ?? null,
    },
  });
}

/**
 * Updates mutable fields of a project record.
 */
export async function update(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    deadline?: Date | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<Project> {
  const db = tx ?? prisma;
  const updateData: Prisma.ProjectUpdateInput = {};

  if (data.title !== undefined) {
    updateData.title = data.title;
  }
  if (data.description !== undefined) {
    updateData.description = data.description;
  }
  if (data.status !== undefined) {
    updateData.status = data.status;
  }
  if (data.priority !== undefined) {
    updateData.priority = data.priority;
  }
  if (data.startDate !== undefined) {
    updateData.startDate = data.startDate;
  }
  if (data.endDate !== undefined) {
    updateData.endDate = data.endDate;
  }
  if (data.deadline !== undefined) {
    updateData.deadline = data.deadline;
  }

  return db.project.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Soft deletes/archives a project by setting status to 'Archived'.
 */
export async function archive(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<Project> {
  const db = tx ?? prisma;
  return db.project.update({
    where: { id },
    data: {
      status: "Archived",
    },
  });
}

/**
 * Inserts a new project membership record.
 */
export async function addMember(
  data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  },
  tx?: Prisma.TransactionClient,
): Promise<ProjectMember> {
  const db = tx ?? prisma;
  return db.projectMember.create({
    data: {
      projectId: data.projectId,
      userId: data.userId,
      role: data.role,
    },
  });
}

/**
 * Deletes a project membership record by composite key `(projectId, userId)`.
 */
export async function removeMember(
  projectId: string,
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<ProjectMember> {
  const db = tx ?? prisma;
  return db.projectMember.delete({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
  });
}

/**
 * Updates a project member's role.
 */
export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
  tx?: Prisma.TransactionClient,
): Promise<ProjectMember> {
  const db = tx ?? prisma;
  return db.projectMember.update({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
    data: {
      role,
    },
  });
}

/**
 * Counts the number of active Managers in a project.
 */
export async function countManagers(
  projectId: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const db = tx ?? prisma;
  return db.projectMember.count({
    where: {
      projectId,
      role: "Manager",
    },
  });
}

/**
 * Aggregates task progress metrics for a project.
 */
export async function getProgressData(
  projectId: string,
  tx?: Prisma.TransactionClient,
): Promise<ProjectProgressData> {
  const db = tx ?? prisma;
  const now = new Date();

  const [totalTasks, completedTasks, overdueTasks] = await Promise.all([
    db.task.count({
      where: { projectId },
    }),
    db.task.count({
      where: { projectId, status: "DONE" },
    }),
    db.task.count({
      where: {
        projectId,
        status: { not: "DONE" },
        dueDate: { lt: now },
      },
    }),
  ]);

  const completionPercentage =
    totalTasks === 0
      ? 0
      : Math.round((completedTasks / totalTasks) * 10000) / 100;

  return {
    projectId,
    totalTasks,
    completedTasks,
    overdueTasks,
    completionPercentage,
  };
}

/**
 * Projects data-access repository singleton.
 */
export const projectsRepository = {
  list,
  findById,
  findTeamMembership,
  findMember,
  listMembers,
  create,
  update,
  archive,
  addMember,
  removeMember,
  updateMemberRole,
  countManagers,
  getProgressData,
};
