/**
 * Gate 2: A가 호출하는 B Port 어댑터.
 *
 * A는 자기 트랜잭션(`ProjectTx`)을 넘기므로, B 도메인에 그 tx의 delegate를
 * 구조적으로 연결한다. A 코드는 import하지 않는다.
 */
import type {
  ProjectSearchPort,
  RecruitmentStatusFilter,
} from '../modules/market/project-search.js';
import {
  recordProjectDetailView,
  type ProjectViewPort,
} from '../modules/market/project-detail.js';
import {
  markApplicationsStaleInTransaction,
  createApplicationNotificationPort,
  type ApplicationTx,
} from '../modules/application/submission.js';
import { toApplicationRevision, type ApplicationRow } from '../modules/application/prisma-adapter.js';
import {
  createPrismaNotificationTx,
  type NotificationDbClient,
} from '../modules/notification/prisma-adapter.js';

export interface AProjectSearchQuery {
  readonly filters: {
    readonly industryCode?: string;
    readonly skill?: string;
    readonly status?: string;
    readonly minBudget?: number;
    readonly maxBudget?: number;
    readonly deadlineBefore?: Date;
  };
  readonly page: number;
  readonly pageSize: number;
}

export interface AProjectSearchPort {
  searchPublicProjects(query: AProjectSearchQuery): Promise<{
    readonly projectIds: readonly string[];
    readonly total: number;
  }>;
}

function statusFilter(status: string | undefined): RecruitmentStatusFilter | undefined {
  if (status === undefined) return undefined;
  return status === 'RECRUITING' ? 'OPEN' : 'CLOSED';
}

/** A 검색 쿼리를 B 검색 Port로 옮긴다. A는 id 목록만 받아 자기 DB에서 다시 읽는다. */
export function createAProjectSearchPort(search: ProjectSearchPort): AProjectSearchPort {
  return {
    async searchPublicProjects(query) {
      const page = await search.searchPublicProjects({
        filters: {
          ...(query.filters.industryCode === undefined
            ? {}
            : { industryCode: query.filters.industryCode }),
          ...(query.filters.skill === undefined
            ? {}
            : { requiredSkills: [query.filters.skill] }),
          ...(query.filters.minBudget === undefined
            ? {}
            : { minBudgetKrw: query.filters.minBudget }),
          ...(query.filters.maxBudget === undefined
            ? {}
            : { maxBudgetKrw: query.filters.maxBudget }),
          ...(query.filters.deadlineBefore === undefined
            ? {}
            : { deadlineBefore: query.filters.deadlineBefore }),
          ...(statusFilter(query.filters.status) === undefined
            ? {}
            : { recruitmentStatus: statusFilter(query.filters.status) }),
        },
        page: query.page,
      });
      return { projectIds: page.items.map((item) => item.id), total: page.meta.total };
    },
  };
}

export interface AProjectDb {
  readonly application: {
    findMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly include: {
        readonly items: true;
        readonly project: { readonly select: { readonly clientId: true } };
      };
    }): Promise<readonly ApplicationRow[]>;
    updateMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly data: Readonly<Record<string, unknown>>;
    }): Promise<{ readonly count: number }>;
    count(input: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
  };
  readonly eventLog: {
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<unknown>;
    findFirst(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly orderBy: Readonly<Record<string, 'asc' | 'desc'>>;
      readonly select: { readonly occurredAt: true };
    }): Promise<{ readonly occurredAt: Date } | null>;
  };
  readonly notification: NotificationDbClient['notification'];
}

const INCLUDE = {
  items: true,
  project: { select: { clientId: true } },
} as const;

function applicationDelegates(
  tx: AProjectDb,
): Pick<ApplicationTx, 'listByProject' | 'updateStatus' | 'notifications'> {
  return {
    async listByProject(projectId) {
      const rows = await tx.application.findMany({ where: { projectId }, include: INCLUDE });
      return rows.map(toApplicationRevision);
    },
    async updateStatus(input) {
      const result = await tx.application.updateMany({
        where: { id: input.applicationId, status: { in: input.from } },
        data: { status: input.to },
      });
      return result.count > 0;
    },
    notifications: createApplicationNotificationPort(createPrismaNotificationTx(tx)),
  };
}

/** A `ProjectViewPort.recordFirstView` 구현. 상세 열람을 EventLog에 남긴다. */
export function createAProjectViewPort(db: AProjectDb): {
  recordFirstView(input: {
    readonly projectId: string;
    readonly supplierId: string;
    readonly at: Date;
  }): Promise<void>;
} {
  const port: ProjectViewPort = {
    async findFirstViewedAt(input) {
      const row = await db.eventLog.findFirst({
        where: {
          type: 'SPEC_DETAIL_VIEWED',
          projectId: input.projectId,
          userId: input.supplierId,
        },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      return row === null ? null : row.occurredAt;
    },
    async recordDetailView(input) {
      await db.eventLog.create({
        data: {
          userId: input.supplierId,
          type: 'SPEC_DETAIL_VIEWED',
          projectId: input.projectId,
          occurredAt: input.viewedAt,
        },
      });
    },
  };

  return {
    async recordFirstView(input) {
      await recordProjectDetailView(port, {
        projectId: input.projectId,
        supplierId: input.supplierId,
        viewedAt: input.at,
      });
    },
  };
}

/** A `ProjectApplicationPort` 구현. A의 명세/삭제 트랜잭션에 참여한다. */
export function createAProjectApplicationPort(db: AProjectDb): {
  countPending(tx: AProjectDb, projectId: string): Promise<number>;
  markSpecStale(
    tx: AProjectDb,
    input: { readonly projectId: string; readonly newVersionNo: number; readonly at: Date },
  ): Promise<number>;
  rejectPendingOnDelete(
    tx: AProjectDb,
    input: { readonly projectId: string; readonly at: Date },
  ): Promise<number>;
} {
  return {
    countPending(tx, projectId) {
      return tx.application.count({
        where: { projectId, status: { in: ['SUBMITTED', 'STALE'] } },
      });
    },

    markSpecStale(tx, input) {
      // ponytail: newVersionNo는 B가 저장하지 않는다. STALE 전환과 재견적 알림만 한다.
      return markApplicationsStaleInTransaction(applicationDelegates(tx), {
        projectId: input.projectId,
        now: input.at,
      });
    },

    async rejectPendingOnDelete(tx, input) {
      const result = await tx.application.updateMany({
        where: {
          projectId: input.projectId,
          status: { in: ['SUBMITTED', 'STALE'] },
        },
        data: { status: 'REJECTED' },
      });
      return result.count;
    },
  };
}
