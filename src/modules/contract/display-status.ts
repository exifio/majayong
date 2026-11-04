/**
 * B-00: 계약 화면 표시 상태는 저장하지 않는 파생값이다.
 *
 * DB에는 ContractStatus(5종)만 저장하고, 화면의 "서명 대기 / 예치 대기 / 진행 중 /
 * 검수 대기 / 마감 지남 / 완료 / 결렬 / 취소"는 상태·결제·기한으로 계산한다.
 * 파생값을 enum으로 추가하거나 DB에 쓰지 않는다(ERD 7.3).
 */

export const CONTRACT_DB_STATUSES = [
  'PENDING_CONSENT',
  'ACTIVE',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type ContractDbStatus = (typeof CONTRACT_DB_STATUSES)[number];

/** v0.7 계약 저장 상태 전이. 예치 전 취소 요청은 없고, 예치 기한 결렬만 ACTIVE→CANCELLED다. */
export const CONTRACT_TRANSITIONS = {
  PENDING_CONSENT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['CANCEL_REQUESTED', 'COMPLETED', 'CANCELLED'],
  CANCEL_REQUESTED: ['CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Record<ContractDbStatus, readonly ContractDbStatus[]>;

export const PAYMENT_STATUSES = [
  'PENDING',
  'DEPOSITED',
  'PARTIALLY_RELEASED',
  'RELEASED',
  'REFUNDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** 화면 전용 파생 상태. DB enum과 이름이 겹치지 않아야 한다. */
export const CONTRACT_DISPLAY_STATUSES = [
  'SIGNING',
  'COUNTERPART_SIGNATURE_PENDING',
  'AWAITING_DEPOSIT',
  'IN_PROGRESS',
  'INSPECTION_DUE',
  'WORK_OVERDUE',
  'CONTRACT_COMPLETED',
  'CANCEL_IN_PROGRESS',
  'CONTRACT_CANCELLED',
] as const;

export type ContractDisplayStatus = (typeof CONTRACT_DISPLAY_STATUSES)[number];

export interface ContractStatusInput {
  readonly status: ContractDbStatus;
  readonly paymentStatus: PaymentStatus;
  readonly clientSignedAt: Date | null;
  readonly supplierSignedAt: Date | null;
  readonly workDueAt: Date | null;
  readonly finalDelivered: boolean;
  readonly now: Date;
}

export interface ContractDto {
  readonly id: string;
  readonly status: ContractDbStatus;
  readonly displayStatus: ContractDisplayStatus;
  readonly agreedAmount: number;
  readonly clientFee: number;
  readonly supplierFee: number;
  readonly interimRatio: number;
  readonly consentDeadline: Date;
  readonly depositDeadline: Date | null;
}

export function deriveContractDisplayStatus(
  input: ContractStatusInput,
): ContractDisplayStatus {
  switch (input.status) {
    case 'CANCELLED':
      return 'CONTRACT_CANCELLED';
    case 'CANCEL_REQUESTED':
      return 'CANCEL_IN_PROGRESS';
    case 'COMPLETED':
      return 'CONTRACT_COMPLETED';
    case 'PENDING_CONSENT': {
      const clientSigned = input.clientSignedAt !== null;
      const supplierSigned = input.supplierSignedAt !== null;

      if (clientSigned && supplierSigned) return 'AWAITING_DEPOSIT';
      if (clientSigned || supplierSigned) return 'COUNTERPART_SIGNATURE_PENDING';
      return 'SIGNING';
    }
    case 'ACTIVE': {
      if (input.paymentStatus === 'PENDING') return 'AWAITING_DEPOSIT';
      if (input.paymentStatus === 'RELEASED') return 'CONTRACT_COMPLETED';
      if (input.paymentStatus === 'REFUNDED') return 'CONTRACT_CANCELLED';
      if (
        input.workDueAt !== null &&
        input.now.getTime() > input.workDueAt.getTime() &&
        !input.finalDelivered
      ) {
        return 'WORK_OVERDUE';
      }
      if (input.finalDelivered) return 'INSPECTION_DUE';
      return 'IN_PROGRESS';
    }
  }
}
