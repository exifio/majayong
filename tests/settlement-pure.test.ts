import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import {
  planDeliverySubmission,
  planInspection,
  planInstallmentRelease,
  planManualRefund,
  planInspectionEscalation,
} from '../src/trade/settlement.ts';

const now = new Date('2026-10-27T12:00:00.000Z');
const participants = { clientId: 'client-1', supplierId: 'supplier-1' };
const supplier = { userId: participants.supplierId, role: 'SUPPLIER' as const };
const client = { userId: participants.clientId, role: 'CLIENT' as const };
const admin = { userId: 'admin-1', role: 'ADMIN' as const };
const active = { ...participants, contractStatus: 'ACTIVE' as const, paymentStatus: 'DEPOSITED' as const };

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

test('공급자는 전액 예치 후 납품하고, 보완 재납품은 다음 attemptNo를 받는다', () => {
  const result = planDeliverySubmission({
    ...active,
    actor: supplier,
    installment: { id: 'interim', stage: 'INTERIM', status: 'REWORK_REQUESTED' },
    otherInstallments: [{ stage: 'FINAL', status: 'PENDING' }],
    priorDeliveries: [{ attemptNo: 1 }],
    summary: 'revised interim',
    fileUrl: 'private/object/path',
    submittedAt: now,
  });

  expect(result.delivery).toEqual({
    installmentId: 'interim',
    attemptNo: 2,
    summary: 'revised interim',
    fileUrl: 'private/object/path',
    status: 'SUBMITTED',
    submittedAt: now,
  });
  expect(result.installment).toEqual({ id: 'interim', status: 'DELIVERED' });
  expect(result.event).toMatchObject({ type: 'DELIVERY_SUBMITTED', userId: participants.supplierId });
});

test('전액 예치 전·비당사자·지급 완료 구간은 납품할 수 없다', () => {
  const base = {
    ...active,
    actor: supplier,
    installment: { id: 'interim', stage: 'INTERIM' as const, status: 'PENDING' as const },
    otherInstallments: [{ stage: 'FINAL' as const, status: 'PENDING' as const }],
    priorDeliveries: [],
    summary: null,
    fileUrl: null,
    submittedAt: now,
  };
  throwsCode(() => planDeliverySubmission({ ...base, actor: client }), 'DELIVERY_SUBMISSION_FORBIDDEN');
  throwsCode(() => planDeliverySubmission({ ...base, paymentStatus: 'PENDING' }), 'DEPOSIT_NOT_COMPLETE');
  throwsCode(() => planDeliverySubmission({ ...base, installment: { id: 'interim', stage: 'INTERIM', status: 'APPROVED' } }), 'INSTALLMENT_NOT_DELIVERABLE');
  throwsCode(() => planDeliverySubmission({ ...base, priorDeliveries: [{ attemptNo: 1.5 }] }), 'DELIVERY_ATTEMPT_INVALID');
  throwsCode(() => planDeliverySubmission({
    ...base,
    installment: { id: 'final', stage: 'FINAL', status: 'PENDING' },
  }), 'INTERIM_RELEASE_REQUIRED');
});

const inspectionInput = {
  ...active,
  actor: client,
  installment: { id: 'interim', stage: 'INTERIM' as const, status: 'DELIVERED' as const },
  otherInstallments: [{ stage: 'FINAL' as const, status: 'PENDING' as const }],
  delivery: { id: 'delivery-2', installmentId: 'interim', attemptNo: 2, status: 'SUBMITTED' as const },
  latestAttemptNo: 2,
  contractScopeItemIds: ['app-item-1', 'app-item-2'],
  deliveryItemIds: ['app-item-1', 'app-item-2'],
  reviewedAt: now,
};

test('검수 완료는 구간을 승인하고, 부분 보완은 지급을 보류하며 범위 안에서만 기록한다', () => {
  const approved = planInspection({ ...inspectionInput, requests: [] });
  expect(approved.delivery.status).toBe('APPROVED');
  expect(approved.installment).toEqual({ id: 'interim', status: 'APPROVED', approvedAt: now });

  const partial = planInspection({
    ...inspectionInput,
    priorOpenInspections: [{ id: 'old-request', applicationItemId: 'app-item-2' }],
    requests: [{ applicationItemId: 'app-item-2', reason: 'IN_SPEC', note: '수정 요청' }],
  });
  expect(partial.delivery.status).toBe('PARTIALLY_APPROVED');
  expect(partial.installment).toEqual({ id: 'interim', status: 'REWORK_REQUESTED', approvedAt: null });
  expect(partial.resolvedInspectionIds).toEqual(['old-request']);
  expect(partial.inspections).toEqual([{
    deliveryId: 'delivery-2',
    applicationItemId: 'app-item-2',
    reason: 'IN_SPEC',
    note: '수정 요청',
    status: 'OPEN',
    createdAt: now,
  }]);
  expect(partial.event).toMatchObject({ type: 'INSPECTION_REQUESTED', userId: participants.clientId });
});

