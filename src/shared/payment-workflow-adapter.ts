import { EventType, Prisma, type PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import {
  type DepositRecord,
  type PaymentContract,
  type PaymentWorkflowPorts,
} from "../trade/payment-workflow.ts";
import { holdIfOverdue, DEPOSIT_HOLD_LIMIT_MS } from "../trade/payment.ts";
import { logEvent } from "./events.ts";

const PAYMENT_CONTRACT_SELECT = {
  id: true,
  applicationId: true,
  status: true,
  paymentStatus: true,
  agreedAmount: true,
  clientFee: true,
  totalDeposited: true,
  application: {
    select: {
      projectId: true,
      project: { select: { draft: { select: { clientId: true } } } },
    },
  },
} satisfies Prisma.ContractSelect;

const DEPOSIT_SELECT = {
  id: true,
  contractId: true,
  principal: true,
  clientFee: true,
  amount: true,
  status: true,
  idempotencyKey: true,
  pgKey: true,
  depositedAt: true,
} satisfies Prisma.EscrowDepositSelect;

type PaymentContractRow = Prisma.ContractGetPayload<{ select: typeof PAYMENT_CONTRACT_SELECT }>;
type DepositRow = Prisma.EscrowDepositGetPayload<{ select: typeof DEPOSIT_SELECT }>;
type StartContext = { contract: PaymentContract; deposits: DepositRecord[] };
type ConfirmationContext = { contract: PaymentContract; clientId: string; deposit: DepositRecord };

export function createPaymentWorkflowPorts(prismaClient: PrismaClient): PaymentWorkflowPorts<DbTx> {
  return {
    transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
      return prismaClient.$transaction((tx) => work(tx));
    },
    async findDepositStartContextForUpdate(tx, contractId): Promise<StartContext | null> {
      await lockContract(tx, contractId);
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM escrow_deposits WHERE "contractId" = ${contractId} ORDER BY id FOR UPDATE
      `);
      const contract = await tx.contract.findUnique({ where: { id: contractId }, select: PAYMENT_CONTRACT_SELECT });
      if (!contract) return null;
      const deposits = await tx.escrowDeposit.findMany({
        where: { contractId },
        select: DEPOSIT_SELECT,
        orderBy: { createdAt: "asc" },
      });
      return { contract: toPaymentContract(contract), deposits: deposits.map(toDepositRecord) };
    },
    async createDeposit(tx, input) {
      const deposit = await tx.escrowDeposit.create({ data: input, select: DEPOSIT_SELECT });
      return toDepositRecord(deposit);
    },
    async recordPaymentEvents(tx, depositId, events) {
      await tx.paymentEvent.createMany({
        data: events.map((event) => ({
          depositId,
          eventType: event.eventType,
          dedupKey: event.dedupKey,
          resultNote: event.resultNote,
        })),
      });
    },
    findDepositConfirmationContext(tx, contractId, depositId) {
      return findConfirmationContext(tx, contractId, depositId);
    },
    async findDepositConfirmationContextForUpdate(tx, contractId, depositId) {
      await lockContract(tx, contractId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM escrow_deposits WHERE id = ${depositId} AND "contractId" = ${contractId} FOR UPDATE
      `);
      if (!rows[0]) return null;
      return findConfirmationContext(tx, contractId, depositId);
    },
    async listPaymentEventDedupKeys(tx, depositId) {
      const events = await tx.paymentEvent.findMany({
        where: { depositId, dedupKey: { not: null } },
        select: { dedupKey: true },
      });
      return events.flatMap(({ dedupKey }) => dedupKey === null ? [] : [dedupKey]);
    },
    async updateDeposit(tx, depositId, patch) {
      const deposit = await tx.escrowDeposit.update({
        where: { id: depositId },
        data: patch,
        select: DEPOSIT_SELECT,
      });
      return toDepositRecord(deposit);
    },
    async updateContractPayment(tx, contractId, patch) {
      await tx.contract.update({ where: { id: contractId }, data: patch });
    },
    recordDepositEvent(tx, event) {
      return logEvent(tx, {
        type: event.type === "PAYMENT_DEPOSITED"
          ? EventType.PAYMENT_DEPOSITED
          : EventType.OPERATOR_DEPOSIT_REVIEWED,
        userId: event.userId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        payload: event.payload,
      }).then(() => undefined);
    },
  };
}
export async function holdOverdueDeposits(
  prismaClient: PrismaClient,
  now: Date = new Date(),
  limitMs = DEPOSIT_HOLD_LIMIT_MS,
): Promise<number> {
  if (Number.isNaN(now.getTime()) || !Number.isFinite(limitMs) || limitMs < 0) return 0;
  const overdueBefore = new Date(now.getTime() - limitMs);
  const candidates = await prismaClient.escrowDeposit.findMany({
    where: { status: "PENDING", createdAt: { lt: overdueBefore } },
    select: { id: true, contractId: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  let held = 0;
  for (const candidate of candidates) {
    const changed = await prismaClient.$transaction(async (tx) => {
      await lockContract(tx, candidate.contractId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM escrow_deposits
        WHERE id = ${candidate.id} AND "contractId" = ${candidate.contractId}
        FOR UPDATE
      `);
      if (!rows[0]) return false;
      const deposit = await tx.escrowDeposit.findUnique({
        where: { id: candidate.id },
        select: { status: true, createdAt: true },
      });
      if (!deposit || holdIfOverdue(deposit, now, limitMs) !== "HELD") return false;
      const update = await tx.escrowDeposit.updateMany({
        where: { id: candidate.id, status: "PENDING" },
        data: { status: "HELD" },
      });
      return update.count === 1;
    });
    if (changed) held += 1;
  }
  return held;
}

async function lockContract(tx: DbTx, contractId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`);
}

async function findConfirmationContext(
  tx: DbTx,
  contractId: string,
  depositId: string,
): Promise<ConfirmationContext | null> {
  const [contract, deposit] = await Promise.all([
    tx.contract.findUnique({ where: { id: contractId }, select: PAYMENT_CONTRACT_SELECT }),
    tx.escrowDeposit.findFirst({ where: { id: depositId, contractId }, select: DEPOSIT_SELECT }),
  ]);
  if (!contract || !deposit) return null;
  return {
    contract: toPaymentContract(contract),
    clientId: contract.application.project.draft.clientId,
    deposit: toDepositRecord(deposit),
  };
}

function toPaymentContract(contract: PaymentContractRow): PaymentContract {
  return {
    id: contract.id,
    applicationId: contract.applicationId,
    status: contract.status,
    paymentStatus: contract.paymentStatus,
    agreedAmount: contract.agreedAmount,
    clientFee: contract.clientFee,
    totalDeposited: contract.totalDeposited,
    clientId: contract.application.project.draft.clientId,
    projectId: contract.application.projectId,
  };
}

function toDepositRecord(deposit: DepositRow): DepositRecord {
  return {
    id: deposit.id,
    contractId: deposit.contractId,
    principal: deposit.principal,
    clientFee: deposit.clientFee,
    amount: deposit.amount,
    status: deposit.status,
    idempotencyKey: deposit.idempotencyKey,
    pgKey: deposit.pgKey,
    depositedAt: deposit.depositedAt,
  };
}
