import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPrismaRepositories } from "../../src/infrastructure/prisma-store.ts";
import { CancellationHttpError, CancellationService } from "../../src/modules/cancellation/index.ts";
import { DepositCompletionService } from "../../src/modules/deposit/index.ts";
import { DeliveryService } from "../../src/modules/delivery/index.ts";
import { SettlementService } from "../../src/modules/settlement/policy.ts";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe("INT-C-02: Prisma 저장소 골든 패스", { skip: hasDatabase ? false : "DATABASE_URL 없음" }, () => {
  it("예치 확정→구간→납품→검수→지급→완료를 같은 계약으로 연결", async () => {
    const prisma = new PrismaClient();
    const clientId = randomUUID();
    const supplierId = randomUUID();
    const draftId = randomUUID();
    const projectId = randomUUID();
    const applicationId = randomUUID();
    const contractId = randomUUID();
    const blockId = randomUUID();
    const interimItemId = randomUUID();
    const finalItemId = randomUUID();

    try {
      await prisma.user.create({ data: { id: clientId, email: `c-${clientId}@test.local`, role: "CLIENT" } });
      await prisma.user.create({ data: { id: supplierId, email: `s-${supplierId}@test.local`, role: "SUPPLIER" } });
      await prisma.supplierProfile.create({
        data: {
          userId: supplierId,
          displayName: "공급자",
          industryCodes: [],
          skills: [],
          businessType: "BUSINESS",
          payoutVerifiedAt: new Date("2026-11-01T00:00:00Z"),
        },
      });
      await prisma.draft.create({ data: { id: draftId, clientId, entryType: "SENTENCE" } });
      await prisma.project.create({
        data: {
          id: projectId,
          draftId,
          confirmedAt: new Date(),
          disclosureConsentVersion: "v1",
          title: "테스트",
          summary: "테스트",
          industryCode: "I",
          requiredSkills: [],
        },
      });
      await prisma.application.create({
        data: {
          id: applicationId,
          projectId,
          supplierId,
          specVersionNo: 1,
          totalAmount: 3_100_000,
          durationDays: 42,
          firstViewedAt: new Date(),
          status: "ACCEPTED",
        },
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          applicationId,
          specVersionNo: 1,
          status: "ACTIVE",
          agreedAmount: 3_100_000,
          durationDays: 42,
          clientFee: 155_000,
          supplierFee: 155_000,
          consentDeadline: new Date(),
          contentHash: "hash",
          depositDeadline: new Date("2099-01-01T00:00:00Z"),
          interimRatio: 50,
        },
      });
      await prisma.blockCatalog.create({
        data: {
          id: blockId,
          code: `b-${blockId}`,
          name: "블록",
          functionSummary: "f",
          description: "d",
          industryCode: "I",
          techTags: [],
          unitPrice: 1_000,
          priceBasis: "b",
        },
      });
      await prisma.contractItem.createMany({
        data: [
          { id: interimItemId, contractId, blockId, title: "중간", description: "d", origin: "AGREEMENT", stage: "INTERIM" },
          { id: finalItemId, contractId, blockId, title: "최종", description: "d", origin: "AGREEMENT", stage: "FINAL" },
        ],
      });

      const repos = createPrismaRepositories(prisma);
      const clock = { now: () => new Date("2026-11-04T05:20:00.000Z") };
      const completion = new DepositCompletionService({
        repo: repos.depositRepository,
        contractsPort: repos.contractsPort,
        marketplacePort: {
          async autoRejectCompetingApplications() {
            return { rejectedCount: 0 };
          },
        },
        clock,
      });
      const settlement = new SettlementService({ repo: repos.settlementRepository, clock });
      const delivery = new DeliveryService({ repo: repos.deliveryRepository, settlementPort: settlement, clock });

      const deposit = await repos.depositRepository.createDeposit({
        contractId,
        principal: 3_100_000,
        clientFee: 155_000,
        amount: 3_255_000,
        method: "CARD",
        status: "PENDING",
        idempotencyKey: `flow-${contractId}`,
        pgKey: null,
        depositedAt: null,
      });
      await completion.completeDeposit({ depositId: deposit.id, pgKey: "pk-flow" });

      const cancellation = new CancellationService({ repo: repos.cancellationRepository, clock });
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "CANCEL_REQUESTED",
          cancelCause: "CLIENT",
          cancelRequestedBy: clientId,
          cancelRequestedAt: clock.now(),
          cancelNote: "D-16 regression",
        },
      });
      await assert.rejects(
        () =>
          cancellation.agreeCancellation(
            { userId: supplierId, role: "SUPPLIER" },
            { contractId },
          ),
        (err: unknown) =>
          err instanceof CancellationHttpError && err.status === 409 && err.message === "D16_BLOCKED",
      );
      const blockedCancellation = await prisma.contract.findUnique({ where: { id: contractId } });
      assert.equal(blockedCancellation?.status, "CANCEL_REQUESTED");
      assert.equal(blockedCancellation?.cancelResolution, null);
      assert.equal(blockedCancellation?.refundAmount, null);

      await prisma.contract.update({
        where: { id: contractId },
        data: { cancelEscalatedAt: clock.now() },
      });
      await assert.rejects(
        () =>
          cancellation.decideCancellation({
            contractId,
            compensationRate: 0,
            reason: "D-16 regression",
          }),
        (err: unknown) =>
          err instanceof CancellationHttpError && err.status === 409 && err.message === "D16_BLOCKED",
      );

      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "ACTIVE",
          cancelCause: null,
          cancelRequestedBy: null,
          cancelRequestedAt: null,
          cancelNote: null,
          cancelEscalatedAt: null,
        },
      });

      const installments = await repos.settlementRepository.listInstallments(contractId);
      assert.equal(installments.length, 2);
      const interim = installments.find((row) => row.stage === "INTERIM")!;
      const final = installments.find((row) => row.stage === "FINAL")!;

      const d1 = await delivery.submitDelivery(
        { userId: supplierId, role: "SUPPLIER" },
        { installmentId: interim.id, items: [{ contractItemId: interimItemId, links: [], files: [], howToCheck: "확인" }] },
      );
      await delivery.approveItem(
        { userId: clientId, role: "CLIENT" },
        { contractItemId: interimItemId, deliveryId: d1.id },
      );
      assert.equal((await settlement.releaseInstallment({ installmentId: interim.id })).status, "RELEASED");

      const d2 = await delivery.submitDelivery(
        { userId: supplierId, role: "SUPPLIER" },
        { installmentId: final.id, items: [{ contractItemId: finalItemId, links: [], files: [], howToCheck: "확인" }] },
      );
      await delivery.approveItem(
        { userId: clientId, role: "CLIENT" },
        { contractItemId: finalItemId, deliveryId: d2.id },
      );
      assert.equal((await settlement.releaseInstallment({ installmentId: final.id })).status, "RELEASED");
      assert.equal((await repos.settlementRepository.getContract(contractId))?.status, "COMPLETED");

      // 파일 메타데이터가 Prisma에 저장되고 문의 첨부 건수로 쓰인다.
      const file = await repos.fileRepository.saveFileMetadata({
        purpose: "SUPPORT_INQUIRY",
        inquiryId: "inquiry-1",
        uploaderId: clientId,
        objectKey: `inquiry/inquiry-1/${randomUUID()}/a.pdf`,
        fileName: "a.pdf",
        fileSize: 10,
        mimeType: "application/pdf",
      });
      assert.equal((await repos.fileRepository.getFileMetadata(file.id))?.fileSize, 10);
      assert.equal(await repos.fileRepository.countFilesInquiry("inquiry-1"), 1);
    } finally {
      await prisma.fileAttachment.deleteMany({ where: { uploaderId: clientId } });
      await prisma.inspectionRequest.deleteMany({ where: { delivery: { installment: { contractId } } } });
      await prisma.delivery.deleteMany({ where: { installment: { contractId } } });
      await prisma.paymentEvent.deleteMany({ where: { deposit: { contractId } } });
      await prisma.paymentInstallment.deleteMany({ where: { contractId } });
      await prisma.escrowDeposit.deleteMany({ where: { contractId } });
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
