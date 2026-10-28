import { EventType, Prisma, type PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import {
  planDeliverySubmission,
  planInspection,
  planInstallmentRelease,
  planManualRefund,
  type InspectionReason,
} from "../trade/settlement.ts";
import { planPayoutCoupon, payoutCouponFromProfile } from "../trade/payout-coupon.ts";
import type { CancellationSettlement } from "../trade/cancellation.ts";
import { TradeError } from "../trade/errors.ts";
import { isRecord, logEvent } from "./events.ts";

const CONTRACT_SELECT = {
  id: true,
  status: true,
  paymentStatus: true,
  agreedAmount: true,
  clientFee: true,
  totalDeposited: true,
  refundAmount: true,
  specSnapshot: true,
  application: {
    select: {
      id: true,
      supplierId: true,
      projectId: true,
      project: { select: { draft: { select: { clientId: true } } } },
    },
  },
  installments: {
    select: { id: true, stage: true, status: true, amount: true, supplierFee: true, releaseAmount: true },
  },
} satisfies Prisma.ContractSelect;

type ContractForSettlement = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

export interface TradeActor {
  userId: string;
  role: "CLIENT" | "SUPPLIER" | "ADMIN";
  sessionId?: string;
}

export function createSettlementWorkflowAdapter(prismaClient: PrismaClient) {
  return {
    submitDelivery(input: {
      contractId: string;
      installmentId: string;
      actor: TradeActor;
      summary: string | null;
      fileUrl: string | null;
      submittedAt: Date;
    }) {
      return prismaClient.$transaction(async (tx) => {
        const contract = await findContractForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
        const installment = await findInstallmentForUpdate(tx, input.contractId, input.installmentId);
        if (!installment) throw new TradeError("INSTALLMENT_NOT_FOUND");
        const priorDeliveries = await tx.delivery.findMany({
          where: { installmentId: installment.id },
          select: { attemptNo: true },
        });
        const plan = planDeliverySubmission({
          actor: input.actor,
          supplierId: contract.application.supplierId,
          contractStatus: contract.status,
          paymentStatus: contract.paymentStatus,
          installment: { id: installment.id, stage: installment.stage, status: installment.status },
          otherInstallments: contract.installments
            .filter((other) => other.id !== installment.id)
            .map(({ stage, status }) => ({ stage, status })),
          priorDeliveries,
          summary: input.summary,
          fileUrl: input.fileUrl,
          submittedAt: input.submittedAt,
        });
        const delivery = await tx.delivery.create({ data: plan.delivery });
        await tx.paymentInstallment.update({
          where: { id: installment.id },
          data: plan.installment,
        });
        await logEvent(tx, {
          type: EventType.DELIVERY_SUBMITTED,
          userId: plan.event.userId,
          sessionId: input.actor.sessionId ?? null,
          projectId: contract.application.projectId,
          payload: plan.event.payload,
        });
        return { delivery, installment: plan.installment };
      });
    },

    inspectDelivery(input: {
      contractId: string;
      deliveryId: string;
      actor: TradeActor;
      requests: { applicationItemId: string; reason: InspectionReason; note: string | null }[];
      reviewedAt: Date;
    }) {
      return prismaClient.$transaction(async (tx) => {
        const contract = await findContractForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
        const deliveryRef = await tx.delivery.findFirst({
          where: { id: input.deliveryId, installment: { contractId: input.contractId } },
          select: { id: true, installmentId: true },
        });
        if (!deliveryRef) throw new TradeError("DELIVERY_NOT_FOUND");
        const installment = await findInstallmentForUpdate(tx, input.contractId, deliveryRef.installmentId);
        if (!installment) throw new TradeError("INSTALLMENT_NOT_FOUND");
        const delivery = await tx.delivery.findUnique({
          where: { id: deliveryRef.id },
          select: { id: true, installmentId: true, attemptNo: true, status: true },
        });
        if (!delivery) throw new TradeError("DELIVERY_NOT_FOUND");
        const latestDelivery = await tx.delivery.findFirst({
          where: { installmentId: installment.id },
          orderBy: { attemptNo: "desc" },
          select: { attemptNo: true },
        });
        const { contractScopeItemIds, deliveryItemIds } = await getContractScopeApplicationItemIds(
          tx,
          contract,
          installment.stage,
        );
        const priorOpenInspections = await tx.inspectionRequest.findMany({
          where: { status: "OPEN", delivery: { is: { installmentId: installment.id } } },
          select: { id: true, applicationItemId: true },
        });
        const plan = planInspection({
          actor: input.actor,
          clientId: contract.application.project.draft.clientId,
          supplierId: contract.application.supplierId,
          contractStatus: contract.status,
          paymentStatus: contract.paymentStatus,
          installment: { id: installment.id, stage: installment.stage, status: installment.status },
          otherInstallments: contract.installments
            .filter((other) => other.id !== installment.id)
            .map(({ stage, status }) => ({ stage, status })),
          delivery,
          latestAttemptNo: latestDelivery?.attemptNo ?? 0,
          contractScopeItemIds,
          deliveryItemIds,
          priorOpenInspections,
          requests: input.requests,
          reviewedAt: input.reviewedAt,
        });

        if (plan.resolvedInspectionIds.length > 0) {
          await tx.inspectionRequest.updateMany({
            where: { id: { in: plan.resolvedInspectionIds } },
            data: { status: "RESOLVED", resolvedAt: input.reviewedAt },
          });
        }
        if (plan.inspections.length > 0) {
          await tx.inspectionRequest.createMany({ data: plan.inspections });
        }
        await tx.delivery.update({
          where: { id: delivery.id },
          data: plan.delivery,
        });
        await tx.paymentInstallment.update({
          where: { id: installment.id },
          data: plan.installment,
        });
        if (plan.event) {
          await logEvent(tx, {
            type: EventType.INSPECTION_REQUESTED,
            userId: plan.event.userId,
            sessionId: input.actor.sessionId ?? null,
            projectId: contract.application.projectId,
            payload: plan.event.payload,
          });
        }
        return { delivery: plan.delivery, installment: plan.installment, inspections: plan.inspections };
      });
    },

    releaseInstallment(input: {
      contractId: string;
      installmentId: string;
      actor: TradeActor;
      releasedAt: Date;
    }) {
      return prismaClient.$transaction(async (tx) => {
        const contract = await findContractForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
        const installment = await findInstallmentForUpdate(tx, input.contractId, input.installmentId);
        if (!installment) throw new TradeError("INSTALLMENT_NOT_FOUND");
        const supplierId = contract.application.supplierId;
        const profile = await tx.supplierProfile.findUnique({
          where: { userId: supplierId },
          select: { userId: true, feeExempt: true, feeExemptUsedAt: true },
        });
        const couponInput = {
          supplierId,
          installment: {
            stage: installment.stage,
            amount: installment.amount,
            supplierFee: installment.supplierFee,
            releaseAmount: installment.releaseAmount,
          },
          releasedStages: contract.installments
            .filter((other) => other.status === "RELEASED")
            .map(({ stage }) => stage),
          now: input.releasedAt,
        };
        let coupon = planPayoutCoupon({
          ...couponInput,
          coupon: profile ? payoutCouponFromProfile(profile) : null,
        });
        if (coupon.applied) {
          const claimed = await tx.$executeRaw(Prisma.sql`
            UPDATE supplier_profiles SET "feeExemptUsedAt" = now()
            WHERE "userId" = ${supplierId} AND "feeExempt" = true AND "feeExemptUsedAt" IS NULL
          `);
          if (claimed !== 1) {
            coupon = planPayoutCoupon({ ...couponInput, coupon: null });
          }
        }
        const plan = planInstallmentRelease({
          actor: input.actor,
          contractStatus: contract.status,
          paymentStatus: contract.paymentStatus,
          installment: {
            id: installment.id,
            stage: installment.stage,
            status: installment.status,
            releaseAmount: coupon.releaseAmount,
          },
          otherInstallments: contract.installments
            .filter((other) => other.id !== installment.id)
            .map(({ stage, status }) => ({ stage, status })),
          releasedAt: input.releasedAt,
        });
        await tx.paymentInstallment.update({
          where: { id: installment.id },
          data: {
            ...plan.installment,
            supplierFee: coupon.supplierFee,
            releaseAmount: coupon.releaseAmount,
          },
        });
        await tx.contract.update({ where: { id: contract.id }, data: plan.contract });
        return plan;
      });
    },

    recordManualCancellationRefund(input: {
      contractId: string;
      actor: TradeActor;
      cancellation: CancellationSettlement;
      reason: string;
      refundedAt: Date;
    }) {
      return prismaClient.$transaction(async (tx) => {
        const contract = await findContractForUpdate(tx, input.contractId);
        if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM payment_installments WHERE "contractId" = ${contract.id} ORDER BY id FOR UPDATE
        `);
        const releasedAmount = contract.installments
          .filter((installment) => installment.status === "RELEASED")
          .reduce((total, installment) => total + installment.amount, 0);
        if (
          contract.agreedAmount - releasedAmount < 0 ||
          input.cancellation.principalRefund + input.cancellation.supplierCompensation !== contract.agreedAmount - releasedAmount ||
          input.cancellation.totalRefund !== input.cancellation.principalRefund + input.cancellation.clientFeeRefund ||
          input.cancellation.totalRefund + input.cancellation.supplierCompensation > contract.totalDeposited - releasedAmount
        ) {
          throw new TradeError("REFUND_AMOUNT_MISMATCH");
        }
        const plan = planManualRefund({
          actor: input.actor,
          contract: {
            id: contract.id,
            status: contract.status,
            paymentStatus: contract.paymentStatus,
            totalDeposited: contract.totalDeposited,
            clientFee: contract.clientFee,
            refundAmount: contract.refundAmount,
          },
          installments: contract.installments.map(({ id, status }) => ({ id, status })),
          availableAmount: input.cancellation.totalRefund,
          refundAmount: input.cancellation.totalRefund,
          clientFeeRefund: input.cancellation.clientFeeRefund,
          supplierCompensation: input.cancellation.supplierCompensation,
          reason: input.reason,
          refundedAt: input.refundedAt,
        });
        const updatedContract = await tx.contract.update({
          where: { id: contract.id },
          data: plan.contract,
        });
        const refundIds = plan.installments.map(({ id }) => id);
        if (refundIds.length > 0) {
          await tx.paymentInstallment.updateMany({
            where: { contractId: contract.id, id: { in: refundIds } },
            data: { status: "REFUNDED" },
          });
        }
        await logEvent(tx, {
          type: EventType.REFUND_PROCESSED,
          userId: input.actor.userId,
          sessionId: input.actor.sessionId ?? null,
          projectId: contract.application.projectId,
          payload: plan.event.payload,
        });
        return { contract: updatedContract, installments: plan.installments, event: plan.event };
      });
    },
  };
}

async function findContractForUpdate(tx: DbTx, contractId: string): Promise<ContractForSettlement | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`,
  );
  if (!rows[0]) return null;
  return tx.contract.findUnique({ where: { id: contractId }, select: CONTRACT_SELECT });
}

async function findInstallmentForUpdate(tx: DbTx, contractId: string, installmentId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM payment_installments WHERE id = ${installmentId} AND "contractId" = ${contractId} FOR UPDATE`,
  );
  if (!rows[0]) return null;
  return tx.paymentInstallment.findUnique({
    where: { id: installmentId },
    select: { id: true, stage: true, status: true, amount: true, supplierFee: true, releaseAmount: true },
  });
}

async function getContractScopeApplicationItemIds(
  tx: DbTx,
  contract: ContractForSettlement,
  installmentStage: "INTERIM" | "FINAL",
): Promise<{ contractScopeItemIds: string[]; deliveryItemIds: string[] }> {
  const snapshot = contract.specSnapshot;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.included)) {
    throw new TradeError("INVALID_CONTRACT_SCOPE");
  }
  const assignments = snapshot.included.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.specItemId !== "string" ||
      (item.installmentStage !== "INTERIM" && item.installmentStage !== "FINAL")
    ) {
      throw new TradeError("INVALID_CONTRACT_SCOPE");
    }
    return { specItemId: item.specItemId, installmentStage: item.installmentStage };
  });
  const specItemIds = assignments.map(({ specItemId }) => specItemId);
  if (specItemIds.length === 0 || new Set(specItemIds).size !== specItemIds.length) {
    throw new TradeError("INVALID_CONTRACT_SCOPE");
  }
  const applicationItems = await tx.applicationItem.findMany({
    where: {
      applicationId: contract.application.id,
      isAvailable: true,
      specItemId: { in: specItemIds },
    },
    select: { id: true, specItemId: true },
  });
  const itemIdBySpecId = new Map(applicationItems.map((item) => [item.specItemId, item.id]));
  const contractScopeItemIds = specItemIds.map((specItemId) => itemIdBySpecId.get(specItemId));
  if (contractScopeItemIds.some((itemId) => itemId === undefined)) throw new TradeError("INVALID_CONTRACT_SCOPE");
  const deliveryItemIds = assignments
    .filter((assignment) => assignment.installmentStage === installmentStage)
    .map(({ specItemId }) => itemIdBySpecId.get(specItemId));
  if (deliveryItemIds.some((itemId) => itemId === undefined)) throw new TradeError("INVALID_CONTRACT_SCOPE");
  return {
    contractScopeItemIds: contractScopeItemIds.filter((itemId): itemId is string => itemId !== undefined),
    deliveryItemIds: deliveryItemIds.filter((itemId): itemId is string => itemId !== undefined),
  };
}
