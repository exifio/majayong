import { expect, test } from '@jest/globals';
import {
  createPaymentWorkflow,
  type DepositRecord,
  type PaymentContract,
  type PaymentWorkflowPorts,
} from '../src/trade/payment-workflow.ts';
import type { PaymentEventDraft, PgCallback } from '../src/trade/payment.ts';
import type { TossConfirmationRequest } from '../src/trade/toss-payments.ts';
import { TradeError } from '../src/trade/errors.ts';

type TestTransaction = {
  contract: PaymentContract;
  deposits: DepositRecord[];
  paymentEvents: { depositId: string; event: PaymentEventDraft }[];
  eventLogs: {
    type: 'PAYMENT_DEPOSITED' | 'OPERATOR_DEPOSIT_REVIEWED';
    userId: string;
    payload: Record<string, unknown>;
  }[];
};

const now = new Date('2026-10-28T03:00:00.000Z');
const client = { userId: 'client-1', role: 'CLIENT' as const, sessionId: 'session-1' };
const depositCallback: PgCallback = {
  pgKey: 'pay_test_1',
  amount: 105_000,
  occurredAt: now.toISOString(),
  result: 'SUCCESS',
  verified: true,
};

function fixture(options: {
  callback?: PgCallback;
  confirmError?: Error;
  beforeConfirm?: (setContractStatus: (status: PaymentContract['status']) => void) => void;
  waitForConfirmations?: boolean;
} = {}) {
  let database: TestTransaction = {
    contract: {
      id: 'contract-1',
      applicationId: 'application-1',
      status: 'ACTIVE',
      paymentStatus: 'PENDING',
      agreedAmount: 100_000,
      clientFee: 5_000,
      totalDeposited: 0,
      clientId: 'client-1',
      projectId: 'project-1',
    },
    deposits: [],
    paymentEvents: [],
    eventLogs: [],
  };
  const confirmationCalls: TossConfirmationRequest[] = [];
  let releaseConfirmations: () => void = () => {};
  const confirmationBarrier = new Promise<void>((resolve) => { releaseConfirmations = resolve; });
  let transactionQueue = Promise.resolve();
  const ports: PaymentWorkflowPorts<TestTransaction> = {
    transaction: async (work) => {
      const preceding = transactionQueue;
      let release: () => void = () => {};
      transactionQueue = new Promise<void>((resolve) => { release = resolve; });
      await preceding;
      try {
        const staged = structuredClone(database);
        const result = await work(staged);
        database = staged;
        return result;
      } finally {
        release();
      }
    },
    findDepositStartContextForUpdate: async (tx) => ({ contract: tx.contract, deposits: tx.deposits }),
    createDeposit: async (tx, input) => {
      const deposit = {
        id: `deposit-${tx.deposits.length + 1}`,
        ...input,
        status: 'PENDING' as const,
        pgKey: null,
        depositedAt: null,
      };
      tx.deposits.push(deposit);
      return deposit;
    },
    recordPaymentEvents: async (tx, depositId, events) => {
      tx.paymentEvents.push(...events.map((event) => ({ depositId, event })));
    },
    findDepositConfirmationContext: async (tx, contractId, depositId) => {
      const deposit = tx.deposits.find((row) => row.id === depositId && row.contractId === contractId);
      return deposit ? { contract: tx.contract, clientId: tx.contract.clientId, deposit } : null;
    },
    findDepositConfirmationContextForUpdate: async (tx, contractId, depositId) => {
      const deposit = tx.deposits.find((row) => row.id === depositId && row.contractId === contractId);
      return deposit ? { contract: tx.contract, clientId: tx.contract.clientId, deposit } : null;
    },
    listPaymentEventDedupKeys: async (tx, depositId) => tx.paymentEvents
      .filter((row) => row.depositId === depositId)
      .flatMap((row) => row.event.dedupKey === null ? [] : [row.event.dedupKey]),
    updateDeposit: async (tx, depositId, patch) => {
      const deposit = tx.deposits.find((row) => row.id === depositId);
      if (!deposit) throw new Error('deposit missing');
      Object.assign(deposit, patch);
      return deposit;
    },
    updateContractPayment: async (tx, contractId, patch) => {
      if (tx.contract.id !== contractId) throw new Error('contract missing');
      Object.assign(tx.contract, patch);
    },
    recordDepositEvent: async (tx, event) => { tx.eventLogs.push(event); },
  };
  const confirm = async (input: TossConfirmationRequest) => {
    confirmationCalls.push(input);
    options.beforeConfirm?.((status) => { database.contract.status = status; });
    if (options.waitForConfirmations && confirmationCalls.length === 2) releaseConfirmations();
    if (options.waitForConfirmations) await confirmationBarrier;
    if (options.confirmError) throw options.confirmError;
    return options.callback ?? depositCallback;
  };
  return {
    workflow: createPaymentWorkflow(ports, confirm, () => now),
    state: () => database,
    confirmationCalls,
    setContractStatus: (status: PaymentContract['status']) => { database.contract.status = status; },
  };
}

