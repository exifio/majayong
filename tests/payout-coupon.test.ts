import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import { computeMoney } from '../src/trade/money.ts';
import { planInstallmentRelease } from '../src/trade/settlement.ts';
import {
  PAYOUT_COUPON_SCOPE,
  payoutCouponFromProfile,
  planPayoutCoupon,
  type PayoutCoupon,
} from '../src/trade/payout-coupon.ts';

const now = new Date('2026-10-28T03:00:00.000Z');
const supplierId = 'supplier-1';
const coupon = (over: Partial<PayoutCoupon> = {}): PayoutCoupon => ({
  id: 'coupon-1',
  supplierId,
  status: 'AVAILABLE',
  expiresAt: null,
  ...over,
});

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

test('B 기본 정책: 쿠폰은 첫 지급(중간 구간) 수수료만 면제하고 단회 사용한다', () => {
  expect(PAYOUT_COUPON_SCOPE).toBe('FIRST_INSTALLMENT');
  const plan = planPayoutCoupon({
    coupon: coupon(),
    supplierId,
    installment: { stage: 'INTERIM', amount: 500_000, supplierFee: 25_000, releaseAmount: 475_000 },
    releasedStages: [],
    now,
  });

  expect(plan).toEqual({
    applied: true,
    couponId: 'coupon-1',
    waivedFee: 25_000,
    supplierFee: 0,
    releaseAmount: 500_000,
    couponPatch: { status: 'USED', usedAt: now },
    reason: 'APPLIED',
  });
});

test('최종 구간이거나 이미 중간 구간이 지급됐으면 쿠폰을 쓰지 않는다', () => {
  const final = planPayoutCoupon({
    coupon: coupon(),
    supplierId,
    installment: { stage: 'FINAL', amount: 500_001, supplierFee: 25_000, releaseAmount: 475_001 },
    releasedStages: ['INTERIM'],
    now,
  });
  expect(final).toMatchObject({ applied: false, reason: 'NOT_FIRST_PAYOUT', couponPatch: null });

  const secondAttempt = planPayoutCoupon({
    coupon: coupon(),
    supplierId,
    installment: { stage: 'INTERIM', amount: 500_000, supplierFee: 25_000, releaseAmount: 475_000 },
    releasedStages: ['INTERIM'],
    now,
  });
  expect(secondAttempt).toMatchObject({ applied: false, reason: 'NOT_FIRST_PAYOUT' });
});

test('사용·만료된 쿠폰, 다른 공급자 쿠폰, 수수료 0원은 적용하지 않는다', () => {
  const base = {
    supplierId,
    installment: { stage: 'INTERIM' as const, amount: 500_000, supplierFee: 25_000, releaseAmount: 475_000 },
    releasedStages: [],
    now,
  };
  expect(planPayoutCoupon({ ...base, coupon: null })).toMatchObject({ applied: false, reason: 'NO_COUPON' });
  expect(planPayoutCoupon({ ...base, coupon: coupon({ status: 'USED' }) }))
    .toMatchObject({ applied: false, reason: 'ALREADY_USED' });
  expect(planPayoutCoupon({ ...base, coupon: coupon({ status: 'EXPIRED' }) }))
    .toMatchObject({ applied: false, reason: 'EXPIRED' });
  expect(planPayoutCoupon({ ...base, coupon: coupon({ expiresAt: now }) }))
    .toMatchObject({ applied: false, reason: 'EXPIRED' });
  throwsCode(
    () => planPayoutCoupon({ ...base, coupon: coupon({ supplierId: 'supplier-2' }) }),
    'COUPON_NOT_OWNED',
  );
  expect(planPayoutCoupon({
    ...base,
    coupon: coupon(),
    installment: { ...base.installment, supplierFee: 0, releaseAmount: 500_000 },
  })).toMatchObject({ applied: false, reason: 'NO_FEE', couponPatch: null });
});

test('쿠폰 적용 전후 금액이 구간 합계와 지급 계획에 그대로 반영된다', () => {
  const money = computeMoney(1_000_001, 50, false);
  const interim = money.installments[0];
  const couponPlan = planPayoutCoupon({
    coupon: coupon(),
    supplierId,
    installment: interim,
    releasedStages: [],
    now,
  });

  expect(couponPlan.releaseAmount).toBe(500_000); // 수수료 25,000원 면제
  const release = planInstallmentRelease({
    actor: { userId: 'admin-1', role: 'ADMIN' },
    contractStatus: 'ACTIVE',
    paymentStatus: 'DEPOSITED',
    installment: { id: 'interim', stage: 'INTERIM', status: 'APPROVED', releaseAmount: couponPlan.releaseAmount },
    otherInstallments: [{ stage: 'FINAL', status: 'PENDING' }],
    releasedAt: now,
  });
  expect(release.amount).toBe(500_000);
  expect(release.contract.paymentStatus).toBe('PARTIALLY_RELEASED');
});

test('스키마의 feeExempt·feeExemptUsedAt을 쿠폰 상태로 해석한다', () => {
  expect(payoutCouponFromProfile({ userId: supplierId, feeExempt: false, feeExemptUsedAt: null })).toBeNull();
  expect(payoutCouponFromProfile({ userId: supplierId, feeExempt: true, feeExemptUsedAt: null }))
    .toMatchObject({ id: supplierId, supplierId, status: 'AVAILABLE' });
  expect(payoutCouponFromProfile({ userId: supplierId, feeExempt: true, feeExemptUsedAt: now }))
    .toMatchObject({ status: 'USED' });
});
