import { ApplicationStatus, BlockOrigin, EventType, NotificationType, Prisma, ProjectStatus, SpecItemStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import { processProjectSchedules } from "../projects/projects.service.ts";
import { AppError } from "../shared/errors.ts";
import { createNotification, logEvent } from "../shared/events.ts";

const MAX_INT = 2_147_483_647;
const ACTIVE_APPLICATION_STATUSES = [ApplicationStatus.SUBMITTED, ApplicationStatus.STALE] as const;

export type ApplicationItemInput = {
  specItemId: string;
  isAvailable: boolean;
  amount?: number | null;
  memo?: string | null;
};

export type SubmitApplicationInput = {
  durationDays: number;
  items: ApplicationItemInput[];
};

export type AcceptApplicationInput = {
  confirmedExcludedItemIds: string[];
  firstSentenceExclusionConfirmed: boolean;
};

export async function markApplicationsStale(tx: DbTx, projectId: string, newVersionNo: number): Promise<number> {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { currentVersion: true } });
  if (!project || project.currentVersion !== newVersionNo) {
    throw new AppError(409, "CONFLICT", "프로젝트의 현재 명세 버전과 일치하지 않습니다.");
  }
  const applications = await tx.application.findMany({
    where: { projectId, status: ApplicationStatus.SUBMITTED, specVersionNo: { lt: newVersionNo } },
    select: { id: true, supplierId: true },
  });
  if (applications.length === 0) return 0;
  await tx.application.updateMany({
    where: { id: { in: applications.map((application) => application.id) } },
    data: { status: ApplicationStatus.STALE },
  });
  await Promise.all(applications.map((application) => createNotification(tx, {
    userId: application.supplierId,
    type: NotificationType.REQUOTE_REQUESTED,
    targetId: application.id,
    targetUrl: `/supplier/applications/${application.id}`,
  })));
  return applications.length;
}

interface LockedProject {
  id: string;
  draftId: string;
  currentVersion: number;
  status: ProjectStatus;
  deadline: Date | null;
  deletedAt: Date | null;
}

