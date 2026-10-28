import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import {
  createCancellationWorkflow,
  type CancellationContract,
  type CancellationEvent,
  type CancellationRecord,
  type CancellationRequest,
  type CancellationWorkflowPorts,
} from '../src/trade/cancellation-workflow.ts';
import {
  registerCancellationRoutes,
  type CancellationHttpRequest,
  type CancellationHttpResponse,
  type CancellationRequestHandler,
  type CancellationRouteRegistrar,
  type CancellationWorkflowService,
} from '../src/trade/cancellation-routes.ts';

// 예시 계약: 합의 1,000,000원, 의뢰인 수수료 50,000원, 예치 1,050,000원, 중간 구간 500,000원.
const activatedAt = new Date('2026-10-28T00:00:00.000Z');
const within24h = new Date('2026-10-28T12:00:00.000Z');
const after24h = new Date('2026-10-30T12:00:00.000Z');

type TestTransaction = {
  contract: CancellationContract;
  requests: CancellationRequest[];
  applied: { record: CancellationRecord; event: CancellationEvent | undefined }[];
  released: {
    applicationId: string;
    contractId: string;
    actorUserId: string;
    sessionId: string | null;
    cancelledAt: Date;
  }[];
};

function fixture(options: { now?: Date } = {}) {
  let database: TestTransaction = {
    contract: {
      id: 'contract-1',
      applicationId: 'application-1',
      status: 'ACTIVE',
      paymentStatus: 'DEPOSITED',
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      totalDeposited: 1_050_000,
      refundAmount: null,
      activatedAt,
      interimAmount: 500_000,
      releasedAmount: 0,
      clientId: 'client-1',
      supplierId: 'supplier-1',
      installments: [
        { id: 'installment-1', status: 'PENDING' },
        { id: 'installment-2', status: 'PENDING' },
      ],
      cancellationRequest: null,
    },
    requests: [],
    applied: [],
    released: [],
  };
  let queue = Promise.resolve();
  const ports: CancellationWorkflowPorts<TestTransaction> = {
    transaction: async (work) => {
      const preceding = queue;
      let release: () => void = () => {};
      queue = new Promise<void>((resolve) => { release = resolve; });
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
    findContractForCancellationForUpdate: async (tx) => tx.contract,
    recordCancellationRequest: async (tx, request) => {
      tx.requests.push(request);
      tx.contract.cancellationRequest = {
        requestedBy: request.actorUserId,
        party: request.party,
        reason: request.reason,
        requestedAt: request.requestedAt,
      };
    },
    applyCancellation: async (tx, record, event) => {
      tx.applied.push({ record, event });
      tx.contract.status = record.status;
      tx.contract.paymentStatus = record.paymentStatus;
      tx.contract.refundAmount = record.refundAmount;
    },
    releaseApplicationForCancellation: async (tx, input) => {
      tx.released.push(input);
    },
  };
  const workflow = createCancellationWorkflow(ports, () => options.now ?? within24h);
  return { workflow, database: () => database };
}

const admin = { userId: 'admin-1', role: 'ADMIN' as const };
const client = { userId: 'client-1', role: 'CLIENT' as const };
const supplier = { userId: 'supplier-1', role: 'SUPPLIER' as const };
const stranger = { userId: 'other-1', role: 'CLIENT' as const };

const throwsCode = async (run: () => Promise<unknown>, code: string) => {
  let thrown: unknown;
  try {
    await run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TradeError);
  expect(thrown).toHaveProperty('code', code);
};

test('취소 요청은 사유만 기록하고 계약 상태는 그대로 둔다', async () => {
  const { workflow, database } = fixture();
  const request = await workflow.requestCancellation({
    contractId: 'contract-1',
    actor: client,
    reason: ' 일정이 밀렸습니다 ',
  });

  expect(request).toMatchObject({
    contractId: 'contract-1',
    actorUserId: 'client-1',
    party: 'CLIENT',
    reason: '일정이 밀렸습니다',
    requestedAt: within24h,
  });
  expect(database().contract.status).toBe('ACTIVE');
  expect(database().requests).toHaveLength(1);
});

test('같은 요청은 기존 요청을 돌려주고, 다른 요청은 이미 요청됨으로 거부한다', async () => {
  const { workflow, database } = fixture();
  const first = await workflow.requestCancellation({ contractId: 'contract-1', actor: client, reason: '변심' });
  const repeated = await workflow.requestCancellation({ contractId: 'contract-1', actor: client, reason: '변심' });

  expect(repeated).toEqual(first);
  expect(database().requests).toHaveLength(1);

  await throwsCode(
    () => workflow.requestCancellation({ contractId: 'contract-1', actor: supplier, reason: '공급자 사정' }),
    'CANCELLATION_ALREADY_REQUESTED',
  );
});

test('당사자가 아닌 사용자와 합의 취소 요청은 거부한다', async () => {
  const { workflow } = fixture();
  await throwsCode(
    () => workflow.requestCancellation({ contractId: 'contract-1', actor: stranger, reason: '취소' }),
    'CANCELLATION_FORBIDDEN',
  );
  await throwsCode(
    () => workflow.requestCancellation({ contractId: 'contract-1', actor: client, party: 'MUTUAL', reason: '취소' }),
    'MUTUAL_CANCELLATION_REQUIRES_ADMIN',
  );
  await throwsCode(
    () => workflow.requestCancellation({ contractId: 'contract-1', actor: supplier, party: 'CLIENT', reason: '취소' }),
    'CANCELLATION_FORBIDDEN',
  );
  await throwsCode(
    () => workflow.requestCancellation({ contractId: 'contract-1', actor: client, reason: '  ' }),
    'CANCELLATION_REASON_REQUIRED',
  );
});

test('24시간 이내 의뢰인 사유는 보상 없이 전액 환불하고 구간·지원 상태를 함께 정리한다', async () => {
  const { workflow, database } = fixture();
  const result = await workflow.processCancellation({
    contractId: 'contract-1',
    actor: admin,
    party: 'CLIENT',
    reason: '변심',
  });

  expect(result.supplierCompensation).toBe(0);
  expect(result.refundAmount).toBe(1_050_000);
  expect(result.clientFeeRefund).toBe(50_000);
  expect(result.settlement.within24Hours).toBe(true);

  const applied = database().applied[0];
  expect(applied.record).toMatchObject({
    contractId: 'contract-1',
    status: 'CANCELLED',
    paymentStatus: 'REFUNDED',
    refundAmount: 1_050_000,
    clientFeeRefund: 50_000,
    settledAmount: 0,
    refundReason: '변심',
    requestedBy: 'admin-1',
    party: 'CLIENT',
    installments: [
      { id: 'installment-1', status: 'REFUNDED' },
      { id: 'installment-2', status: 'REFUNDED' },
    ],
  });
  expect(applied.event).toMatchObject({
    type: 'REFUND_PROCESSED',
    userId: 'admin-1',
    payload: { contractId: 'contract-1', amount: 1_050_000, clientFeeRefund: 50_000, supplierCompensation: 0 },
  });
  expect(database().released).toEqual([{
    applicationId: 'application-1',
    contractId: 'contract-1',
    actorUserId: 'admin-1',
    sessionId: null,
    cancelledAt: within24h,
  }]);
  expect(database().contract.status).toBe('CANCELLED');
});

test('24시간 경과 의뢰인 사유는 중간 구간의 50%를 올림해 보상하고 남은 금액만 환불한다', async () => {
  const { workflow, database } = fixture({ now: after24h });
  const result = await workflow.processCancellation({
    contractId: 'contract-1',
    actor: admin,
    party: 'CLIENT',
    reason: '일정 지연',
  });

  expect(result.supplierCompensation).toBe(250_000);
  expect(result.refundAmount).toBe(787_500);
  expect(result.clientFeeRefund).toBe(37_500);
  expect(database().applied[0].record.settledAmount).toBe(250_000);
  expect(database().applied[0].event?.payload).toMatchObject({ supplierCompensation: 250_000 });
});

test('공급자 사유는 보상 없이 남은 의뢰인 수수료까지 전액 환불하고, 상태 전이에 actor 세션을 넘긴다', async () => {
  const { workflow, database } = fixture({ now: after24h });
  const result = await workflow.processCancellation({
    contractId: 'contract-1',
    actor: { ...admin, sessionId: 'session-admin' },
    party: 'SUPPLIER',
    reason: '공급자 사정',
  });

  expect(result.supplierCompensation).toBe(0);
  expect(result.refundAmount).toBe(1_050_000);
  expect(result.clientFeeRefund).toBe(50_000);
  expect(database().released[0]).toMatchObject({
    actorUserId: 'admin-1',
    sessionId: 'session-admin',
  });
});

test('양측 합의는 합의한 금액만 보상하고, 합의액이 없으면 계산하지 않는다', async () => {
  const { workflow } = fixture({ now: after24h });
  const agreed = await workflow.processCancellation({
    contractId: 'contract-1',
    actor: admin,
    party: 'MUTUAL',
    reason: '협의 취소',
    negotiatedCompensation: 100_000,
  });
  expect(agreed.supplierCompensation).toBe(100_000);
  expect(agreed.refundAmount).toBe(945_000);

  const missing = fixture({ now: after24h });
  await throwsCode(
    () => missing.workflow.processCancellation({ contractId: 'contract-1', actor: admin, party: 'MUTUAL', reason: '협의 취소' }),
    'NEGOTIATED_COMPENSATION_REQUIRED',
  );
});

test('운영자가 아닌 사용자와 이미 취소·환불된 계약은 처리하지 않는다', async () => {
  const { workflow, database } = fixture();
  await throwsCode(
    () => workflow.processCancellation({ contractId: 'contract-1', actor: client, party: 'CLIENT', reason: '변심' }),
    'REFUND_FORBIDDEN',
  );

  await workflow.processCancellation({ contractId: 'contract-1', actor: admin, party: 'CLIENT', reason: '변심' });
  await throwsCode(
    () => workflow.processCancellation({ contractId: 'contract-1', actor: admin, party: 'CLIENT', reason: '변심' }),
    'CONTRACT_NOT_ACTIVE',
  );
  expect(database().applied).toHaveLength(1);
});

test('예치 전 계약은 환불 없이 취소만 확정하고 상태를 PENDING으로 둔다', async () => {
  const { workflow, database } = fixture();
  database().contract.paymentStatus = 'PENDING';
  database().contract.totalDeposited = 0;

  const result = await workflow.processCancellation({
    contractId: 'contract-1',
    actor: admin,
    party: 'CLIENT',
    reason: '예치 전 취소',
  });

  expect(result.refundAmount).toBe(0);
  expect(result.supplierCompensation).toBe(0);
  expect(result.settlement.within24Hours).toBe(true);
  const applied = database().applied[0];
  expect(applied.record).toMatchObject({
    contractId: 'contract-1',
    status: 'CANCELLED',
    paymentStatus: 'PENDING',
    refundAmount: 0,
    clientFeeRefund: 0,
    settledAmount: 0,
    installments: [],
  });
  expect(applied.event).toBeUndefined();
  expect(database().released).toHaveLength(1);
  expect(database().contract.status).toBe('CANCELLED');
});

test('이미 환불이 기록된 계약은 다시 환불하지 않는다', async () => {
  const { workflow, database } = fixture();
  database().contract.refundAmount = 1_050_000;
  await throwsCode(
    () => workflow.processCancellation({ contractId: 'contract-1', actor: admin, party: 'CLIENT', reason: '변심' }),
    'REFUND_ALREADY_RECORDED',
  );
  expect(database().applied).toEqual([]);
});

// ── route ────────────────────────────────────────────────────

function routeFixture() {
  const handlers = new Map<string, CancellationRequestHandler<CancellationHttpRequest, CancellationHttpResponse>>();
  const calls: { request: unknown[]; process: unknown[] } = { request: [], process: [] };
  const workflow: CancellationWorkflowService = {
    requestCancellation: async (input) => {
      calls.request.push(input);
      return { ok: true };
    },
    processCancellation: async (input) => {
      calls.process.push(input);
      return { refundAmount: 1_050_000 };
    },
  };
  const router: CancellationRouteRegistrar<CancellationHttpRequest, CancellationHttpResponse> = {
    post: (path, handler) => { handlers.set(path, handler); },
  };
  registerCancellationRoutes(router, {
    workflow,
    getAuth: () => admin,
    mapTradeError: (error) => ({ mapped: error.code }),
  });
  return { handlers, calls };
}

async function callHandler(
  handler: CancellationRequestHandler<CancellationHttpRequest, CancellationHttpResponse> | undefined,
  request: CancellationHttpRequest,
) {
  let body: unknown;
  const errors: unknown[] = [];
  const response: CancellationHttpResponse = { json: (value) => { body = value; } };
  const next = (error?: unknown) => { if (error !== undefined) errors.push(error); };
  if (!handler) throw new Error('cancellation handler was not registered');
  await handler(request, response, next);
  return { body, errors };
}

test('취소 요청 route는 사유와 인증 actor를 workflow에 전달한다', async () => {
  const { handlers, calls } = routeFixture();
  const result = await callHandler(handlers.get('/:contractId/cancellation-requests'), {
    params: { contractId: 'contract-1' },
    body: { reason: '일정이 밀렸습니다' },
  });

  expect(calls.request).toEqual([{
    contractId: 'contract-1',
    actor: admin,
    reason: '일정이 밀렸습니다',
  }]);
  expect(result.body).toEqual({ ok: true });
  expect(result.errors).toEqual([]);
});

test('취소 처리 route는 합의 금액·비율을 workflow에 전달하고, 입력 오류는 mapTradeError로 보낸다', async () => {
  const { handlers, calls } = routeFixture();
  const handler = handlers.get('/:contractId/cancellation');
  const result = await callHandler(handler, {
    params: { contractId: 'contract-1' },
    body: { party: 'MUTUAL', reason: '협의 취소', negotiatedCompensation: 100_000 },
  });

  expect(calls.process).toEqual([{
    contractId: 'contract-1',
    actor: admin,
    party: 'MUTUAL',
    reason: '협의 취소',
    negotiatedCompensation: 100_000,
  }]);
  expect(result.body).toEqual({ refundAmount: 1_050_000 });

  const invalid = await callHandler(handler, {
    params: { contractId: 'contract-1' },
    body: { party: 'MUTUAL', reason: '협의 취소', negotiatedCompensation: -1 },
  });
  expect(invalid.errors).toEqual([{ mapped: 'INVALID_COMPENSATION_AMOUNT' }]);

  const noParty = await callHandler(handler, {
    params: { contractId: 'contract-1' },
    body: { reason: '협의 취소' },
  });
  expect(noParty.errors).toEqual([{ mapped: 'INVALID_CANCELLATION_PARTY' }]);
});
