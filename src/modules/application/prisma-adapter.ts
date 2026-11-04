/**
 * B-02/B-08: 지원 읽기 Port의 Prisma 어댑터.
 *
 * `Application.clientUserId`는 컬럼이 아니라 `Project.clientId`에서 온다.
 * `@prisma/client`를 직접 import하지 않고 필요한 delegate만 구조적으로 받는다.
 */
import type { ApplicationQuestion } from './submission.js';
import type { ApplicationRevision } from './submission.js';
import {
  ApplicationUniqueViolation,
  createApplicationNotificationPort,
  type ApplicationTx,
  type ApplicationUnitOfWork,
  type NewApplicationRevision,
} from './submission.js';
import type { ApplicationReadPort, ProjectApplicationsPort } from './queries.js';
import type { ApplicationStatus } from './dto.js';
import {
  createPrismaNotificationTx,
  type NotificationDbClient,
} from '../notification/prisma-adapter.js';

export interface ApplicationItemRow {
  readonly specItemId: string;
  readonly isAvailable: boolean;
}

export interface ApplicationRow {
  readonly id: string;
  readonly projectId: string;
  readonly supplierId: string;
  readonly revisionNo: number;
  readonly specVersionNo: number;
  readonly status: ApplicationStatus;
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly message: string | null;
  readonly questions: unknown;
  readonly isMessageMasked: boolean;
  readonly revisionReason: string | null;
  readonly firstViewedAt: Date;
  readonly submittedAt: Date;
  readonly items: readonly ApplicationItemRow[];
  readonly project: { readonly clientId: string };
}

export interface ApplicationReadDelegate {
  findMany(input: {
    readonly where: Readonly<Record<string, unknown>>;
    readonly include: { readonly items: true; readonly project: { readonly select: { readonly clientId: true } } };
    readonly orderBy?: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
  }): Promise<readonly ApplicationRow[]>;
  findUnique(input: {
    readonly where: { readonly id: string };
    readonly include: { readonly items: true; readonly project: { readonly select: { readonly clientId: true } } };
  }): Promise<ApplicationRow | null>;
}

export interface ApplicationReadDbClient {
  readonly application: ApplicationReadDelegate;
  readonly project: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly select: { readonly clientId: true };
    }): Promise<{ readonly clientId: string } | null>;
  };
}

const INCLUDE = {
  items: true,
  project: { select: { clientId: true } },
} as const;

function readQuestions(value: unknown): readonly ApplicationQuestion[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('INVALID_APPLICATION_QUESTIONS');
  return value.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { text?: unknown }).text !== 'string'
    ) {
      throw new Error('INVALID_APPLICATION_QUESTIONS');
    }
    return { text: (item as { text: string }).text };
  });
}

export function toApplicationRevision(row: ApplicationRow): ApplicationRevision {
  return {
    id: row.id,
    projectId: row.projectId,
    clientUserId: row.project.clientId,
    supplierId: row.supplierId,
    revisionNo: row.revisionNo,
    specVersionNo: row.specVersionNo,
    status: row.status,
    totalAmount: row.totalAmount,
    durationDays: row.durationDays,
    firstViewedAt: row.firstViewedAt,
    submittedAt: row.submittedAt,
    message: row.message,
    questions: readQuestions(row.questions),
    isMessageMasked: row.isMessageMasked,
    revisionReason: row.revisionReason,
    items: row.items.map((item) => ({
      specItemId: item.specItemId,
      isAvailable: item.isAvailable,
    })),
  };
}

export function createPrismaApplicationReadPort(
  db: ApplicationReadDbClient,
): ApplicationReadPort & ProjectApplicationsPort {
  return {
    async listForUser(input) {
      const rows = await db.application.findMany({
        where:
          input.role === 'CLIENT'
            ? { project: { clientId: input.userId } }
            : { supplierId: input.userId },
        include: INCLUDE,
      });
      return rows.map(toApplicationRevision);
    },

    async findRevision(applicationId) {
      const row = await db.application.findUnique({
        where: { id: applicationId },
        include: INCLUDE,
      });
      return row === null ? null : toApplicationRevision(row);
    },

    async findProjectClientId(projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { clientId: true },
      });
      return project?.clientId ?? null;
    },

    async listRevisionsByProject(projectId) {
      const rows = await db.application.findMany({
        where: { projectId },
        include: INCLUDE,
        orderBy: [{ revisionNo: 'desc' }, { id: 'asc' }],
      });
      return rows.map(toApplicationRevision);
    },
  };
}