export async function submitApplication(
  db: PrismaClient,
  projectId: string,
  supplierId: string,
  input: SubmitApplicationInput,
  sessionId?: string,
  now = new Date(),
) {
  await requireSupplierNda(db, supplierId);
  await processProjectSchedules(db, now);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedProject[]>(Prisma.sql`SELECT id, "draftId", "currentVersion", status, deadline, "deletedAt" FROM projects WHERE id = ${projectId} FOR UPDATE`);
    const project = rows[0];
    if (!project || project.deletedAt !== null) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    if (project.status !== ProjectStatus.RECRUITING || (project.deadline !== null && project.deadline <= now)) {
      throw new AppError(409, "CONFLICT", "현재 견적을 제출할 수 있는 모집 상태가 아닙니다.");
    }

    const supplierView = await tx.eventLog.findFirst({
      where: { type: EventType.SPEC_DETAIL_VIEWED, projectId, userId: supplierId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { occurredAt: true },
    });
    if (!supplierView) throw new AppError(409, "CONFLICT", "프로젝트 상세를 확인한 뒤 견적을 제출해 주세요.");

    const specItems = await tx.specItem.findMany({
      where: { projectId, versionNo: project.currentVersion },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, status: true },
    });
    const specItemById = new Map(specItems.map((item) => [item.id, item]));
    const inputIds = new Set<string>();
    let totalAmount = 0;
    let hasAvailableIncludedItem = false;
    const items = input.items.map((item) => {
      const specItem = specItemById.get(item.specItemId);
      if (!specItem || inputIds.has(item.specItemId)) {
        throw new AppError(400, "VALIDATION_ERROR", "견적 항목이 현재 명세에 없거나 중복되었습니다.");
      }
      inputIds.add(item.specItemId);
      if (item.isAvailable && (!Number.isSafeInteger(item.amount) || (item.amount ?? 0) < 1 || (item.amount ?? 0) > MAX_INT)) {
        throw new AppError(400, "VALIDATION_ERROR", "수행 가능한 항목의 금액은 1원 이상의 정수여야 합니다.");
      }
      if (!item.isAvailable && item.amount !== undefined && item.amount !== null) {
        throw new AppError(400, "VALIDATION_ERROR", "수행 불가 항목에는 금액을 입력할 수 없습니다.");
      }
      if (item.isAvailable && specItem.status === SpecItemStatus.INCLUDED) {
        totalAmount += item.amount ?? 0;
        hasAvailableIncludedItem = true;
      }
      const memo = item.memo ?? null;
      const maskedMemo = memo === null ? null : maskContactDetails(memo);
      return {
        specItemId: item.specItemId,
        isAvailable: item.isAvailable,
        amount: item.isAvailable ? item.amount ?? null : null,
        memo: maskedMemo,
        isContactMasked: memo !== null && maskedMemo !== memo,
      };
    });
    if (inputIds.size !== specItems.length) {
      throw new AppError(400, "VALIDATION_ERROR", "현재 명세의 모든 항목별 견적이 필요합니다.");
    }
    if (!hasAvailableIncludedItem) {
      throw new AppError(400, "VALIDATION_ERROR", "최소 한 개의 포함 항목을 수행 가능으로 제출해야 합니다.");
    }
    if (!Number.isSafeInteger(totalAmount) || totalAmount > MAX_INT) {
      throw new AppError(400, "VALIDATION_ERROR", "견적 합계가 허용 범위를 벗어났습니다.");
    }
    if (!Number.isSafeInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > MAX_INT) {
      throw new AppError(400, "VALIDATION_ERROR", "소요일수는 1일 이상의 정수여야 합니다.");
    }

    const latest = await tx.application.findFirst({
      where: { projectId, supplierId },
      orderBy: { revisionNo: "desc" },
      select: { revisionNo: true },
    });
    await tx.application.updateMany({
      where: { projectId, supplierId, status: { in: [...ACTIVE_APPLICATION_STATUSES] } },
      data: { status: ApplicationStatus.SUPERSEDED },
    });
    const application = await tx.application.create({
      data: {
        projectId,
        supplierId,
        revisionNo: (latest?.revisionNo ?? 0) + 1,
        specVersionNo: project.currentVersion,
        status: ApplicationStatus.SUBMITTED,
        totalAmount,
        durationDays: input.durationDays,
        firstViewedAt: supplierView.occurredAt,
        items: { create: items },
      },
    });
    const draft = await tx.draft.findUnique({ where: { id: project.draftId }, select: { clientId: true } });
    if (draft) {
      await createNotification(tx, {
        userId: draft.clientId,
        type: NotificationType.APPLICATION_RECEIVED,
        targetId: application.id,
        targetUrl: `/client/applications/${application.id}`,
      });
    }
    await logEvent(tx, {
      type: EventType.APPLICATION_SUBMITTED,
      userId: supplierId,
      sessionId,
      projectId,
      draftId: project.draftId,
      payload: { applicationId: application.id, revisionNo: application.revisionNo },
    });
    return { id: application.id, status: application.status, revisionNo: application.revisionNo, totalAmount };
  });
}

