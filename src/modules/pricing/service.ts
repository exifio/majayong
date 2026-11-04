import { DraftStatus, Prisma, PrismaClient } from "@prisma/client";
import { DraftError } from "../draft/rules.js";
import { calculatePriceEstimate, type PriceEstimate } from "./policy.js";

const priceReportDraft = {
  blocks: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { block: { select: { name: true, priceBasis: true } } },
  },
} satisfies Prisma.DraftInclude;

async function readPriceReport(
  tx: Prisma.TransactionClient,
  draftId: string,
  clientId: string,
): Promise<PriceEstimate> {
  const draft = await tx.draft.findFirst({
    where: { id: draftId, clientId, deletedAt: null },
    select: {
      status: true,
      pendingFeatures: true,
      blocks: {
        ...priceReportDraft.blocks,
      },
    },
  });
  if (!draft) throw new DraftError("DRAFT_NOT_FOUND", 404);
  if (draft.status === DraftStatus.CONFIRMED) throw new DraftError("DRAFT_ALREADY_CONFIRMED", 409);

  return calculatePriceEstimate(draft.blocks.map(block => ({
    blockId: block.blockId,
    name: block.block.name,
    status: block.status,
    unitPrice: block.unitPrice,
    priceBasis: block.block.priceBasis,
  })), Array.isArray(draft.pendingFeatures) ? draft.pendingFeatures.length : 0);
}

export async function getPriceReport(db: PrismaClient, draftId: string, clientId: string): Promise<PriceEstimate> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
    return readPriceReport(tx, draftId, clientId);
  });
}

export async function applyEstimateToBudget(
  db: PrismaClient,
  draftId: string,
  clientId: string,
  now: Date,
): Promise<{ hopeBudget: number; estimatedTotal: number }> {
  if (Number.isNaN(now.getTime())) throw new DraftError("INVALID_TIME", 500);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
    const report = await readPriceReport(tx, draftId, clientId);
    const draft = await tx.draft.findFirst({
      where: { id: draftId, clientId, deletedAt: null },
      select: { status: true },
    });
    if (!draft) throw new DraftError("DRAFT_NOT_FOUND", 404);
    if (draft.status !== DraftStatus.IN_PROGRESS) throw new DraftError("DRAFT_NOT_IN_PROGRESS", 409);
    await tx.draft.update({ where: { id: draftId }, data: { hopeBudget: report.estimatedTotal, lastActiveAt: now } });
    return { hopeBudget: report.estimatedTotal, estimatedTotal: report.estimatedTotal };
  });
}
