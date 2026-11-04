/**
 * B-07: 신고 Port의 Prisma 어댑터.
 *
 * 계정 제재(`applyAccountAction`)는 A 소유 User 쓰기이므로 주입받는다.
 * 신고 알림/이벤트는 같은 트랜잭션의 Notification/EventLog delegate로 남긴다.
 */
import {
  createNotificationOnceInTransaction,
  type NotificationTx,
} from '../notification/notifications.js';
import type {
  MyReportQueryPort,
  ReportActor,
  ReportReason,
  ReportRecord,
  ReportStatus,
  ReportUnitOfWork,
  ReportTx,
} from './reports.js';

export interface ReportRow {
  readonly id: string;
  readonly messageId: string;
  readonly reporterId: string;
  readonly targetUserId: string;
  readonly reason: ReportReason;
  readonly detail: string | null;
  readonly status: ReportStatus;
  readonly action: 'NONE' | 'WARNING' | 'CHAT_RESTRICT_7D' | 'SUSPEND' | null;
  readonly actionNote: string | null;
  readonly resolvedById: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export interface ReportMessageRow {
  readonly id: string;
  readonly senderId: string | null;
  readonly application: {
    readonly supplierId: string;
    readonly project: { readonly clientId: string };
  };
}

export interface ReportDbClient {
  readonly applicationMessage: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly include: {
        readonly application: {
          readonly select: {
            readonly supplierId: true;
            readonly project: { readonly select: { readonly clientId: true } };
          };
        };
      };
    }): Promise<ReportMessageRow | null>;
  };
  readonly report: {
    findFirst(input: {
      readonly where: Readonly<Record<string, unknown>>;
    }): Promise<ReportRow | null>;
    findMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly orderBy?: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
    }): Promise<readonly ReportRow[]>;
    findUnique(input: {
      readonly where: { readonly id: string };
    }): Promise<ReportRow | null>;
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<ReportRow>;
    update(input: {
      readonly where: { readonly id: string };
      readonly data: Readonly<Record<string, unknown>>;
    }): Promise<ReportRow>;
    count(input: { readonly where: Readonly<Record<string, unknown>> }): Promise<number>;
  };
  readonly eventLog: {
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<unknown>;
  };
  readonly notification: NotificationTx;
}

export interface ReportPrismaClient extends ReportDbClient {
  $transaction<T>(work: (tx: ReportDbClient) => Promise<T>): Promise<T>;
}

export interface ReportAccountActionPort {
  applyAccountAction(input: {
    readonly userId: string;
    readonly action: 'CHAT_RESTRICT_7D' | 'SUSPEND';
    readonly at: Date;
    readonly until: Date | null;
  }): Promise<void>;
}

function toRecord(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    messageId: row.messageId,
    reporterId: row.reporterId,
    targetUserId: row.targetUserId,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    action: row.action,
    actionNote: row.actionNote,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

export function createReportTx(
  db: ReportDbClient,
  accounts: ReportAccountActionPort,
  now: () => Date,
): ReportTx {
  return {
    async findReportableMessage(messageId) {
      const row = await db.applicationMessage.findUnique({
        where: { id: messageId },
        include: {
          application: {
            select: { supplierId: true, project: { select: { clientId: true } } },
          },
        },
      });
      if (row === null) return null;
      return {
        id: row.id,
        senderId: row.senderId,
        participantIds: [row.application.project.clientId, row.application.supplierId],
      };
    },

    async findOpenReport(input) {
      const row = await db.report.findFirst({
        where: { messageId: input.messageId, reporterId: input.reporterId, status: 'OPEN' },
      });
      return row === null ? null : toRecord(row);
    },

    async createReport(input) {
      return toRecord(
        await db.report.create({
          data: {
            messageId: input.messageId,
            reporterId: input.reporterId,
            targetUserId: input.targetUserId,
            reason: input.reason,
            detail: input.detail,
            createdAt: input.createdAt,
          },
        }),
      );
    },

    async listReports(input) {
      const rows = await db.report.findMany({
        where: input.status === undefined ? {} : { status: input.status },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map(toRecord);
    },

    async findReport(reportId) {
      const row = await db.report.findUnique({ where: { id: reportId } });
      return row === null ? null : toRecord(row);
    },

    findWarningCount(targetUserId) {
      return db.report.count({ where: { targetUserId, action: 'WARNING' } });
    },

    async resolveReport(input) {
      const exists = await db.report.findUnique({ where: { id: input.reportId } });
      if (exists === null) return null;
      return toRecord(
        await db.report.update({
          where: { id: input.reportId },
          data: {
            status: 'RESOLVED',
            action: input.action,
            actionNote: input.actionNote,
            resolvedById: input.resolvedById,
            resolvedAt: input.resolvedAt,
          },
        }),
      );
    },

    applyAccountAction(input) {
      return accounts.applyAccountAction(input);
    },

    async notifyReporter(input) {
      await createNotificationOnceInTransaction(db.notification, {
        userId: input.userId,
        type: 'REPORT_REVIEWED',
        targetId: input.reportId,
        now: now(),
      });
    },

    async logEvent(input) {
      await db.eventLog.create({
        data: {
          userId: input.userId,
          type: input.type,
          payload: input.payload,
        },
      });
    },
  };
}

export function createPrismaReportUnitOfWork(
  prisma: ReportPrismaClient,
  accounts: ReportAccountActionPort,
  now: () => Date,
): ReportUnitOfWork {
  return {
    run<T>(work: (tx: ReportTx) => Promise<T>): Promise<T> {
      return prisma.$transaction((tx) => work(createReportTx(tx, accounts, now)));
    },
  };
}

export function createPrismaMyReportQueryPort(db: ReportDbClient): MyReportQueryPort {
  return {
    async listByReporter(input) {
      const rows = await db.report.findMany({
        where:
          input.status === undefined
            ? { reporterId: input.reporterId }
            : { reporterId: input.reporterId, status: input.status },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map(toRecord);
    },
  };
}

export type { ReportActor };
