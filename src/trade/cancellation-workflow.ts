import {
  CANCELLATION_FREE_CANCEL_MS,
  planCancellationSettlement,
  type CancellationParty,
  type CancellationSettlement,
} from './cancellation.ts';
import { TradeError } from './errors.ts';
import { planManualRefund, type InstallmentStatus, type PaymentStatus } from './settlement.ts';

// 취소는 두 단계다.
// 1) 당사자가 사유를 남겨 취소를 요청한다(계약은 ACTIVE로 유지, 상대 합의 대기).
// 2) 운영자가 합의 내용을 확인해 취소를 확정하고 환불 금액을 기록한다.
// A adapter가 취소 요청 사본과 EventLog를 저장한다.

export type CancellationActor = {
  userId: string;
  role: 'CLIENT' | 'SUPPLIER' | 'ADMIN';
  sessionId?: string;
};

export type CancellationContract = {
  id: string;
  applicationId: string; // A 상태 전이(지원 거절·모집 복귀)에 필요
  status: 'PENDING_CONSENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: PaymentStatus;
  agreedAmount: number;
  clientFee: number;
  totalDeposited: number;
  refundAmount: number | null;
  activatedAt: Date; // 두 번째 서명으로 ACTIVE가 된 시각(supplierSignedAt)
  interimAmount: number; // PaymentInstallment(INTERIM).amount
  releasedAmount: number; // 지급 완료된 구간 amount 합계
  clientId: string;
  supplierId: string;
  installments: { id: string; status: InstallmentStatus }[];
  // 취소 확정 전에 남긴 요청. 저장 방식은 A adapter가 정한다(계약당 1건).
  cancellationRequest: {
    requestedBy: string;
    party: CancellationParty;
    reason: string;
    requestedAt: Date;
  } | null;
};

export type CancellationRequest = {
  contractId: string;
  actorUserId: string;
  party: CancellationParty;
  reason: string;
  requestedAt: Date;
};

export type CancellationRecord = {
  contractId: string;
  status: 'CANCELLED';
  // 예치 전 취소는 PENDING을 유지한다(환불할 금액이 없다).
  paymentStatus: 'REFUNDED' | 'PENDING';
  refundAmount: number;
  clientFeeRefund: number;
  settledAmount: number; // 공급자 착수 보상액
  refundReason: string;
  refundedAt: Date;
  installments: { id: string; status: 'REFUNDED' }[];
  requestedBy: string;
  party: CancellationParty;
};

export type CancellationEvent = {
  type: 'REFUND_PROCESSED';
  userId: string;
  payload: Record<string, unknown>;
};

export interface CancellationWorkflowPorts<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  findContractForCancellationForUpdate(
    tx: Tx,
    contractId: string,
  ): Promise<CancellationContract | null>;
  // 계약·입금 row를 잠근 같은 transaction에서 취소 요청을 기록한다.
  recordCancellationRequest(tx: Tx, request: CancellationRequest): Promise<void>;
  // 계약 상태·환불 금액·구간 상태·REFUND_PROCESSED EventLog를 같은 transaction에 기록한다.
  // 예치 전 취소처럼 환불이 없으면 event는 넘기지 않는다.
  applyCancellation(tx: Tx, record: CancellationRecord, event?: CancellationEvent): Promise<void>;
  // A 소유 상태 전이: 같은 transaction에서 Application=REJECTED, Project=RECRUITING.
  // A의 transitionProjectForContract(tx, applicationId, { type: 'CONTRACT_CANCELLED', actorUserId, sessionId, cancelledAt })를 그대로 호출한다.
  releaseApplicationForCancellation(
    tx: Tx,
    input: {
      applicationId: string;
      contractId: string;
      actorUserId: string;
      sessionId: string | null;
      cancelledAt: Date;
    },
  ): Promise<unknown>;
}

