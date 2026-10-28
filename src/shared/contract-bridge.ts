import {
  ApplicationStatus,
  BlockOrigin,
  Prisma,
  ProjectStatus,
  SpecItemStatus,
} from "@prisma/client";
import type { DbTx } from "../db.ts";
import { AppError } from "./errors.ts";
import { logEvent } from "./events.ts";

export type ScopeExclusionReason =
  | "SPEC_EXCLUDED"
  | "NEEDS_CONFIRMATION"
  | "SUPPLIER_UNAVAILABLE";

export interface AcceptedContractScopeItem {
  applicationItemId: string;
  specItemId: string;
  blockId: string | null;
  title: string;
  description: string;
  origin: BlockOrigin;
  questions: Prisma.JsonValue | null;
  proposedAmount: number | null;
  memo: string | null;
  sortOrder: number;
}

export interface ExcludedContractScopeItem {
  specItemId: string;
  applicationItemId: string | null;
  blockId: string | null;
  title: string;
  origin: BlockOrigin;
  isFirstSentenceOrigin: boolean;
  reason: ScopeExclusionReason;
}

export interface AcceptedApplicationContext {
  applicationId: string;
  projectId: string;
  projectTitle: string;
  projectStatus: ProjectStatus;
  specVersionNo: number;
  clientId: string;
  supplierId: string;
  proposedTotalAmount: number;
  durationDays: number;
  firstViewedAt: Date;
  submittedAt: Date;
  specItems: {
    id: string;
    versionNo: number;
    title: string;
    description: string;
    status: SpecItemStatus;
    sortOrder: number;
  }[];
  applicationItems: { specItemId: string; isAvailable: boolean; amount: number | null }[];
  includedItems: AcceptedContractScopeItem[];
  excludedItems: ExcludedContractScopeItem[];
}

export type ContractProjectAction =
  | {
      type: "CONTRACT_SIGNED";
      actorUserId?: string;
      sessionId?: string | null;
    }
  | {
      type: "CONTRACT_CANCELLED";
      cancelledAt: Date;
      newDeadline?: Date;
      actorUserId?: string;
      sessionId?: string | null;
    };

export interface ContractProjectTransitionResult {
  projectId: string;
  projectStatus: ProjectStatus;
  applicationId: string;
  applicationStatus: ApplicationStatus;
}

