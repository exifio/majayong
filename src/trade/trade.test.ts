import { expect, test } from '@jest/globals';
import { TradeError } from './errors.js';
import { computeMoney, isFeeExempt } from './money.js';
import {
  buildScope,
  planContract,
  recordContractSignature,
  type AcceptedContext,
  type ContractConsent,
  type ContractStatus,
  type SpecItemStatus,
} from './contract.js';
import {
  callbackKey,
  decideCallback,
  holdIfOverdue,
  planDeposit,
  type DepositStatus,
  type PgCallback,
} from './payment.js';

// 이 시험은 수락된 지원서 예시 데이터로 순수 로직만 확인한다. 실제 DB·Toss sandbox 연결 시험이 아니다.

const throwsCode = (fn: () => unknown, code: string) => {
  let thrown: unknown;
  try {
    fn();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TradeError);
  expect(thrown).toHaveProperty('code', code);
};

// ── 금액 ──────────────────────────────────────────────────────

test('1,000,001원 50:50: 끝수는 최종 구간, 양측 수수료 각 50,000원', () => {
  const m = computeMoney(1_000_001, 50, false);
  const [interim, final] = m.installments;
  expect(m.clientFee).toBe(50_000);
  expect(m.supplierFee).toBe(50_000);
  expect([interim.amount, final.amount]).toEqual([500_000, 500_001]);
  expect([interim.supplierFee, final.supplierFee]).toEqual([25_000, 25_000]);
  expect([interim.releaseAmount, final.releaseAmount]).toEqual([475_000, 475_001]);
});

test('수수료는 원 단위로 내린다', () => {
  expect(computeMoney(999, 50, false).clientFee).toBe(49);
});

test('어떤 금액·비율에서도 구간 합계가 계약 금액·공급자 수수료와 같다', () => {
  for (const exempt of [false, true]) {
    for (const amount of [100, 101, 999, 12_345, 1_000_001, 987_654_321]) {
      for (const ratio of [1, 30, 33, 50, 70, 99]) {
        const m = computeMoney(amount, ratio, exempt);
        const [i, f] = m.installments;
        const where = 'amount=' + amount + ' ratio=' + ratio + ' exempt=' + exempt;
        expect(i.amount + f.amount).toBe(amount);
        expect(i.supplierFee + f.supplierFee).toBe(m.supplierFee);
        expect(i.releaseAmount + f.releaseAmount).toBe(amount - m.supplierFee);
        for (const n of [i.amount, f.amount, i.supplierFee, f.supplierFee, i.releaseAmount, f.releaseAmount]) {
          expect(Number.isInteger(n) && n >= 0).toBe(true);
        }
      }
    }
  }
});

test('첫 거래 면제: 공급자 수수료 0, 의뢰인 수수료는 그대로', () => {
  const m = computeMoney(1_000_001, 50, true);
  expect(m.supplierFee).toBe(0);
  expect(m.clientFee).toBe(50_000);
  for (const i of m.installments) {
    expect(i.supplierFee).toBe(0);
    expect(i.releaseAmount).toBe(i.amount);
  }
});

test('면제는 feeExempt이고 아직 쓰지 않았을 때만', () => {
  expect(isFeeExempt({ feeExempt: true, feeExemptUsedAt: null })).toBe(true);
  expect(isFeeExempt({ feeExempt: true, feeExemptUsedAt: new Date() })).toBe(false);
  expect(isFeeExempt({ feeExempt: false, feeExemptUsedAt: null })).toBe(false);
});

test('잘못된 금액·비율은 거부한다', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, 2_147_483_648]) throwsCode(() => computeMoney(bad, 50, false), 'INVALID_AMOUNT');
  for (const bad of [0, 100, 50.5, -5]) throwsCode(() => computeMoney(1_000_000, bad, false), 'INVALID_RATIO');
  throwsCode(() => computeMoney(1, 50, false), 'AMOUNT_TOO_SMALL');
  // 원금은 들어가도 의뢰인 수수료를 더한 예치 금액이 32비트 정수를 넘는 경우
  throwsCode(() => computeMoney(2_100_000_000, 50, false), 'INVALID_AMOUNT');
});

