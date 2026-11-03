import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  NotificationError,
  chatRoomTargetId,
  isDeadlineNotificationType,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  notifyFromContractEvent,
  notifyNewMessage,
  recipientsFor,
  type NewNotification,
  type NotificationParties,
  type NotificationRecord,
  type NotificationTx,
  type NotificationType,
  type NotificationUnitOfWork,
} from '../../src/modules/notification/notifications.ts';
import { FIXED_NOW } from './fixtures.ts';

const CLIENT = 'client-1';
const SUPPLIER = 'supplier-1';

const PARTIES: NotificationParties = {
  clientUserId: CLIENT,
  supplierUserId: SUPPLIER,
  reporterUserId: 'reporter-1',
  inquiryAuthorUserId: 'author-1',
};

const DUE_AT = '2026-11-05T14:59:59.999Z';

function isNotificationError(status: number, code: string) {
  return (error: unknown): boolean =>
    error instanceof NotificationError && error.status === status && error.code === code;
}

class FakeNotificationTx implements NotificationTx {
  rows: NotificationRecord[] = [];
  private nextId = 1;

  async findByKey(input: {
    readonly userId: string;
    readonly type: NotificationType;
    readonly targetId: string;
  }): Promise<NotificationRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.userId === input.userId &&
          row.type === input.type &&
          row.targetId === input.targetId,
      ) ?? null
    );
  }

  async create(input: NewNotification): Promise<NotificationRecord> {
    const created: NotificationRecord = {
      ...input,
      id: `notification-${this.nextId}`,
      isRead: false,
    };
    this.nextId += 1;
    this.rows.push(created);
    return created;
  }

  async refreshBundled(input: {
    readonly id: string;
    readonly createdAt: Date;
  }): Promise<NotificationRecord> {
    const index = this.rows.findIndex((row) => row.id === input.id);
    const current = this.rows[index];
    if (index < 0 || current === undefined) throw new Error('missing notification');
    const updated: NotificationRecord = {
      ...current,
      createdAt: input.createdAt,
      isRead: false,
    };
    this.rows[index] = updated;
    return updated;
  }

  async listRecent(input: {
    readonly userId: string;
    readonly since: Date;
    readonly now: Date;
    readonly unreadOnly: boolean;
  }): Promise<readonly NotificationRecord[]> {
    return this.rows
      .filter(
        (row) =>
          row.userId === input.userId &&
          row.createdAt.getTime() >= input.since.getTime() &&
          row.createdAt.getTime() <= input.now.getTime() &&
          (!input.unreadOnly || !row.isRead),
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
      );
  }

  async countUnread(input: {
    readonly userId: string;
    readonly since: Date;
    readonly now: Date;
  }): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.userId === input.userId &&
        !row.isRead &&
        row.createdAt.getTime() >= input.since.getTime() &&
        row.createdAt.getTime() <= input.now.getTime(),
    ).length;
  }

  async markRead(input: {
    readonly notificationId: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.id === input.notificationId && row.userId === input.userId,
    );
    const current = this.rows[index];
    if (index < 0 || current === undefined) return false;
    this.rows[index] = { ...current, isRead: true };
    return true;
  }

  async markAllRead(input: {
    readonly userId: string;
    readonly since: Date;
    readonly now: Date;
  }): Promise<number> {
    let changed = 0;
    for (let index = 0; index < this.rows.length; index += 1) {
      const row = this.rows[index];
      if (row === undefined) continue;
      if (row.userId !== input.userId || row.isRead) continue;
      if (row.createdAt.getTime() < input.since.getTime()) continue;
      if (row.createdAt.getTime() > input.now.getTime()) continue;
      this.rows[index] = { ...row, isRead: true };
      changed += 1;
    }
    return changed;
  }
}

class FakeUnitOfWork implements NotificationUnitOfWork {
  readonly tx: FakeNotificationTx;

  constructor(tx: FakeNotificationTx = new FakeNotificationTx()) {
    this.tx = tx;
  }

  async run<T>(work: (tx: NotificationTx) => Promise<T>): Promise<T> {
    return work(this.tx);
  }
}

interface TypeCase {
  readonly type: NotificationType;
  readonly targetId: string;
  readonly userId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly targetUrl: string;
}