test('모든 항목 보완·계약 밖 항목·비당사자·이전 납품 검수는 차단한다', () => {
  const rework = planInspection({
    ...inspectionInput,
    requests: [
      { applicationItemId: 'app-item-1', reason: 'NOT_IN_SPEC', note: null },
      { applicationItemId: 'app-item-2', reason: 'INTERPRETATION', note: null },
    ],
  });
  expect(rework.delivery.status).toBe('REWORK_REQUESTED');

  throwsCode(() => planInspection({
    ...inspectionInput,
    requests: [{ applicationItemId: 'foreign-item', reason: 'IN_SPEC', note: null }],
  }), 'INSPECTION_ITEM_OUT_OF_SCOPE');
  throwsCode(() => planInspection({
    ...inspectionInput,
    actor: supplier,
    requests: [],
  }), 'INSPECTION_FORBIDDEN');
  throwsCode(() => planInspection({
    ...inspectionInput,
    latestAttemptNo: 1,
    requests: [],
  }), 'STALE_DELIVERY');
  throwsCode(() => planInspection({
    ...inspectionInput,
    delivery: { ...inspectionInput.delivery, installmentId: 'foreign-installment' },
    requests: [],
  }), 'DELIVERY_INSTALLMENT_MISMATCH');
});

test('운영자는 열린 보완 요청을 운영자 개입 상태로 올릴 수 있다', () => {
  expect(planInspectionEscalation({
    actor: admin,
    inspection: { id: 'inspection-1', status: 'OPEN' },
    escalatedAt: now,
  })).toEqual({ id: 'inspection-1', status: 'ESCALATED', resolvedAt: now });
  throwsCode(() => planInspectionEscalation({
    actor: client,
    inspection: { id: 'inspection-1', status: 'OPEN' },
    escalatedAt: now,
  }), 'INSPECTION_ESCALATION_FORBIDDEN');
});

test('지급 기록은 승인된 중간 구간부터 순서대로 만들고 최종 구간에서 계약을 완료한다', () => {
  const interim = planInstallmentRelease({
    actor: admin,
    contractStatus: 'ACTIVE',
    paymentStatus: 'DEPOSITED',
    installment: { id: 'interim', stage: 'INTERIM', status: 'APPROVED', releaseAmount: 475_000 },
    otherInstallments: [{ stage: 'FINAL', status: 'PENDING' }],
    releasedAt: now,
  });
  expect(interim).toEqual({
    amount: 475_000,
    installment: { id: 'interim', status: 'RELEASED', releasedAt: now },
    contract: { status: 'ACTIVE', paymentStatus: 'PARTIALLY_RELEASED', completedAt: null },
  });

  const final = planInstallmentRelease({
    actor: admin,
    contractStatus: 'ACTIVE',
    paymentStatus: 'PARTIALLY_RELEASED',
    installment: { id: 'final', stage: 'FINAL', status: 'APPROVED', releaseAmount: 475_001 },
    otherInstallments: [{ stage: 'INTERIM', status: 'RELEASED' }],
    releasedAt: now,
  });
  expect(final).toEqual({
    amount: 475_001,
    installment: { id: 'final', status: 'RELEASED', releasedAt: now },
    contract: { status: 'COMPLETED', paymentStatus: 'RELEASED', completedAt: now },
  });

  throwsCode(() => planInstallmentRelease({
    actor: admin,
    contractStatus: 'ACTIVE',
    paymentStatus: 'DEPOSITED',
    installment: { id: 'final', stage: 'FINAL', status: 'APPROVED', releaseAmount: 475_001 },
    otherInstallments: [{ stage: 'INTERIM', status: 'APPROVED' }],
    releasedAt: now,
  }), 'INTERIM_RELEASE_REQUIRED');
});

test('운영자 환불은 서버 계산 잔액·사유를 기록하고 미지급 구간만 REFUNDED로 표시한다', () => {
  const result = planManualRefund({
    actor: admin,
    contract: {
      id: 'contract-1',
      status: 'CANCELLED',
      paymentStatus: 'PARTIALLY_RELEASED',
      totalDeposited: 1_050_000,
      clientFee: 50_000,
      refundAmount: null,
    },
    installments: [
      { id: 'interim', status: 'RELEASED' },
      { id: 'final', status: 'APPROVED' },
    ],
    availableAmount: 550_000,
    refundAmount: 550_000,
    clientFeeRefund: 50_000,
    supplierCompensation: 100_000,
    reason: '계약 취소 정산',
    refundedAt: now,
  });

  expect(result.contract).toEqual({
    paymentStatus: 'REFUNDED',
    refundAmount: 550_000,
    clientFeeRefund: 50_000,
    settledAmount: 100_000,
    refundReason: '계약 취소 정산',
    refundedAt: now,
  });
  expect(result.installments).toEqual([
    { id: 'final', status: 'REFUNDED' },
  ]);
  expect(result.event).toMatchObject({
    type: 'REFUND_PROCESSED',
    userId: 'admin-1',
    payload: { contractId: 'contract-1', amount: 550_000, clientFeeRefund: 50_000, supplierCompensation: 100_000 },
  });

  throwsCode(() => planManualRefund({
    actor: admin,
    contract: {
      id: 'contract-1', status: 'CANCELLED', paymentStatus: 'PARTIALLY_RELEASED',
      totalDeposited: 1_050_000, clientFee: 50_000, refundAmount: null,
    },
    installments: [],
    availableAmount: 550_000,
    refundAmount: 550_001,
    clientFeeRefund: 0,
    reason: 'over refund',
    refundedAt: now,
  }), 'REFUND_AMOUNT_MISMATCH');
});