export function createCancellationWorkflow<Tx>(
  ports: CancellationWorkflowPorts<Tx>,
  now: () => Date = () => new Date(),
) {
  return {
    async requestCancellation(input: {
      contractId: string;
      actor: CancellationActor;
      party?: CancellationParty;
      reason: string;
    }): Promise<CancellationRequest> {
      const reason = requireReason(input.reason);
      return ports.transaction(async (tx) => {
        const contract = await ports.findContractForCancellationForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError('CONTRACT_NOT_FOUND');
        if (contract.status !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
        const party = resolveParty(input.actor, contract, input.party);
        if (party === 'MUTUAL') throw new TradeError('MUTUAL_CANCELLATION_REQUIRES_ADMIN');

        // 요청은 계약당 1건만 둔다. 같은 사람이 같은 사유로 다시 보내면 기존 요청을 돌려준다.
        const existing = contract.cancellationRequest;
        if (existing) {
          if (existing.requestedBy === input.actor.userId && existing.party === party && existing.reason === reason) {
            return { contractId: contract.id, actorUserId: existing.requestedBy, party, reason, requestedAt: existing.requestedAt };
          }
          throw new TradeError('CANCELLATION_ALREADY_REQUESTED');
        }

        const request: CancellationRequest = {
          contractId: contract.id,
          actorUserId: input.actor.userId,
          party,
          reason,
          requestedAt: now(),
        };
        await ports.recordCancellationRequest(tx, request);
        return request;
      });
    },

    async processCancellation(input: {
      contractId: string;
      actor: CancellationActor;
      party: CancellationParty;
      reason: string;
      negotiatedCompensation?: number;
      compensationPercent?: number;
    }): Promise<{
      settlement: CancellationSettlement;
      refundAmount: number;
      clientFeeRefund: number;
      supplierCompensation: number;
      cancelledAt: Date;
    }> {
      const reason = requireReason(input.reason);
      return ports.transaction(async (tx) => {
        const contract = await ports.findContractForCancellationForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError('CONTRACT_NOT_FOUND');
        if (contract.status !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
        // 합의 내용 기록과 환불 실행은 운영자만 한다(planManualRefund가 ADMIN을 확인한다).
        if (input.actor.role !== 'ADMIN') throw new TradeError('REFUND_FORBIDDEN');

        const cancelledAt = now();

        // 예치 전 취소: 돌려줄 돈이 없으므로 환불 계산 없이 취소만 확정한다.
        if (contract.paymentStatus === 'PENDING' || contract.totalDeposited === 0) {
          const within24Hours =
            cancelledAt.getTime() - contract.activatedAt.getTime() <= CANCELLATION_FREE_CANCEL_MS;
          const empty: CancellationSettlement = {
            within24Hours,
            supplierCompensation: 0,
            principalRefund: 0,
            clientFeeRefund: 0,
            totalRefund: 0,
            retainedClientFee: 0,
          };
          await ports.applyCancellation(tx, {
            contractId: contract.id,
            status: 'CANCELLED',
            paymentStatus: 'PENDING',
            refundAmount: 0,
            clientFeeRefund: 0,
            settledAmount: 0,
            refundReason: reason,
            refundedAt: cancelledAt,
            installments: [],
            requestedBy: input.actor.userId,
            party: input.party,
          });
          await releaseApplication(ports, tx, contract, input.actor, cancelledAt);
          return {
            settlement: empty,
            refundAmount: 0,
            clientFeeRefund: 0,
            supplierCompensation: 0,
            cancelledAt,
          };
        }

        const settlement = planCancellationSettlement({
          principal: contract.agreedAmount,
          clientFee: contract.clientFee,
          interimAmount: contract.interimAmount,
          totalDeposited: contract.totalDeposited,
          releasedAmount: contract.releasedAmount,
          activatedAt: contract.activatedAt,
          cancelledAt,
          party: input.party,
          negotiatedCompensation: input.negotiatedCompensation,
          compensationPercent: input.compensationPercent,
        });

        const refund = planManualRefund({
          actor: input.actor,
          contract: {
            id: contract.id,
            status: 'CANCELLED',
            paymentStatus: contract.paymentStatus,
            totalDeposited: contract.totalDeposited,
            clientFee: contract.clientFee,
            refundAmount: contract.refundAmount,
          },
          installments: contract.installments,
          availableAmount: settlement.totalRefund,
          refundAmount: settlement.totalRefund,
          clientFeeRefund: settlement.clientFeeRefund,
          supplierCompensation: settlement.supplierCompensation,
          reason,
          refundedAt: cancelledAt,
        });

        await ports.applyCancellation(
          tx,
          {
            contractId: contract.id,
            status: 'CANCELLED',
            paymentStatus: 'REFUNDED',
            refundAmount: refund.contract.refundAmount,
            clientFeeRefund: refund.contract.clientFeeRefund,
            settledAmount: settlement.supplierCompensation,
            refundReason: reason,
            refundedAt: cancelledAt,
            installments: refund.installments,
            requestedBy: input.actor.userId,
            party: input.party,
          },
          refund.event,
        );
        await releaseApplication(ports, tx, contract, input.actor, cancelledAt);

        return {
          settlement,
          refundAmount: settlement.totalRefund,
          clientFeeRefund: settlement.clientFeeRefund,
          supplierCompensation: settlement.supplierCompensation,
          cancelledAt,
        };
      });
    },
  };
}

function releaseApplication<Tx>(
  ports: CancellationWorkflowPorts<Tx>,
  tx: Tx,
  contract: CancellationContract,
  actor: CancellationActor,
  cancelledAt: Date,
): Promise<unknown> {
  return ports.releaseApplicationForCancellation(tx, {
    applicationId: contract.applicationId,
    contractId: contract.id,
    actorUserId: actor.userId,
    sessionId: actor.sessionId ?? null,
    cancelledAt,
  });
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new TradeError('CANCELLATION_REASON_REQUIRED');
  return trimmed;
}

// 당사자는 자기 사유로만 요청한다. 운영자는 사유를 대신 기록할 수 있다.
function resolveParty(
  actor: CancellationActor,
  contract: CancellationContract,
  requested: CancellationParty | undefined,
): CancellationParty {
  if (actor.role === 'ADMIN') {
    if (requested !== 'CLIENT' && requested !== 'SUPPLIER' && requested !== 'MUTUAL') {
      throw new TradeError('CANCELLATION_PARTY_REQUIRED');
    }
    return requested;
  }
  if (actor.role === 'CLIENT') {
    if (actor.userId !== contract.clientId) throw new TradeError('CANCELLATION_FORBIDDEN');
    if (requested === 'MUTUAL') throw new TradeError('MUTUAL_CANCELLATION_REQUIRES_ADMIN');
    if (requested !== undefined && requested !== 'CLIENT') throw new TradeError('CANCELLATION_FORBIDDEN');
    return 'CLIENT';
  }
  if (actor.userId !== contract.supplierId) throw new TradeError('CANCELLATION_FORBIDDEN');
  if (requested === 'MUTUAL') throw new TradeError('MUTUAL_CANCELLATION_REQUIRES_ADMIN');
  if (requested !== undefined && requested !== 'SUPPLIER') throw new TradeError('CANCELLATION_FORBIDDEN');
  return 'SUPPLIER';
}