// ── 계약 범위 ─────────────────────────────────────────────────

const specItem = (id: string, status: SpecItemStatus, sortOrder: number) => ({
  id,
  versionNo: 2,
  title: 'title-' + id,
  description: 'desc-' + id,
  status,
  sortOrder,
});

const ctx = (over: Partial<AcceptedContext> = {}): AcceptedContext => ({
  application: { id: 'app-1', status: 'ACCEPTED', specVersionNo: 2, totalAmount: 3_000_000, durationDays: 30 },
  specItems: [
    specItem('s4', 'INCLUDED', 4), // 지원서에 견적 항목 없음
    specItem('s1', 'INCLUDED', 1),
    specItem('s2', 'INCLUDED', 2), // 공급자가 수행 불가
    specItem('s3', 'NEEDS_CONFIRMATION', 3),
    specItem('s5', 'EXCLUDED', 5),
    specItem('s6', 'INCLUDED', 6),
  ],
  appItems: [
    { specItemId: 's1', isAvailable: true, amount: 1_000_000 },
    { specItemId: 's2', isAvailable: false, amount: null },
    { specItemId: 's3', isAvailable: true, amount: 500_000 },
    { specItemId: 's5', isAvailable: true, amount: 200_000 },
    { specItemId: 's6', isAvailable: true, amount: 1_300_000 },
  ],
  ...over,
});

test('계약 범위는 INCLUDED이면서 수행 가능한 항목만, 제외 사유를 남긴다', () => {
  const scope = buildScope(ctx());
  expect(scope.specVersionNo).toBe(2);
  expect(scope.included.map((s) => s.specItemId)).toEqual(['s1', 's6']);
  expect(
    scope.excluded.map((s) => [s.specItemId, s.reason]),
  ).toEqual([
      ['s2', 'SUPPLIER_UNAVAILABLE'],
      ['s3', 'SPEC_NEEDS_CONFIRMATION'],
      ['s4', 'NOT_QUOTED'],
      ['s5', 'SPEC_EXCLUDED'],
  ]);
});

test('수행 가능한 포함 항목의 금액이 null이면 계약 범위에도 null을 보존한다', () => {
  const base = ctx();
  const appItems = base.appItems.map((item) =>
    item.specItemId === 's1' ? { ...item, amount: null } : item,
  );

  const scope = buildScope(ctx({ appItems }));

  expect(scope.included[0].specItemId).toBe('s1');
  expect(scope.included[0].amount).toBeNull();
});

test('수락되지 않은 지원서·다른 명세 버전·다른 명세의 항목·빈 범위는 거부한다', () => {
  const base = ctx();
  throwsCode(() => buildScope(ctx({ application: { ...base.application, status: 'SUBMITTED' } })), 'APPLICATION_NOT_ACCEPTED');
  throwsCode(() => buildScope(ctx({ application: { ...base.application, specVersionNo: 3 } })), 'SPEC_VERSION_MISMATCH');
  throwsCode(
    () => buildScope(ctx({ appItems: [...base.appItems, { specItemId: 'other', isAvailable: true, amount: 1 }] })),
    'FOREIGN_APPLICATION_ITEM',
  );
  throwsCode(() => buildScope(ctx({ appItems: [] })), 'EMPTY_SCOPE');
});

test('계약 계획: 합의 금액은 제안 금액과 달라도 합의 금액으로 계산한다', () => {
  const plan = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  expect(plan.status).toBe('PENDING_CONSENT');
  expect(plan.agreedAmount).toBe(2_500_000); // 제안 금액은 3,000,000
  expect(plan.interimRatio).toBe(50);
  expect(plan.clientFee).toBe(125_000);
  expect(plan.supplierFee).toBe(125_000);
  expect(plan.specSnapshot.included.map((s) => s.specItemId)).toEqual(['s1', 's6']);
  expect(plan.installments[0].amount + plan.installments[1].amount).toBe(2_500_000);

  const custom = planContract(ctx(), { agreedAmount: 2_500_000, interimRatio: 30, supplierFeeExempt: true });
  expect(custom.installments.map((i) => i.amount)).toEqual([750_000, 1_750_000]);
  expect(custom.supplierFee).toBe(0);
});

