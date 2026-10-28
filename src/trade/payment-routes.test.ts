import { expect, test } from '@jest/globals';
import { TradeError } from './errors.js';
import {
  registerPaymentRoutes,
  type PaymentHttpRequest,
  type PaymentHttpResponse,
  type PaymentRequestHandler,
  type PaymentRouteRegistrar,
  type PaymentWorkflowService,
} from './payment-routes.js';

type Calls = {
  start: Parameters<PaymentWorkflowService['startDeposit']>[0][];
  confirm: Parameters<PaymentWorkflowService['confirmDeposit']>[0][];
  review: Parameters<PaymentWorkflowService['reviewHeldDeposit']>[0][];
};

function fixture(options: { error?: Error } = {}) {
  const handlers = new Map<string, PaymentRequestHandler<PaymentHttpRequest, PaymentHttpResponse>>();
  const calls: Calls = { start: [], confirm: [], review: [] };
  const workflow: PaymentWorkflowService = {
    startDeposit: async (input) => {
      if (options.error) throw options.error;
      calls.start.push(input);
      return {
        depositId: 'deposit-1',
        orderId: 'deposit-1',
        amount: 105_000,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        replayed: false,
      };
    },
    confirmDeposit: async (input) => {
      if (options.error) throw options.error;
      calls.confirm.push(input);
      return {
        depositStatus: 'COMPLETED',
        paymentStatus: 'DEPOSITED',
        creditedAmount: 105_000,
        replayed: false,
      };
    },
    reviewHeldDeposit: async (input) => {
      if (options.error) throw options.error;
      calls.review.push(input);
      return {
        depositStatus: 'COMPLETED',
        paymentStatus: 'DEPOSITED',
        creditedAmount: 105_000,
      };
    },
  };
  const router: PaymentRouteRegistrar<PaymentHttpRequest, PaymentHttpResponse> = {
    post: (path, handler) => { handlers.set(path, handler); },
  };
  registerPaymentRoutes(router, {
    workflow,
    getAuth: () => ({ userId: 'client-1', role: 'CLIENT' }),
    mapTradeError: (error) => ({ mapped: error.code }),
  });
  return { handlers, calls };
}

async function callHandler(
  handler: PaymentRequestHandler<PaymentHttpRequest, PaymentHttpResponse> | undefined,
  request: PaymentHttpRequest,
) {
  let body: unknown;
  const errors: unknown[] = [];
  const response: PaymentHttpResponse = { json: (value) => { body = value; } };
  const next = (error?: unknown) => { if (error !== undefined) errors.push(error); };
  if (!handler) throw new Error('payment handler was not registered');
  await handler(request, response, next);
  return { body, errors };
}

test('예치 시작 route는 계약 ID·멱등키·인증 actor를 workflow에 전달한다', async () => {
  const { handlers, calls } = fixture();
  const result = await callHandler(handlers.get('/:contractId/deposits'), {
    params: { contractId: 'contract-1' },
    body: { idempotencyKey: 'deposit-key-1' },
  });

  expect(calls.start).toEqual([{
    contractId: 'contract-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    idempotencyKey: 'deposit-key-1',
  }]);
  expect(result.body).toMatchObject({ depositId: 'deposit-1', amount: 105_000, replayed: false });
  expect(result.errors).toEqual([]);
});

test('예치 승인 route는 Toss 응답 대조에 필요한 값을 workflow에 전달한다', async () => {
  const { handlers, calls } = fixture();
  const result = await callHandler(handlers.get('/:contractId/deposits/:depositId/confirm'), {
    params: { contractId: 'contract-1', depositId: 'deposit-1' },
    body: { paymentKey: 'pay_test_1', orderId: 'deposit-1', returnedAmount: 105_000 },
  });

  expect(calls.confirm).toEqual([{
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    paymentKey: 'pay_test_1',
    orderId: 'deposit-1',
    returnedAmount: 105_000,
  }]);
  expect(result.body).toMatchObject({ depositStatus: 'COMPLETED', creditedAmount: 105_000 });
});

test('운영자 확정 route는 COMPLETE·FAIL 결정과 사유를 workflow에 전달한다', async () => {
  const { handlers, calls } = fixture();
  const result = await callHandler(handlers.get('/:contractId/deposits/:depositId/operator-review'), {
    params: { contractId: 'contract-1', depositId: 'deposit-1' },
    body: { decision: 'COMPLETE', reason: 'PG 정산 내역과 입금액 일치' },
  });

  expect(calls.review).toEqual([{
    contractId: 'contract-1',
    depositId: 'deposit-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    decision: 'COMPLETE',
    reason: 'PG 정산 내역과 입금액 일치',
  }]);
  expect(result.body).toMatchObject({ depositStatus: 'COMPLETED' });
});

test('누락·잘못된 예치 DTO는 workflow를 호출하지 않고 도메인 오류로 전달한다', async () => {
  const { handlers, calls } = fixture();
  const start = handlers.get('/:contractId/deposits');
  const confirm = handlers.get('/:contractId/deposits/:depositId/confirm');
  const review = handlers.get('/:contractId/deposits/:depositId/operator-review');
  const params = { contractId: 'contract-1', depositId: 'deposit-1' };

  expect((await callHandler(start, { params: { contractId: 'contract-1' }, body: {} })).errors)
    .toEqual([{ mapped: 'IDEMPOTENCY_KEY_REQUIRED' }]);
  expect((await callHandler(start, { params: {}, body: { idempotencyKey: 'key' } })).errors)
    .toEqual([{ mapped: 'CONTRACT_ID_REQUIRED' }]);
  expect((await callHandler(confirm, { params, body: { paymentKey: '', orderId: 'd', returnedAmount: 1 } })).errors)
    .toEqual([{ mapped: 'TOSS_PAYMENT_KEY_INVALID' }]);
  expect((await callHandler(confirm, { params, body: { paymentKey: 'p', orderId: '', returnedAmount: 1 } })).errors)
    .toEqual([{ mapped: 'PAYMENT_ORDER_ID_REQUIRED' }]);
  expect((await callHandler(confirm, { params, body: { paymentKey: 'p', orderId: 'd', returnedAmount: 1.5 } })).errors)
    .toEqual([{ mapped: 'TOSS_AMOUNT_MISMATCH' }]);
  expect((await callHandler(review, { params, body: { decision: 'MAYBE', reason: 'x' } })).errors)
    .toEqual([{ mapped: 'INVALID_OPERATOR_REVIEW_DECISION' }]);
  expect((await callHandler(review, { params, body: { decision: 'FAIL', reason: ' ' } })).errors)
    .toEqual([{ mapped: 'OPERATOR_REVIEW_REASON_REQUIRED' }]);
  expect(calls).toEqual({ start: [], confirm: [], review: [] });
});

test('workflow 도메인 오류를 공통 mapper로 전달한다', async () => {
  const { handlers } = fixture({ error: new TradeError('DEPOSIT_NOT_HELD') });
  const result = await callHandler(handlers.get('/:contractId/deposits/:depositId/operator-review'), {
    params: { contractId: 'contract-1', depositId: 'deposit-1' },
    body: { decision: 'FAIL', reason: '실패 처리' },
  });
  expect(result.errors).toEqual([{ mapped: 'DEPOSIT_NOT_HELD' }]);
});