test('의뢰인은 한 멱등키로 입금 시도를 한 번 만들고 재요청에는 기존 시도를 받는다', async () => {
  const { workflow, state } = fixture();
  const request = { contractId: 'contract-1', actor: client, idempotencyKey: 'deposit-key-1' };

  const first = await workflow.startDeposit(request);
  const replay = await workflow.startDeposit(request);

  expect(first).toMatchObject({ depositId: 'deposit-1', orderId: 'deposit-1', amount: 105_000, replayed: false });
  expect(replay).toMatchObject({ depositId: 'deposit-1', amount: 105_000, replayed: true });
  expect(state().deposits).toHaveLength(1);
  expect(state().paymentEvents.map(({ event }) => event.eventType)).toEqual(['REQUESTED']);
});

test('비당사자·잘못된 상태와 다른 멱등키의 열린 입금은 새 시도를 만들지 않는다', async () => {
  const { workflow, state } = fixture();
  await expect(workflow.startDeposit({
    contractId: 'contract-1',
    actor: { userId: 'other', role: 'CLIENT' },
    idempotencyKey: 'deposit-key-1',
  })).rejects.toHaveProperty('code', 'DEPOSIT_FORBIDDEN');
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'deposit-key-1' });
  await expect(workflow.startDeposit({
    contractId: 'contract-1', actor: client, idempotencyKey: 'deposit-key-2',
  })).rejects.toHaveProperty('code', 'DEPOSIT_ALREADY_OPEN');
  expect(state().deposits).toHaveLength(1);
  expect(state().paymentEvents).toHaveLength(1);
});

test('검증된 승인 결과는 예치액·결제 상태·EventLog에 한 번만 반영한다', async () => {
  const { workflow, state, confirmationCalls } = fixture();
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'deposit-key-1' });
  const confirm = {
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: client,
    paymentKey: 'pay_test_1',
    orderId: 'deposit-1',
    returnedAmount: 105_000,
  };

  const first = await workflow.confirmDeposit(confirm);
  const replay = await workflow.confirmDeposit(confirm);

  expect(first).toEqual({ depositStatus: 'COMPLETED', paymentStatus: 'DEPOSITED', creditedAmount: 105_000, replayed: false });
  expect(replay).toEqual({ depositStatus: 'COMPLETED', paymentStatus: 'DEPOSITED', creditedAmount: 0, replayed: true });
  expect(confirmationCalls).toEqual([{
    paymentKey: 'pay_test_1', orderId: 'deposit-1', amount: 105_000,
    returnedAmount: 105_000, idempotencyKey: 'deposit-key-1',
  }]);
  expect(state().contract.totalDeposited).toBe(105_000);
  expect(state().deposits[0]).toMatchObject({ status: 'COMPLETED', pgKey: 'pay_test_1', depositedAt: now });
  expect(state().eventLogs).toHaveLength(1);
  expect(state().paymentEvents.map(({ event }) => event.eventType)).toEqual(['REQUESTED', 'CALLBACK_RECEIVED', 'VERIFIED']);
});

