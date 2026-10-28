import { EventType, Prisma, Role, type PrismaClient } from "@prisma/client";
import type { DbTx } from "../db.ts";
import type { ReviewWorkflowPorts } from "../trade/review-workflow.ts";
import { TradeError } from "../trade/errors.ts";
import { logEvent } from "./events.ts";

interface LockedProfile {
  ratingAvg: number | null;
  reviewCount: number;
}

export function createReviewWorkflowPorts(prismaClient: PrismaClient): ReviewWorkflowPorts<DbTx> {
  return {
    transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T> {
      return prismaClient.$transaction((tx) => work(tx));
    },
    async findReviewContext(tx, contractId) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`,
      );
      if (!locked[0]) return null;
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          status: true,
          completedAt: true,
          application: {
            select: {
              supplierId: true,
              project: { select: { draft: { select: { clientId: true } } } },
            },
          },
        },
      });
      return contract
        ? {
            contract: { id: contract.id, status: contract.status, completedAt: contract.completedAt },
            participants: {
              clientId: contract.application.project.draft.clientId,
              supplierId: contract.application.supplierId,
            },
          }
        : null;
    },
    async listReviewerIds(tx, contractId) {
      const reviews = await tx.review.findMany({
        where: { contractId },
        select: { reviewerId: true },
      });
      return reviews.map((review) => review.reviewerId);
    },
    async findRevieweeProfileForUpdate(tx, revieweeId) {
      const role = await getUserRole(tx, revieweeId);
      if (role === Role.CLIENT) {
        const rows = await tx.$queryRaw<LockedProfile[]>(
          Prisma.sql`SELECT "ratingAvg", "reviewCount" FROM client_profiles WHERE "userId" = ${revieweeId} FOR UPDATE`,
        );
        return rows[0] ?? null;
      }
      if (role === Role.SUPPLIER) {
        const rows = await tx.$queryRaw<LockedProfile[]>(
          Prisma.sql`SELECT "ratingAvg", "reviewCount" FROM supplier_profiles WHERE "userId" = ${revieweeId} FOR UPDATE`,
        );
        return rows[0] ?? null;
      }
      return null;
    },
    async createReview(tx, review) {
      const created = await tx.review.create({
        data: {
          ...review,
          reviewerRole: review.reviewerRole === "CLIENT" ? Role.CLIENT : Role.SUPPLIER,
        },
      });
      if (created.reviewerRole !== Role.CLIENT && created.reviewerRole !== Role.SUPPLIER) {
        throw new TradeError("INVALID_REVIEW_ROLE");
      }
      return { ...created, reviewerRole: review.reviewerRole };
    },
    async updateRevieweeProfile(tx, revieweeId, profile) {
      const role = await getUserRole(tx, revieweeId);
      if (role === Role.CLIENT) {
        await tx.clientProfile.update({ where: { userId: revieweeId }, data: profile });
        return;
      }
      if (role === Role.SUPPLIER) {
        await tx.supplierProfile.update({ where: { userId: revieweeId }, data: profile });
        return;
      }
      throw new TradeError("REVIEW_PROFILE_NOT_FOUND");
    },
    async recordReviewEvent(tx, event) {
      const contract = await tx.contract.findUnique({
        where: { id: event.payload.contractId },
        select: { application: { select: { projectId: true } } },
      });
      if (!contract) throw new TradeError("CONTRACT_NOT_FOUND");
      await logEvent(tx, {
        type: EventType.REVIEW_SUBMITTED,
        userId: event.userId,
        projectId: contract.application.projectId,
        payload: event.payload,
      });
    },
  };
}

async function getUserRole(tx: DbTx, userId: string): Promise<Role | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role ?? null;
}
