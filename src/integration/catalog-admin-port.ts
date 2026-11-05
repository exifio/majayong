import type { Prisma, PrismaClient } from "@prisma/client";
import { AdminHttpError, type CatalogAdminPort } from "../modules/admin-ops/index.js";
import { CatalogError, mergeCatalogBlock, setCatalogBlockActive, updateCatalogBlockPrice } from "../modules/catalog/index.js";

export function createCatalogAdminPort(db: PrismaClient): CatalogAdminPort {
  return {
    async executeBlockAction(input, tx) {
      const clientTx = tx as Prisma.TransactionClient | undefined;
      try {
        switch (input.action) {
          case "UPDATE_PRICE":
            if (input.unitPrice === undefined) throw new AdminHttpError(400, "단가 수정에는 unitPrice가 필요합니다.");
            await updateCatalogBlockPrice(db, { actorId: input.actorId, blockId: input.blockId, unitPrice: input.unitPrice, reason: input.reason }, clientTx);
            break;
          case "MERGE":
            if (!input.mergedIntoId) throw new AdminHttpError(400, "블록 병합에는 mergedIntoId가 필요합니다.");
            await mergeCatalogBlock(db, { actorId: input.actorId, sourceId: input.blockId, targetId: input.mergedIntoId, reason: input.reason }, clientTx);
            break;
          case "DISABLE":
          case "ENABLE":
            await setCatalogBlockActive(db, { actorId: input.actorId, blockId: input.blockId, isActive: input.action === "ENABLE", reason: input.reason }, clientTx);
            break;
          default:
            throw new AdminHttpError(400, "허용되지 않은 블록 액션입니다.");
        }
      } catch (error) {
        if (error instanceof CatalogError) throw new AdminHttpError(error.status, error.code);
        throw error;
      }
      return { success: true, blockId: input.blockId, action: input.action };
    },
  };
}
