/**
 * @file src/modules/projects/projects.service.ts
 * @description Business logic, transactional orchestration, and audit logging
 * for Project lifecycle and ProjectMember operations.
 *
 * Implements SRS v3.0 §4.2 (RBAC project scoping: Administrators see all projects;
 * non-Administrators see only projects where they are members), A2 (project creator
 * becomes initial Manager), A4 (PM must be team member of teamId to create projects),
 * A7 (ALL-CAPS priority default), A8 (archive semantic), and CA-12 (audit logging).
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../core/db/prisma.js";
import { AppError } from "../../core/errors/AppError.js";
import { ERROR_CODES } from "../../core/errors/codes.js";
import { logger } from "../../core/logger/index.js";
import type { PaginationMeta } from "../../core/responses/index.js";
import {
  projectsRepository,
  type ListProjectsVisibility,
  type ProjectMemberWithUser,
  type ProjectRole,
  type ProjectWithCount,
} from "./projects.repository.js";
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  ListProjectsQuery,
  UpdateProjectRequest,
  UpdateProjectMemberRoleRequest,
} from "./projects.schemas.js";

export type { PaginationMeta };

/**
 * Actor and request-tracing metadata supplied to project service operations.
 */
export interface ServiceContext {
  actorId: string;
  actorGlobalRole: string;
  correlationId?: string;
}

/**
 * Public Project representation returned by the Projects API.
 */
export interface ProjectDTO {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  deadline: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public ProjectMember representation including safe user profile projection.
 */
export interface ProjectMemberDTO {
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
}

/**
 * Paginated list result returned by `projectsService.list`.
 */
export interface ListProjectsResult {
  rows: ProjectDTO[];
  meta: PaginationMeta;
}

/**
 * Project progress metrics representation.
 */
export interface ProjectProgressDTO {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionPercentage: number;
}

/**
 * Transforms an internal `ProjectWithCount` record into a public `ProjectDTO`.
 */
function toProjectDTO(p: ProjectWithCount): ProjectDTO {
  return {
    id: p.id,
    teamId: p.teamId,
    title: p.title,
    description: p.description,
    status: p.status,
    priority: p.priority,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    endDate: p.endDate ? p.endDate.toISOString() : null,
    deadline: p.deadline ? p.deadline.toISOString() : null,
    memberCount: p._count.members,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Transforms an internal `ProjectMemberWithUser` record into a public `ProjectMemberDTO`.
 */
function toProjectMemberDTO(m: ProjectMemberWithUser): ProjectMemberDTO {
  const role: ProjectRole =
    m.role === "Manager" || m.role === "Viewer" ? m.role : "Contributor";

  return {
    projectId: m.projectId,
    userId: m.userId,
    role,
    joinedAt: m.joinedAt.toISOString(),
    user: {
      id: m.user.id,
      email: m.user.email,
      fullName: m.user.fullName,
      globalRole: m.user.globalRole,
    },
  };
}

/**
 * Lists projects visible to the caller with pagination and optional filters.
 * Administrators see all projects; all other roles see only projects they belong to.
 */
export async function list(
  query: ListProjectsQuery,
  ctx: ServiceContext,
): Promise<ListProjectsResult> {
  const visibility: ListProjectsVisibility =
    ctx.actorGlobalRole === "Administrator"
      ? { scope: "ALL" }
      : { scope: "MEMBER_ONLY", userId: ctx.actorId };

  const { rows, total } = await projectsRepository.list(
    {
      page: query.page,
      limit: query.limit,
      teamId: query.teamId,
      status: query.status,
      priority: query.priority,
    },
    visibility,
  );

  const totalPages = Math.ceil(total / query.limit);

  return {
    rows: rows.map(toProjectDTO),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
    },
  };
}

/**
 * Retrieves a single project by UUID.
 * Authorization is enforced by `requireProjectMember` middleware at the controller layer.
 */
export async function getById(projectId: string): Promise<ProjectDTO> {
  const project = await projectsRepository.findById(projectId);
  if (!project) {
    throw new AppError("Project not found", 404, ERROR_CODES.PROJECT_NOT_FOUND);
  }
  return toProjectDTO(project);
}

/**
 * Creates a new project in a team, assigns the creating actor as the initial Manager,
 * and records two transactional audit entries (`Project` + `ProjectMember`).
 */
export async function create(
  input: CreateProjectRequest,
  ctx: ServiceContext,
): Promise<ProjectDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  const createdProject = await prisma.$transaction(async (tx) => {
    // A4 — PM must be team member of teamId
    if (ctx.actorGlobalRole === "Project Manager") {
      const isTeamMember = await projectsRepository.findTeamMembership(
        input.teamId,
        ctx.actorId,
        tx,
      );
      if (!isTeamMember) {
        throw new AppError(
          "You must be a member of the team to create projects in it",
          403,
          ERROR_CODES.AUTHZ_FORBIDDEN,
        );
      }
    }

    // Validate team exists
    const team = await tx.team.findUnique({
      where: { id: input.teamId },
      select: { id: true },
    });
    if (!team) {
      throw new AppError("Team not found", 404, ERROR_CODES.TEAM_NOT_FOUND);
    }

    // Create project — A7-priority-case: force all-caps default
    const created = await projectsRepository.create(
      {
        teamId: input.teamId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "MEDIUM",
        startDate: input.startDate,
        endDate: input.endDate,
        deadline: input.deadline,
      },
      tx,
    );

    // A2 — creator becomes Manager
    const creatorMembership = await projectsRepository.addMember(
      {
        projectId: created.id,
        userId: ctx.actorId,
        role: "Manager",
      },
      tx,
    );

    // Audit — Project CREATE
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Project",
        entityId: created.id,
        action: "CREATE",
        oldValues: {},
        newValues: {
          id: created.id,
          teamId: created.teamId,
          title: created.title,
          description: created.description,
          status: created.status,
          priority: created.priority,
          startDate: created.startDate?.toISOString() ?? null,
          endDate: created.endDate?.toISOString() ?? null,
          deadline: created.deadline?.toISOString() ?? null,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });

    // Audit — ProjectMember CREATE (creator as Manager)
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "ProjectMember",
        entityId: created.id,
        action: "CREATE",
        oldValues: {},
        newValues: {
          projectId: created.id,
          userId: creatorMembership.userId,
          role: creatorMembership.role,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });

    const refreshed = await projectsRepository.findById(created.id, tx);
    if (!refreshed) {
      logger.error(
        { projectId: created.id, correlationId },
        "Created project could not be reloaded inside transaction",
      );
      throw new AppError(
        "Failed to load created project",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }

    return refreshed;
  });

