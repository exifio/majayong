import { TradeError } from './errors.js';
import { assertWon } from './money.js';

// 취소 정산 기본값(2026-10-28 B 확정안, A·법무 확인 전).
// - 24시간 이내 의뢰인 사유: 남은 예치금 전액 환불
// - 24시간 이후 의뢰인 사유: 중간 구간 금액의 최소 50%를 착수 보상으로 공급자에게 지급.
//   이미 지급된 구간 금액과 별개로 추가 지급하고, 협의로 더 올릴 수 있다. 보상은 원금에서 빼고,
//   남은 원금만 환불한다.
// - 공급자 사유: 남은 예치금 전액 환불
// - 양측 합의: 합의한 보상액만 지급하고 나머지는 환불
// 의뢰인 수수료는 환불되는 원금 비율만큼 돌려준다(공급자 사유는 남은 수수료 전액).
// 합의가 안 되면 이 계산을 호출하지 않고 계약을 취소 상태로 두었다가 합의 후 운영자가 기록한다.
export const CANCELLATION_COMPENSATION_PERCENT = 50;
export const CANCELLATION_FREE_CANCEL_MS = 24 * 60 * 60 * 1000;

export type CancellationParty = 'CLIENT' | 'SUPPLIER' | 'MUTUAL';

export type CancellationSettlement = {
  within24Hours: boolean;
  supplierCompensation: number;
  principalRefund: number;
  clientFeeRefund: number;
  totalRefund: number;
  retainedClientFee: number;
};

export function planCancellationSettlement(input: {
  principal: number; // Contract.agreedAmount
  clientFee: number; // Contract.clientFee
  interimAmount: number; // PaymentInstallment(INTERIM).amount
  totalDeposited: number; // Contract.totalDeposited
  releasedAmount: number; // 지급 완료된 구간 amount 합계(수수료 포함)
  alreadyRefundedFee?: number;
  activatedAt: Date; // 두 번째 서명으로 ACTIVE가 된 시각
  cancelledAt: Date;
  party: CancellationParty;
  compensationPercent?: number;
  negotiatedCompensation?: number;
}): CancellationSettlement {
  assertWon(input.principal);
  if (!Number.isInteger(input.clientFee) || input.clientFee < 0) throw new TradeError('INVALID_AMOUNT');
  if (!Number.isInteger(input.interimAmount) || input.interimAmount <= 0) throw new TradeError('INVALID_AMOUNT');
  if (!Number.isInteger(input.totalDeposited) || input.totalDeposited < 0) throw new TradeError('INVALID_AMOUNT');
  if (!Number.isInteger(input.releasedAmount) || input.releasedAmount < 0) throw new TradeError('INVALID_AMOUNT');
  const alreadyRefundedFee = input.alreadyRefundedFee ?? 0;
  if (!Number.isInteger(alreadyRefundedFee) || alreadyRefundedFee < 0 || alreadyRefundedFee > input.clientFee) {
    throw new TradeError('INVALID_AMOUNT');
  }
  if (Number.isNaN(input.activatedAt.getTime()) || Number.isNaN(input.cancelledAt.getTime())) {
    throw new TradeError('INVALID_CANCELLATION_TIME');
  }
  if (input.cancelledAt.getTime() < input.activatedAt.getTime()) {
    throw new TradeError('INVALID_CANCELLATION_TIME');
  }

  const remainingPrincipal = input.principal - input.releasedAmount;
  const remainingClientFee = input.clientFee - alreadyRefundedFee;
  const remainingEscrow = input.totalDeposited - input.releasedAmount;
  if (remainingPrincipal < 0 || remainingEscrow < 0) throw new TradeError('INVALID_CANCELLATION_STATE');
  if (remainingEscrow < remainingPrincipal) throw new TradeError('INVALID_CANCELLATION_STATE');

  const within24Hours =
    input.cancelledAt.getTime() - input.activatedAt.getTime() <= CANCELLATION_FREE_CANCEL_MS;
  const percent = input.compensationPercent ?? CANCELLATION_COMPENSATION_PERCENT;
  if (!Number.isInteger(percent) || percent < CANCELLATION_COMPENSATION_PERCENT || percent > 100) {
    throw new TradeError('INVALID_COMPENSATION_PERCENT');
  }

  const supplierCompensation = resolveCompensation({
    party: input.party,
    within24Hours,
    interimAmount: input.interimAmount,
    remainingPrincipal,
    percent,
    negotiatedCompensation: input.negotiatedCompensation,
  });

  const principalRefund = remainingPrincipal - supplierCompensation;
  // 공급자 사유는 남은 의뢰인 수수료를 전액 돌려주고, 그 외에는 환불 원금이
  // 전체 원금에서 차지하는 비율만큼 돌려준다(이미 지급된 구간의 수수료는 플랫폼이 갖는다).
  const clientFeeRefund = input.party === 'SUPPLIER'
    ? remainingClientFee
    : Math.floor((remainingClientFee * principalRefund) / input.principal);

  const totalRefund = principalRefund + clientFeeRefund;
  if (totalRefund > remainingEscrow) throw new TradeError('REFUND_AMOUNT_MISMATCH');

  return {
    within24Hours,
    supplierCompensation,
    principalRefund,
    clientFeeRefund,
    totalRefund,
    retainedClientFee: remainingClientFee - clientFeeRefund,
  };
}

function resolveCompensation(input: {
  party: CancellationParty;
  within24Hours: boolean;
  interimAmount: number;
  remainingPrincipal: number;
  percent: number;
  negotiatedCompensation: number | undefined;
}): number {
  if (input.party === 'SUPPLIER') return 0;
  if (input.party === 'CLIENT' && input.within24Hours) return 0;

  if (input.party === 'MUTUAL') {
    const agreed = input.negotiatedCompensation;
    if (agreed === undefined) throw new TradeError('NEGOTIATED_COMPENSATION_REQUIRED');
    if (!Number.isInteger(agreed) || agreed < 0) throw new TradeError('INVALID_COMPENSATION_AMOUNT');
    if (agreed > input.remainingPrincipal) throw new TradeError('COMPENSATION_EXCEEDS_AVAILABLE');
    return agreed;
  }

  // 의뢰인 사유, 24시간 경과: 중간 구간 금액의 50%(올림)를 기본 보상으로 깔고 협의로 올린다.
  // 이미 지급된 구간 금액과 무관하게 추가 지급한다(중간 구간을 받은 뒤 일방 취소한 경우에도 동일).
  const minimum = Math.ceil((input.interimAmount * input.percent) / 100);
  const agreed = input.negotiatedCompensation ?? minimum;
  if (!Number.isInteger(agreed) || agreed < minimum) {
    throw new TradeError('COMPENSATION_BELOW_MINIMUM');
  }
  if (agreed > input.remainingPrincipal) throw new TradeError('COMPENSATION_EXCEEDS_AVAILABLE');
  return agreed;
}
