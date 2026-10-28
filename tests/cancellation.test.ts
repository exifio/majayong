import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import {
  CANCELLATION_FREE_CANCEL_MS,
  planCancellationSettlement,
} from '../src/trade/cancellation.ts';
import { planManualRefund } from '../src/trade/settlement.ts';

const activatedAt = new Date('2026-10-01T00:00:00.000Z');
const within = new Date(activatedAt.getTime() + CANCELLATION_FREE_CANCEL_MS);
const after = new Date(activatedAt.getTime() + CANCELLATION_FREE_CANCEL_MS + 1);

const base = {
  principal: 1_000_000,
  clientFee: 50_000,
  interimAmount: 500_000,
  totalDeposited: 1_050_000,
  releasedAmount: 0,
  activatedAt,
  cancelledAt: after,
  party: 'CLIENT' as const,
};

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

test('의뢰인 사유 24시간 이내(경계 포함)는 남은 예치금 전액을 환불한다', () => {
  const result = planCancellationSettlement({ ...base, cancelledAt: within });
  expect(result).toEqual({
    within24Hours: true,
    supplierCompensation: 0,
    principalRefund: 1_000_000,
    clientFeeRefund: 50_000,
    totalRefund: 1_050_000,
    retainedClientFee: 0,
  });
});

test('의뢰인 사유 24시간 경과 뒤에는 중간 구간의 최소 50%를 착수 보상으로 뺀다', () => {
  const result = planCancellationSettlement(base);
  expect(result).toEqual({
    within24Hours: false,
    supplierCompensation: 250_000,
    principalRefund: 750_000,
    clientFeeRefund: 37_500,
    totalRefund: 787_500,
    retainedClientFee: 12_500,
  });
});

test('협의 보상은 최소 50% 이상이어야 하고, 이미 지급된 구간은 보상액에 포함한다', () => {
  const higher = planCancellationSettlement({ ...base, negotiatedCompensation: 300_000 });
  expect(higher.supplierCompensation).toBe(300_000);
  expect(higher.principalRefund).toBe(700_000);

  throwsCode(
    () => planCancellationSettlement({ ...base, negotiatedCompensation: 249_999 }),
    'COMPENSATION_BELOW_MINIMUM',
  );

  // 중간 구간 500,000원이 이미 지급됐으면 최소 보상 250,000원은 이미 채워졌다.
  const alreadyReleased = planCancellationSettlement({
    ...base,
    releasedAmount: 500_000,
  });
  expect(alreadyReleased.supplierCompensation).toBe(0);
  expect(alreadyReleased.principalRefund).toBe(500_000);
  expect(alreadyReleased.clientFeeRefund).toBe(25_000);
  expect(alreadyReleased.totalRefund).toBe(525_000);
});

test('공급자 사유는 남은 예치금과 의뢰인 수수료를 전액 환불한다', () => {
  const result = planCancellationSettlement({ ...base, party: 'SUPPLIER' });
  expect(result.supplierCompensation).toBe(0);
  expect(result.principalRefund).toBe(1_000_000);
  expect(result.clientFeeRefund).toBe(50_000);
  expect(result.totalRefund).toBe(1_050_000);
});

test('양측 합의는 합의한 보상액만 지급하고 나머지를 환불한다', () => {
  const result = planCancellationSettlement({ ...base, party: 'MUTUAL', negotiatedCompensation: 100_000 });
  expect(result.supplierCompensation).toBe(100_000);
  expect(result.principalRefund).toBe(900_000);
  expect(result.clientFeeRefund).toBe(45_000);
  expect(result.totalRefund).toBe(945_000);
  throwsCode(
    () => planCancellationSettlement({ ...base, party: 'MUTUAL' }),
    'NEGOTIATED_COMPENSATION_REQUIRED',
  );
});

test('잘못된 시각·비율·보상 한도를 거부한다', () => {
  throwsCode(
    () => planCancellationSettlement({ ...base, cancelledAt: new Date(activatedAt.getTime() - 1) }),
    'INVALID_CANCELLATION_TIME',
  );
  throwsCode(
    () => planCancellationSettlement({ ...base, compensationPercent: 49 }),
    'INVALID_COMPENSATION_PERCENT',
  );
  throwsCode(
    () => planCancellationSettlement({ ...base, negotiatedCompensation: 1_000_001 }),
    'COMPENSATION_EXCEEDS_AVAILABLE',
  );
});

test('계산 결과를 수동 환불 기록에 그대로 넘길 수 있다', () => {
  const settlement = planCancellationSettlement(base);
  const refund = planManualRefund({
    actor: { userId: 'admin-1', role: 'ADMIN' },
    contract: {
      id: 'contract-1',
      status: 'CANCELLED',
      paymentStatus: 'DEPOSITED',
      totalDeposited: base.totalDeposited,
      clientFee: base.clientFee,
      refundAmount: null,
    },
    installments: [
      { id: 'interim', status: 'PENDING' },
      { id: 'final', status: 'PENDING' },
    ],
    availableAmount: settlement.totalRefund,
    refundAmount: settlement.totalRefund,
    clientFeeRefund: settlement.clientFeeRefund,
    supplierCompensation: settlement.supplierCompensation,
    reason: '의뢰인 사유 취소, 착수 보상 합의',
    refundedAt: after,
  });

  expect(refund.contract).toMatchObject({
    paymentStatus: 'REFUNDED',
    refundAmount: 787_500,
    clientFeeRefund: 37_500,
  });
  expect(refund.event.payload).toMatchObject({
    amount: 787_500,
    clientFeeRefund: 37_500,
    supplierCompensation: 250_000,
  });
  expect(refund.installments).toEqual([
    { id: 'interim', status: 'REFUNDED' },
    { id: 'final', status: 'REFUNDED' },
  ]);
});