const TYPE_CASES: readonly TypeCase[] = [
  {
    type: 'APPLICATION_RECEIVED',
    targetId: 'project-1',
    userId: CLIENT,
    targetUrl: '/projects/project-1/applications',
  },
  {
    type: 'APPLICATION_ACCEPTED',
    targetId: 'contract-1',
    userId: SUPPLIER,
    targetUrl: '/contracts/contract-1/sign',
  },
  {
    type: 'APPLICATION_AUTO_REJECTED',
    targetId: 'application-1',
    userId: SUPPLIER,
    targetUrl: '/applications/application-1',
  },
  {
    type: 'APPLICATION_REJECTED',
    targetId: 'application-2',
    userId: SUPPLIER,
    targetUrl: '/applications/application-2',
  },
  {
    type: 'PROJECT_CLOSED',
    targetId: 'project-2',
    userId: CLIENT,
    targetUrl: '/projects/project-2',
  },
  {
    type: 'REQUOTE_REQUESTED',
    targetId: 'application-3',
    userId: SUPPLIER,
    targetUrl: '/applications/application-3',
  },
  {
    type: 'NEW_MESSAGE',
    targetId: 'project-3:supplier-1',
    userId: SUPPLIER,
    targetUrl: '/chat/project-3:supplier-1',
  },
  {
    type: 'CONTRACT_BROKEN',
    targetId: 'contract-2',
    userId: CLIENT,
    payload: { reason: 'SIGN_REFUSED' },
    targetUrl: '/contracts/contract-2',
  },
  {
    type: 'DEPOSIT_DUE',
    targetId: 'contract-3',
    userId: CLIENT,
    payload: { dueAt: DUE_AT },
    targetUrl: '/contracts/contract-3/deposit',
  },
  {
    type: 'INSPECTION_DUE',
    targetId: 'contract-4',
    userId: CLIENT,
    payload: { dueAt: DUE_AT },
    targetUrl: '/contracts/contract-4/inspection',
  },
  {
    type: 'WORK_DUE',
    targetId: 'contract-5',
    userId: SUPPLIER,
    payload: { dueAt: DUE_AT },
    targetUrl: '/contracts/contract-5/delivery',
  },
  {
    type: 'WORK_OVERDUE',
    targetId: 'contract-6',
    userId: CLIENT,
    payload: { dueAt: DUE_AT },
    targetUrl: '/contracts/contract-6/delivery',
  },
  {
    type: 'AUTO_APPROVED',
    targetId: 'contract-7',
    userId: CLIENT,
    targetUrl: '/contracts/contract-7/settlement',
  },
  {
    type: 'REPORT_REVIEWED',
    targetId: 'report-1',
    userId: 'reporter-1',
    targetUrl: '/reports/report-1',
  },
  {
    type: 'INQUIRY_ANSWERED',
    targetId: 'inquiry-1',
    userId: 'author-1',
    targetUrl: '/help/inquiries/inquiry-1',
  },
];

