import { TradeError } from './errors.js';
import type { InstallmentStage } from './settlement.js';

// 공급자 첫 거래 수수료 면제는 계약 생성이 아니라 첫 지급 시점에 적용한다.
// B 기본값: 첫 지급 구간(INTERIM) 수수료만 면제한다. 전체 거래 면제로 바꾸려면 이 상수와
// planPayoutCoupon의 적용 조건만 바꾸면 된다.
export const PAYOUT_COUPON_SCOPE = 'FIRST_INSTALLMENT' as const;
export type PayoutCouponScope = typeof PAYOUT_COUPON_SCOPE;

export type PayoutCouponStatus = 'AVAILABLE' | 'USED' | 'EXPIRED';
export type PayoutCoupon = {
  id: string;
  supplierId: string;
  status: PayoutCouponStatus;
  expiresAt: Date | null;
};

export type PayoutCouponPlan = {
  applied: boolean;
  couponId: string | null;
  waivedFee: number;
  supplierFee: number;
  releaseAmount: number;
  couponPatch: { status: 'USED'; usedAt: Date } | null;
  reason: 'APPLIED' | 'NO_COUPON' | 'NO_FEE' | 'NOT_FIRST_PAYOUT' | 'EXPIRED' | 'ALREADY_USED';
};

// 스키마의 SupplierProfile.feeExempt·feeExemptUsedAt을 쿠폰 상태로 해석한다.
// 만료 필드가 없으므로 만료는 아직 적용하지 않는다(정책 확정 시 스키마 검토 필요).
export function payoutCouponFromProfile(profile: {
  userId: string;
  feeExempt: boolean;
  feeExemptUsedAt: Date | null;
}): PayoutCoupon | null {
  if (!profile.feeExempt) return null;
  return {
    id: profile.userId,
    supplierId: profile.userId,
    status: profile.feeExemptUsedAt === null ? 'AVAILABLE' : 'USED',
    expiresAt: null,
  };
}

// 순수 계산만 한다. 쿠폰 사용 처리는 A가 같은 transaction에서
// UPDATE supplier_profiles SET "feeExemptUsedAt" = ... WHERE "feeExemptUsedAt" IS NULL 로
// 단회 사용을 보장한다(동시 지급 시 한쪽만 성공).
export function planPayoutCoupon(input: {
  coupon: PayoutCoupon | null;
  supplierId: string;
  installment: { stage: InstallmentStage; amount: number; supplierFee: number; releaseAmount: number };
  releasedStages: InstallmentStage[];
  now: Date;
}): PayoutCouponPlan {
  const { amount, supplierFee, releaseAmount } = input.installment;
  if (!Number.isInteger(amount) || amount <= 0) throw new TradeError('INVALID_AMOUNT');
  if (!Number.isInteger(supplierFee) || supplierFee < 0 || supplierFee > amount) {
    throw new TradeError('INVALID_FEE');
  }
  if (!Number.isInteger(releaseAmount) || releaseAmount !== amount - supplierFee) {
    throw new TradeError('INVALID_RELEASE_AMOUNT');
  }
  if (Number.isNaN(input.now.getTime())) throw new TradeError('INVALID_COUPON_TIME');

  const unchanged = (reason: PayoutCouponPlan['reason']): PayoutCouponPlan => ({
    applied: false,
    couponId: input.coupon?.id ?? null,
    waivedFee: 0,
    supplierFee,
    releaseAmount,
    couponPatch: null,
    reason,
  });

  const coupon = input.coupon;
  if (!coupon) return unchanged('NO_COUPON');
  // 다른 공급자의 쿠폰을 쓰지 못하게 한다.
  if (coupon.supplierId !== input.supplierId) throw new TradeError('COUPON_NOT_OWNED');
  if (coupon.status === 'USED') return unchanged('ALREADY_USED');
  if (coupon.status === 'EXPIRED') return unchanged('EXPIRED');
  if (coupon.expiresAt !== null && coupon.expiresAt.getTime() <= input.now.getTime()) {
    return unchanged('EXPIRED');
  }
  // 첫 지급 = INTERIM 구간이고 아직 지급된 구간이 없을 때만.
  if (input.installment.stage !== 'INTERIM' || input.releasedStages.includes('INTERIM')) {
    return unchanged('NOT_FIRST_PAYOUT');
  }
  // 수수료가 0이면 쿠폰을 소모하지 않는다.
  if (supplierFee === 0) return unchanged('NO_FEE');

  return {
    applied: true,
    couponId: coupon.id,
    waivedFee: supplierFee,
    supplierFee: 0,
    releaseAmount: amount,
    couponPatch: { status: 'USED', usedAt: input.now },
    reason: 'APPLIED',
  };
}
