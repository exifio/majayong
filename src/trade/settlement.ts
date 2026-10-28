import type { ContractStatus } from './contract.js';
import { TradeError } from './errors.js';
import { assertWon } from './money.js';

export type PaymentStatus = 'PENDING' | 'DEPOSITED' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'REFUNDED';
export type InstallmentStatus = 'PENDING' | 'DELIVERED' | 'REWORK_REQUESTED' | 'APPROVED' | 'RELEASED' | 'REFUNDED';
export type InstallmentStage = 'INTERIM' | 'FINAL';
export type DeliveryStatus = 'SUBMITTED' | 'PARTIALLY_APPROVED' | 'APPROVED' | 'REWORK_REQUESTED';
export type InspectionReason = 'IN_SPEC' | 'NOT_IN_SPEC' | 'INTERPRETATION';

type Actor = { userId: string; role: 'CLIENT' | 'SUPPLIER' | 'ADMIN' };

export function planDeliverySubmission(input: {
  actor: Actor;
  supplierId: string;
  contractStatus: ContractStatus;
  paymentStatus: PaymentStatus;
  installment: { id: string; stage: InstallmentStage; status: InstallmentStatus };
  otherInstallments: { stage: InstallmentStage; status: InstallmentStatus }[];
  priorDeliveries: { attemptNo: number }[];
  summary: string | null;
  fileUrl: string | null;
  submittedAt: Date;
}) {
  if (input.actor.role !== 'SUPPLIER' || input.actor.userId !== input.supplierId) {
    throw new TradeError('DELIVERY_SUBMISSION_FORBIDDEN');
  }
  if (input.contractStatus !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
  if (!isFunded(input.paymentStatus)) throw new TradeError('DEPOSIT_NOT_COMPLETE');
  if (!isInstallmentInSequence(input.installment.stage, input.paymentStatus, input.otherInstallments)) {
    throw new TradeError('INTERIM_RELEASE_REQUIRED');
  }
  if (input.installment.status !== 'PENDING' && input.installment.status !== 'REWORK_REQUESTED') {
    throw new TradeError('INSTALLMENT_NOT_DELIVERABLE');
  }
  if (Number.isNaN(input.submittedAt.getTime())) throw new TradeError('INVALID_DELIVERY_TIME');

  let lastAttemptNo = 0;
  for (const delivery of input.priorDeliveries) {
    if (!Number.isInteger(delivery.attemptNo) || delivery.attemptNo < 1 || delivery.attemptNo >= 2_147_483_647) {
      throw new TradeError('DELIVERY_ATTEMPT_INVALID');
    }
    lastAttemptNo = Math.max(lastAttemptNo, delivery.attemptNo);
  }

  const attemptNo = lastAttemptNo + 1;
  return {
    delivery: {
      installmentId: input.installment.id,
      attemptNo,
      summary: input.summary,
      fileUrl: input.fileUrl,
      status: 'SUBMITTED' as const,
      submittedAt: input.submittedAt,
    },
    installment: { id: input.installment.id, status: 'DELIVERED' as const },
    event: {
      type: 'DELIVERY_SUBMITTED' as const,
      userId: input.actor.userId,
      payload: { installmentId: input.installment.id, attemptNo },
    },
  };
}

export function planInspection(input: {
  actor: Actor;
  clientId: string;
  supplierId: string;
  contractStatus: ContractStatus;
  paymentStatus: PaymentStatus;
  installment: { id: string; stage: InstallmentStage; status: InstallmentStatus };
  otherInstallments: { stage: InstallmentStage; status: InstallmentStatus }[];
  delivery: { id: string; installmentId: string; attemptNo: number; status: DeliveryStatus };
  latestAttemptNo: number;
  contractScopeItemIds: string[];
  deliveryItemIds: string[];
  priorOpenInspections?: { id: string; applicationItemId: string }[];
  requests: { applicationItemId: string; reason: InspectionReason; note: string | null }[];
  reviewedAt: Date;
}) {
  if (input.actor.role !== 'CLIENT' || input.actor.userId !== input.clientId) {
    throw new TradeError('INSPECTION_FORBIDDEN');
  }
  if (input.contractStatus !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
  if (!isFunded(input.paymentStatus)) throw new TradeError('DEPOSIT_NOT_COMPLETE');
  if (!isInstallmentInSequence(input.installment.stage, input.paymentStatus, input.otherInstallments)) {
    throw new TradeError('INTERIM_RELEASE_REQUIRED');
  }
  if (input.delivery.installmentId !== input.installment.id) {
    throw new TradeError('DELIVERY_INSTALLMENT_MISMATCH');
  }
  if (input.installment.status !== 'DELIVERED' || input.delivery.status !== 'SUBMITTED') {
    throw new TradeError('DELIVERY_NOT_REVIEWABLE');
  }
  if (
    !Number.isInteger(input.latestAttemptNo) ||
    input.latestAttemptNo < 1 ||
    input.delivery.attemptNo !== input.latestAttemptNo
  ) {
    throw new TradeError('STALE_DELIVERY');
  }
  if (Number.isNaN(input.reviewedAt.getTime())) throw new TradeError('INVALID_INSPECTION_TIME');

  const scope = new Set(input.contractScopeItemIds);
  const deliveryItems = new Set(input.deliveryItemIds);
  if (scope.size !== input.contractScopeItemIds.length || scope.size === 0) {
    throw new TradeError('INVALID_CONTRACT_SCOPE');
  }
  if (deliveryItems.size !== input.deliveryItemIds.length || deliveryItems.size === 0) {
    throw new TradeError('INVALID_DELIVERY_SCOPE');
  }
  if (input.deliveryItemIds.some((id) => !scope.has(id))) throw new TradeError('INSPECTION_ITEM_OUT_OF_SCOPE');

  const requestedItems = new Set<string>();
  for (const request of input.requests) {
    if (!isInspectionReason(request.reason)) throw new TradeError('INVALID_INSPECTION_REASON');
    if (!deliveryItems.has(request.applicationItemId)) throw new TradeError('INSPECTION_ITEM_OUT_OF_SCOPE');
    if (requestedItems.has(request.applicationItemId)) throw new TradeError('DUPLICATE_INSPECTION_ITEM');
    requestedItems.add(request.applicationItemId);
  }

  const priorIds = new Set<string>();
  const resolvedInspectionIds: string[] = [];
  for (const inspection of input.priorOpenInspections ?? []) {
    if (priorIds.has(inspection.id)) throw new TradeError('DUPLICATE_INSPECTION_ID');
    priorIds.add(inspection.id);
    if (deliveryItems.has(inspection.applicationItemId)) resolvedInspectionIds.push(inspection.id);
  }

  const deliveryStatus: DeliveryStatus = input.requests.length === 0
    ? 'APPROVED'
    : input.requests.length === input.deliveryItemIds.length
      ? 'REWORK_REQUESTED'
      : 'PARTIALLY_APPROVED';

  return {
    delivery: { id: input.delivery.id, status: deliveryStatus, reviewedAt: input.reviewedAt },
    installment: {
      id: input.installment.id,
      status: input.requests.length === 0 ? 'APPROVED' as const : 'REWORK_REQUESTED' as const,
      approvedAt: input.requests.length === 0 ? input.reviewedAt : null,
    },
    resolvedInspectionIds,
    inspections: input.requests.map((request) => ({
      deliveryId: input.delivery.id,
      applicationItemId: request.applicationItemId,
      reason: request.reason,
      note: request.note,
      status: 'OPEN' as const,
      createdAt: input.reviewedAt,
    })),
    event: input.requests.length === 0 ? null : {
      type: 'INSPECTION_REQUESTED' as const,
      userId: input.actor.userId,
      payload: {
        deliveryId: input.delivery.id,
        applicationItemIds: input.requests.map((request) => request.applicationItemId),
      },
    },
  };
}

export function planInstallmentRelease(input: {
  actor: Actor;
  contractStatus: ContractStatus;
  paymentStatus: PaymentStatus;
  installment: { id: string; stage: InstallmentStage; status: InstallmentStatus; releaseAmount: number };
  otherInstallments: { stage: InstallmentStage; status: InstallmentStatus }[];
  releasedAt: Date;
}) {
  if (input.actor.role !== 'ADMIN') throw new TradeError('PAYOUT_FORBIDDEN');
  if (input.contractStatus !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
  if (input.installment.status !== 'APPROVED') throw new TradeError('INSTALLMENT_NOT_APPROVED');
  assertWon(input.installment.releaseAmount);
  if (Number.isNaN(input.releasedAt.getTime())) throw new TradeError('INVALID_RELEASE_TIME');

  if (input.installment.stage === 'INTERIM') {
    if (input.paymentStatus !== 'DEPOSITED') throw new TradeError('INVALID_INTERIM_RELEASE_STATE');
  } else {
    const interimReleased = input.otherInstallments.some(
      (installment) => installment.stage === 'INTERIM' && installment.status === 'RELEASED',
    );
    if (input.paymentStatus !== 'PARTIALLY_RELEASED' || !interimReleased) {
      throw new TradeError('INTERIM_RELEASE_REQUIRED');
    }
  }

  // shortcut: the adapter must update the installment and contract atomically; this only records a payout state.
  const final = input.installment.stage === 'FINAL';
  return {
    amount: input.installment.releaseAmount,
    installment: { id: input.installment.id, status: 'RELEASED' as const, releasedAt: input.releasedAt },
    contract: {
      status: final ? 'COMPLETED' as const : 'ACTIVE' as const,
      paymentStatus: final ? 'RELEASED' as const : 'PARTIALLY_RELEASED' as const,
      completedAt: final ? input.releasedAt : null,
    },
  };
}

export function planInspectionEscalation(input: {
  actor: Actor;
  inspection: { id: string; status: 'OPEN' | 'RESOLVED' | 'ESCALATED' };
  escalatedAt: Date;
}) {
  if (input.actor.role !== 'ADMIN') throw new TradeError('INSPECTION_ESCALATION_FORBIDDEN');
  if (input.inspection.status !== 'OPEN') throw new TradeError('INSPECTION_NOT_OPEN');
  if (Number.isNaN(input.escalatedAt.getTime())) throw new TradeError('INVALID_INSPECTION_TIME');
  return { id: input.inspection.id, status: 'ESCALATED' as const, resolvedAt: input.escalatedAt };
}

export function planManualRefund(input: {
  actor: Actor;
  contract: {
    id: string;
    status: ContractStatus;
    paymentStatus: PaymentStatus;
    totalDeposited: number;
    clientFee: number;
    refundAmount: number | null;
  };
  installments: { id: string; status: InstallmentStatus }[];
  availableAmount: number;
  refundAmount: number;
  clientFeeRefund: number;
  reason: string;
  refundedAt: Date;
}) {
  if (input.actor.role !== 'ADMIN') throw new TradeError('REFUND_FORBIDDEN');
  if (input.contract.status !== 'CANCELLED') throw new TradeError('CONTRACT_NOT_CANCELLED');
  if (input.contract.paymentStatus === 'PENDING' || input.contract.paymentStatus === 'REFUNDED') {
    throw new TradeError('REFUND_NOT_AVAILABLE');
  }
  if (input.contract.refundAmount !== null) throw new TradeError('REFUND_ALREADY_RECORDED');
  assertWon(input.contract.totalDeposited);
  assertWon(input.contract.clientFee);
  assertWon(input.refundAmount);
  // shortcut: caller supplies the policy-calculated refundable balance until the client-fee retention formula is finalized.
  if (
    !Number.isInteger(input.availableAmount) ||
    input.availableAmount < 0 ||
    input.availableAmount > input.contract.totalDeposited ||
    input.refundAmount !== input.availableAmount
  ) {
    throw new TradeError('REFUND_AMOUNT_MISMATCH');
  }
  if (
    !Number.isInteger(input.clientFeeRefund) ||
    input.clientFeeRefund < 0 ||
    input.clientFeeRefund > input.contract.clientFee ||
    input.clientFeeRefund > input.refundAmount
  ) {
    throw new TradeError('INVALID_CLIENT_FEE_REFUND');
  }
  if (!input.reason.trim()) throw new TradeError('REFUND_REASON_REQUIRED');
  if (Number.isNaN(input.refundedAt.getTime())) throw new TradeError('INVALID_REFUND_TIME');

  return {
    contract: {
      paymentStatus: 'REFUNDED' as const,
      refundAmount: input.refundAmount,
      clientFeeRefund: input.clientFeeRefund,
      refundReason: input.reason,
      refundedAt: input.refundedAt,
    },
    installments: input.installments
      .filter((installment) => installment.status !== 'RELEASED' && installment.status !== 'REFUNDED')
      .map((installment) => ({ id: installment.id, status: 'REFUNDED' as const })),
    event: {
      type: 'REFUND_PROCESSED' as const,
      userId: input.actor.userId,
      payload: {
        contractId: input.contract.id,
        amount: input.refundAmount,
        clientFeeRefund: input.clientFeeRefund,
        reason: input.reason,
      },
    },
  };
}

function isFunded(paymentStatus: PaymentStatus): boolean {
  return paymentStatus === 'DEPOSITED' || paymentStatus === 'PARTIALLY_RELEASED';
}

function isInstallmentInSequence(
  stage: InstallmentStage,
  paymentStatus: PaymentStatus,
  otherInstallments: { stage: InstallmentStage; status: InstallmentStatus }[],
): boolean {
  if (stage === 'INTERIM') return paymentStatus === 'DEPOSITED';
  return paymentStatus === 'PARTIALLY_RELEASED' && otherInstallments.some(
    (installment) => installment.stage === 'INTERIM' && installment.status === 'RELEASED',
  );
}

function isInspectionReason(reason: string): reason is InspectionReason {
  return reason === 'IN_SPEC' || reason === 'NOT_IN_SPEC' || reason === 'INTERPRETATION';
}
