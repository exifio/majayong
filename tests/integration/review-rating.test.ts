import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl } from "../test-db.ts";
import { createPrismaRepositories } from "../../src/infrastructure/prisma-store.ts";
import { ReviewService } from "../../src/modules/review/index.ts";
import { createProfileRatingPort } from "../../src/modules/profile/api.ts";

const hasDatabase = Boolean(testDatabaseUrl());

describe("INT-C-07: 리뷰 생성과 A 평점 캐시 PG 트랜잭션", { skip: hasDatabase ? false : "DATABASE_URL 없음" }, () => {
  it("완료 계약 리뷰 생성 시 supplier profile 평점/리뷰 수가 같은 트랜잭션에서 갱신된다", async () => {
    const prisma = new PrismaClient();
    const clientId = randomUUID();
    const supplierId = randomUUID();
    const draftId = randomUUID();
    const projectId = randomUUID();
    const applicationId = randomUUID();
    const contractId = randomUUID();

    try {
      await prisma.user.createMany({
        data: [
          { id: clientId, email: `c-${clientId}@test.local`, role: "CLIENT" },
          { id: supplierId, email: `s-${supplierId}@test.local`, role: "SUPPLIER" },
        ],
      });
      await prisma.supplierProfile.create({ data: { userId: supplierId, displayName: "공급자" } });
      await prisma.draft.create({ data: { id: draftId, clientId, entryType: "SENTENCE" } });
      await prisma.project.create({
        data: { id: projectId, draftId, confirmedAt: new Date(), disclosureConsentVersion: "v1", title: "t", summary: "s", industryCode: "I" },
      });
      await prisma.application.create({
        data: { id: applicationId, projectId, supplierId, specVersionNo: 1, totalAmount: 1000, durationDays: 10, firstViewedAt: new Date(), status: "ACCEPTED" },
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          applicationId,
          specVersionNo: 1,
          status: "COMPLETED",
          paymentStatus: "RELEASED",
          agreedAmount: 1000,
          durationDays: 10,
          clientFee: 50,
          supplierFee: 50,
          consentDeadline: new Date("2026-11-01T00:00:00Z"),
          contentHash: "h",
        },
      });

      const repos = createPrismaRepositories(prisma);
      const ratingPort = createProfileRatingPort(prisma);
      const profilePorts = {
        async updateProfileReviewStats(input: { targetUserId: string; rating: number }, tx?: unknown) {
          await ratingPort.refresh(input.targetUserId, tx as any);
          return { success: true };
        },
      };
      const service = new ReviewService({
        repo: repos.reviewRepository,
        profilePorts,
        clock: { now: () => new Date("2026-11-04T00:00:00.000Z") },
        transactionRunner: { run: (work) => prisma.$transaction((tx) => work(tx)) },
      });

      await service.createReview(
        { userId: clientId, role: "CLIENT" },
        { contractId, rating: 4, comment: "좋았어요" },
      );

      const profile = await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: supplierId } });
      assert.equal(profile.reviewCount, 1);
      assert.equal(profile.ratingAvg, 4);
    } finally {
      await prisma.review.deleteMany({ where: { contractId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.application.deleteMany({ where: { id: applicationId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.draft.deleteMany({ where: { id: draftId } });
      await prisma.supplierProfile.deleteMany({ where: { userId: supplierId } });
      await prisma.user.deleteMany({ where: { id: { in: [clientId, supplierId] } } });
      await prisma.$disconnect();
    }
  });
});