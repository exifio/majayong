import { ApplicationStatus, EventType, NotificationType, Prisma, ProjectStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../shared/errors.ts";
import { createNotification, logEvent } from "../shared/events.ts";

const PAGE_SIZE = 10;
const OPEN_STATUSES = [ProjectStatus.RECRUITING] as const;
const CLOSED_STATUSES = [ProjectStatus.ACCEPTED, ProjectStatus.CONTRACTED, ProjectStatus.EXPIRED] as const;
const VISIBLE_STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES];

export type ProjectListInput = {
  q?: string;
  industryCode?: string;
  skills?: string[];
  minBudget?: number;
  maxBudget?: number;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  status?: "OPEN" | "CLOSED";
  sort: "newest" | "deadline" | "budget-high";
  page: number;
};

export async function processProjectSchedules(db: PrismaClient, now = new Date()): Promise<void> {
  const dueProjects = await db.project.findMany({
    where: {
      deletedAt: null,
      OR: [
        { status: ProjectStatus.SCHEDULED, recruitStartAt: { lte: now } },
        { status: ProjectStatus.RECRUITING, deadline: { lte: now } },
      ],
    },
    select: { id: true },
  });

  for (const { id } of dueProjects) {
    await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        draftId: string;
        status: ProjectStatus;
        recruitStartAt: Date | null;
        deadline: Date | null;
        publishedAt: Date | null;
        deletedAt: Date | null;
      }>>(Prisma.sql`SELECT id, "draftId", status, "recruitStartAt", deadline, "publishedAt", "deletedAt" FROM projects WHERE id = ${id} FOR UPDATE`);
      const project = rows[0];
      if (!project || project.deletedAt !== null) return;

      if (project.status === ProjectStatus.SCHEDULED && project.recruitStartAt !== null && project.recruitStartAt <= now) {
        await tx.project.update({
          where: { id },
          data: { status: ProjectStatus.RECRUITING, publishedAt: now },
        });
        await logEvent(tx, {
          type: EventType.PROJECT_PUBLISHED,
          projectId: id,
          draftId: project.draftId,
          payload: { publishedAt: now.toISOString() },
        });
        project.status = ProjectStatus.RECRUITING;
        project.publishedAt = now;
      }

      if (project.status !== ProjectStatus.RECRUITING || project.deadline === null || project.deadline > now) return;

      await tx.project.update({ where: { id }, data: { status: ProjectStatus.EXPIRED } });
      const [draft, applications] = await Promise.all([
        tx.draft.findUnique({ where: { id: project.draftId }, select: { clientId: true } }),
        tx.application.findMany({ where: { projectId: id }, distinct: ["supplierId"], select: { supplierId: true } }),
      ]);
      if (draft) {
        await createNotification(tx, {
          userId: draft.clientId,
          type: NotificationType.PROJECT_CLOSED,
          targetId: id,
          targetUrl: `/client/projects/${id}`,
        });
      }
      await Promise.all(applications.map(({ supplierId }) => createNotification(tx, {
        userId: supplierId,
        type: NotificationType.PROJECT_CLOSED,
        targetId: id,
        targetUrl: `/supplier/projects/${id}`,
      })));
    });
  }
}

