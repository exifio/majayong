import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { prisma } from "../src/db.ts";
import { transitionProjectForContract } from "../src/shared/contract-bridge.ts";
import { resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

describe("계약 취소 프로젝트 전이", () => {
  beforeEach(async () => resetDatabase());

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("지원서를 거절하고 모집으로 복귀할 때 취소 시각을 모집 공개 시각으로 쓴다", async () => {
    const project = await createProjectFixture({ status: "CONTRACTED", published: false });
    const supplier = await createSupplierFixture();
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
      },
    });
    const cancelledAt = new Date("2026-10-28T12:00:00.000Z");

    await prisma.$transaction((tx) =>
      transitionProjectForContract(tx, application.id, {
        type: "CONTRACT_CANCELLED",
        actorUserId: "operator-1",
        sessionId: "session-operator",
        cancelledAt,
      }),
    );

    expect(await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
      select: { status: true },
    })).toEqual({ status: "REJECTED" });
    expect(await prisma.project.findUniqueOrThrow({
      where: { id: project.projectId },
      select: { status: true, publishedAt: true },
    })).toEqual({ status: "RECRUITING", publishedAt: cancelledAt });
  });
});
