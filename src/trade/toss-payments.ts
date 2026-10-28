import { assertWon } from './money.js';
import type { PgCallback } from './payment.js';
import { TradeError } from './errors.js';

export type TossConfirmationRequest = {
  paymentKey: string;
  orderId: string;
  amount: number;
  returnedAmount: number;
  idempotencyKey: string;
};

const CONFIRM_TIMEOUT_MS = 10_000;

// 승인 여부를 알 수 없는 오류. 결제가 이미 됐을 수 있으므로 호출부가 입금을 HELD로 잠근다.
export const UNCERTAIN_CONFIRM_CODES: readonly string[] = [
  'TOSS_CONFIRM_UNAVAILABLE',
  'TOSS_CONFIRM_INVALID_RESPONSE',
];

export async function confirmTossPayment(
  testSecretKey: string,
  input: TossConfirmationRequest,
  fetcher: typeof fetch = fetch,
): Promise<PgCallback> {
  if (!testSecretKey.startsWith('test_sk_') && !testSecretKey.startsWith('test_gsk_')) {
    throw new TradeError('TOSS_TEST_KEY_REQUIRED');
  }
  if (!input.paymentKey.trim() || input.paymentKey.length > 200) {
    throw new TradeError('TOSS_PAYMENT_KEY_INVALID');
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(input.orderId)) throw new TradeError('TOSS_ORDER_ID_INVALID');
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 300) {
    throw new TradeError('TOSS_IDEMPOTENCY_KEY_INVALID');
  }
  assertWon(input.amount);
  if (!Number.isInteger(input.returnedAmount) || input.returnedAmount !== input.amount) {
    throw new TradeError('TOSS_AMOUNT_MISMATCH');
  }

  let response: Response;
  try {
    response = await fetcher('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(testSecretKey + ':').toString('base64'),
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        paymentKey: input.paymentKey,
        orderId: input.orderId,
        amount: input.amount,
      }),
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
    });
  } catch {
    throw new TradeError('TOSS_CONFIRM_UNAVAILABLE');
  }
  if (response.status >= 500) throw new TradeError('TOSS_CONFIRM_UNAVAILABLE');
  if (!response.ok) throw new TradeError('TOSS_CONFIRM_REJECTED');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TradeError('TOSS_CONFIRM_INVALID_RESPONSE');
  }
  if (!isRecord(payload) ||
    typeof payload.paymentKey !== 'string' ||
    typeof payload.orderId !== 'string' ||
    typeof payload.totalAmount !== 'number' ||
    typeof payload.status !== 'string' ||
    typeof payload.approvedAt !== 'string' ||
    Number.isNaN(Date.parse(payload.approvedAt))) {
    throw new TradeError('TOSS_CONFIRM_INVALID_RESPONSE');
  }
  if (
    // shortcut: only immediate DONE payments are accepted; add verified DEPOSIT_CALLBACK handling before enabling virtual accounts.
    payload.status !== 'DONE' ||
    payload.paymentKey !== input.paymentKey ||
    payload.orderId !== input.orderId ||
    payload.totalAmount !== input.amount
  ) {
    throw new TradeError('TOSS_CONFIRM_MISMATCH');
  }

  return {
    pgKey: payload.paymentKey,
    amount: payload.totalAmount,
    occurredAt: payload.approvedAt,
    result: 'SUCCESS',
    verified: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
