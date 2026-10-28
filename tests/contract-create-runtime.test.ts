import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { createContractForAcceptedApplication } from "../src/shared/contract-workflow-adapter.ts";
import { prisma } from "../src/db.ts";
import { resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

describe("수락 지원서의 계약 생성 트랜잭션", () => {
  beforeEach(async () => resetDatabase());

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("지원서 소요일수와 양측 구간 선택을 스냅샷에 보존하고 계약 생성 시 쿠폰을 쓰지 않는다", async () => {
    const project = await createProjectFixture({ status: "ACCEPTED" });
    const supplier = await createSupplierFixture();
    const specItemId = project.itemIds[0];
    if (!specItemId) throw new Error("계약 범위 항목이 필요합니다.");
    await prisma.supplierProfile.update({
      where: { userId: supplier.id },
      data: { feeExempt: true },
    });
    const application = await prisma.application.create({
      data: {
        projectId: project.projectId,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 200_000,
        durationDays: 14,
        firstViewedAt: new Date("2026-10-28T00:00:00.000Z"),
        items: { create: [{ specItemId, isAvailable: true, amount: 200_000 }] },
      },
    });

    const contract = await createContractForAcceptedApplication(prisma)({
      applicationId: application.id,
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { [specItemId]: "INTERIM" },
    });

    expect(contract.specSnapshot).toMatchObject({
      durationDays: 14,
      included: [{ specItemId, installmentStage: "INTERIM" }],
    });
    expect(contract.supplierFee).toBe(10_000);
    expect(contract.installments.find(({ stage }) => stage === "INTERIM")).toMatchObject({
      supplierFee: 5_000,
      releaseAmount: 95_000,
    });
    expect(await prisma.supplierProfile.findUniqueOrThrow({
      where: { userId: supplier.id }, select: { feeExemptUsedAt: true },
    })).toEqual({ feeExemptUsedAt: null });
  });
});
