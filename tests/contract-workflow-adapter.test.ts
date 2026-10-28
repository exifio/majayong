import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { prisma } from "../src/db.ts";
import { createContractWorkflowPorts } from "../src/shared/contract-workflow-adapter.ts";
import { resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

describe("Agent B 계약 워크플로 Prisma 포트 어댑터", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("서명 갱신과 A 프로젝트 전이를 같은 Prisma transaction에 넣는다", async () => {
    const project = await createProjectFixture({ status: "ACCEPTED" });
    const supplier = await createSupplierFixture();
    const specItemId = project.itemIds[0];
    if (!specItemId) throw new Error("계약 범위 항목이 필요합니다.");
    const application = await prisma.application.create({
      data: {
        projectId: project.projectId,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 100_000,
        durationDays: 5,
        firstViewedAt: new Date(),
        items: { create: [{ specItemId, isAvailable: true, amount: 100_000 }] },
      },
    });
    const contract = await prisma.contract.create({
      data: {
        applicationId: application.id,
        specVersionNo: 1,
        specSnapshot: { included: [{ specItemId }], excluded: [] },
        agreedAmount: 100_000,
        clientFee: 5_000,
        supplierFee: 5_000,
        contentHash: `sha256:${"a".repeat(64)}`,
        pdfUrl: `contracts/contract/${"a".repeat(64)}.pdf`,
      },
    });
    const ports = createContractWorkflowPorts(prisma);
    const signedAt = new Date("2026-10-27T12:00:00.000Z");

    const result = await ports.transaction(async (tx) => {
      const context = await ports.getAcceptedApplicationContext(tx, application.id);
      expect(context).toMatchObject({ clientId: project.clientId, supplierId: supplier.id, specVersionNo: 1 });
      expect((await ports.getContractParticipants(tx, application.id)))
        .toEqual({ clientId: project.clientId, supplierId: supplier.id });
      const locked = await ports.findContractForUpdate(tx, application.id);
      expect(locked).toMatchObject({ id: contract.id, status: "PENDING_CONSENT", pdfUrl: contract.pdfUrl });
      const updated = await ports.updateContractSignature(tx, contract.id, {
        status: "ACTIVE",
        contentHash: contract.contentHash,
        clientSignedAt: signedAt,
        supplierSignedAt: signedAt,
      });
      await ports.transitionProjectForContract(tx, application.id, {
        type: "CONTRACT_SIGNED",
        actorUserId: supplier.id,
        sessionId: "session-supplier",
      });
      return updated;
    });

    expect(result.status).toBe("ACTIVE");
    expect(await prisma.contract.findUnique({ where: { id: contract.id }, select: { status: true } }))
      .toMatchObject({ status: "ACTIVE" });
    expect(await prisma.project.findUnique({ where: { id: project.projectId }, select: { status: true } }))
      .toMatchObject({ status: "CONTRACTED" });
    expect(await prisma.eventLog.count({ where: { projectId: project.projectId, type: "CONTRACT_AGREED" } })).toBe(1);
  });

  it("취소·완료 등 Application 상태와 무관하게 PDF 당사자 조회를 제공한다", async () => {
    const project = await createProjectFixture({ status: "EXPIRED" });
    const supplier = await createSupplierFixture();
    const application = await prisma.application.create({
      data: {
        projectId: project.projectId,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "REJECTED",
        totalAmount: 100_000,
        durationDays: 5,
        firstViewedAt: new Date(),
      },
    });
    const ports = createContractWorkflowPorts(prisma);
    const participants = await ports.transaction((tx) => ports.getContractParticipants(tx, application.id));

    expect(participants).toEqual({ clientId: project.clientId, supplierId: supplier.id });
  });
});
