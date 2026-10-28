import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Request } from "express";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { createTradeApiRouter } from "../src/contracts/trade.router.ts";
import { createSettlementWorkflowAdapter } from "../src/shared/settlement-workflow-adapter.ts";
import { holdOverdueDeposits } from "../src/shared/payment-workflow-adapter.ts";
import { planCancellationSettlement } from "../src/trade/cancellation.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

const fixedNow = new Date("2026-10-28T12:00:00.000Z");

describe("B 예치·정산 인계의 PostgreSQL 연결", () => {
  beforeEach(async () => resetDatabase());

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("동일 Toss 콜백을 동시에 받아도 원금은 한 번만 반영하고 주문 ID는 입금 ID다", async () => {
    const fixture = await createPaymentFixture();
    let confirmCalls = 0;
    let releaseConfirmations: (() => void) | undefined;
    const bothConfirmations = new Promise<void>((resolve) => { releaseConfirmations = resolve; });
    const app = createPaymentApp(async (input: { orderId: string; amount: number }) => {
      confirmCalls += 1;
      expect(input.orderId).toBe(fixture.depositId);
      if (confirmCalls === 2) releaseConfirmations?.();
      await bothConfirmations;
      return {
        pgKey: "sandbox-payment-1",
        amount: input.amount,
        occurredAt: fixedNow.toISOString(),
        result: "SUCCESS",
        verified: true,
      };
    });
    const server = await listen(app);

    try {
      const start = await post(server, `/api/contracts/${fixture.contractId}/deposits`, fixture.clientId, {
        idempotencyKey: "deposit-idempotency-1",
      });
      const startBody = assertRecord(await start.json());
      expect(start.status).toBe(200);
      expect(startBody.orderId).toBe(startBody.depositId);
      const depositId = String(startBody.depositId);
      fixture.depositId = depositId;

      const url = `/api/contracts/${fixture.contractId}/deposits/${depositId}/confirm`;
      const results = await Promise.all([
        post(server, url, fixture.clientId, {
          paymentKey: "sandbox-payment-1", orderId: depositId, returnedAmount: 105_000,
        }),
        post(server, url, fixture.clientId, {
          paymentKey: "sandbox-payment-1", orderId: depositId, returnedAmount: 105_000,
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual([200, 200]);
      expect(await prisma.contract.findUniqueOrThrow({
        where: { id: fixture.contractId }, select: { totalDeposited: true, paymentStatus: true },
      })).toEqual({ totalDeposited: 105_000, paymentStatus: "DEPOSITED" });
      expect(await prisma.paymentEvent.count({
        where: { depositId, eventType: "VERIFIED" },
      })).toBe(1);
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "PAYMENT_DEPOSITED" },
      })).toBe(1);
      expect(await prisma.paymentEvent.count({
        where: { depositId, eventType: "DUPLICATE_BLOCKED" },
      })).toBe(1);
    } finally {
      await close(server);
    }
  });

  it("7일 지난 입금은 HELD이며 운영자 확정 전 납품을 막고, 확정 이벤트를 같은 DB에 남긴다", async () => {
    const fixture = await createPaymentFixture();
    const deposit = await prisma.escrowDeposit.create({
      data: {
        contractId: fixture.contractId,
        principal: 100_000,
        clientFee: 5_000,
        amount: 105_000,
        idempotencyKey: "overdue-deposit",
        createdAt: new Date(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000 - 1),
      },
    });
    const heldCount = await holdOverdueDeposits(prisma, fixedNow);
    expect(heldCount).toBe(1);
    expect(await prisma.escrowDeposit.findUniqueOrThrow({
      where: { id: deposit.id }, select: { status: true },
    })).toEqual({ status: "HELD" });
    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: fixture.contractId }, select: { paymentStatus: true },
    })).toEqual({ paymentStatus: "PENDING" });

    const server = await listen(createPaymentApp(async () => {
      throw new Error("운영자 확인은 Toss API를 호출하면 안 됩니다.");
    }));
    try {
      const delivery = await post(server,
        `/api/contracts/${fixture.contractId}/installments/${fixture.interimId}/deliveries`,
        fixture.supplierId,
        { summary: "예치 확정 전 납품", fileUrl: null },
      );
      expect(delivery.status).toBe(409);

      const review = await post(server,
        `/api/contracts/${fixture.contractId}/deposits/${deposit.id}/operator-review`,
        fixture.adminId,
        { decision: "COMPLETE", reason: "샌드박스 입금 내역 확인" },
      );
      expect(review.status).toBe(200);
      expect(await prisma.contract.findUniqueOrThrow({
        where: { id: fixture.contractId }, select: { totalDeposited: true, paymentStatus: true },
      })).toEqual({ totalDeposited: 105_000, paymentStatus: "DEPOSITED" });
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "OPERATOR_DEPOSIT_REVIEWED" },
      })).toBe(1);
    } finally {
      await close(server);
    }
  });

  it("서로 다른 계약의 동시 첫 중간 지급은 공급자 쿠폰을 한 번만 소모한다", async () => {
    const supplier = await createSupplierFixture();
    await prisma.supplierProfile.update({ where: { userId: supplier.id }, data: { feeExempt: true } });
    const first = await createPaymentFixture({ supplierId: supplier.id, paymentStatus: "DEPOSITED", installmentStatus: "APPROVED" });
    const second = await createPaymentFixture({ supplierId: supplier.id, paymentStatus: "DEPOSITED", installmentStatus: "APPROVED" });
    const settlement = createSettlementWorkflowAdapter(prisma);

    await Promise.all([first, second].map((fixture) => settlement.releaseInstallment({
      contractId: fixture.contractId,
      installmentId: fixture.interimId,
      actor: { userId: fixture.adminId, role: "ADMIN" },
      releasedAt: fixedNow,
    })));

    const rows = await prisma.paymentInstallment.findMany({
      where: { id: { in: [first.interimId, second.interimId] } },
      orderBy: { id: "asc" },
      select: { amount: true, supplierFee: true, releaseAmount: true, status: true },
    });
    expect(rows.filter((row) => row.supplierFee === 0)).toHaveLength(1);
    expect(rows.filter((row) => row.supplierFee === 2_500)).toHaveLength(1);
    expect(rows.every((row) => row.status === "RELEASED")).toBe(true);
    expect(rows.find((row) => row.supplierFee === 0)?.releaseAmount).toBe(50_000);
    expect((await prisma.supplierProfile.findUniqueOrThrow({
      where: { userId: supplier.id }, select: { feeExemptUsedAt: true },
    })).feeExemptUsedAt).not.toBeNull();
  });

  it("취소 보상액을 계약 settledAmount와 REFUND_PROCESSED payload에 기록한다", async () => {
    const fixture = await createPaymentFixture({ paymentStatus: "DEPOSITED" });
    await prisma.contract.update({
      where: { id: fixture.contractId },
      data: { status: "CANCELLED", paymentStatus: "DEPOSITED", totalDeposited: 105_000 },
    });
    const cancellation = planCancellationSettlement({
      principal: 100_000,
      clientFee: 5_000,
      interimAmount: 50_000,
      totalDeposited: 105_000,
      releasedAmount: 0,
      activatedAt: new Date(fixedNow.getTime() - 25 * 60 * 60 * 1000),
      cancelledAt: fixedNow,
      party: "CLIENT",
    });
    const settlement = createSettlementWorkflowAdapter(prisma);
    await settlement.recordManualCancellationRefund({
      contractId: fixture.contractId,
      actor: { userId: fixture.adminId, role: "ADMIN", sessionId: "admin-session" },
      cancellation,
      reason: "의뢰인 사유 취소, 착수 보상",
      refundedAt: fixedNow,
    });

    expect(await prisma.contract.findUniqueOrThrow({
      where: { id: fixture.contractId },
      select: { settledAmount: true, refundAmount: true, paymentStatus: true },
    })).toEqual({ settledAmount: 25_000, refundAmount: 78_750, paymentStatus: "REFUNDED" });
    const event = await prisma.eventLog.findFirstOrThrow({
      where: { projectId: fixture.projectId, type: "REFUND_PROCESSED" }, select: { payload: true },
    });
    expect(assertRecord(event.payload)).toMatchObject({ supplierCompensation: 25_000 });
  });
});

