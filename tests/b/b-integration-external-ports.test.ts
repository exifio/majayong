import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createChatAccountPort,
  createChatEventPort,
  createContractItemSourcePort,
  createDepositAttemptPort,
  createIntegrationPorts,
  createProjectStatePort,
  type IntegrationDb,
} from '../../src/integration/external-ports.ts';
import { HttpError } from '../../src/http/envelope.ts';
import { FIXED_NOW } from './fixtures.ts';

const unused = async (): Promise<never> => {
  throw new Error('unused');
};

describe('A/C 읽기 Port 어댑터', () => {
  it('지원 제출용 프로젝트 상태는 현재 버전과 포함 항목 ID만 준다', async () => {
    const db: IntegrationDb = {
      project: {
        async findUnique() {
          return { id: 'prj-1', draft: { clientId: 'client-1' }, status: 'RECRUITING', currentVersion: 2 };
        },
      },
      specItem: {
        async findMany(input) {
          const where = input.where as { versionNo?: number; status?: string };
          assert.equal(where.versionNo, 2);
          assert.equal(where.status, 'INCLUDED');
          return [
            { id: 'spec-2', blockId: 'block-2', description: '결제', origin: 'CHAT', sortOrder: 1 },
          ];
        },
      },
      application: { findUnique: unused },
      user: { findUnique: unused },
      escrowDeposit: { count: unused },
      eventLog: { findFirst: unused, create: unused },
    };

    const state = await createProjectStatePort(db).getForApplication('prj-1');

    assert.deepEqual(state, {
      clientUserId: 'client-1',
      status: 'RECRUITING',
      specVersionNo: 2,
      specItemIds: ['spec-2'],
    });
  });

  it('계약 항목 원천은 지원 회차의 명세 버전에서 읽는다', async () => {
    const db: IntegrationDb = {
      project: { findUnique: unused },
      application: {
        async findUnique() {
          return { projectId: 'prj-1', specVersionNo: 3 };
        },
      },
      specItem: {
        async findMany(input) {
          const where = input.where as { versionNo?: number };
          assert.equal(where.versionNo, 3);
          return [
            { id: 'spec-1', blockId: 'block-1', description: '예약', origin: 'FIRST_SENTENCE', sortOrder: 0 },
          ];
        },
      },
      user: { findUnique: unused },
      escrowDeposit: { count: unused },
      eventLog: { findFirst: unused, create: unused },
    };

    const sources = await createContractItemSourcePort(db).listSources('app-1');

    assert.deepEqual(sources, [
      { blockId: 'block-1', description: '예약', origin: 'FIRST_SENTENCE', sortOrder: 0 },
    ]);
  });

  it('채팅 계정 상태는 User 제재 필드만 읽고, 없는 계정은 401이다', async () => {
    const db: IntegrationDb = {
      project: { findUnique: unused },
      specItem: { findMany: unused },
      application: { findUnique: unused },
      user: {
        async findUnique(input) {
          return input.where.id === 'user-1'
            ? { suspendedAt: null, withdrawnAt: null, chatRestrictedUntil: FIXED_NOW }
            : null;
        },
      },
      escrowDeposit: { count: unused },
      eventLog: { findFirst: unused, create: unused },
    };
    const port = createChatAccountPort(db);

    assert.deepEqual(await port.getAccountState('user-1'), {
      suspendedAt: null,
      withdrawnAt: null,
      chatRestrictedUntil: FIXED_NOW,
    });
    await assert.rejects(
      port.getAccountState('ghost'),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
  });

  it('예치 시도가 있는 계약만 후보 제외 대상으로 표시한다', async () => {
    const db: IntegrationDb = {
      project: { findUnique: unused },
      specItem: { findMany: unused },
      application: { findUnique: unused },
      user: { findUnique: unused },
      escrowDeposit: {
        async count(input) {
          const where = input.where as { contractId?: string };
          return where.contractId === 'contract-1' ? 1 : 0;
        },
      },
      eventLog: { findFirst: unused, create: unused },
    };
    const port = createDepositAttemptPort(db);

    assert.equal(await port.hasDepositAttempt('contract-1'), true);
    assert.equal(await port.hasDepositAttempt('contract-2'), false);
  });

  it('최초 문의 이벤트는 프로젝트당 한 번만 만든다', async () => {
    const created: Record<string, unknown>[] = [];
    let existing = false;
    const db: IntegrationDb = {
      project: { findUnique: unused },
      specItem: { findMany: unused },
      application: { findUnique: unused },
      user: { findUnique: unused },
      escrowDeposit: { count: unused },
      eventLog: {
        async findFirst() {
          return existing ? { id: 'evt-1' } : null;
        },
        async create(input) {
          created.push(input.data as Record<string, unknown>);
          existing = true;
          return input.data;
        },
      },
    };
    const port = createChatEventPort(db);

    assert.equal(
      await port.recordInquiryOpenedOnce({
        projectId: 'prj-1',
        clientUserId: 'client-1',
        openedAt: FIXED_NOW,
      }),
      true,
    );
    assert.equal(created[0]?.type, 'INQUIRY_OPENED');
    assert.equal(
      await port.recordInquiryOpenedOnce({
        projectId: 'prj-1',
        clientUserId: 'client-1',
        openedAt: FIXED_NOW,
      }),
      false,
    );
  });

  it('계약이 없는 Port는 호출 시 503 INTEGRATION_PENDING으로 실패한다', async () => {
    const db: IntegrationDb = {
      project: { findUnique: unused },
      specItem: { findMany: unused },
      application: { findUnique: unused },
      user: { findUnique: unused },
      escrowDeposit: { count: async () => 0 },
      eventLog: { findFirst: async () => null, create: unused },
    };
    const ports = createIntegrationPorts(db, { now: () => FIXED_NOW });

    await assert.rejects(
      ports.recommendations.getSupplier('supplier-1'),
      (error: unknown) => error instanceof HttpError && error.status === 503,
    );
    await assert.rejects(
      ports.agreementPreview.getSpec('app-1'),
      (error: unknown) => error instanceof HttpError && error.status === 503,
    );
    await assert.rejects(
      ports.reportAccounts.applyAccountAction({
        userId: 'user-1',
        action: 'SUSPEND',
        at: FIXED_NOW,
        until: null,
      }),
      (error: unknown) => error instanceof HttpError && error.status === 503,
    );
  });
});
