/**
 * B-06-U02: C 정산·납품 알림 포트 bridge.
 *
 * C는 `{userId,type,targetId,targetUrl?}`만 넘기고 payload/dueAt을 넘기지 않는다.
 * B는 targetUrl을 타입별 고정 경로로만 만들므로 C가 준 URL은 무시한다.
 * 기한 알림 4종은 dueAt이 필요하므로 현재 계약으로는 생성되지 않는다.
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
  }): Promise<{ readonly created: boolean }>;
}

export function createNotificationBridge(
  notificationTx: NotificationTx,
  options: { readonly now: () => Date },
): CNotificationPorts {
  return {
    createOnce: (input) =>
      createNotificationOnceInTransaction(notificationTx, {
        userId: input.userId,
        type: input.type,
        targetId: input.targetId,
        now: options.now(),
      }),
  };
}