export interface ApplicationWriteDelegate extends ApplicationReadDelegate {
  create(input: {
    readonly data: Readonly<Record<string, unknown>>;
    readonly include: typeof INCLUDE;
  }): Promise<ApplicationRow>;
  updateMany(input: {
    readonly where: Readonly<Record<string, unknown>>;
    readonly data: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly count: number }>;
}

export interface ApplicationDbClient {
  readonly application: ApplicationWriteDelegate;
  readonly applicationMessage: {
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<unknown>;
  };
  readonly eventLog: {
    findFirst(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly orderBy: Readonly<Record<string, 'asc' | 'desc'>>;
      readonly select: { readonly occurredAt: true };
    }): Promise<{ readonly occurredAt: Date } | null>;
  };
  readonly notification: NotificationDbClient['notification'];
}

export interface ApplicationPrismaClient extends ApplicationDbClient {
  $transaction<T>(work: (tx: ApplicationDbClient) => Promise<T>): Promise<T>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'P2002'
  );
}

export function createApplicationTx(db: ApplicationDbClient): ApplicationTx {
  return {
    async findFirstDetailView(input) {
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

    async findLatestRevision(input) {
      const rows = await db.application.findMany({
        where: { projectId: input.projectId, supplierId: input.supplierId },
        include: INCLUDE,
        orderBy: [{ revisionNo: 'desc' }],
      });
      const row = rows[0];
      return row === undefined ? null : toApplicationRevision(row);
    },

    async findById(applicationId) {
      const row = await db.application.findUnique({
        where: { id: applicationId },
        include: INCLUDE,
      });
      return row === null ? null : toApplicationRevision(row);
    },

    async listByProject(projectId) {
      const rows = await db.application.findMany({
        where: { projectId },
        include: INCLUDE,
      });
      return rows.map(toApplicationRevision);
    },

    async createRevision(input: NewApplicationRevision) {
      try {
        const row = await db.application.create({
          data: {
            projectId: input.projectId,
            supplierId: input.supplierId,
            revisionNo: input.revisionNo,
            specVersionNo: input.specVersionNo,
            status: 'SUBMITTED',
            totalAmount: input.totalAmount,
            durationDays: input.durationDays,
            message: input.message,
            questions:
              input.questions.length === 0
                ? null
                : input.questions.map((question) => ({ text: question.text })),
            isMessageMasked: input.isMessageMasked,
            revisionReason: input.revisionReason,
            firstViewedAt: input.firstViewedAt,
            submittedAt: input.submittedAt,
            items: {
              create: input.items.map((item) => ({
                specItemId: item.specItemId,
                isAvailable: item.isAvailable,
              })),
            },
          },
          include: INCLUDE,
        });
        return toApplicationRevision(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApplicationUniqueViolation();
        throw error;
      }
    },

    async updateStatus(input) {
      const result = await db.application.updateMany({
        where: { id: input.applicationId, status: { in: input.from } },
        data: { status: input.to },
      });
      return result.count > 0;
    },

    async appendSystemMessage(input) {
      await db.applicationMessage.create({
        data: {
          applicationId: input.applicationId,
          senderId: null,
          kind: 'SYSTEM',
          body: input.body,
          isMasked: false,
        },
      });
    },

    notifications: createApplicationNotificationPort(createPrismaNotificationTx(db)),
  };
}

export function createPrismaApplicationUnitOfWork(
  prisma: ApplicationPrismaClient,
): ApplicationUnitOfWork {
  return {
    run<T>(work: (tx: ApplicationTx) => Promise<T>): Promise<T> {
      return prisma.$transaction((tx) => work(createApplicationTx(tx)));
    },
  };
}