  return toProjectDTO(createdProject);
}

/**
 * Updates mutable fields of a project with transactional diff audit logging.
 * Skips DB write and audit entry if no changes are detected (no-op).
 */
export async function update(
  projectId: string,
  input: UpdateProjectRequest,
  ctx: ServiceContext,
): Promise<ProjectDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  const updatedProject = await prisma.$transaction(async (tx) => {
    const before = await projectsRepository.findById(projectId, tx);
    if (!before) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    const oldValues: Record<string, Prisma.InputJsonValue | null> = {};
    const newValues: Record<string, Prisma.InputJsonValue | null> = {};
    const updatePayload: {
      title?: string;
      description?: string | null;
      status?: string;
      priority?: string;
      startDate?: Date | null;
      endDate?: Date | null;
      deadline?: Date | null;
    } = {};

    if (input.title !== undefined && input.title !== before.title) {
      oldValues.title = before.title;
      newValues.title = input.title;
      updatePayload.title = input.title;
    }
    if (
      input.description !== undefined &&
      input.description !== before.description
    ) {
      oldValues.description = before.description;
      newValues.description = input.description;
      updatePayload.description = input.description;
    }
    if (input.status !== undefined && input.status !== before.status) {
      oldValues.status = before.status;
      newValues.status = input.status;
      updatePayload.status = input.status;
    }
    if (input.priority !== undefined && input.priority !== before.priority) {
      oldValues.priority = before.priority;
      newValues.priority = input.priority;
      updatePayload.priority = input.priority;
    }

    const beforeStart = before.startDate?.toISOString() ?? null;
    const beforeEnd = before.endDate?.toISOString() ?? null;
    const beforeDeadline = before.deadline?.toISOString() ?? null;

    if (input.startDate !== undefined) {
      const nextIso = input.startDate?.toISOString() ?? null;
      if (nextIso !== beforeStart) {
        oldValues.startDate = beforeStart;
        newValues.startDate = nextIso;
        updatePayload.startDate = input.startDate;
      }
    }
    if (input.endDate !== undefined) {
      const nextIso = input.endDate?.toISOString() ?? null;
      if (nextIso !== beforeEnd) {
        oldValues.endDate = beforeEnd;
        newValues.endDate = nextIso;
        updatePayload.endDate = input.endDate;
      }
    }
    if (input.deadline !== undefined) {
      const nextIso = input.deadline?.toISOString() ?? null;
      if (nextIso !== beforeDeadline) {
        oldValues.deadline = beforeDeadline;
        newValues.deadline = nextIso;
        updatePayload.deadline = input.deadline;
      }
    }

    if (Object.keys(newValues).length === 0) {
      return before;
    }

    await projectsRepository.update(projectId, updatePayload, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Project",
        entityId: projectId,
        action: "UPDATE",
        oldValues: oldValues as Prisma.InputJsonObject,
        newValues: newValues as Prisma.InputJsonObject,
        correlationId,
      },
    });

    const refreshed = await projectsRepository.findById(projectId, tx);
    if (!refreshed) {
      logger.error(
        { projectId, correlationId },
        "Updated project could not be reloaded inside transaction",
      );
      throw new AppError(
        "Failed to load updated project",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }

    return refreshed;
  });

  return toProjectDTO(updatedProject);
}

