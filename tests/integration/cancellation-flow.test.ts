import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl } from "../test-db.ts";
import { createPrismaRepositories } from "../../src/infrastructure/prisma-store.ts";
import { CancellationService } from "../../src/modules/cancellation/index.ts";

const hasDatabase = Boolean(testDatabaseUrl());

describe("INT-C-06: 취소 요청→이의→운영자 판정→수동 처리 PG 흐름", { skip: hasDatabase ? false : "DATABASE_URL 없음" }, () => {
  it("공급자 사정 취소를 이의·운영자 판정·수동 처리까지 하나의 PostgreSQL 시나리오로 연결", async () => {
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
          status: "ACTIVE",
          paymentStatus: "DEPOSITED",
          agreedAmount: 1000,
          durationDays: 10,
          clientFee: 50,
          supplierFee: 50,
          consentDeadline: new Date("2026-11-01T00:00:00Z"),
          contentHash: "h",
          totalDeposited: 1050,
        },
      });
      await prisma.escrowDeposit.create({
        data: {
          id: randomUUID(),
          contractId,
          principal: 1000,
          clientFee: 50,
          amount: 1050,
          idempotencyKey: `cancel-${contractId}`,
          status: "COMPLETED",
          depositedAt: new Date("2026-11-01T00:00:00Z"),
        },
      });
      await prisma.paymentInstallment.createMany({
        data: [
          { id: randomUUID(), contractId, stage: "INTERIM", ratio: 50, amount: 500, supplierFee: 25, releaseAmount: 475, status: "PENDING" },
          { id: randomUUID(), contractId, stage: "FINAL", ratio: 50, amount: 500, supplierFee: 25, releaseAmount: 475, status: "PENDING" },
        ],
      });

      const repos = createPrismaRepositories(prisma);
      const clock = { now: () => new Date("2026-11-02T00:00:00.000Z") };
      const service = new CancellationService({ repo: repos.cancellationRepository, clock });

      const requested = await service.requestCancellation(
        { userId: supplierId, role: "SUPPLIER" },
        { contractId, cause: "SUPPLIER", note: "공급자 사정" },
      );
      assert.equal(requested.status, "CANCEL_REQUESTED");
      assert.equal(requested.cancelCause, "SUPPLIER");

      const objected = await service.objectCancellation(
        { userId: clientId, role: "CLIENT" },
        { contractId, objectionRate: 30, note: "이의" },
      );
      assert.equal(objected.cancelEscalatedAt instanceof Date, true);

      await prisma.contract.update({ where: { id: contractId }, data: { cancelEscalatedAt: clock.now() } });

      const decided = await service.decideCancellation({
        contractId,
        compensationRate: 40,
        reason: "운영자 판정",
      });
      assert.equal(decided.cancelResolution, "ADMIN_DECIDED");
      assert.equal(decided.compensationRate, 40);
      assert.equal(decided.status, "CANCELLED");

      const processed = await service.markProcessed({
        contractId,
        operatorId: "admin-1",
        refunded: true,
        cancelPayout: true,
      });
      assert.ok(processed.refundedAt);
      assert.ok(processed.cancelPayoutAt);

      const final = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
      assert.equal(final.status, "CANCELLED");
      assert.equal(final.cancelResolution, "ADMIN_DECIDED");
      assert.ok(final.refundedAt);
      assert.ok(final.cancelPayoutAt);
    } finally {
      await prisma.paymentInstallment.deleteMany({ where: { contractId } });
      await prisma.escrowDeposit.deleteMany({ where: { contractId } });
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