export async function compareApplications(db: PrismaClient, projectId: string, clientId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null, draft: { clientId } },
    select: { id: true, currentVersion: true },
  });
  if (!project) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  const applications = await db.application.findMany({
    where: { projectId, specVersionNo: project.currentVersion, status: ApplicationStatus.SUBMITTED },
    orderBy: [{ supplierId: "asc" }, { revisionNo: "desc" }],
    include: {
      supplier: { select: { displayName: true } },
      items: {
        include: { specItem: { select: { title: true, status: true, origin: true, sortOrder: true } } },
      },
    },
  });
  const seenSuppliers = new Set<string>();
  const latestApplications = applications.filter((application) => {
    if (seenSuppliers.has(application.supplierId)) return false;
    seenSuppliers.add(application.supplierId);
    return true;
  });
  return {
    items: latestApplications.map((application) => {
      const clientFee = Math.floor(application.totalAmount * 0.05);
      return {
        id: application.id,
        supplierId: application.supplierId,
        supplierName: application.supplier.displayName,
        revisionNo: application.revisionNo,
        totalAmount: application.totalAmount,
        clientFee,
        totalWithClientFee: application.totalAmount + clientFee,
        durationDays: application.durationDays,
        submittedAt: application.submittedAt,
        includedItemCount: application.items.filter((item) => item.isAvailable && item.specItem.status === SpecItemStatus.INCLUDED).length,
        items: [...application.items]
          .sort((left, right) => left.specItem.sortOrder - right.specItem.sortOrder)
          .map((item) => ({
            specItemId: item.specItemId,
            title: item.specItem.title,
            status: item.specItem.status,
            isAvailable: item.isAvailable,
            amount: item.amount,
            memo: item.memo,
          })),
      };
    }),
  };
}

