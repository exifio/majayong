/**
 * B-06-U02: C 정산·납품 알림 포트 bridge.
 *
 * C는 `{userId,type,targetId,targetUrl?,dueAt?}`를 넘긴다. B는 targetUrl을 타입별
 * 고정 경로로만 만들므로 C가 준 URL은 무시한다. 기한 알림 4종(DEPOSIT_DUE/
 * INSPECTION_DUE/WORK_DUE/WORK_OVERDUE)은 C가 넘긴 dueAt을 B payload `{dueAt}`로 옮긴다.
 */
import {
  createNotificationOnceInTransaction,
  type NotificationTx,
} from './notifications.js';

export interface CNotificationPorts {
  createOnce(input: {
    readonly userId: string;
    readonly type: string;
    readonly targetId: string;
    readonly targetUrl?: string;
    /** 기한 알림 4종은 dueAt이 있어야 B가 payload를 만들 수 있다. */
    readonly dueAt?: Date;
  }, tx?: unknown): Promise<{ readonly created: boolean }>;
}

export function createNotificationBridge(
  notificationTx: NotificationTx,
  options: {
    readonly now: () => Date;
    /** 배치의 transaction client를 B 알림 Tx로 옮긴다. 없으면 루트 delegate를 쓴다. */
    readonly notificationTxFor?: (tx: unknown) => NotificationTx;
  },
): CNotificationPorts {
  return {
    createOnce: (input, tx) => {
      const target =
        tx !== undefined && options.notificationTxFor !== undefined
          ? options.notificationTxFor(tx)
          : notificationTx;
      return createNotificationOnceInTransaction(target, {
        userId: input.userId,
        type: input.type,
        targetId: input.targetId,
        ...(input.dueAt === undefined ? {} : { payload: { dueAt: input.dueAt.toISOString() } }),
        now: options.now(),
      });
    },
  };
}
