import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPrismaRepositories } from "../../src/infrastructure/prisma-store.ts";
import { createPrismaDueJobTargets } from "../../src/infrastructure/prisma-due-targets.ts";
import { DepositCompletionService } from "../../src/modules/deposit/index.ts";
import { DeliveryService, InspectionBatchService } from "../../src/modules/delivery/index.ts";
import { CancellationService } from "../../src/modules/cancellation/index.ts";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe("INT-C-04: Prisma 기한 대상·배치", { skip: hasDatabase ? false : "DATABASE_URL 없음" }, () => {
  it("DB 대상 조회와 예치·취소·자동승인·알림 실행", async () => {
    const prisma = new PrismaClient();
    const clientId = randomUUID();
    const supplierId = randomUUID();
    const draftId = randomUUID();
    const projectId = randomUUID();
    const applicationId = randomUUID();
    const contractId = randomUUID();
    const blockId = randomUUID();
    const interimItemId = randomUUID();
    const now = new Date("2026-11-04T05:20:00.000Z");

    try {
      await prisma.user.create({ data: { id: clientId, email: `c-${clientId}@t.local`, role: "CLIENT" } });
      await prisma.user.create({ data: { id: supplierId, email: `s-${supplierId}@t.local`, role: "SUPPLIER" } });
      await prisma.supplierProfile.create({ data: { userId: supplierId, displayName: "공급자", industryCodes: [], skills: [], payoutVerifiedAt: now } });
      await prisma.draft.create({ data: { id: draftId, clientId, entryType: "SENTENCE" } });
      await prisma.project.create({ data: { id: projectId, draftId, confirmedAt: now, disclosureConsentVersion: "v1", title: "t", summary: "s", industryCode: "I", requiredSkills: [] } });
      await prisma.application.create({ data: { id: applicationId, projectId, supplierId, specVersionNo: 1, totalAmount: 3_100_000, durationDays: 42, firstViewedAt: now, status: "ACCEPTED" } });
      await prisma.contract.create({
        data: {
          id: contractId,
          applicationId,
          specVersionNo: 1,
          status: "ACTIVE",
          paymentStatus: "PENDING",
          agreedAmount: 3_100_000,
          durationDays: 42,
          clientFee: 155_000,
          supplierFee: 155_000,
          consentDeadline: now,
          contentHash: "h",
          depositDeadline: new Date(now.getTime() - 60_000),
          workDueAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
          interimRatio: 50,
        },
      });
      await prisma.blockCatalog.create({ data: { id: blockId, code: `b-${blockId}`, name: "블록", functionSummary: "f", description: "d", industryCode: "I", techTags: [], unitPrice: 1_000, priceBasis: "b" } });
      await prisma.contractItem.create({ data: { id: interimItemId, contractId, blockId, title: "중간", description: "d", origin: "AGREEMENT", stage: "INTERIM" } });

      const repos = createPrismaRepositories(prisma);
      const clock = { now: () => now };
      const completion = new DepositCompletionService({
        repo: repos.depositRepository,
        contractsPort: repos.contractsPort,
        marketplacePort: { async autoRejectCompetingApplications() { return { rejectedCount: 0 }; } },
        clock,
      });
      const cancellation = new CancellationService({ repo: repos.cancellationRepository, clock });
      const notifications: Array<{ userId: string; type: string }> = [];
      const batch = new InspectionBatchService({
        repo: repos.deliveryRepository,
        notificationPorts: {
          async createOnce(input) {
            notifications.push({ userId: input.userId, type: input.type });
            return { created: true };
          },
        },
        clock,
      });
      const targets = createPrismaDueJobTargets(prisma);

      // 기한 대상 조회
      assert.ok((await targets.depositContractIds!(now)).includes(contractId));
      assert.ok((await targets.notificationContractIds!(now)).includes(contractId));

      // 예치 기한 경과 + 입금 시도 없음 → 계약 결렬
      assert.equal((await completion.expireDepositIfDue(contractId, now)).expired, true);
      assert.equal((await repos.settlementRepository.getContract(contractId))?.status, "CANCELLED");

      // 취소 3일 무응답 → 운영자 대기
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "CANCEL_REQUESTED",
          paymentStatus: "PENDING",
          cancelRequestedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          cancelCause: "CLIENT",
          cancelRequestedBy: clientId,
          cancelNote: "취소",
          cancelResolvedAt: null,
          cancelEscalatedAt: null,
        },
      });
      assert.ok((await targets.cancellationContractIds!(now)).includes(contractId));
      assert.equal((await cancellation.checkCancellationDeadlines(contractId, now)).escalatedToAdmin, true);

      // 자동 승인: 활성 계약 + 기한 지난 최신 납품
      await prisma.contract.update({ where: { id: contractId }, data: { status: "ACTIVE" } });
      const interim = await prisma.paymentInstallment.create({
        data: { contractId, stage: "INTERIM", ratio: 50, amount: 1_550_000, supplierFee: 77_500, releaseAmount: 1_472_500, status: "DELIVERED" },
      });
      const delivery = await prisma.delivery.create({
        data: {
          installmentId: interim.id,
          attemptNo: 1,
          items: [{ contractItemId: interimItemId, links: [], files: [], howToCheck: "확인" }],
          status: "SUBMITTED",
          submittedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
          inspectionDueAt: new Date(now.getTime() - 1000),
        },
      });
      assert.ok((await targets.deliveryIds!(now)).includes(delivery.id));
      assert.equal((await batch.processAutoApproval(delivery.id, now)).autoApprovedCount, 1);

      // 기한 안내: 작업 마감 12시간 전 공급자에게 1회
      await batch.sendDueNotifications(contractId, now);
      assert.equal(notifications.filter((row) => row.type === "WORK_DUE").length, 1);
    } finally {
      await prisma.inspectionRequest.deleteMany({ where: { delivery: { installment: { contractId } } } });
      await prisma.delivery.deleteMany({ where: { installment: { contractId } } });
      await prisma.paymentInstallment.deleteMany({ where: { contractId } });
      await prisma.contractItem.deleteMany({ where: { contractId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.application.deleteMany({ where: { id: applicationId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.draft.deleteMany({ where: { id: draftId } });
      await prisma.blockCatalog.deleteMany({ where: { id: blockId } });
      await prisma.supplierProfile.deleteMany({ where: { userId: supplierId } });
      await prisma.user.deleteMany({ where: { id: { in: [clientId, supplierId] } } });
      await prisma.$disconnect();
    }
  });
});