async function createPaymentFixture(options: {
  supplierId?: string;
  paymentStatus?: "PENDING" | "DEPOSITED";
  installmentStatus?: "PENDING" | "APPROVED";
} = {}) {
  const project = await createProjectFixture({ status: "ACCEPTED" });
  const admin = await prisma.user.create({
    data: { email: `admin-${randomUUID()}@test.local`, name: "운영자", role: "ADMIN" },
  });
  const supplier = options.supplierId
    ? { id: options.supplierId }
    : await createSupplierFixture();
  const specItemId = project.itemIds[0];
  if (!specItemId) throw new Error("계약 기능 항목이 필요합니다.");
  const application = await prisma.application.create({
    data: {
      projectId: project.projectId,
      supplierId: supplier.id,
      revisionNo: 1,
      specVersionNo: 1,
      status: "ACCEPTED",
      totalAmount: 100_000,
      durationDays: 7,
      firstViewedAt: fixedNow,
      items: { create: [{ specItemId, isAvailable: true, amount: 100_000 }] },
    },
  });
  const contract = await prisma.contract.create({
    data: {
      applicationId: application.id,
      status: "ACTIVE",
      specVersionNo: 1,
      specSnapshot: {
        durationDays: 7,
        included: [{ specItemId, installmentStage: "INTERIM" }],
        excluded: [],
      },
      agreedAmount: 100_000,
      clientFee: 5_000,
      supplierFee: 5_000,
      paymentStatus: options.paymentStatus ?? "PENDING",
      totalDeposited: options.paymentStatus === "DEPOSITED" ? 105_000 : 0,
      installments: {
        create: [
          {
            stage: "INTERIM", ratio: 50, amount: 50_000, supplierFee: 2_500,
            releaseAmount: 47_500, status: options.installmentStatus ?? "PENDING",
          },
          { stage: "FINAL", ratio: 50, amount: 50_000, supplierFee: 2_500, releaseAmount: 47_500 },
        ],
      },
    },
    select: { id: true, installments: { select: { id: true, stage: true } } },
  });
  const interim = contract.installments.find((row) => row.stage === "INTERIM");
  if (!interim) throw new Error("중간 지급 구간이 필요합니다.");
  return {
    clientId: project.clientId,
    adminId: admin.id,
    supplierId: supplier.id,
    projectId: project.projectId,
    contractId: contract.id,
    interimId: interim.id,
    depositId: "",
  };
}

function createPaymentApp(confirmPayment: (input: { orderId: string; amount: number }) => Promise<{
  pgKey: string; amount: number; occurredAt: string; result: "SUCCESS"; verified: true;
}>) {
  return createApp({
    prismaClient: prisma,
    authVerifier: async (request: Request) => {
      const userId = request.header("x-test-user");
      if (!userId) return null;
      const found = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!found) return null;
      return { userId, role: found.role };
    },
    extraRouters: [createTradeApiRouter({ prismaClient: prisma, confirmPayment })],
  });
}

async function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return server;
}

function post(server: Server, path: string, userId: string, body: unknown): Promise<Response> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("테스트 서버 주소를 확인할 수 없습니다.");
  return fetch(`http://127.0.0.1:${getServerPort(server)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: JSON.stringify(body),
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