/**
 * Soft deletes/archives a project by setting status to 'Archived' (A8).
 * Fails with 409 CONFLICT if the project is already archived.
 */
export async function archive(
  projectId: string,
  ctx: ServiceContext,
): Promise<ProjectDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  const archivedProject = await prisma.$transaction(async (tx) => {
    const before = await projectsRepository.findById(projectId, tx);
    if (!before) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }
    if (before.status === "Archived") {
      throw new AppError(
        "Project is already archived",
        409,
        ERROR_CODES.CONFLICT,
      );
    }

    await projectsRepository.archive(projectId, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "Project",
        entityId: projectId,
        action: "UPDATE",
        oldValues: { status: before.status } as Prisma.InputJsonObject,
        newValues: { status: "Archived" } as Prisma.InputJsonObject,
        correlationId,
      },
    });

    const refreshed = await projectsRepository.findById(projectId, tx);
    if (!refreshed) {
      logger.error(
        { projectId, correlationId },
        "Archived project could not be reloaded inside transaction",
      );
      throw new AppError(
        "Failed to load archived project",
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
      );
    }
    return refreshed;
  });

  return toProjectDTO(archivedProject);
}

/**
 * Lists all members of a project.
 * Authorization is enforced by `requireProjectMember` middleware at the controller layer.
 */
export async function listMembers(
  projectId: string,
): Promise<ProjectMemberDTO[]> {
  const project = await projectsRepository.findById(projectId);
  if (!project) {
    throw new AppError("Project not found", 404, ERROR_CODES.PROJECT_NOT_FOUND);
  }
  const members = await projectsRepository.listMembers(projectId);
  return members.map(toProjectMemberDTO);
}

/**
 * Adds an active user to a project with the specified role (`"Manager"` | `"Contributor"` | `"Viewer"`).
 * Any active user may be added (A5: need not be a team member).
 */
export async function addMember(
  projectId: string,
  input: AddProjectMemberRequest,
  ctx: ServiceContext,
): Promise<ProjectMemberDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const project = await projectsRepository.findById(projectId, tx);
    if (!project) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    const targetUser = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true },
    });

    if (!targetUser) {
      throw new AppError("User not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    if (!targetUser.isActive) {
      throw new AppError(
        "Cannot add an inactive user to a project",
        422,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const existing = await projectsRepository.findMember(
      projectId,
      input.userId,
      tx,
    );
    if (existing) {
      throw new AppError(
        "User is already a member of this project",
        409,
        ERROR_CODES.PROJECT_MEMBER_ALREADY_EXISTS,
      );
    }

    const created = await projectsRepository.addMember(
      {
        projectId,
        userId: input.userId,
        role: input.role,
      },
      tx,
    );

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "ProjectMember",
        entityId: projectId,
        action: "CREATE",
        oldValues: {},
        newValues: {
          projectId: created.projectId,
          userId: created.userId,
          role: created.role,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });
  });

  const members = await projectsRepository.listMembers(projectId);
  const added = members.find((m) => m.userId === input.userId);
  if (!added) {
    logger.error(
      { projectId, userId: input.userId, correlationId },
      "Added project member could not be reloaded after transaction commit",
    );
    throw new AppError(
      "Failed to load newly added project member",
      500,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }

  return toProjectMemberDTO(added);
}