export async function listProjects(db: PrismaClient, userId: string, input: ProjectListInput) {
  await requireSupplierNda(db, userId);
  await processProjectSchedules(db);

  const statuses = input.status === "OPEN" ? OPEN_STATUSES : input.status === "CLOSED" ? CLOSED_STATUSES : VISIBLE_STATUSES;
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    publishedAt: { not: null },
    status: { in: [...statuses] },
    ...(input.q ? { OR: [
      { title: { contains: input.q, mode: "insensitive" } },
      { summary: { contains: input.q, mode: "insensitive" } },
    ] } : {}),
    ...(input.industryCode ? { industryCode: input.industryCode } : {}),
    ...(input.skills && input.skills.length > 0 ? { requiredSkills: { hasSome: input.skills } } : {}),
    ...(input.minBudget !== undefined || input.maxBudget !== undefined ? {
      hopeBudget: {
        not: null,
        ...(input.minBudget !== undefined ? { gte: input.minBudget } : {}),
        ...(input.maxBudget !== undefined ? { lte: input.maxBudget } : {}),
      },
    } : {}),
    ...(input.deadlineFrom !== undefined || input.deadlineTo !== undefined ? {
      deadline: {
        not: null,
        ...(input.deadlineFrom !== undefined ? { gte: input.deadlineFrom } : {}),
        ...(input.deadlineTo !== undefined ? { lte: input.deadlineTo } : {}),
      },
    } : {}),
  };

  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = input.sort === "deadline"
    ? [{ deadline: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }]
    : input.sort === "budget-high"
      ? [{ hopeBudget: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }]
      : [{ publishedAt: "desc" }, { id: "desc" }];
  const [projects, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        currentVersion: true,
        title: true,
        summary: true,
        industryCode: true,
        requiredSkills: true,
        hopeBudget: true,
        status: true,
        deadline: true,
        publishedAt: true,
      },
    }),
    db.project.count({ where }),
  ]);
  const currentVersionItems = projects.length === 0 ? [] : await db.specItem.findMany({
    where: { OR: projects.map((project) => ({ projectId: project.id, versionNo: project.currentVersion })) },
    select: { projectId: true },
  });
  const itemCountByProject = new Map<string, number>();
  for (const item of currentVersionItems) {
    itemCountByProject.set(item.projectId, (itemCountByProject.get(item.projectId) ?? 0) + 1);
  }

  await Promise.all(projects.map((project) => logEvent(db, {
    type: EventType.SPEC_LIST_VIEWED,
    userId,
    projectId: project.id,
    payload: { surface: "PROJECT_LIST" },
  })));

  return {
    items: projects.map(({ currentVersion: _currentVersion, ...project }) => ({
      ...project,
      itemCount: itemCountByProject.get(project.id) ?? 0,
      recruitmentStatus: project.status === ProjectStatus.RECRUITING ? "OPEN" : "CLOSED",
    })),
    total,
    page: input.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getProjectDetail(
  db: PrismaClient,
  projectId: string,
  actor: { userId: string; role: "CLIENT" | "SUPPLIER" },
) {
  await processProjectSchedules(db);
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      publishedAt: { not: null },
      status: { in: [...VISIBLE_STATUSES] },
    },
    select: {
      id: true,
      draftId: true,
      currentVersion: true,
      title: true,
      summary: true,
      industryCode: true,
      requiredSkills: true,
      hopeBudget: true,
      status: true,
      deadline: true,
      publishedAt: true,
      draft: {
        select: {
          clientId: true,
          client: {
            select: {
              name: true,
              profileImageUrl: true,
              clientProfile: { select: { businessName: true, phone: true, region: true } },
            },
          },
          utterances: {
            orderBy: { createdAt: "asc" },
            select: { kind: true, content: true },
          },
        },
      },
    },
  });
  if (!project) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

  const isOwner = actor.role === "CLIENT" && project.draft.clientId === actor.userId;
  if (actor.role === "CLIENT" && !isOwner) {
    throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  }
  if (actor.role === "SUPPLIER") await requireSupplierNda(db, actor.userId);

  const accepted = actor.role === "SUPPLIER" && await db.application.findFirst({
    where: {
      projectId,
      supplierId: actor.userId,
      status: ApplicationStatus.ACCEPTED,
      specVersionNo: project.currentVersion,
    },
    select: { id: true },
  }) !== null;
  if (actor.role === "SUPPLIER") {
    await logEvent(db, { type: EventType.SPEC_DETAIL_VIEWED, userId: actor.userId, projectId });
  }

  const [specItems, uniqueViewers] = await Promise.all([
    db.specItem.findMany({
      where: { projectId, versionNo: project.currentVersion },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        blockId: true,
        title: true,
        description: true,
        rendererKey: true,
        renderConfig: true,
        questions: true,
        origin: true,
        status: true,
        sortOrder: true,
        ...(actor.role === "CLIENT" ? { estUnit: true, estMin: true, estMax: true, isEstimable: true } : {}),
      },
    }),
    isOwner ? db.eventLog.findMany({
      where: { projectId, type: EventType.SPEC_DETAIL_VIEWED, userId: { not: null } },
      distinct: ["userId"],
      select: { userId: true },
    }) : Promise.resolve([]),
  ]);

  const { draft, ...publicProject } = project;
  return {
    project: {
      ...publicProject,
      recruitmentStatus: project.status === ProjectStatus.RECRUITING ? "OPEN" : "CLOSED",
    },
    items: specItems,
    ...(accepted ? {
      client: {
        name: draft.client.name,
        profileImageUrl: draft.client.profileImageUrl,
        businessName: draft.client.clientProfile?.businessName ?? null,
        phone: draft.client.clientProfile?.phone ?? null,
        region: draft.client.clientProfile?.region ?? null,
      },
      originalTexts: draft.utterances,
    } : {}),
    ...(isOwner ? { uniqueDetailViewers: uniqueViewers.length } : {}),
  };
}

