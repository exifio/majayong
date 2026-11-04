/**
 * B-06: 알림 도메인 Port의 Prisma 어댑터.
 *
 * `@prisma/client`를 직접 import하지 않고 필요한 delegate/`$transaction`만
 * 구조적으로 받는다. 통합에서는 `PrismaClient`를 그대로 넘기면 된다.
 *
 * 전제: `Notification`에 `@@unique([userId, type, targetId])`가 적용되어 있어야
 * `findUnique`/P2002 기반 중복 방지가 동작한다. (docs/B06_CONTRACT_PROPOSAL.md)
 */
import {
  NotificationUniqueViolation,
  isNotificationType,
  type NewNotification,
  type NotificationRecord,
  type NotificationTx,
  type NotificationType,
  type NotificationUnitOfWork,
} from './notifications.js';

export interface NotificationDbRow {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly targetUrl: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly isRead: boolean;
  readonly createdAt: Date;
}

export interface NotificationWhere {
  readonly id?: string;
  readonly userId?: string;
  readonly type?: NotificationType;
  readonly targetId?: string;
  readonly isRead?: boolean;
  readonly createdAt?: {
    readonly gte?: Date;
    readonly lte?: Date;
  };
}

export interface NotificationDelegate {
  findUnique(input: {
    readonly where: {
      readonly userId_type_targetId: {
        readonly userId: string;
        readonly type: NotificationType;
        readonly targetId: string;
      };
    };
  }): Promise<NotificationDbRow | null>;
  create(input: { readonly data: NewNotification }): Promise<NotificationDbRow>;
  update(input: {
    readonly where: { readonly id: string };
    readonly data: { readonly createdAt?: Date; readonly isRead?: boolean };
  }): Promise<NotificationDbRow>;
  findMany(input: {
    readonly where: NotificationWhere;
    readonly orderBy: readonly (
      | { readonly createdAt: 'desc' }
      | { readonly id: 'desc' }
    )[];
  }): Promise<readonly NotificationDbRow[]>;
  count(input: { readonly where: NotificationWhere }): Promise<number>;
  updateMany(input: {
    readonly where: NotificationWhere;
    readonly data: { readonly createdAt?: Date; readonly isRead?: boolean };
  }): Promise<{ readonly count: number }>;
}

export interface NotificationDbClient {
  readonly notification: NotificationDelegate;
}

export interface NotificationPrismaClient extends NotificationDbClient {
  $transaction<T>(work: (tx: NotificationDbClient) => Promise<T>): Promise<T>;
}

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function toRecord(row: NotificationDbRow): NotificationRecord {
  if (!isNotificationType(row.type)) {
    throw new Error(`알 수 없는 알림 타입입니다: ${String(row.type)}`);
  }
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    targetUrl: row.targetUrl,
    targetId: row.targetId,
    payload: row.payload,
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}

function createNotificationTx(db: NotificationDbClient): NotificationTx {
  return {
    async findByKey(input) {
      const row = await db.notification.findUnique({
        where: {
          userId_type_targetId: {
            userId: input.userId,
            type: input.type,
            targetId: input.targetId,
          },
        },
      });
      return row === null ? null : toRecord(row);
    },

    async create(input) {
      try {
        return toRecord(await db.notification.create({ data: input }));
      } catch (error) {
        if (isUniqueViolation(error)) throw new NotificationUniqueViolation();
        throw error;
      }
    },

    async refreshBundled(input) {
      const row = await db.notification.update({
        where: { id: input.id },
        data: { createdAt: input.createdAt, isRead: false },
      });
      return toRecord(row);
    },

    async listRecent(input) {
      const rows = await db.notification.findMany({
        where: {
          userId: input.userId,
          createdAt: { gte: input.since, lte: input.now },
          ...(input.unreadOnly ? { isRead: false } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(toRecord);
    },

    countUnread(input) {
      return db.notification.count({
        where: {
          userId: input.userId,
          isRead: false,
          createdAt: { gte: input.since, lte: input.now },
        },
      });
    },

    async markRead(input) {
      const result = await db.notification.updateMany({
        where: { id: input.notificationId, userId: input.userId },
        data: { isRead: true },
      });
      return result.count > 0;
    },

    async markAllRead(input) {
      const result = await db.notification.updateMany({
        where: {
          userId: input.userId,
          isRead: false,
          createdAt: { gte: input.since, lte: input.now },
        },
        data: { isRead: true },
      });
      return result.count;
    },
  };
}

export function createPrismaNotificationUnitOfWork(
  prisma: NotificationPrismaClient,
): NotificationUnitOfWork {
  return {
    run<T>(work: (tx: NotificationTx) => Promise<T>): Promise<T> {
      return prisma.$transaction((tx) => work(createNotificationTx(tx)));
    },
  };
}
