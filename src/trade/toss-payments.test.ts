import { expect, test } from '@jest/globals';
import { callbackKey, decideCallback } from './payment.js';
import { confirmTossPayment } from './toss-payments.js';

const request = {
  paymentKey: 'pay_test_42',
  orderId: 'deposit-42',
  amount: 105_000,
  returnedAmount: 105_000,
  idempotencyKey: 'deposit-idem-42',
};

const confirmed = {
  paymentKey: request.paymentKey,
  orderId: request.orderId,
  totalAmount: request.amount,
  status: 'DONE',
  approvedAt: '2026-10-27T12:00:00+09:00',
};

const mockResponse = (body: unknown, status = 200) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetcher };
};

test('sandbox 승인 요청은 서버 금액과 결제 결과를 대조하고 멱등키를 보낸다', async () => {
  const { calls, fetcher } = mockResponse(confirmed);

  const callback = await confirmTossPayment('test_sk_unit', request, fetcher);

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://api.tosspayments.com/v1/payments/confirm');
  expect(calls[0].init?.method).toBe('POST');
  expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe(
    'Basic ' + Buffer.from('test_sk_unit:').toString('base64'),
  );
  expect(new Headers(calls[0].init?.headers).get('Idempotency-Key')).toBe(request.idempotencyKey);
  expect(calls[0].init?.body).toBe(JSON.stringify({
    paymentKey: request.paymentKey,
    orderId: request.orderId,
    amount: request.amount,
  }));

  expect(callback).toEqual({
    pgKey: request.paymentKey,
    amount: request.amount,
    occurredAt: confirmed.approvedAt,
    result: 'SUCCESS',
    verified: true,
  });
  const decision = decideCallback({ status: 'PENDING', amount: request.amount }, new Set(), callback);
  expect([decision.depositStatus, decision.credit]).toEqual(['COMPLETED', request.amount]);

  const replay = decideCallback(
    { status: 'PENDING', amount: request.amount },
    new Set(['callback:' + callbackKey(callback)]),
    callback,
  );
  expect([replay.depositStatus, replay.credit]).toEqual(['PENDING', 0]);
});

test('live key와 서버 금액과 다른 redirect 금액은 요청 전에 거부한다', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response('{}');
  };

  await expect(confirmTossPayment('live_sk_do_not_use', request, fetcher)).rejects.toHaveProperty(
    'code',
    'TOSS_TEST_KEY_REQUIRED',
  );
  await expect(confirmTossPayment('test_sk_unit', { ...request, returnedAmount: 1 }, fetcher)).rejects.toHaveProperty(
    'code',
    'TOSS_AMOUNT_MISMATCH',
  );
  expect(calls).toBe(0);
});

test('요청 실패, 응답 대조 실패, 잘못된 응답을 성공 입금으로 처리하지 않는다', async () => {
  const rejected = mockResponse({ code: 'PAYMENT_NOT_FOUND' }, 400);
  await expect(confirmTossPayment('test_sk_unit', request, rejected.fetcher)).rejects.toHaveProperty(
    'code',
    'TOSS_CONFIRM_REJECTED',
  );

  for (const payload of [
    { ...confirmed, totalAmount: request.amount - 1 },
    { ...confirmed, status: 'IN_PROGRESS' },
    { ...confirmed, orderId: 'another-order' },
    { ...confirmed, paymentKey: 'another-payment' },
  ]) {
    const mismatched = mockResponse(payload);
    await expect(confirmTossPayment('test_sk_unit', request, mismatched.fetcher)).rejects.toHaveProperty(
      'code',
      'TOSS_CONFIRM_MISMATCH',
    );
  }

  const invalid = mockResponse({ ...confirmed, approvedAt: null });
  await expect(confirmTossPayment('test_sk_unit', request, invalid.fetcher)).rejects.toHaveProperty(
    'code',
    'TOSS_CONFIRM_INVALID_RESPONSE',
  );

  const unavailable: typeof fetch = async () => {
    throw new Error('network unavailable');
  };
  await expect(confirmTossPayment('test_sk_unit', request, unavailable)).rejects.toHaveProperty(
    'code',
    'TOSS_CONFIRM_UNAVAILABLE',
  );
});