export async function getAcceptedApplicationContext(
  tx: DbTx,
  applicationId: string,
): Promise<AcceptedApplicationContext> {
  const application = await tx.application.findUnique({
    where: { id: applicationId },
    include: {
      project: {
        include: {
          draft: { select: { clientId: true } },
        },
      },
      items: {
        include: { specItem: true },
      },
    },
  });

  if (!application) {
    throw new AppError(404, "NOT_FOUND", "지원서를 찾을 수 없습니다.");
  }
  if (application.project.deletedAt !== null) {
    throw new AppError(409, "CONFLICT", "삭제된 프로젝트의 지원서입니다.");
  }
  if (application.status !== ApplicationStatus.ACCEPTED) {
    throw new AppError(409, "CONFLICT", "수락된 지원서만 계약에 연결할 수 있습니다.");
  }
  if (application.specVersionNo !== application.project.currentVersion) {
    throw new AppError(409, "CONFLICT", "최신 명세 버전과 일치하지 않는 지원서입니다.");
  }
  if (
    application.project.status !== ProjectStatus.ACCEPTED &&
    application.project.status !== ProjectStatus.CONTRACTED
  ) {
    throw new AppError(409, "CONFLICT", "프로젝트가 수락 또는 계약 단계가 아닙니다.");
  }

  for (const appItem of application.items) {
    if (
      appItem.specItem.projectId !== application.projectId ||
      appItem.specItem.versionNo !== application.specVersionNo
    ) {
      throw new AppError(409, "CONFLICT", "지원 항목의 프로젝트·명세 버전 소속이 일치하지 않습니다.");
    }
  }

  const specItems = await tx.specItem.findMany({
    where: {
      projectId: application.projectId,
      versionNo: application.specVersionNo,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  const appItemBySpecId = new Map(application.items.map((item) => [item.specItemId, item]));
  const includedItems: AcceptedContractScopeItem[] = [];
  const excludedItems: ExcludedContractScopeItem[] = [];

  for (const specItem of specItems) {
    const appItem = appItemBySpecId.get(specItem.id);
    if (specItem.status === SpecItemStatus.INCLUDED) {
      if (appItem?.isAvailable) {
        includedItems.push({
          applicationItemId: appItem.id,
          specItemId: specItem.id,
          blockId: specItem.blockId,
          title: specItem.title,
          description: specItem.description,
          origin: specItem.origin,
          questions: specItem.questions,
          proposedAmount: appItem.amount,
          memo: appItem.memo,
          sortOrder: specItem.sortOrder,
        });
      } else {
        excludedItems.push({
          specItemId: specItem.id,
          applicationItemId: appItem?.id ?? null,
          blockId: specItem.blockId,
          title: specItem.title,
          origin: specItem.origin,
          isFirstSentenceOrigin: specItem.origin === BlockOrigin.FIRST_SENTENCE,
          reason: "SUPPLIER_UNAVAILABLE",
        });
      }
    } else if (specItem.status === SpecItemStatus.NEEDS_CONFIRMATION) {
      excludedItems.push({
        specItemId: specItem.id,
        applicationItemId: appItem?.id ?? null,
        blockId: specItem.blockId,
        title: specItem.title,
        origin: specItem.origin,
        isFirstSentenceOrigin: specItem.origin === BlockOrigin.FIRST_SENTENCE,
        reason: "NEEDS_CONFIRMATION",
      });
    } else {
      excludedItems.push({
        specItemId: specItem.id,
        applicationItemId: appItem?.id ?? null,
        blockId: specItem.blockId,
        title: specItem.title,
        origin: specItem.origin,
        isFirstSentenceOrigin: specItem.origin === BlockOrigin.FIRST_SENTENCE,
        reason: "SPEC_EXCLUDED",
      });
    }
  }

  if (includedItems.length === 0) {
    throw new AppError(409, "CONFLICT", "계약 범위에 포함할 수행 가능 항목이 없습니다.");
  }

  return {
    applicationId: application.id,
    projectId: application.projectId,
    projectTitle: application.project.title,
    projectStatus: application.project.status,
    specVersionNo: application.specVersionNo,
    clientId: application.project.draft.clientId,
    supplierId: application.supplierId,
    proposedTotalAmount: application.totalAmount,
    durationDays: application.durationDays,
    firstViewedAt: application.firstViewedAt,
    submittedAt: application.submittedAt,
    specItems: specItems.map(({ id, versionNo, title, description, status, sortOrder }) => ({
      id,
      versionNo,
      title,
      description,
      status,
      sortOrder,
    })),
    applicationItems: application.items.map(({ specItemId, isAvailable, amount }) => ({
      specItemId,
      isAvailable,
      amount,
    })),
    includedItems,
    excludedItems,
  };
}

interface LockedApplicationRow {
  id: string;
  projectId: string;
  specVersionNo: number;
  status: ApplicationStatus;
}

interface LockedProjectRow {
  id: string;
  status: ProjectStatus;
  currentVersion: number;
  recruitStartAt: Date | null;
  deadline: Date | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
}

export async function transitionProjectForContract(
  tx: DbTx,
  applicationId: string,
  action: ContractProjectAction,
): Promise<ContractProjectTransitionResult> {
  const appRows = await tx.$queryRaw<LockedApplicationRow[]>(
    Prisma.sql`SELECT id, "projectId", "specVersionNo", status FROM applications WHERE id = ${applicationId} FOR UPDATE`,
  );
  const appRow = appRows[0];
  if (!appRow) {
    throw new AppError(404, "NOT_FOUND", "지원서를 찾을 수 없습니다.");
  }

  const projRows = await tx.$queryRaw<LockedProjectRow[]>(
    Prisma.sql`SELECT id, status, "currentVersion", "recruitStartAt", deadline, "publishedAt", "deletedAt" FROM projects WHERE id = ${appRow.projectId} FOR UPDATE`,
  );
  const projRow = projRows[0];
  if (!projRow || projRow.deletedAt !== null) {
    throw new AppError(409, "CONFLICT", "유효하지 않은 프로젝트 상태입니다.");
  }

  if (action.type === "CONTRACT_SIGNED") {
    if (appRow.status !== ApplicationStatus.ACCEPTED) {
      throw new AppError(409, "CONFLICT", "수락된 지원서만 계약 체결 상태로 전환할 수 있습니다.");
    }
    if (appRow.specVersionNo !== projRow.currentVersion) {
      throw new AppError(409, "CONFLICT", "명세 버전이 일치하지 않아 계약을 체결할 수 없습니다.");
    }
    if (
      projRow.status !== ProjectStatus.ACCEPTED &&
      projRow.status !== ProjectStatus.CONTRACTED
    ) {
      throw new AppError(409, "CONFLICT", "프로젝트가 계약 체결 가능 상태가 아닙니다.");
    }

    if (projRow.status !== ProjectStatus.CONTRACTED) {
      await tx.project.update({
        where: { id: projRow.id },
        data: { status: ProjectStatus.CONTRACTED },
      });
      await logEvent(tx, {
        type: "CONTRACT_AGREED",
        userId: action.actorUserId ?? null,
        sessionId: action.sessionId ?? null,
        projectId: projRow.id,
        payload: { applicationId: appRow.id },
      });
    }

    return {
      projectId: projRow.id,
      projectStatus: ProjectStatus.CONTRACTED,
      applicationId: appRow.id,
      applicationStatus: ApplicationStatus.ACCEPTED,
    };
  }

  if (appRow.status !== ApplicationStatus.ACCEPTED) {
    throw new AppError(409, "CONFLICT", "수락 상태인 지원서만 계약 취소에 따른 거절 처리가 가능합니다.");
  }
  if (
    projRow.status !== ProjectStatus.ACCEPTED &&
    projRow.status !== ProjectStatus.CONTRACTED
  ) {
    throw new AppError(409, "CONFLICT", "수락 또는 계약 단계 프로젝트만 모집 복귀할 수 있습니다.");
  }
  if (
    action.newDeadline &&
    projRow.recruitStartAt &&
    action.newDeadline <= projRow.recruitStartAt
  ) {
    throw new AppError(400, "VALIDATION_ERROR", "새 마감일은 모집 시작일보다 뒤여야 합니다.");
  }

  await tx.application.update({
    where: { id: appRow.id },
    data: { status: ApplicationStatus.REJECTED },
  });

  await tx.project.update({
    where: { id: projRow.id },
    data: {
      status: ProjectStatus.RECRUITING,
      publishedAt: projRow.publishedAt ?? action.cancelledAt,
      ...(action.newDeadline !== undefined ? { deadline: action.newDeadline } : {}),
    },
  });

  return {
    projectId: projRow.id,
    projectStatus: ProjectStatus.RECRUITING,
    applicationId: appRow.id,
    applicationStatus: ApplicationStatus.REJECTED,
  };
}
