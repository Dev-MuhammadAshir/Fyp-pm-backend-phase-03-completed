/**
 * @file tests/helpers/team-project-helpers.ts
 * @description Test helpers for seeding and cleaning up isolated Teams in
 * API integration tests.
 *
 * Mirrors tests/helpers/auth-test-helpers.ts: tracks created Team IDs in a
 * module-level array and removes them in reverse order during teardown.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../../src/core/db/prisma.js";

const createdTeamIds: string[] = [];

/**
 * Valid team membership roles per SRS v3.0 §6.2.
 */
export type TeamRole = "Admin-Assigned" | "Member";

/**
 * Optional fields when seeding a temporary team for test setup.
 */
export interface SeedTeamOptions {
  name?: string;
  description?: string | null;
}

/**
 * Creates a Team via direct Prisma write (bypasses HTTP API) and enrolls
 * `creatorId` as an `"Admin-Assigned"` member.
 * Tracks the created team ID for `cleanupTeams()`.
 */
export async function seedTempTeam(
  creatorId: string,
  options: SeedTeamOptions = {},
): Promise<{ id: string; name: string }> {
  const name = options.name ?? `Test Team ${randomUUID().slice(0, 8)}`;
  const team = await prisma.team.create({
    data: {
      name,
      description: options.description ?? null,
      members: {
        create: [
          {
            userId: creatorId,
            role: "Admin-Assigned",
            assignedBy: creatorId,
          },
        ],
      },
    },
  });
  createdTeamIds.push(team.id);
  return { id: team.id, name: team.name };
}

/**
 * Adds a user to a team via direct Prisma write. Use only in test setup —
 * for API-based member management tests, use `POST /api/v1/teams/:teamId/members`.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = "Member",
  assignedBy?: string,
): Promise<void> {
  await prisma.teamMember.create({
    data: {
      teamId,
      userId,
      role,
      assignedBy: assignedBy ?? null,
    },
  });
}

/**
 * Deletes all teams created via `seedTempTeam`. Deletion cascades to
 * `team_members` and `projects`. Tolerates already-deleted entities
 * (e.g., when a test exercises `DELETE /api/v1/teams/:teamId`).
 */
export async function cleanupTeams(): Promise<void> {
  for (const tid of [...createdTeamIds].reverse()) {
    try {
      await prisma.team.delete({ where: { id: tid } });
    } catch {
      // Already deleted by test — ok
    }
  }
  createdTeamIds.length = 0;
}

const createdProjectIds: string[] = [];

/**
 * Valid project membership roles per SRS v3.0 §6.2.
 */
export type ProjectRole = "Manager" | "Contributor" | "Viewer";

/**
 * Optional fields when seeding a temporary project for test setup.
 */
export interface SeedProjectOptions {
  title?: string;
  description?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status?: "Active" | "OnHold" | "Completed" | "Archived";
  startDate?: Date | null;
  endDate?: Date | null;
  deadline?: Date | null;
}

/**
 * Creates a Project via direct Prisma write (bypasses API) and enrolls
 * `creatorId` as `"Manager"` (A2 behavior mirrored). Returns `{ id, title }`.
 * Project ID is tracked for `cleanupProjects()`.
 */
export async function seedTempProject(
  teamId: string,
  creatorId: string,
  options: SeedProjectOptions = {},
): Promise<{ id: string; title: string }> {
  const title = options.title ?? `Test Project ${randomUUID().slice(0, 8)}`;
  const project = await prisma.project.create({
    data: {
      teamId,
      title,
      description: options.description ?? null,
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.status !== undefined ? { status: options.status } : {}),
      startDate: options.startDate ?? null,
      endDate: options.endDate ?? null,
      deadline: options.deadline ?? null,
      members: {
        create: [{ userId: creatorId, role: "Manager" }],
      },
    },
  });
  createdProjectIds.push(project.id);
  return { id: project.id, title: project.title };
}

/**
 * Adds a user to a project via direct Prisma write (setup only).
 */
export async function addProjectMember(
  projectId: string,
  userId: string,
  role: ProjectRole = "Contributor",
): Promise<void> {
  await prisma.projectMember.create({
    data: { projectId, userId, role },
  });
}

/**
 * Deletes all projects created by `seedTempProject` in reverse order.
 * Tolerates already-deleted entities.
 */
export async function cleanupProjects(): Promise<void> {
  for (const pid of [...createdProjectIds].reverse()) {
    try {
      await prisma.project.delete({ where: { id: pid } });
    } catch {
      // Already deleted by test — ok
    }
  }
  createdProjectIds.length = 0;
}

