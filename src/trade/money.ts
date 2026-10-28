import { TradeError } from './errors.js';

// 금액은 모두 원 단위 정수다. 스키마의 Int는 32비트라 이 값을 넘으면 저장할 수 없다.
const INT_MAX = 2_147_483_647;
const FEE_PERCENT = 5;

export function assertWon(n: number, code = 'INVALID_AMOUNT'): void {
  if (!Number.isInteger(n) || n <= 0 || n > INT_MAX) throw new TradeError(code);
}

// 0.05를 곱하면 부동소수점 오차가 날 수 있어 정수로 계산하고 원 단위로 내린다.
const pct = (n: number, p: number) => Math.floor((n * p) / 100);

export type InstallmentPlan = {
  stage: 'INTERIM' | 'FINAL';
  ratio: number;
  amount: number;
  supplierFee: number;
  releaseAmount: number; // 공급자 수령액 = 구간 금액 - 구간 공급자 수수료
};

export type Money = {
  clientFee: number;
  supplierFee: number;
  installments: [InstallmentPlan, InstallmentPlan];
};

// 면제는 계약 생성이 아니라 첫 공급자 지급 때 쿠폰으로 적용한다(payout-coupon.ts).
// 이 계산기는 쿠폰 전후 금액을 비교할 때만 supplierFeeExempt=true를 쓴다.
export function computeMoney(agreedAmount: number, interimRatio: number, supplierFeeExempt: boolean): Money {
  assertWon(agreedAmount);
  if (!Number.isInteger(interimRatio) || interimRatio < 1 || interimRatio > 99) {
    throw new TradeError('INVALID_RATIO');
  }
  const clientFee = pct(agreedAmount, FEE_PERCENT);
  assertWon(agreedAmount + clientFee); // 예치 금액(원금 + 의뢰인 수수료)도 저장 가능해야 한다
  const supplierFee = supplierFeeExempt ? 0 : pct(agreedAmount, FEE_PERCENT);

  const interim = pct(agreedAmount, interimRatio);
  if (interim === 0) throw new TradeError('AMOUNT_TOO_SMALL');
  const final = agreedAmount - interim; // 끝수는 최종 구간이 가져간다

  // 구간 수수료도 같은 방식이다. 중간 금액의 5%를 내리고 나머지는 최종 구간에 둔다.
  const interimFee = supplierFeeExempt ? 0 : pct(interim, FEE_PERCENT);
  const finalFee = supplierFee - interimFee;

  return {
    clientFee,
    supplierFee,
    installments: [
      { stage: 'INTERIM', ratio: interimRatio, amount: interim, supplierFee: interimFee, releaseAmount: interim - interimFee },
      { stage: 'FINAL', ratio: 100 - interimRatio, amount: final, supplierFee: finalFee, releaseAmount: final - finalFee },
    ],
  };
}