const contractHash = 'sha256:contract-v1';
const clientSignedAt = new Date('2026-10-27T12:00:00.000Z');
const supplierSignedAt = new Date('2026-10-27T12:05:00.000Z');

test('두 당사자가 같은 계약서에 서명하면 두 번째 서명에서 ACTIVE가 된다', () => {
  const planned = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  const clientSigned = recordContractSignature(planned, {
    party: 'CLIENT',
    contentHash: contractHash,
    signedAt: clientSignedAt,
  });

  expect(clientSigned.status).toBe('PENDING_CONSENT');
  expect(clientSigned.clientSignedAt).toBe(clientSignedAt);
  expect(clientSigned.supplierSignedAt).toBeNull();
  expect(clientSigned.contentHash).toBe(contractHash);
  throwsCode(() => planDeposit({ ...planned, ...clientSigned }, [], 'deposit-early'), 'CONTRACT_NOT_ACTIVE');

  const bothSigned = recordContractSignature(clientSigned, {
    party: 'SUPPLIER',
    contentHash: contractHash,
    signedAt: supplierSignedAt,
  });
  expect(bothSigned.status).toBe('ACTIVE');
  expect(bothSigned.clientSignedAt).toBe(clientSignedAt);
  expect(bothSigned.supplierSignedAt).toBe(supplierSignedAt);
  expect(planDeposit({ ...planned, ...bothSigned }, [], 'deposit-ready').kind).toBe('NEW');
});

test('공급자가 먼저 서명해도 의뢰인의 같은 문서 서명으로 ACTIVE가 된다', () => {
  const planned = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  const supplierSigned = recordContractSignature(planned, {
    party: 'SUPPLIER',
    contentHash: contractHash,
    signedAt: supplierSignedAt,
  });
  const bothSigned = recordContractSignature(supplierSigned, {
    party: 'CLIENT',
    contentHash: contractHash,
    signedAt: clientSignedAt,
  });

  expect(bothSigned.status).toBe('ACTIVE');
  expect(bothSigned.clientSignedAt).toBe(clientSignedAt);
  expect(bothSigned.supplierSignedAt).toBe(supplierSignedAt);
});

test('서명 전에 고정한 문서 해시와 같은 해시로 서명할 수 있다', () => {
  const planned = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  const documentReady = { ...planned, contentHash: contractHash } satisfies ContractConsent;
  const clientSigned = recordContractSignature(documentReady, {
    party: 'CLIENT',
    contentHash: contractHash,
    signedAt: clientSignedAt,
  });
  const bothSigned = recordContractSignature(clientSigned, {
    party: 'SUPPLIER',
    contentHash: contractHash,
    signedAt: supplierSignedAt,
  });

  expect(bothSigned.status).toBe('ACTIVE');
  expect(bothSigned.contentHash).toBe(contractHash);
});

test('문서 해시가 다르거나 이미 서명한 당사자는 서명 상태를 바꾸지 못한다', () => {
  const planned = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  const clientSigned = recordContractSignature(planned, {
    party: 'CLIENT',
    contentHash: contractHash,
    signedAt: clientSignedAt,
  });

  throwsCode(
    () => recordContractSignature(clientSigned, { party: 'SUPPLIER', contentHash: 'sha256:other', signedAt: supplierSignedAt }),
    'CONTRACT_CONTENT_MISMATCH',
  );
  throwsCode(
    () => recordContractSignature(clientSigned, { party: 'CLIENT', contentHash: contractHash, signedAt: supplierSignedAt }),
    'ALREADY_SIGNED',
  );
  expect(clientSigned).toEqual({
    status: 'PENDING_CONSENT',
    contentHash: contractHash,
    clientSignedAt,
    supplierSignedAt: null,
  });
});

