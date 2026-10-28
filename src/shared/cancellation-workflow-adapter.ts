import { EventType, Prisma, type PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import {
  type CancellationContract,
  type CancellationEvent,
  type CancellationRecord,
  type CancellationRequest,
  type CancellationWorkflowPorts,
} from "../trade/cancellation-workflow.ts";
import type { CancellationParty } from "../trade/cancellation.ts";
import { TradeError } from "../trade/errors.ts";
import { logEvent } from "./events.ts";
import { transitionProjectForContract } from "./contract-bridge.ts";

const CANCELLATION_SELECT = {
  id: true,
  applicationId: true,
  status: true,
  paymentStatus: true,
  agreedAmount: true,
  clientFee: true,
  totalDeposited: true,
  refundAmount: true,
  supplierSignedAt: true,
  cancelRequestedBy: true,
  cancelRequestedParty: true,
  cancelReason: true,
  cancelRequestedAt: true,
  application: {
    select: {
      supplierId: true,
      project: { select: { draft: { select: { clientId: true } } } },
    },
  },
  installments: {
    select: { id: true, stage: true, status: true, amount: true },
  },
} satisfies Prisma.ContractSelect;

type CancellationContractRow = Prisma.ContractGetPayload<{ select: typeof CANCELLATION_SELECT }>;

export function createCancellationWorkflowPorts(
  prismaClient: PrismaClient,
): CancellationWorkflowPorts<DbTx> {
  return {
    transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
      return prismaClient.$transaction(work);
    },

    findContractForCancellationForUpdate(tx, contractId) {
      return findContractForCancellationForUpdate(tx, contractId);
    },

    async recordCancellationRequest(tx, request) {
      const projectId = await getProjectId(tx, request.contractId);
      await tx.contract.update({
        where: { id: request.contractId },
        data: {
          cancelRequestedBy: request.actorUserId,
          cancelRequestedParty: request.party,
          cancelReason: request.reason,
          cancelRequestedAt: request.requestedAt,
        },
      });
      await logEvent(tx, {
        type: EventType.CANCELLATION_REQUESTED,
        userId: request.actorUserId,
        projectId,
        payload: {
          contractId: request.contractId,
          requestedBy: request.actorUserId,
          party: request.party,
          reason: request.reason,
          requestedAt: request.requestedAt.toISOString(),
        },
      });
    },

    async applyCancellation(tx, record: CancellationRecord, event?: CancellationEvent) {
      const contractId = record.contractId;
      if (!contractId.trim() || (event && event.payload.contractId !== contractId)) {
        throw new TradeError("INVALID_CANCELLATION_STATE");
      }
      const projectId = await getProjectId(tx, contractId);

      await tx.contract.update({
        where: { id: contractId },
        data: {
          status: record.status,
          paymentStatus: record.paymentStatus,
          refundAmount: record.refundAmount,
          clientFeeRefund: record.clientFeeRefund,
          settledAmount: record.settledAmount,
          refundReason: record.refundReason,
          refundedAt: record.refundedAt,
        },
      });

      const installmentIds = record.installments.map(({ id }) => id);
      if (installmentIds.length > 0) {
        const update = await tx.paymentInstallment.updateMany({
          where: {
            contractId,
            id: { in: installmentIds },
            status: { not: "RELEASED" },
          },
          data: { status: "REFUNDED" },
        });
        if (update.count !== installmentIds.length) {
          throw new TradeError("INVALID_CANCELLATION_STATE");
        }
      }

      if (event) {
        await logEvent(tx, {
          type: EventType.REFUND_PROCESSED,
          userId: event.userId,
          projectId,
          payload: event.payload,
        });
      }
    },

    releaseApplicationForCancellation(tx, input) {
      return transitionProjectForContract(tx, input.applicationId, {
        type: "CONTRACT_CANCELLED",
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        cancelledAt: input.cancelledAt,
      });
    },
  };
}

async function findContractForCancellationForUpdate(
  tx: DbTx,
  contractId: string,
): Promise<CancellationContract | null> {
  const lockedContracts = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`,
  );
  if (!lockedContracts[0]) return null;

  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM escrow_deposits
    WHERE "contractId" = ${contractId}
    ORDER BY id FOR UPDATE
  `);
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM payment_installments
    WHERE "contractId" = ${contractId}
    ORDER BY id FOR UPDATE
  `);

  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    select: CANCELLATION_SELECT,
  });
  if (!contract) return null;
  return toCancellationContract(contract);
}

function toCancellationContract(row: CancellationContractRow): CancellationContract {
  const activatedAt = row.supplierSignedAt;
  const interim = row.installments.find(({ stage }) => stage === "INTERIM");
  if (!activatedAt || !interim || interim.amount <= 0) {
    throw new TradeError("INVALID_CANCELLATION_STATE");
  }

  return {
    id: row.id,
    applicationId: row.applicationId,
    status: row.status,
    paymentStatus: row.paymentStatus,
    agreedAmount: row.agreedAmount,
    clientFee: row.clientFee,
    totalDeposited: row.totalDeposited,
    refundAmount: row.refundAmount,
    activatedAt,
    interimAmount: interim.amount,
    releasedAmount: row.installments.reduce(
      (total, installment) => installment.status === "RELEASED" ? total + installment.amount : total,
      0,
    ),
    clientId: row.application.project.draft.clientId,
    supplierId: row.application.supplierId,
    installments: row.installments.map(({ id, status }) => ({ id, status })),
    cancellationRequest: readCancellationRequest(row),
  };
}

function readCancellationRequest(row: CancellationContractRow): CancellationContract["cancellationRequest"] {
  const { cancelRequestedBy, cancelRequestedParty, cancelReason, cancelRequestedAt } = row;
  if (
    cancelRequestedBy === null &&
    cancelRequestedParty === null &&
    cancelReason === null &&
    cancelRequestedAt === null
  ) return null;
  if (
    cancelRequestedBy === null ||
    cancelRequestedParty === null ||
    cancelReason === null ||
    cancelRequestedAt === null
  ) {
    throw new TradeError("INVALID_CANCELLATION_STATE");
  }
  if (!isCancellationParty(cancelRequestedParty) || !cancelRequestedBy.trim() || !cancelReason.trim()) {
    throw new TradeError("INVALID_CANCELLATION_STATE");
  }
  return {
    requestedBy: cancelRequestedBy,
    party: cancelRequestedParty,
    reason: cancelReason,
    requestedAt: cancelRequestedAt,
  };
}

function isCancellationParty(value: string): value is CancellationParty {
  return value === "CLIENT" || value === "SUPPLIER" || value === "MUTUAL";
}

async function getProjectId(tx: DbTx, contractId: string): Promise<string> {
  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    select: { application: { select: { projectId: true } } },
  });
  if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
  return contract.application.projectId;
}
