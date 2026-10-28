import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Server } from "node:http";
import { createTradeApiRouter } from "../src/contracts/trade.router.ts";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { createCancellationWorkflowPorts } from "../src/shared/cancellation-workflow-adapter.ts";
import { createCancellationWorkflow } from "../src/trade/cancellation-workflow.ts";
import { getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

const activatedAt = new Date("2026-10-28T00:00:00.000Z");
const cancelledAt = new Date("2026-10-28T12:00:00.000Z");

async function createCancellationFixture(
  projectStatus: "CONTRACTED" | "EXPIRED" = "CONTRACTED",
  deposited = true,
) {
  const project = await createProjectFixture({ status: projectStatus, published: false });
  const supplier = await createSupplierFixture();
  const application = await prisma.application.create({
    data: {
      projectId: project.projectId,
      supplierId: supplier.id,
      revisionNo: 1,
      specVersionNo: 1,
      status: "ACCEPTED",
      totalAmount: 1_000_000,
      durationDays: 14,
      firstViewedAt: activatedAt,
    },
  });
  const suffix = `${project.projectId}-${supplier.id}`;
  const contract = await prisma.contract.create({
    data: {
      applicationId: application.id,
      status: "ACTIVE",
      specVersionNo: 1,
      specSnapshot: { included: [], excluded: [] },
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      supplierFee: 50_000,
      clientSignedAt: activatedAt,
      supplierSignedAt: activatedAt,
      paymentStatus: deposited ? "DEPOSITED" : "PENDING",
      totalDeposited: deposited ? 1_050_000 : 0,
      installments: {
        create: [
          { stage: "INTERIM", ratio: 50, amount: 500_000, supplierFee: 25_000, releaseAmount: 475_000 },
          { stage: "FINAL", ratio: 50, amount: 500_000, supplierFee: 25_000, releaseAmount: 475_000 },
        ],
      },
      ...(deposited ? { deposits: {
        create: {
          principal: 1_000_000,
          clientFee: 50_000,
          amount: 1_050_000,
          status: "COMPLETED",
          idempotencyKey: `cancel-${suffix}`,
          pgKey: `pg-${suffix}`,
          depositedAt: activatedAt,
        },
      } } : {}),
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `admin-${suffix}@test.local`,
      name: "운영자",
      role: "ADMIN",
    },
  });
  return { project, supplier, application, contract, admin };
}

function createWorkflow() {
  return createCancellationWorkflow(createCancellationWorkflowPorts(prisma), () => cancelledAt);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe("취소 workflow Prisma 통합", () => {
  beforeEach(async () => resetDatabase());

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("동시 동일 취소 요청을 한 번만 저장하고 이벤트도 한 건 남긴다", async () => {
    const { project, contract } = await createCancellationFixture();
    const workflow = createWorkflow();
    const input = {
      contractId: contract.id,
      actor: { userId: project.clientId, role: "CLIENT" as const, sessionId: "session-client" },
      reason: "일정 변경",
    };

    const results = await Promise.all([
      workflow.requestCancellation(input),
      workflow.requestCancellation(input),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id },
      select: {
        cancelRequestedBy: true,
        cancelRequestedParty: true,
        cancelReason: true,
        cancelRequestedAt: true,
      },
    })).toEqual({
      cancelRequestedBy: project.clientId,
      cancelRequestedParty: "CLIENT",
      cancelReason: "일정 변경",
      cancelRequestedAt: cancelledAt,
    });
    const requestEvent = await prisma.eventLog.findFirstOrThrow({
      where: { projectId: project.projectId, type: "CANCELLATION_REQUESTED" },
    });
    expect(requestEvent).toMatchObject({
      userId: project.clientId,
      payload: {
        contractId: contract.id,
        requestedBy: project.clientId,
        party: "CLIENT",
        reason: "일정 변경",
        requestedAt: cancelledAt.toISOString(),
      },
    });
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id }, select: { status: true },
    })).toEqual({ status: "ACTIVE" });
    expect(await prisma.eventLog.count({
      where: { projectId: project.projectId, type: "CANCELLATION_REQUESTED" },
    })).toBe(1);
  });

  it("서로 다른 당사자의 동시 취소 요청 중 하나만 저장한다", async () => {
    const { project, supplier, contract } = await createCancellationFixture();
    const workflow = createWorkflow();
    const results = await Promise.allSettled([
      workflow.requestCancellation({
        contractId: contract.id,
        actor: { userId: project.clientId, role: "CLIENT" },
        reason: "의뢰인 사유",
      }),
      workflow.requestCancellation({
        contractId: contract.id,
        actor: { userId: supplier.id, role: "SUPPLIER" },
        reason: "공급자 사유",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (!rejected || rejected.status !== "rejected") throw new Error("두 번째 취소 요청은 거부되어야 합니다.");
    expect(rejected.reason).toHaveProperty("code", "CANCELLATION_ALREADY_REQUESTED");
    expect(await prisma.eventLog.count({
      where: { projectId: project.projectId, type: "CANCELLATION_REQUESTED" },
    })).toBe(1);
  });

  it("관리자 확정은 환불 기록과 지원 거절·모집 복귀를 한 번에 반영한다", async () => {
    const { project, application, contract, admin } = await createCancellationFixture();
    const workflow = createWorkflow();
    await workflow.requestCancellation({
      contractId: contract.id,
      actor: { userId: project.clientId, role: "CLIENT" },
      reason: "일정 변경",
    });

    const result = await workflow.processCancellation({
      contractId: contract.id,
      actor: { userId: admin.id, role: "ADMIN", sessionId: "session-admin" },
      party: "CLIENT",
      reason: "양측 확인 후 취소",
    });

    expect(result).toMatchObject({
      refundAmount: 1_050_000,
      clientFeeRefund: 50_000,
      supplierCompensation: 0,
      cancelledAt,
    });
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id },
      select: {
        status: true,
        paymentStatus: true,
        refundAmount: true,
        clientFeeRefund: true,
        settledAmount: true,
        refundReason: true,
      },
    })).toEqual({
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      refundAmount: 1_050_000,
      clientFeeRefund: 50_000,
      settledAmount: 0,
      refundReason: "양측 확인 후 취소",
    });
    expect(await prisma.paymentInstallment.findMany({
      where: { contractId: contract.id },
      select: { stage: true, status: true },
      orderBy: { stage: "asc" },
    })).toEqual([
      { stage: "INTERIM", status: "REFUNDED" },
      { stage: "FINAL", status: "REFUNDED" },
    ]);
    expect(await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
      select: { status: true },
    })).toEqual({ status: "REJECTED" });
    expect(await prisma.project.findUniqueOrThrow({
      where: { id: project.projectId },
      select: { status: true, publishedAt: true },
    })).toEqual({ status: "RECRUITING", publishedAt: cancelledAt });
    expect(await prisma.eventLog.count({
      where: { projectId: project.projectId, type: "REFUND_PROCESSED" },
    })).toBe(1);
  });

  it("예치 전 취소는 환불 이벤트 없이 상태만 취소하고 지원 거절·모집 복귀를 반영한다", async () => {
    const { project, application, contract, admin } = await createCancellationFixture("CONTRACTED", false);
    const workflow = createWorkflow();
    await workflow.requestCancellation({
      contractId: contract.id,
      actor: { userId: project.clientId, role: "CLIENT" },
      reason: "예치 전 취소 요청",
    });

    const result = await workflow.processCancellation({
      contractId: contract.id,
      actor: { userId: admin.id, role: "ADMIN", sessionId: "session-admin" },
      party: "CLIENT",
      reason: "예치 전 취소 확정",
    });

    expect(result).toMatchObject({ refundAmount: 0, clientFeeRefund: 0, supplierCompensation: 0 });
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id },
      select: { status: true, paymentStatus: true, refundAmount: true, clientFeeRefund: true, settledAmount: true },
    })).toEqual({
      status: "CANCELLED",
      paymentStatus: "PENDING",
      refundAmount: 0,
      clientFeeRefund: 0,
      settledAmount: 0,
    });
    expect(await prisma.paymentInstallment.findMany({
      where: { contractId: contract.id }, select: { status: true }, orderBy: { stage: "asc" },
    })).toEqual([{ status: "PENDING" }, { status: "PENDING" }]);
    expect(await prisma.escrowDeposit.count({ where: { contractId: contract.id } })).toBe(0);
    expect(await prisma.eventLog.count({ where: { projectId: project.projectId, type: "REFUND_PROCESSED" } })).toBe(0);
    expect(await prisma.eventLog.count({ where: { projectId: project.projectId, type: "CANCELLATION_REQUESTED" } })).toBe(1);
    expect(await prisma.application.findUniqueOrThrow({
      where: { id: application.id }, select: { status: true },
    })).toEqual({ status: "REJECTED" });
    expect(await prisma.project.findUniqueOrThrow({
      where: { id: project.projectId }, select: { status: true, publishedAt: true },
    })).toEqual({ status: "RECRUITING", publishedAt: cancelledAt });
  });

  it("프로젝트 전이가 실패하면 환불·이벤트·구간 변경도 롤백한다", async () => {
    const { project, application, contract, admin } = await createCancellationFixture("EXPIRED");
    const workflow = createWorkflow();

    await expect(workflow.processCancellation({
      contractId: contract.id,
      actor: { userId: admin.id, role: "ADMIN" },
      party: "CLIENT",
      reason: "취소",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id },
      select: { status: true, paymentStatus: true, refundAmount: true },
    })).toEqual({ status: "ACTIVE", paymentStatus: "DEPOSITED", refundAmount: null });
    expect(await prisma.paymentInstallment.count({ where: { contractId: contract.id, status: "PENDING" } })).toBe(2);
    expect(await prisma.application.findUniqueOrThrow({
      where: { id: application.id }, select: { status: true },
    })).toEqual({ status: "ACCEPTED" });
    expect(await prisma.project.findUniqueOrThrow({
      where: { id: project.projectId }, select: { status: true },
    })).toEqual({ status: "EXPIRED" });
    expect(await prisma.eventLog.count({ where: { projectId: project.projectId, type: "REFUND_PROCESSED" } })).toBe(0);
  });

  it("동시 취소 확정은 환불과 모집 복귀를 한 번만 처리한다", async () => {
    const { project, application, contract, admin } = await createCancellationFixture();
    const workflow = createWorkflow();
    const input = {
      contractId: contract.id,
      actor: { userId: admin.id, role: "ADMIN" as const, sessionId: "session-admin" },
      party: "CLIENT" as const,
      reason: "양측 확인 후 취소",
    };

    const results = await Promise.allSettled([
      workflow.processCancellation(input),
      workflow.processCancellation(input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (!rejected || rejected.status !== "rejected") throw new Error("중복 취소 확정은 거부되어야 합니다.");
    expect(rejected.reason).toHaveProperty("code", "CONTRACT_NOT_ACTIVE");
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: contract.id }, select: { status: true, refundAmount: true },
    })).toEqual({ status: "CANCELLED", refundAmount: 1_050_000 });
    expect(await prisma.eventLog.count({
      where: { projectId: project.projectId, type: "REFUND_PROCESSED" },
    })).toBe(1);
    expect(await prisma.application.findUniqueOrThrow({
      where: { id: application.id }, select: { status: true },
    })).toEqual({ status: "REJECTED" });
  });

  it("/api/contracts에 취소 요청 route를 mount하고 다른 당사자의 중복 요청을 409로 반환한다", async () => {
    const { project, supplier, contract } = await createCancellationFixture();
    let actor: { userId: string; role: "CLIENT" | "SUPPLIER"; sessionId: string } = {
      userId: project.clientId,
      role: "CLIENT",
      sessionId: "session-client",
    };
    const app = createApp({
      prismaClient: prisma,
      authVerifier: () => actor,
      extraRouters: [createTradeApiRouter({ prismaClient: prisma })],
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));

    try {
      const url = `http://127.0.0.1:${getServerPort(server)}/api/contracts/${contract.id}/cancellation-requests`;
      const first = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "일정 변경" }),
      });
      expect(first.status).toBe(200);

      actor = { userId: supplier.id, role: "SUPPLIER", sessionId: "session-supplier" };
      const second = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "공급자 사정" }),
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: { code: "CONFLICT" } });
    } finally {
      await closeServer(server);
    }
  });
});