function seed(
  tx: FakeNotificationTx,
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  const row: NotificationRecord = {
    id: `seed-${tx.rows.length + 1}`,
    userId: CLIENT,
    type: 'APPLICATION_RECEIVED',
    targetUrl: '/projects/project-1/applications',
    targetId: `seed-target-${tx.rows.length + 1}`,
    payload: null,
    isRead: false,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
  tx.rows.push(row);
  return row;
}

describe('B-06-T01 알림 15종 타입·payload·URL', () => {
  it('15종이 모집8·기한5·운영2로 나뉜다', () => {
    assert.equal(NOTIFICATION_TYPES.length, 15);
    assert.equal(NOTIFICATION_CATEGORIES.matching.length, 8);
    assert.equal(NOTIFICATION_CATEGORIES.deadline.length, 5);
    assert.equal(NOTIFICATION_CATEGORIES.operations.length, 2);

    for (const type of NOTIFICATION_CATEGORIES.deadline) {
      assert.equal(isDeadlineNotificationType(type), true);
    }
    assert.equal(isDeadlineNotificationType('NEW_MESSAGE'), false);
  });

  it('타입마다 고정 경로·targetId·읽지 않음으로 만든다', async () => {
    const uow = new FakeUnitOfWork();

    for (const testCase of TYPE_CASES) {
      const row = await notify(uow, {
        type: testCase.type,
        userId: testCase.userId,
        targetId: testCase.targetId,
        payload: testCase.payload,
        now: FIXED_NOW,
      });

      assert.equal(row.type, testCase.type);
      assert.equal(row.userId, testCase.userId);
      assert.equal(row.targetId, testCase.targetId);
      assert.equal(row.targetUrl, testCase.targetUrl);
      assert.equal(row.isRead, false);
      assert.equal(row.createdAt.toISOString(), FIXED_NOW.toISOString());
      assert.deepEqual(row.payload, testCase.payload ?? null);
    }

    assert.equal(uow.tx.rows.length, 15);
  });

  it('알 수 없는 타입·위험한 targetId·잘못된 payload를 거부한다', async () => {
    const uow = new FakeUnitOfWork();

    await assert.rejects(
      notify(uow, {
        type: 'PAYMENT_DEPOSITED' as unknown as NotificationType,
        userId: CLIENT,
        targetId: 'contract-1',
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'UNKNOWN_NOTIFICATION_TYPE'),
    );

    for (const targetId of ['../admin', 'a/b', 'a?b', 'http://evil.test', '', ' ']) {
      await assert.rejects(
        notify(uow, {
          type: 'PROJECT_CLOSED',
          userId: CLIENT,
          targetId,
          now: FIXED_NOW,
        }),
        isNotificationError(400, 'INVALID_TARGET'),
      );
    }

    await assert.rejects(
      notify(uow, {
        type: 'CONTRACT_BROKEN',
        userId: CLIENT,
        targetId: 'contract-1',
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'INVALID_PAYLOAD'),
    );
    await assert.rejects(
      notify(uow, {
        type: 'CONTRACT_BROKEN',
        userId: CLIENT,
        targetId: 'contract-1',
        payload: { reason: 'BORED' },
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'INVALID_PAYLOAD'),
    );
    await assert.rejects(
      notify(uow, {
        type: 'DEPOSIT_DUE',
        userId: CLIENT,
        targetId: 'contract-1',
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'INVALID_PAYLOAD'),
    );
    await assert.rejects(
      notify(uow, {
        type: 'DEPOSIT_DUE',
        userId: CLIENT,
        targetId: 'contract-1',
        payload: { dueAt: 'not-a-date' },
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'INVALID_PAYLOAD'),
    );

    assert.equal(uow.tx.rows.length, 0);
  });
});

describe('B-06-T02 수신자 규칙과 안전한 URL', () => {
  it('역할별 수신자를 정확히 고른다', () => {
    assert.deepEqual(recipientsFor('APPLICATION_RECEIVED', PARTIES), [CLIENT]);
    for (const type of [
      'APPLICATION_ACCEPTED',
      'APPLICATION_AUTO_REJECTED',
      'APPLICATION_REJECTED',
      'REQUOTE_REQUESTED',
    ] as const) {
      assert.deepEqual(recipientsFor(type, PARTIES), [SUPPLIER]);
    }
    for (const type of [
      'PROJECT_CLOSED',
      'CONTRACT_BROKEN',
      'WORK_DUE',
      'WORK_OVERDUE',
      'AUTO_APPROVED',
    ] as const) {
      assert.deepEqual(recipientsFor(type, PARTIES), [CLIENT, SUPPLIER]);
    }
    assert.deepEqual(recipientsFor('DEPOSIT_DUE', PARTIES), [CLIENT]);
    assert.deepEqual(recipientsFor('INSPECTION_DUE', PARTIES), [CLIENT]);
    assert.deepEqual(recipientsFor('REPORT_REVIEWED', PARTIES), ['reporter-1']);
    assert.deepEqual(recipientsFor('INQUIRY_ANSWERED', PARTIES), ['author-1']);

    assert.deepEqual(recipientsFor('NEW_MESSAGE', { ...PARTIES, senderId: CLIENT }), [
      SUPPLIER,
    ]);
    assert.deepEqual(recipientsFor('NEW_MESSAGE', { ...PARTIES, senderId: SUPPLIER }), [
      CLIENT,
    ]);
  });

  it('같은 사용자가 양쪽이면 중복 수신하지 않는다', () => {
    assert.deepEqual(
      recipientsFor('PROJECT_CLOSED', {
        clientUserId: 'same-user',
        supplierUserId: 'same-user',
      }),
      ['same-user'],
    );
  });

  it('운영 알림에 대상자가 없으면 거부한다', () => {
    assert.throws(
      () =>
        recipientsFor('REPORT_REVIEWED', {
          clientUserId: CLIENT,
          supplierUserId: SUPPLIER,
        }),
      isNotificationError(400, 'INVALID_RECIPIENT_CONTEXT'),
    );
  });

  it('모든 targetUrl은 내부 경로이고 URL 조작 문자가 없다', async () => {
    const uow = new FakeUnitOfWork();

    for (const testCase of TYPE_CASES) {
      const row = await notify(uow, {
        type: testCase.type,
        userId: testCase.userId,
        targetId: testCase.targetId,
        payload: testCase.payload,
        now: FIXED_NOW,
      });

      assert.equal(row.targetUrl.startsWith('/'), true);
      for (const forbidden of ['http', '//', '?', '#', '..', '@']) {
        assert.equal(
          row.targetUrl.includes(forbidden),
          false,
          `${row.targetUrl} contains ${forbidden}`,
        );
      }
    }
  });

  it('채팅방 targetId는 프로젝트와 공급자를 함께 쓴다', () => {
    assert.equal(chatRoomTargetId('project-1', 'supplier-1'), 'project-1:supplier-1');
    assert.throws(
      () => chatRoomTargetId('project/1', 'supplier-1'),
      isNotificationError(400, 'INVALID_TARGET'),
    );
  });
});

describe('B-06-T03 최근 30일 폴링과 읽음', () => {
  const now = FIXED_NOW;

  function seeded(): { tx: FakeNotificationTx; uow: FakeUnitOfWork } {
    const tx = new FakeNotificationTx();
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    seed(tx, {
      userId: CLIENT,
      targetId: 'old-1',
      createdAt: old,
    });
    seed(tx, {
      userId: CLIENT,
      targetId: 'recent-1',
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    });
    seed(tx, {
      userId: CLIENT,
      targetId: 'recent-2',
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    seed(tx, {
      userId: CLIENT,
      type: 'NEW_MESSAGE',
      targetId: 'project-9:supplier-1',
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      isRead: true,
    });
    seed(tx, {
      userId: SUPPLIER,
      targetId: 'supplier-1',
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    });
    return { tx, uow: new FakeUnitOfWork(tx) };
  }

  it('30일 밖 알림은 빼고 최신순으로 폴링하며 안 읽은 수를 함께 준다', async () => {
    const { uow } = seeded();

    const list = await listNotifications(uow, { userId: CLIENT, now });
    assert.deepEqual(
      list.items.map((item) => item.targetId),
      ['project-9:supplier-1', 'recent-1', 'recent-2'],
    );
    assert.equal(list.unreadCount, 2);

    const unreadOnly = await listNotifications(uow, {
      userId: CLIENT,
      now,
      unreadOnly: true,
    });
    assert.deepEqual(
      unreadOnly.items.map((item) => item.targetId),
      ['recent-1', 'recent-2'],
    );
  });

  it('단건 읽음은 본인 알림만, 모두 읽음은 30일 안의 내 알림만 바꾼다', async () => {
    const { tx, uow } = seeded();
    const target = tx.rows.find((row) => row.targetId === 'recent-1');
    assert.ok(target);

    await markNotificationRead(uow, {
      notificationId: target.id,
      userId: CLIENT,
      now,
    });
    assert.equal(
      tx.rows.find((row) => row.id === target.id)?.isRead,
      true,
    );

    await assert.rejects(
      markNotificationRead(uow, {
        notificationId: target.id,
        userId: SUPPLIER,
        now,
      }),
      isNotificationError(404, 'NOTIFICATION_NOT_FOUND'),
    );
    await assert.rejects(
      markNotificationRead(uow, {
        notificationId: 'missing',
        userId: CLIENT,
        now,
      }),
      isNotificationError(404, 'NOTIFICATION_NOT_FOUND'),
    );

    const changed = await markAllNotificationsRead(uow, { userId: CLIENT, now });

    assert.equal(changed, 1);
    assert.equal(
      tx.rows.filter(
        (row) =>
          row.userId === CLIENT &&
          !row.isRead &&
          row.createdAt.getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000,
      ).length,
      0,
    );
    const oldRow = tx.rows.find((row) => row.targetId === 'old-1');
    assert.equal(oldRow?.isRead, false);
    assert.equal(
      tx.rows.find((row) => row.userId === SUPPLIER)?.isRead,
      false,
    );
    assert.equal(
      (await listNotifications(uow, { userId: CLIENT, now })).unreadCount,
      0,
    );
  });
});

describe('B-06-T04 새 메시지 방별 한 줄', () => {
  it('같은 방의 새 메시지는 한 줄을 최신으로 갱신한다', async () => {
    const uow = new FakeUnitOfWork();
    const firstAt = new Date('2026-11-03T00:00:00.000Z');
    const secondAt = new Date('2026-11-03T00:05:00.000Z');

    const first = await notifyNewMessage(uow, {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: CLIENT,
      now: firstAt,
    });
    const second = await notifyNewMessage(uow, {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: CLIENT,
      now: secondAt,
    });

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0]?.id, second[0]?.id);
    assert.equal(second[0]?.createdAt.toISOString(), secondAt.toISOString());
    assert.equal(second[0]?.targetId, 'project-1:supplier-1');
    assert.equal(uow.tx.rows.length, 1);

    const list = await listNotifications(uow, { userId: SUPPLIER, now: secondAt });
    assert.equal(list.unreadCount, 1);
    assert.equal(list.items.length, 1);
  });

  it('보낸 사람에게는 알림을 만들지 않고 방이 다르면 따로 만든다', async () => {
    const uow = new FakeUnitOfWork();

    await notifyNewMessage(uow, {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: CLIENT,
      now: FIXED_NOW,
    });
    assert.deepEqual(
      uow.tx.rows.map((row) => row.userId),
      [SUPPLIER],
    );

    await notifyNewMessage(uow, {
      projectId: 'project-2',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: CLIENT,
      now: FIXED_NOW,
    });
    assert.deepEqual(
      uow.tx.rows.map((row) => row.targetId),
      ['project-1:supplier-1', 'project-2:supplier-1'],
    );
  });

  it('읽은 뒤 새 메시지가 오면 같은 줄이 다시 안 읽음이 된다', async () => {
    const uow = new FakeUnitOfWork();

    const created = await notifyNewMessage(uow, {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: CLIENT,
      now: new Date('2026-11-03T00:00:00.000Z'),
    });
    const row = created[0];
    assert.ok(row);

    await markNotificationRead(uow, {
      notificationId: row.id,
      userId: SUPPLIER,
      now: new Date('2026-11-03T00:01:00.000Z'),
    });
    const read = await listNotifications(uow, {
      userId: SUPPLIER,
      now: new Date('2026-11-03T00:02:00.000Z'),
    });
    assert.equal(read.unreadCount, 0);

    const bumped = await notifyNewMessage(uow, {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      clientUserId: CLIENT,
      supplierUserId: SUPPLIER,
      senderId: SUPPLIER,
      now: new Date('2026-11-03T00:03:00.000Z'),
    });
    assert.equal(bumped[0]?.userId, CLIENT);
    assert.equal(uow.tx.rows.filter((candidate) => candidate.userId === SUPPLIER).length, 1);
  });
});

describe('B-06-T05 기한 알림 1회 보장', () => {
  it('배치를 다시 돌려도 같은 기한 알림은 한 번만 만든다', async () => {
    const uow = new FakeUnitOfWork();
    const firstAt = new Date('2026-11-03T00:00:00.000Z');
    const secondAt = new Date('2026-11-03T00:01:00.000Z');

    const first = await notifyFromContractEvent(uow, {
      eventType: 'DEPOSIT_DUE',
      contractId: 'contract-1',
      parties: PARTIES,
      dueAt: new Date('2026-11-06T14:59:59.999Z'),
      now: firstAt,
    });
    const second = await notifyFromContractEvent(uow, {
      eventType: 'DEPOSIT_DUE',
      contractId: 'contract-1',
      parties: PARTIES,
      dueAt: new Date('2026-11-07T14:59:59.999Z'),
      now: secondAt,
    });

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0]?.id, second[0]?.id);
    assert.deepEqual(
      first[0]?.payload,
      { dueAt: '2026-11-06T14:59:59.999Z' },
    );
    assert.equal(first[0]?.createdAt.toISOString(), firstAt.toISOString());
    assert.equal(uow.tx.rows.length, 1);
  });

  it('계약·타입이 다르면 따로 만들고 AUTO_APPROVED는 dueAt이 없어도 된다', async () => {
    const uow = new FakeUnitOfWork();
    const base = {
      parties: PARTIES,
      dueAt: new Date('2026-11-06T14:59:59.999Z'),
      now: FIXED_NOW,
    };

    await notifyFromContractEvent(uow, {
      ...base,
      eventType: 'DEPOSIT_DUE',
      contractId: 'contract-1',
    });
    await notifyFromContractEvent(uow, {
      ...base,
      eventType: 'DEPOSIT_DUE',
      contractId: 'contract-2',
    });
    await notifyFromContractEvent(uow, {
      ...base,
      eventType: 'INSPECTION_DUE',
      contractId: 'contract-1',
    });
    await notifyFromContractEvent(uow, {
      eventType: 'AUTO_APPROVED',
      contractId: 'contract-1',
      parties: PARTIES,
      now: FIXED_NOW,
    });

    assert.equal(uow.tx.rows.length, 5);
    assert.equal(
      uow.tx.rows.filter((row) => row.type === 'AUTO_APPROVED').length,
      2,
    );
  });

  it('수신자별로 따로 만들고 기한 이벤트에 dueAt이 없으면 거부한다', async () => {
    const uow = new FakeUnitOfWork();

    await notifyFromContractEvent(uow, {
      eventType: 'WORK_OVERDUE',
      contractId: 'contract-1',
      parties: PARTIES,
      dueAt: new Date('2026-11-01T00:00:00.000Z'),
      now: FIXED_NOW,
    });

    assert.deepEqual(
      uow.tx.rows.map((row) => row.userId),
      [CLIENT, SUPPLIER],
    );
    assert.equal(
      uow.tx.rows.filter((row) => row.type === 'WORK_OVERDUE').length,
      2,
    );

    await assert.rejects(
      notifyFromContractEvent(uow, {
        eventType: 'DEPOSIT_DUE',
        contractId: 'contract-2',
        parties: PARTIES,
        now: FIXED_NOW,
      }),
      isNotificationError(400, 'INVALID_PAYLOAD'),
    );
  });
});

describe('B-06-T06 계약 이후 불필요 알림 0', () => {
  it('결제·납품·검수·지급 이벤트는 알림을 만들지 않는다', async () => {
    const uow = new FakeUnitOfWork();

    for (const eventType of [
      'PAYMENT_DEPOSITED',
      'DELIVERY_SUBMITTED',
      'INSPECTION_APPROVED',
      'PAYMENT_RELEASED',
      'CONTRACT_SIGNED',
      'REVIEW_WRITTEN',
      'MESSAGE_SENT',
    ]) {
      const created = await notifyFromContractEvent(uow, {
        eventType,
        contractId: 'contract-1',
        parties: PARTIES,
        dueAt: new Date('2026-11-06T14:59:59.999Z'),
        now: FIXED_NOW,
      });
      assert.deepEqual(created, []);
    }

    assert.equal(uow.tx.rows.length, 0);
  });

  it('알림을 만드는 계약 이벤트는 기한 5종뿐이다', () => {
    assert.deepEqual(
      [...NOTIFICATION_CATEGORIES.deadline],
      ['DEPOSIT_DUE', 'INSPECTION_DUE', 'WORK_DUE', 'WORK_OVERDUE', 'AUTO_APPROVED'],
    );
    assert.equal(
      (NOTIFICATION_TYPES as readonly string[]).includes('PAYMENT_DEPOSITED'),
      false,
    );
  });
});
