import { EventType, Prisma, PrismaClient, Role } from "@prisma/client";
import { sanitizeUserText } from "../../core/privacy.js";
import { CatalogError } from "./errors.js";

type CatalogMutation = { actorId: string; reason: string };
type CatalogPriceUpdate = CatalogMutation & { blockId: string; unitPrice: number };
type CatalogMerge = CatalogMutation & { sourceId: string; targetId: string };
type CatalogActivation = CatalogMutation & { blockId: string; isActive: boolean };
type CatalogTx = Prisma.TransactionClient;

async function requireAdmin(tx: CatalogTx, actorId: string): Promise<string[]> {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, email: true, name: true } });
  if (!actor || actor.role !== Role.ADMIN) throw new CatalogError("ADMIN_REQUIRED", 403);
  return [actor.email, actor.name ?? ""];
}

function requiredReason(reason: unknown, privateValues: string[]): string {
  if (typeof reason !== "string" || !reason.trim()) throw new CatalogError("REASON_REQUIRED", 400);
  return sanitizeUserText(reason.trim(), privateValues);
}

function validatePrice(unitPrice: number): void {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 2_147_483_647) {
    throw new CatalogError("INVALID_UNIT_PRICE", 400);
  }
}

function withTransaction<T>(
  db: PrismaClient,
  existingTx: CatalogTx | undefined,
  work: (tx: CatalogTx) => Promise<T>,
): Promise<T> {
  return existingTx === undefined ? db.$transaction(work) : work(existingTx);
}

async function lockBlock(tx: CatalogTx, blockId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM block_catalog WHERE id = ${blockId} FOR UPDATE`;
}

export async function updateCatalogBlockPrice(db: PrismaClient, input: CatalogPriceUpdate, existingTx?: CatalogTx) {
  return withTransaction(db, existingTx, async tx => {
    const privateValues = await requireAdmin(tx, input.actorId);
    validatePrice(input.unitPrice);
    const reason = requiredReason(input.reason, privateValues);
    await lockBlock(tx, input.blockId);
    const block = await tx.blockCatalog.findUnique({ where: { id: input.blockId } });
    if (!block) throw new CatalogError("CATALOG_BLOCK_NOT_FOUND", 404);
    const updated = await tx.blockCatalog.update({
      where: { id: input.blockId },
      data: { unitPrice: input.unitPrice, priceUpdatedAt: new Date() },
    });
    await tx.eventLog.create({
      data: {
        userId: input.actorId,
        type: EventType.BLOCK_PRICE_UPDATED,
        payload: {
          blockId: input.blockId,
          before: block.unitPrice,
          after: input.unitPrice,
          reason,
        },
      },
    });
    return updated;
  });
}

export async function mergeCatalogBlock(db: PrismaClient, input: CatalogMerge, existingTx?: CatalogTx) {
  return withTransaction(db, existingTx, async tx => {
    const privateValues = await requireAdmin(tx, input.actorId);
    const reason = requiredReason(input.reason, privateValues);
    if (input.sourceId === input.targetId) throw new CatalogError("INVALID_CATALOG_MERGE", 409);
    for (const blockId of [input.sourceId, input.targetId].sort()) await lockBlock(tx, blockId);
    const source = await tx.blockCatalog.findUnique({ where: { id: input.sourceId } });
    const target = await tx.blockCatalog.findUnique({ where: { id: input.targetId } });
    if (!source || !target) throw new CatalogError("CATALOG_BLOCK_NOT_FOUND", 404);
    if (source.industryCode !== target.industryCode || source.mergedIntoId !== null || !target.isActive || target.mergedIntoId !== null) {
      throw new CatalogError("INVALID_CATALOG_MERGE", 409);
    }
    const merged = await tx.blockCatalog.update({
      where: { id: source.id },
      data: { mergedIntoId: target.id, isActive: false },
    });
    await tx.eventLog.create({
      data: {
        userId: input.actorId,
        type: EventType.BLOCK_MERGED,
        payload: { blockId: source.id, into: target.id, reason },
      },
    });
    return merged;
  });
}

export async function setCatalogBlockActive(db: PrismaClient, input: CatalogActivation, existingTx?: CatalogTx) {
  return withTransaction(db, existingTx, async tx => {
    const privateValues = await requireAdmin(tx, input.actorId);
    const reason = requiredReason(input.reason, privateValues);
    if (typeof input.isActive !== "boolean") throw new CatalogError("INVALID_ACTIVE_STATE", 400);
    await lockBlock(tx, input.blockId);
    const block = await tx.blockCatalog.findUnique({ where: { id: input.blockId } });
    if (!block) throw new CatalogError("CATALOG_BLOCK_NOT_FOUND", 404);
    if (block.mergedIntoId !== null && input.isActive) throw new CatalogError("MERGED_BLOCK_CANNOT_BE_ACTIVATED", 409);
    if (block.isActive === input.isActive) return block;
    const updated = await tx.blockCatalog.update({ where: { id: input.blockId }, data: { isActive: input.isActive } });
    await tx.eventLog.create({
      data: {
        userId: input.actorId,
        type: EventType.BLOCK_DEACTIVATED,
        payload: { blockId: input.blockId, isActive: input.isActive, reason },
      },
    });
    return updated;
  });
}