test('ACTIVE·COMPLETED·CANCELLED 계약과 잘못된 서명값은 거부한다', () => {
  const planned = planContract(ctx(), { agreedAmount: 2_500_000, supplierFeeExempt: false });
  const terminalStatuses: ContractStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
  for (const status of terminalStatuses) {
    const contract = { ...planned, status } satisfies ContractConsent;
    throwsCode(
      () => recordContractSignature(contract, { party: 'CLIENT', contentHash: contractHash, signedAt: clientSignedAt }),
      'CONTRACT_NOT_PENDING',
    );
  }

  throwsCode(
    () => recordContractSignature(planned, { party: 'CLIENT', contentHash: '   ', signedAt: clientSignedAt }),
    'INVALID_CONTENT_HASH',
  );
  throwsCode(
    () => recordContractSignature(planned, { party: 'CLIENT', contentHash: contractHash, signedAt: new Date(Number.NaN) }),
    'INVALID_SIGNATURE_TIME',
  );
});

// ── 입금 시도 ─────────────────────────────────────────────────

const activeContract = { status: 'ACTIVE', agreedAmount: 1_000_000, clientFee: 50_000 };

test('입금 시도: 원금 + 의뢰인 수수료, ACTIVE 계약에서만', () => {
  const plan = planDeposit(activeContract, [], 'key-1');
  expect(plan).toEqual({ kind: 'NEW', principal: 1_000_000, clientFee: 50_000, amount: 1_050_000, idempotencyKey: 'key-1' });
  throwsCode(() => planDeposit({ ...activeContract, status: 'PENDING_CONSENT' }, [], 'key-1'), 'CONTRACT_NOT_ACTIVE');
  throwsCode(() => planDeposit(activeContract, [], ''), 'IDEMPOTENCY_KEY_REQUIRED');
});

test('진행 중 입금이 있으면 새 시도를 막고, 실패한 뒤에만 허용한다', () => {
  const open: DepositStatus[] = ['PENDING', 'HELD', 'COMPLETED'];
  for (const status of open) {
    throwsCode(() => planDeposit(activeContract, [{ status, idempotencyKey: 'old' }], 'new'), 'DEPOSIT_ALREADY_OPEN');
  }
  const retry = planDeposit(activeContract, [{ status: 'FAILED', idempotencyKey: 'old' }], 'new');
  expect(retry.kind).toBe('NEW');
});

test('같은 멱등키 요청은 새 시도를 만들지 않고 기존 시도를 돌려준다', () => {
  const existing: { status: DepositStatus; idempotencyKey: string } = { status: 'PENDING', idempotencyKey: 'key-1' };
  const plan = planDeposit(activeContract, [existing], 'key-1');
  expect(plan.kind).toBe('EXISTING');
  expect(plan.kind === 'EXISTING' && plan.deposit).toBe(existing);
});

// ── 결제 콜백 ─────────────────────────────────────────────────

const AMOUNT = 1_050_000;
const cb = (over: Partial<PgCallback> = {}): PgCallback => ({
  pgKey: 'pg_1',
  amount: AMOUNT,
  occurredAt: '2026-10-27T12:00:00.000Z',
  result: 'SUCCESS',
  verified: true,
  ...over,
});

// DB의 (입금, dedupKey) 유니크와 CALLBACK_RECEIVED·VERIFIED의 dedupKey 필수 CHECK를 흉내 낸다.
function deliver(start: DepositStatus, callbacks: PgCallback[]) {
  let status = start;
  let total = 0;
  const seen = new Set<string>();
  const eventTypes: string[] = [];
  for (const c of callbacks) {
    const d = decideCallback({ status, amount: AMOUNT }, seen, c);
    status = d.depositStatus;
    total += d.credit;
    for (const e of d.events) {
      if (e.eventType === 'CALLBACK_RECEIVED' || e.eventType === 'VERIFIED') {
        expect(e.dedupKey).toBeTruthy();
      }
      if (e.dedupKey) {
        expect(seen.has(e.dedupKey)).toBe(false);
        seen.add(e.dedupKey);
      }
      eventTypes.push(e.eventType);
    }
  }
  return { status, total, eventTypes };
}

test('정상 콜백: 입금 완료, 예치액 한 번 반영', () => {
  const r = deliver('PENDING', [cb()]);
  expect(r).toEqual({ status: 'COMPLETED', total: AMOUNT, eventTypes: ['CALLBACK_RECEIVED', 'VERIFIED'] });
});

