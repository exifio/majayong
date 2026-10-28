import { ContractStatus as PrismaContractStatus, Prisma, type PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import { getAcceptedApplicationContext, transitionProjectForContract } from "./contract-bridge.ts";
import { AppError } from "./errors.ts";
import { planContract, type AcceptedContext, type InstallmentStage } from "../trade/contract.ts";
import { TradeError } from "../trade/errors.ts";

const CONTRACT_SELECT = {
  id: true,
  applicationId: true,
  status: true,
  contentHash: true,
  clientSignedAt: true,
  supplierSignedAt: true,
  pdfUrl: true,
} satisfies Prisma.ContractSelect;

type ContractRow = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;
type ContractStatusValue = "PENDING_CONSENT" | "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface ContractRecordForWorkflow {
  id: string;
  applicationId: string;
  status: ContractStatusValue;
  contentHash: string | null;
  clientSignedAt: Date | null;
  supplierSignedAt: Date | null;
  pdfUrl: string | null;
}

export interface ContractSignatureFieldsForWorkflow {
  status: ContractStatusValue;
  contentHash: string | null;
  clientSignedAt: Date | null;
  supplierSignedAt: Date | null;
}

export interface ContractSignedActionForWorkflow {
  type: "CONTRACT_SIGNED";
  actorUserId: string;
  sessionId: string | null;
}

export async function findContractForWorkflow(tx: DbTx, applicationId: string): Promise<ContractRecordForWorkflow | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM contracts WHERE "applicationId" = ${applicationId} FOR UPDATE`,
  );
  if (!rows[0]) return null;
  return findContract(tx, applicationId);
}

export async function findContract(tx: DbTx, applicationId: string): Promise<ContractRecordForWorkflow | null> {
  const contract = await tx.contract.findUnique({ where: { applicationId }, select: CONTRACT_SELECT });
  return contract ? toWorkflowContract(contract) : null;
}

export async function updateContractSignature(
  tx: DbTx,
  contractId: string,
  fields: ContractSignatureFieldsForWorkflow,
): Promise<ContractRecordForWorkflow> {
  const contract = await tx.contract.update({
    where: { id: contractId },
    data: {
      status: toPrismaStatus(fields.status),
      contentHash: fields.contentHash,
      clientSignedAt: fields.clientSignedAt,
      supplierSignedAt: fields.supplierSignedAt,
    },
    select: CONTRACT_SELECT,
  });
  return toWorkflowContract(contract);
}

export function createContractForAcceptedApplication(prismaClient: PrismaClient) {
  return (input: {
    applicationId: string;
    agreedAmount: number;
    interimRatio?: number;
    installmentStageBySpecItemId: Readonly<Record<string, InstallmentStage>>;
  }) => prismaClient.$transaction(async (tx) => {
    const lockedApplication = await tx.$queryRaw<Array<{ id: string; projectId: string }>>(Prisma.sql`
      SELECT id, "projectId" FROM applications WHERE id = ${input.applicationId} FOR UPDATE
    `);
    if (!lockedApplication[0]) {
      throw new AppError(404, "NOT_FOUND", "수락 지원서를 찾을 수 없습니다.");
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM projects WHERE id = ${lockedApplication[0].projectId} FOR UPDATE
    `);
    const existing = await tx.contract.findUnique({
      where: { applicationId: input.applicationId },
      select: { id: true },
    });
    if (existing) throw new TradeError("CONTRACT_ALREADY_EXISTS");

    const context = await getAcceptedApplicationContext(tx, input.applicationId);
    const planningContext: AcceptedContext = {
      application: {
        id: context.applicationId,
        status: "ACCEPTED",
        specVersionNo: context.specVersionNo,
        totalAmount: context.proposedTotalAmount,
        durationDays: context.durationDays,
      },
      specItems: context.specItems,
      appItems: context.applicationItems,
    };
    const plan = planContract(planningContext, input);
    return tx.contract.create({
      data: {
        applicationId: plan.applicationId,
        status: plan.status,
        specVersionNo: plan.specVersionNo,
        specSnapshot: plan.specSnapshot,
        agreedAmount: plan.agreedAmount,
        clientFee: plan.clientFee,
        supplierFee: plan.supplierFee,
        interimRatio: plan.interimRatio,
        installments: { create: plan.installments },
      },
      include: { installments: true },
    });
  });
}

export function createContractWorkflowPorts(prismaClient: PrismaClient) {
  return {
    transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
      return prismaClient.$transaction((tx) => work(tx));
    },
    getAcceptedApplicationContext(tx: DbTx, applicationId: string) {
      return getAcceptedApplicationContext(tx, applicationId);
    },
    async getContractParticipants(tx: DbTx, applicationId: string) {
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        select: {
          supplierId: true,
          project: { select: { draft: { select: { clientId: true } } } },
        },
      });
      return application
        ? { clientId: application.project.draft.clientId, supplierId: application.supplierId }
        : null;
    },
    findContractForUpdate: findContractForWorkflow,
    findContract,
    updateContractSignature,
    transitionProjectForContract(tx: DbTx, applicationId: string, action: ContractSignedActionForWorkflow) {
      return transitionProjectForContract(tx, applicationId, action);
    },
  };
}

function toWorkflowContract(contract: ContractRow): ContractRecordForWorkflow {
  return {
    id: contract.id,
    applicationId: contract.applicationId,
    status: contract.status,
    contentHash: contract.contentHash,
    clientSignedAt: contract.clientSignedAt,
    supplierSignedAt: contract.supplierSignedAt,
    pdfUrl: contract.pdfUrl,
  };
}

function toPrismaStatus(status: ContractStatusValue): PrismaContractStatus {
  switch (status) {
    case "PENDING_CONSENT": return PrismaContractStatus.PENDING_CONSENT;
    case "ACTIVE": return PrismaContractStatus.ACTIVE;
    case "COMPLETED": return PrismaContractStatus.COMPLETED;
    case "CANCELLED": return PrismaContractStatus.CANCELLED;
    default: throw new AppError(400, "VALIDATION_ERROR", "계약 상태가 올바르지 않습니다.");
  }
}