export async function setProjectBookmark(db: PrismaClient, supplierId: string, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
  if (!project) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  await db.bookmark.upsert({
    where: { supplierId_projectId: { supplierId, projectId } },
    create: { supplierId, projectId },
    update: {},
  });
}

export async function removeProjectBookmark(db: PrismaClient, supplierId: string, projectId: string): Promise<void> {
  await db.bookmark.deleteMany({ where: { supplierId, projectId } });
}

export async function listSupplierBookmarks(db: PrismaClient, supplierId: string) {
  const bookmarks = await db.bookmark.findMany({
    where: { supplierId, project: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      project: {
        select: {
          id: true,
          title: true,
          summary: true,
          industryCode: true,
          requiredSkills: true,
          status: true,
          deadline: true,
          publishedAt: true,
        },
      },
    },
  });
  return {
    items: bookmarks.map(({ project }) => ({
      ...project,
      recruitmentStatus: project.status === ProjectStatus.RECRUITING ? "OPEN" : "CLOSED",
    })),
  };
}

export async function recommendProjects(db: PrismaClient, projectId: string, supplierId: string) {
  await requireSupplierNda(db, supplierId);
  await processProjectSchedules(db);
  const current = await db.project.findFirst({
    where: { id: projectId, deletedAt: null, status: { in: [...VISIBLE_STATUSES] } },
    select: { industryCode: true, requiredSkills: true },
  });
  if (!current) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const projects = await db.project.findMany({
    where: {
      id: { not: projectId },
      deletedAt: null,
      publishedAt: { not: null },
      industryCode: current.industryCode,
      status: { in: [...VISIBLE_STATUSES] },
      ...(current.requiredSkills.length > 0 ? { requiredSkills: { hasSome: current.requiredSkills } } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      title: true,
      summary: true,
      industryCode: true,
      requiredSkills: true,
      status: true,
      deadline: true,
      publishedAt: true,
    },
  });
  return { items: projects.map((project) => ({
    ...project,
    recruitmentStatus: project.status === ProjectStatus.RECRUITING ? "OPEN" : "CLOSED",
  })) };
}

async function requireSupplierNda(db: PrismaClient, supplierId: string): Promise<void> {
  const profile = await db.supplierProfile.findUnique({ where: { userId: supplierId }, select: { ndaAgreedAt: true } });
  if (!profile || profile.ndaAgreedAt === null) {
    throw new AppError(403, "FORBIDDEN", "명세 비밀유지 동의가 필요합니다.");
  }
}