test('같은 콜백이 여러 번 와도 예치액은 한 번만 늘어난다', () => {
  const r = deliver('PENDING', [cb(), cb(), { ...cb() }]);
  expect(r.status).toBe('COMPLETED');
  expect(r.total).toBe(AMOUNT);
  expect(r.eventTypes).toEqual(['CALLBACK_RECEIVED', 'VERIFIED', 'DUPLICATE_BLOCKED', 'DUPLICATE_BLOCKED']);
});

test('이미 완료된 입금에 다른 콜백이 와도 더하지 않는다', () => {
  const r = deliver('COMPLETED', [cb({ pgKey: 'pg_2' })]);
  expect(r).toEqual({ status: 'COMPLETED', total: 0, eventTypes: ['DUPLICATE_BLOCKED'] });
});

test('콜백 키는 같은 원본 이벤트에서 늘 같고, 이벤트가 다르면 달라진다', () => {
  expect(callbackKey(cb())).toBe(callbackKey({ ...cb() }));
  expect(callbackKey(cb())).not.toBe(callbackKey(cb({ occurredAt: '2026-10-27T12:00:01.000Z' })));
  expect(callbackKey(cb())).not.toBe(callbackKey(cb({ pgKey: 'pg_2' })));
});

test('금액 불일치: 보류하고 예치액에 반영하지 않는다', () => {
  const r = deliver('PENDING', [cb({ amount: AMOUNT - 1 })]);
  expect(r).toEqual({ status: 'HELD', total: 0, eventTypes: ['CALLBACK_RECEIVED', 'AMOUNT_MISMATCH'] });
});

test('PG 확인이 안 된 콜백: 보류하고 성공으로 보지 않는다', () => {
  const r = deliver('PENDING', [cb({ verified: false })]);
  expect(r).toEqual({ status: 'HELD', total: 0, eventTypes: ['CALLBACK_RECEIVED'] });
});

test('실패 콜백: 입금 실패, 이후 새 시도를 만들 수 있다', () => {
  const r = deliver('PENDING', [cb({ result: 'FAILURE' })]);
  expect(r).toEqual({ status: 'FAILED', total: 0, eventTypes: ['CALLBACK_RECEIVED', 'FAILED'] });
  expect(planDeposit(activeContract, [{ status: r.status, idempotencyKey: 'old' }], 'new').kind).toBe('NEW');
});

test('보류·실패한 입금은 뒤늦은 성공 콜백으로 완료되지 않는다', () => {
  const stuck: DepositStatus[] = ['HELD', 'FAILED'];
  for (const start of stuck) {
    const r = deliver(start, [cb()]);
    expect(r).toEqual({ status: start, total: 0, eventTypes: ['CALLBACK_RECEIVED'] });
  }
});

test('금액 불일치 뒤에 같은 콜백이 다시 와도 완료되지 않는다', () => {
  const r = deliver('PENDING', [cb({ amount: 1 }), cb({ amount: 1 }), cb()]);
  expect(r.status).toBe('HELD');
  expect(r.total).toBe(0);
});

test('필수 값이 빠진 콜백은 거부한다', () => {
  const pending: { status: DepositStatus; amount: number } = { status: 'PENDING', amount: AMOUNT };
  for (const bad of [cb({ pgKey: '' }), cb({ occurredAt: '' }), cb({ amount: 1.5 })]) {
    throwsCode(() => decideCallback(pending, new Set(), bad), 'INVALID_CALLBACK');
  }
});

test('콜백이 오지 않는 입금은 기한이 지나면 보류한다', () => {
  const createdAt = new Date('2026-10-27T12:00:00Z');
  const at = (ms: number) => new Date(createdAt.getTime() + ms);
  expect(holdIfOverdue({ status: 'PENDING', createdAt }, at(1000), 1000)).toBe('PENDING'); // 기한 정각은 아직 보류 아님
  expect(holdIfOverdue({ status: 'PENDING', createdAt }, at(1001), 1000)).toBe('HELD');
  expect(holdIfOverdue({ status: 'COMPLETED', createdAt }, at(99_999), 1000)).toBe('COMPLETED');
  expect(holdIfOverdue({ status: 'FAILED', createdAt }, at(99_999), 1000)).toBe('FAILED');
});