/**
 * Defense-in-depth: prevent removing/demoting the last Manager of a
 * project, which would leave it unadministrable until an Administrator
 * intervenes.
 *
 * Not SRS-mandated; defense-in-depth parallel to last-admin guard per
 * Phase 3 Decision 6. Uses AUTHZ_FORBIDDEN + custom message rather than
 * a new error code (per Phase 3 A9 — no new error codes).
 */
export async function removeMember(
  projectId: string,
  userId: string,
  ctx: ServiceContext,
): Promise<void> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const project = await projectsRepository.findById(projectId, tx);
    if (!project) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    const existing = await projectsRepository.findMember(
      projectId,
      userId,
      tx,
    );
    if (!existing) {
      throw new AppError(
        "Project member not found",
        404,
        ERROR_CODES.PROJECT_MEMBER_NOT_FOUND,
      );
    }

    // D6 last-Manager guard
    if (existing.role === "Manager") {
      const managers = await projectsRepository.countManagers(projectId, tx);
      if (managers <= 1) {
        throw new AppError(
          "Cannot remove the last Manager from the project.",
          403,
          ERROR_CODES.AUTHZ_FORBIDDEN,
        );
      }
    }

    await projectsRepository.removeMember(projectId, userId, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "ProjectMember",
        entityId: projectId,
        action: "DELETE",
        oldValues: {
          projectId,
          userId,
          role: existing.role,
        } as Prisma.InputJsonObject,
        newValues: {},
        correlationId,
      },
    });
  });
}

/**
 * Defense-in-depth: prevent removing/demoting the last Manager of a
 * project, which would leave it unadministrable until an Administrator
 * intervenes.
 *
 * Not SRS-mandated; defense-in-depth parallel to last-admin guard per
 * Phase 3 Decision 6. Uses AUTHZ_FORBIDDEN + custom message rather than
 * a new error code (per Phase 3 A9 — no new error codes).
 */
export async function updateMemberRole(
  projectId: string,
  userId: string,
  input: UpdateProjectMemberRoleRequest,
  ctx: ServiceContext,
): Promise<ProjectMemberDTO> {
  const correlationId = ctx.correlationId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const project = await projectsRepository.findById(projectId, tx);
    if (!project) {
      throw new AppError(
        "Project not found",
        404,
        ERROR_CODES.PROJECT_NOT_FOUND,
      );
    }

    const existing = await projectsRepository.findMember(
      projectId,
      userId,
      tx,
    );
    if (!existing) {
      throw new AppError(
        "Project member not found",
        404,
        ERROR_CODES.PROJECT_MEMBER_NOT_FOUND,
      );
    }

    if (existing.role === input.role) {
      return;
    }

    // D6 last-Manager guard
    if (existing.role === "Manager" && input.role !== "Manager") {
      const managers = await projectsRepository.countManagers(projectId, tx);
      if (managers <= 1) {
        throw new AppError(
          "Cannot demote the last Manager of the project.",
          403,
          ERROR_CODES.AUTHZ_FORBIDDEN,
        );
      }
    }

    await projectsRepository.updateMemberRole(projectId, userId, input.role, tx);

    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        entityType: "ProjectMember",
        entityId: projectId,
        action: "UPDATE",
        oldValues: {
          projectId,
          userId,
          role: existing.role,
        } as Prisma.InputJsonObject,
        newValues: {
          projectId,
          userId,
          role: input.role,
        } as Prisma.InputJsonObject,
        correlationId,
      },
    });
  });

  const members = await projectsRepository.listMembers(projectId);
  const row = members.find((m) => m.userId === userId);
  if (!row) {
    logger.error(
      { projectId, userId, correlationId },
      "Updated project member could not be reloaded after transaction commit",
    );
    throw new AppError(
      "Failed to load updated project member",
      500,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }

  return toProjectMemberDTO(row);
}

/**
 * Retrieves progress metrics (tasks counts and completion percentage) for a project.
 */
export async function getProgress(
  projectId: string,
): Promise<ProjectProgressDTO> {
  const project = await projectsRepository.findById(projectId);
  if (!project) {
    throw new AppError("Project not found", 404, ERROR_CODES.PROJECT_NOT_FOUND);
  }
  return projectsRepository.getProgressData(projectId);
}

/**
 * Projects domain service singleton.
 */
export const projectsService = {
  list,
  getById,
  create,
  update,
  archive,
  listMembers,
  addMember,
  removeMember,
  updateMemberRole,
  getProgress,
};