export async function acceptApplication(
  db: PrismaClient,
  applicationId: string,
  clientId: string,
  input: AcceptApplicationInput,
  sessionId?: string,
  now = new Date(),
) {
  const initial = await db.application.findUnique({ where: { id: applicationId }, select: { projectId: true } });
  if (!initial) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
  await processProjectSchedules(db, now);

  return db.$transaction(async (tx) => {
    const projectRows = await tx.$queryRaw<LockedProject[]>(Prisma.sql`SELECT id, "draftId", "currentVersion", status, deadline, "deletedAt" FROM projects WHERE id = ${initial.projectId} FOR UPDATE`);
    const project = projectRows[0];
    if (!project || project.deletedAt !== null) throw new AppError(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    const draft = await tx.draft.findUnique({ where: { id: project.draftId }, select: { clientId: true } });
    if (!draft || draft.clientId !== clientId) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");

    await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`);
    const application = await tx.application.findUnique({ where: { id: applicationId }, select: { id: true, projectId: true, supplierId: true, specVersionNo: true, status: true } });
    if (!application || application.projectId !== project.id) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
    if (project.status !== ProjectStatus.RECRUITING || (project.deadline !== null && project.deadline <= now)) {
      throw new AppError(409, "CONFLICT", "모집 중인 프로젝트만 지원자를 수락할 수 있습니다.");
    }
    if (application.status !== ApplicationStatus.SUBMITTED || application.specVersionNo !== project.currentVersion) {
      throw new AppError(409, "CONFLICT", "최신 명세 기준의 제출된 지원만 수락할 수 있습니다.");
    }

    const [specItems, applicationItems] = await Promise.all([
      tx.specItem.findMany({
        where: { projectId: project.id, versionNo: project.currentVersion },
        select: { id: true, status: true, origin: true },
      }),
      tx.applicationItem.findMany({ where: { applicationId }, select: { specItemId: true, isAvailable: true } }),
    ]);
    const applicationItemById = new Map(applicationItems.map((item) => [item.specItemId, item]));
    const excludedItems = specItems.filter((item) =>
      item.status !== SpecItemStatus.INCLUDED || applicationItemById.get(item.id)?.isAvailable !== true,
    );
    const excludedIds = new Set(excludedItems.map((item) => item.id));
    const confirmedIds = new Set(input.confirmedExcludedItemIds);
    if (confirmedIds.size !== input.confirmedExcludedItemIds.length || [...confirmedIds].some((id) => !excludedIds.has(id))) {
      throw new AppError(400, "VALIDATION_ERROR", "제외 확인 항목이 현재 견적과 일치하지 않습니다.");
    }
    if ([...excludedIds].some((id) => !confirmedIds.has(id))) {
      throw new AppError(409, "CONFLICT", "수행 불가·명세 제외 항목의 처리 여부를 먼저 확인해 주세요.");
    }
    const excludesFirstSentence = excludedItems.some((item) => item.origin === BlockOrigin.FIRST_SENTENCE);
    if (excludesFirstSentence && !input.firstSentenceExclusionConfirmed) {
      throw new AppError(409, "CONFLICT", "첫 문장에서 나온 기능을 제외하는 것을 확인해 주세요.");
    }

    await tx.application.update({ where: { id: applicationId }, data: { status: ApplicationStatus.ACCEPTED } });
    const competingApplications = await tx.application.findMany({
      where: { projectId: project.id, status: ApplicationStatus.SUBMITTED, id: { not: applicationId } },
      select: { id: true, supplierId: true },
    });
    await tx.application.updateMany({
      where: { projectId: project.id, status: ApplicationStatus.SUBMITTED, id: { not: applicationId } },
      data: { status: ApplicationStatus.AUTO_REJECTED },
    });
    await tx.project.update({ where: { id: project.id }, data: { status: ProjectStatus.ACCEPTED } });
    await createNotification(tx, {
      userId: application.supplierId,
      type: NotificationType.APPLICATION_ACCEPTED,
      targetId: applicationId,
      targetUrl: `/supplier/applications/${applicationId}`,
    });
    if (competingApplications.length > 0) {
      await Promise.all(competingApplications.map((row) => createNotification(tx, {
        userId: row.supplierId,
        type: NotificationType.APPLICATION_AUTO_REJECTED,
        targetId: row.id,
        targetUrl: `/supplier/applications/${row.id}`,
      })));
    }
    await logEvent(tx, {
      type: EventType.APPLICATION_ACCEPTED,
      userId: clientId,
      sessionId,
      projectId: project.id,
      draftId: project.draftId,
      payload: { applicationId },
    });
    return { applicationId, applicationStatus: ApplicationStatus.ACCEPTED, projectId: project.id, projectStatus: ProjectStatus.ACCEPTED };
  });
}

export async function rejectApplication(db: PrismaClient, applicationId: string, clientId: string) {
  const initial = await db.application.findUnique({ where: { id: applicationId }, select: { projectId: true } });
  if (!initial) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedProject[]>(Prisma.sql`SELECT id, "draftId", "currentVersion", status, deadline, "deletedAt" FROM projects WHERE id = ${initial.projectId} FOR UPDATE`);
    const project = rows[0];
    if (!project || project.deletedAt !== null) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
    const draft = await tx.draft.findUnique({ where: { id: project.draftId }, select: { clientId: true } });
    if (!draft || draft.clientId !== clientId) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`);
    const application = await tx.application.findUnique({ where: { id: applicationId }, select: { id: true, projectId: true, supplierId: true, status: true } });
    if (!application || application.projectId !== project.id) throw new AppError(404, "NOT_FOUND", "지원을 찾을 수 없습니다.");
    if (project.status !== ProjectStatus.RECRUITING || application.status !== ApplicationStatus.SUBMITTED) {
      throw new AppError(409, "CONFLICT", "현재 거절할 수 있는 제출 지원이 아닙니다.");
    }
    await tx.application.update({ where: { id: applicationId }, data: { status: ApplicationStatus.REJECTED } });
    await createNotification(tx, {
      userId: application.supplierId,
      type: NotificationType.APPLICATION_REJECTED,
      targetId: applicationId,
      targetUrl: `/supplier/applications/${applicationId}`,
    });
    return { applicationId, status: ApplicationStatus.REJECTED };
  });
}

function maskContactDetails(value: string): string {
  return value
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[연락처 숨김]")
    .replace(/(?:\+?82[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[연락처 숨김]");
}

async function requireSupplierNda(db: PrismaClient, supplierId: string): Promise<void> {
  const profile = await db.supplierProfile.findUnique({ where: { userId: supplierId }, select: { ndaAgreedAt: true } });
  if (!profile || profile.ndaAgreedAt === null) {
    throw new AppError(403, "FORBIDDEN", "명세 비밀유지 동의가 필요합니다.");
  }
}
