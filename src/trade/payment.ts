import { TradeError } from './errors.js';

export type DepositStatus = 'PENDING' | 'HELD' | 'COMPLETED' | 'FAILED';
export type PaymentEventType =
  | 'REQUESTED'
  | 'CALLBACK_RECEIVED'
  | 'DUPLICATE_BLOCKED'
  | 'AMOUNT_MISMATCH'
  | 'VERIFIED'
  | 'FAILED';

// DB의 deposit_one_open 인덱스와 같은 집합이다. 직전 시도가 FAILED일 때만 새 시도를 만든다.
const OPEN: DepositStatus[] = ['PENDING', 'HELD', 'COMPLETED'];

export function planDeposit<D extends { status: DepositStatus; idempotencyKey: string }>(
  contract: { status: string; agreedAmount: number; clientFee: number },
  deposits: D[],
  idempotencyKey: string,
) {
  if (!idempotencyKey) throw new TradeError('IDEMPOTENCY_KEY_REQUIRED');
  const replay = deposits.find((d) => d.idempotencyKey === idempotencyKey);
  if (replay) return { kind: 'EXISTING' as const, deposit: replay };
  // 서명이 끝나 ACTIVE가 된 뒤에만 예치할 수 있다.
  if (contract.status !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
  if (deposits.some((d) => OPEN.includes(d.status))) throw new TradeError('DEPOSIT_ALREADY_OPEN');
  return {
    kind: 'NEW' as const,
    principal: contract.agreedAmount,
    clientFee: contract.clientFee,
    amount: contract.agreedAmount + contract.clientFee,
    idempotencyKey,
  };
}

export type PgCallback = {
  pgKey: string;
  amount: number;
  occurredAt: string; // PG 원본 시각. 재수신해도 같은 값이어야 한다
  result: 'SUCCESS' | 'FAILURE';
  verified: boolean; // sandbox 확인 결과. 확인 호출은 호출자가 한다
};
export type PaymentEventDraft = { eventType: PaymentEventType; dedupKey: string | null; resultNote: string };
export type CallbackDecision = { depositStatus: DepositStatus; credit: number; events: PaymentEventDraft[] };

// 같은 원본 이벤트는 몇 번 받아도 같은 키가 나와야 한다. 현재 시각은 넣지 않는다.
// 필드 이름은 실제 sandbox 응답을 확인한 뒤 맞춘다.
export const callbackKey = (cb: PgCallback) => cb.pgKey + ':' + cb.amount + ':' + cb.occurredAt;

export function decideCallback(
  deposit: { status: DepositStatus; amount: number },
  seenDedupKeys: ReadonlySet<string>,
  cb: PgCallback,
): CallbackDecision {
  if (!cb.pgKey || !cb.occurredAt || !Number.isInteger(cb.amount)) throw new TradeError('INVALID_CALLBACK');
  const key = callbackKey(cb);
  // CALLBACK_RECEIVED와 VERIFIED는 둘 다 키가 필수이고 (입금, 키)가 유일하므로 키를 서로 다르게 만든다.
  const received: PaymentEventDraft = { eventType: 'CALLBACK_RECEIVED', dedupKey: 'callback:' + key, resultNote: 'callback received' };
  const keep = (events: PaymentEventDraft[]): CallbackDecision => ({ depositStatus: deposit.status, credit: 0, events });

  // 이미 받은 콜백이거나 이미 완료된 입금이면 예치액에 다시 더하지 않는다. 키 없는 기록은 유니크에 걸리지 않는다.
  if (seenDedupKeys.has('callback:' + key) || deposit.status === 'COMPLETED') {
    return keep([{ eventType: 'DUPLICATE_BLOCKED', dedupKey: null, resultNote: 'already handled' }]);
  }
  // HELD·FAILED 입금은 운영자 확인이나 새 시도로만 바뀐다. 콜백은 기록만 한다.
  if (deposit.status !== 'PENDING') {
    return keep([{ ...received, resultNote: 'deposit is ' + deposit.status + ', operator review' }]);
  }
  if (cb.result === 'FAILURE') {
    return { depositStatus: 'FAILED', credit: 0, events: [received, { eventType: 'FAILED', dedupKey: null, resultNote: 'PG reported failure' }] };
  }
  if (cb.amount !== deposit.amount) {
    const note = 'expected ' + deposit.amount + ' got ' + cb.amount;
    return { depositStatus: 'HELD', credit: 0, events: [received, { eventType: 'AMOUNT_MISMATCH', dedupKey: null, resultNote: note }] };
  }
  if (!cb.verified) {
    return { depositStatus: 'HELD', credit: 0, events: [{ ...received, resultNote: 'not verified with PG' }] };
  }
  return {
    depositStatus: 'COMPLETED',
    credit: deposit.amount,
    events: [received, { eventType: 'VERIFIED', dedupKey: 'verified:' + key, resultNote: 'verified' }],
  };
}

// 콜백이 오지 않는 입금은 기한이 지나면 보류한다. 기한 값은 sandbox 확인 뒤 정한다.
export function holdIfOverdue(
  deposit: { status: DepositStatus; createdAt: Date },
  now: Date,
  limitMs: number,
): DepositStatus {
  return deposit.status === 'PENDING' && now.getTime() - deposit.createdAt.getTime() > limitMs ? 'HELD' : deposit.status;
}