test('동시에 두 번 승인되어도 예치 반영과 지급 이벤트는 한 번뿐이다', async () => {
  const { workflow, state, confirmationCalls } = fixture({ waitForConfirmations: true });
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'racing-key' });
  const input = {
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  };

  const results = await Promise.all([workflow.confirmDeposit(input), workflow.confirmDeposit(input)]);

  expect(confirmationCalls).toHaveLength(2);
  expect(confirmationCalls[0].idempotencyKey).toBe('racing-key');
  expect(confirmationCalls[1].idempotencyKey).toBe('racing-key');
  expect(results.map((result) => result.creditedAmount).sort((a, b) => a - b)).toEqual([0, 105_000]);
  expect(state().contract.totalDeposited).toBe(105_000);
  expect(state().eventLogs).toHaveLength(1);
  expect(state().paymentEvents.map(({ event }) => event.eventType)).toEqual([
    'REQUESTED', 'CALLBACK_RECEIVED', 'VERIFIED', 'DUPLICATE_BLOCKED',
  ]);
});

test('취소 경합·금액 불일치·실패 콜백은 예치액에 반영하지 않는다', async () => {
  const cancelled = fixture({ beforeConfirm: (setStatus) => setStatus('CANCELLED') });
  await cancelled.workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'cancelled-key' });
  const cancelledResult = await cancelled.workflow.confirmDeposit({
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  });
  expect(cancelledResult).toMatchObject({ depositStatus: 'HELD', creditedAmount: 0, replayed: false });
  expect(cancelled.state().contract.totalDeposited).toBe(0);
  expect(cancelled.state().eventLogs).toHaveLength(0);

  const mismatch = fixture({ callback: { ...depositCallback, amount: 104_999 } });
  await mismatch.workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'mismatch-key' });
  expect(await mismatch.workflow.confirmDeposit({
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  })).toMatchObject({ depositStatus: 'HELD', creditedAmount: 0 });
  expect(mismatch.state().contract.totalDeposited).toBe(0);

  const failed = fixture({ callback: { ...depositCallback, result: 'FAILURE' } });
  await failed.workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'failed-key' });
  expect(await failed.workflow.confirmDeposit({
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  })).toMatchObject({ depositStatus: 'FAILED', creditedAmount: 0 });
  expect(failed.state().contract.totalDeposited).toBe(0);
});

test('잘못된 주문·금액·인증은 provider 호출 전에 막고 provider 오류는 입금을 열어둔다', async () => {
  const { workflow, state, confirmationCalls } = fixture({ confirmError: new Error('provider unavailable') });
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'provider-key' });
  const input = {
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  };
  await expect(workflow.confirmDeposit({ ...input, orderId: 'someone-elses-order' })).rejects.toHaveProperty(
    'code', 'PAYMENT_ORDER_ID_MISMATCH',
  );
  await expect(workflow.confirmDeposit({ ...input, returnedAmount: 1 })).rejects.toHaveProperty(
    'code', 'TOSS_AMOUNT_MISMATCH',
  );
  await expect(workflow.confirmDeposit({
    ...input, actor: { userId: 'other', role: 'CLIENT' },
  })).rejects.toHaveProperty('code', 'DEPOSIT_FORBIDDEN');
  expect(confirmationCalls).toHaveLength(0);

  await expect(workflow.confirmDeposit(input)).rejects.toThrow('provider unavailable');
  expect(state().deposits[0].status).toBe('PENDING');
  expect(state().contract.totalDeposited).toBe(0);
});

test('7일 지난 HELD 입금은 운영자 확정으로만 예치 완료된다', async () => {
  const { workflow, state } = fixture();
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'held-key' });
  state().deposits[0].status = 'HELD';

  const admin = { userId: 'admin-1', role: 'ADMIN' as const, sessionId: 'admin-session' };
  const result = await workflow.reviewHeldDeposit({
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: admin,
    decision: 'COMPLETE',
    reason: 'PG 정산 내역과 입금액 일치',
  });

  expect(result).toEqual({ depositStatus: 'COMPLETED', paymentStatus: 'DEPOSITED', creditedAmount: 105_000 });
  expect(state().contract.totalDeposited).toBe(105_000);
  expect(state().deposits[0]).toMatchObject({ status: 'COMPLETED', depositedAt: now });
  expect(state().eventLogs).toHaveLength(1);
  expect(state().eventLogs[0]).toMatchObject({
    type: 'OPERATOR_DEPOSIT_REVIEWED',
    userId: 'admin-1',
    payload: { decision: 'COMPLETE', reason: 'PG 정산 내역과 입금액 일치', creditedAmount: 105_000 },
  });
  expect(state().paymentEvents.map(({ event }) => event.eventType)).toEqual(['REQUESTED', 'VERIFIED']);
});

