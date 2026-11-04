import { ContractStatus, Prisma, PrismaClient } from "@prisma/client";
import type { WithdrawalStore } from "./auth.js";

export function createPrismaWithdrawalStore(db: PrismaClient): WithdrawalStore {
  return {
    async withdrawIfNoBlockingContracts(userId, withdrawnAt) {
      return db.$transaction(async tx => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { withdrawnAt: true } });
        if (!user) return "NOT_FOUND";
        if (user.withdrawnAt) return "ALREADY_WITHDRAWN";
        const activeContracts = await tx.contract.count({
          where: {
            status: { in: [ContractStatus.PENDING_CONSENT, ContractStatus.ACTIVE, ContractStatus.CANCEL_REQUESTED] },
            application: {
              OR: [
                { supplierId: userId },
                { project: { draft: { clientId: userId } } },
              ],
            },
          },
        });
        if (activeContracts) return "BLOCKED";
        const updated = await tx.user.updateMany({
          where: { id: userId, withdrawnAt: null },
          data: { withdrawnAt },
        });
        if (updated.count !== 1) return "CHANGED";
        await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: withdrawnAt } });
        return "WITHDRAWN";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
  };
}
