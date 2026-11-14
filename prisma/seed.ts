import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_SALT_ROUNDS = 12; // Enforced per SRS DC-10

async function main(): Promise<void> {
  console.info('[seed] Starting database seed for FYP Platform (SRS v3.0)...');

  // 1. Seed Roles (SRS §6.2 roles table)
  const roleNames = ['Administrator', 'Project Manager', 'Team Member', 'Viewer'];
  for (const name of roleNames) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.info(`[seed] Seeded ${roleNames.length} system roles`);

  // 2. Hash seed password (default demo password: Admin@1234)
  const defaultPasswordHash = await bcrypt.hash('Admin@1234', BCRYPT_SALT_ROUNDS);

  // 3. Seed core demo users (admin-provisioned only per CA-04)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@fyp.local' },
    update: {},
    create: {
      email: 'admin@fyp.local',
      passwordHash: defaultPasswordHash,
      fullName: 'System Administrator',
      globalRole: 'Administrator',
      configuredCapacityHours: 40,
      isActive: true,
    },
  });

  const pmUser = await prisma.user.upsert({
    where: { email: 'pm@fyp.local' },
    update: {},
    create: {
      email: 'pm@fyp.local',
      passwordHash: defaultPasswordHash,
      fullName: 'Sarah Jenkins',
      globalRole: 'Project Manager',
      configuredCapacityHours: 40,
      isActive: true,
    },
  });

  const memberUser1 = await prisma.user.upsert({
    where: { email: 'dev1@fyp.local' },
    update: {},
    create: {
      email: 'dev1@fyp.local',
      passwordHash: defaultPasswordHash,
      fullName: 'Alex Rivera',
      globalRole: 'Team Member',
      configuredCapacityHours: 40,
      isActive: true,
    },
  });

  const memberUser2 = await prisma.user.upsert({
    where: { email: 'dev2@fyp.local' },
    update: {},
    create: {
      email: 'dev2@fyp.local',
      passwordHash: defaultPasswordHash,
      fullName: 'Priya Sharma',
      globalRole: 'Team Member',
      configuredCapacityHours: 35,
      isActive: true,
    },
  });

  const viewerUser = await prisma.user.upsert({
    where: { email: 'viewer@fyp.local' },
    update: {},
    create: {
      email: 'viewer@fyp.local',
      passwordHash: defaultPasswordHash,
      fullName: 'Dr. Arthur Vance',
      globalRole: 'Viewer',
      configuredCapacityHours: 20,
      isActive: true,
    },
  });

  console.info('[seed] Seeded demo users across all 4 global roles');

  // 4. Seed initial team (created by Administrator per CA-05)
  const engineeringTeam = await prisma.team.create({
    data: {
      name: 'Core Platform Engineering',
      description:
        'Primary engineering team responsible for real-time collaboration and PIRAE analytics.',
      members: {
        create: [
          {
            userId: adminUser.id,
            role: 'Admin-Assigned',
            assignedBy: adminUser.id,
          },
          {
            userId: pmUser.id,
            role: 'Admin-Assigned',
            assignedBy: adminUser.id,
          },
          {
            userId: memberUser1.id,
            role: 'Member',
            assignedBy: pmUser.id,
          },
          {
            userId: memberUser2.id,
            role: 'Member',
            assignedBy: pmUser.id,
          },
          {
            userId: viewerUser.id,
            role: 'Member',
            assignedBy: adminUser.id,
          },
        ],
      },
    },
  });
  console.info(`[seed] Seeded Team: "${engineeringTeam.name}" with 5 members`);

  // 5. Seed project (G-03 start_date included)
  const project = await prisma.project.create({
    data: {
      teamId: engineeringTeam.id,
      title: 'Real-Time Collaboration Platform v3.0',
      description: 'Design and rollout of the distributed project management backend engine.',
      status: 'Active',
      priority: 'HIGH', // ⚠️ uppercase per CHECK constraint
      startDate: new Date('2026-11-01T00:00:00Z'),
      deadline: new Date('2026-12-15T23:59:59Z'),
      members: {
        create: [
          {
            userId: pmUser.id,
            role: 'Manager', // ⚠️ mixed case per CHECK constraint
          },
          {
            userId: memberUser1.id,
            role: 'Contributor',
          },
          {
            userId: memberUser2.id,
            role: 'Contributor',
          },
          {
            userId: viewerUser.id,
            role: 'Viewer',
          },
        ],
      },
    },
  });
  console.info(`[seed] Seeded Project: "${project.title}"`);

  // 6. Seed sample tasks (G-04 start_date & completed_at included)
  await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Architect PostgreSQL Relational Schema & Constraints',
      description: 'Define relational schema with CHECK constraints and append-only audit trigger.',
      status: 'DONE',
      priority: 'HIGH',
      startDate: new Date('2026-11-01T09:00:00Z'),
      dueDate: new Date('2026-11-04T18:00:00Z'),
      estimatedEffort: 12.0,
      completedAt: new Date('2026-11-04T04:00:00Z'),
      subtasks: [
        { title: 'Draft ERD and foreign key cascades', done: true },
        { title: 'Write immutable audit trigger', done: true },
      ],
      assignees: {
        create: [{ userId: memberUser1.id }],
      },
    },
  });

  const task2 = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Implement Socket.IO Redis Pub/Sub Gateway',
      description: 'Setup 13 frozen events room distribution and JWT handshake authentication.',
      status: 'IN_PROGRESS',
      priority: 'CRITICAL',
      startDate: new Date('2026-11-04T09:00:00Z'),
      dueDate: new Date('2026-11-10T18:00:00Z'),
      estimatedEffort: 16.0,
      subtasks: [
        { title: 'Configure Redis publisher and subscriber clients', done: true },
        { title: 'Implement room-level authorization', done: false },
      ],
      assignees: {
        create: [{ userId: memberUser1.id }, { userId: memberUser2.id }],
      },
    },
  });

  const task3 = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Build PIRAE Advisory Engine & Workers',
      description:
        'BullMQ async worker for 4 frozen rules (Workload, Delay, Dependency, Priority).',
      status: 'TODO',
      priority: 'HIGH',
      startDate: new Date('2026-11-11T09:00:00Z'),
      dueDate: new Date('2026-11-20T18:00:00Z'),
      estimatedEffort: 24.0,
      subtasks: [{ title: 'Implement workload risk 4-level rule', done: false }],
      assignees: {
        create: [{ userId: memberUser2.id }],
      },
    },
  });

  // 7. Seed dependency: task2 BLOCKS task3 (CA-11)
  await prisma.taskDependency.create({
    data: {
      blockingTaskId: task2.id,
      blockedTaskId: task3.id,
      type: 'BLOCKS',
    },
  });

  console.info('[seed] Seeded 3 tasks and 1 relational blocking dependency');
  console.info('[seed] Database seeding completed successfully.');
}

main()
  .catch((e: unknown) => {
    console.error('[seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