test('운영자 실패 확정은 예치액을 늘리지 않고 새 시도를 허용한다', async () => {
  const { workflow, state } = fixture();
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'held-key' });
  state().deposits[0].status = 'HELD';

  const result = await workflow.reviewHeldDeposit({
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: { userId: 'admin-1', role: 'ADMIN' },
    decision: 'FAIL',
    reason: 'PG에 승인 기록 없음',
  });

  expect(result).toEqual({ depositStatus: 'FAILED', paymentStatus: 'PENDING', creditedAmount: 0 });
  expect(state().contract.totalDeposited).toBe(0);
  await expect(workflow.startDeposit({
    contractId: 'contract-1', actor: client, idempotencyKey: 'retry-key',
  })).resolves.toMatchObject({ replayed: false });
});

test('운영자 확정은 HELD 입금·관리자·사유를 모두 확인하고 취소 계약은 완료 처리하지 않는다', async () => {
  const { workflow, state } = fixture();
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'held-key' });
  const input = {
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: { userId: 'admin-1', role: 'ADMIN' as const },
    decision: 'COMPLETE' as const,
    reason: '확인',
  };

  await expect(workflow.reviewHeldDeposit({ ...input, actor: client }))
    .rejects.toHaveProperty('code', 'OPERATOR_REVIEW_FORBIDDEN');
  await expect(workflow.reviewHeldDeposit(input))
    .rejects.toHaveProperty('code', 'DEPOSIT_NOT_HELD');

  state().deposits[0].status = 'HELD';
  await expect(workflow.reviewHeldDeposit({ ...input, reason: '   ' }))
    .rejects.toHaveProperty('code', 'OPERATOR_REVIEW_REASON_REQUIRED');

  state().contract.status = 'CANCELLED';
  await expect(workflow.reviewHeldDeposit(input))
    .rejects.toHaveProperty('code', 'CONTRACT_NOT_ACTIVE');
  expect(state().contract.totalDeposited).toBe(0);
});

test('승인 결과를 알 수 없으면 입금을 HELD로 잠그고 사유를 남기며 재시도를 막는다', async () => {
  for (const code of ['TOSS_CONFIRM_UNAVAILABLE', 'TOSS_CONFIRM_INVALID_RESPONSE']) {
    const { workflow, state, confirmationCalls } = fixture({ confirmError: new TradeError(code) });
    await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'uncertain-key' });
    const input = {
      contractId: 'contract-1', depositId: 'deposit-1', actor: client,
      paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
    };

    const first = await workflow.confirmDeposit(input);
    expect(first).toEqual({ depositStatus: 'HELD', paymentStatus: 'PENDING', creditedAmount: 0, replayed: false });
    expect(state().deposits[0].status).toBe('HELD');
    expect(state().deposits[0].pgKey).toBe('pay_test_1');
    expect(state().contract.totalDeposited).toBe(0);
    const note = state().paymentEvents.find((row) => row.event.dedupKey === 'uncertain:pay_test_1');
    expect(note?.event.resultNote).toContain('승인 결과 확인 불가');
    expect(note?.event.resultNote).toContain(code);

    const retry = await workflow.confirmDeposit(input);
    expect(retry).toMatchObject({ depositStatus: 'HELD', creditedAmount: 0, replayed: true });
    expect(confirmationCalls).toHaveLength(1);
    await expect(workflow.startDeposit({
      contractId: 'contract-1', actor: client, idempotencyKey: 'another-key',
    })).rejects.toBeDefined();
  }
});

test('확정 거절(4xx)은 입금을 PENDING으로 유지한다', async () => {
  const { workflow, state } = fixture({ confirmError: new TradeError('TOSS_CONFIRM_REJECTED') });
  await workflow.startDeposit({ contractId: 'contract-1', actor: client, idempotencyKey: 'rejected-key' });
  await expect(workflow.confirmDeposit({
    contractId: 'contract-1', depositId: 'deposit-1', actor: client,
    paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000,
  })).rejects.toHaveProperty('code', 'TOSS_CONFIRM_REJECTED');
  expect(state().deposits[0].status).toBe('PENDING');
  expect(state().paymentEvents.map((row) => row.event.eventType)).toEqual(['REQUESTED']);
});
