import { Role } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Request } from "express";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { createTradeApiRouter } from "../src/contracts/trade.router.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";

describe("계약 리뷰·검수·구간 지급 API", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("동시 중복 리뷰 중 하나만 저장하고 Review·프로필 평균·이벤트를 같은 결과로 반영한다", async () => {
    const fixture = await createTradeFixture("COMPLETED", "RELEASED");
    const server = await startTradeServer(fixture.clientId, fixture.supplierId, true);

    try {
      const url = tradeUrl(server, `/api/contracts/${fixture.contractId}/reviews`);
      const unauthenticated = await postJson(url, "unknown-user", { rating: 5 });
      expect(unauthenticated.status).toBe(401);
      const [first, second] = await Promise.all([
        postJson(url, fixture.clientId, {
          rating: 5,
          comment: "좋았습니다.",
          tags: ["communication"],
        }),
        postJson(url, fixture.clientId, {
          rating: 5,
          comment: "좋았습니다.",
          tags: ["communication"],
        }),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
      expect(await prisma.review.count({ where: { contractId: fixture.contractId } })).toBe(1);
      expect(await prisma.supplierProfile.findUnique({
        where: { userId: fixture.supplierId },
        select: { ratingAvg: true, reviewCount: true },
      })).toEqual({ ratingAvg: 5, reviewCount: 1 });
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "REVIEW_SUBMITTED" },
      })).toBe(1);

      const supplierReview = await postJson(url, fixture.supplierId, { rating: 4 });
      expect(supplierReview.status).toBe(200);
      expect(await prisma.clientProfile.findUnique({
        where: { userId: fixture.clientId },
        select: { ratingAvg: true, reviewCount: true },
      })).toEqual({ ratingAvg: 4, reviewCount: 1 });
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "REVIEW_SUBMITTED" },
      })).toBe(2);
    } finally {
      await closeServer(server);
    }
  });

  it("납품과 범위 내 보완 요청을 상태 및 기존 EventType으로 함께 저장한다", async () => {
    const fixture = await createTradeFixture("ACTIVE", "DEPOSITED");
    const installments = await createInstallments(fixture.contractId);
    const applicationItem = await prisma.applicationItem.findFirstOrThrow({
      where: { applicationId: fixture.applicationId },
      select: { id: true },
    });
    const server = await startTradeServer(fixture.clientId, fixture.supplierId);

    try {
      const deliveryResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.interimId}/deliveries`),
        fixture.supplierId,
        { summary: "중간 납품", fileUrl: "private/delivery/object" },
      );
      expect(deliveryResponse.status).toBe(201);
      const deliveryBody = assertRecord(await deliveryResponse.json());
      const deliveryId = String(assertRecord(deliveryBody.delivery).id);
      expect(await prisma.paymentInstallment.findUnique({
        where: { id: installments.interimId }, select: { status: true },
      })).toEqual({ status: "DELIVERED" });
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "DELIVERY_SUBMITTED" },
      })).toBe(1);

      const invalidResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/deliveries/${deliveryId}/inspection`),
        fixture.clientId,
        { requests: [{ applicationItemId: "foreign-item", reason: "NOT_IN_SPEC", note: null }] },
      );
      expect(invalidResponse.status).toBe(400);
      expect(await prisma.inspectionRequest.count({ where: { deliveryId } })).toBe(0);

      const inspectionResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/deliveries/${deliveryId}/inspection`),
        fixture.clientId,
        { requests: [{ applicationItemId: applicationItem.id, reason: "NOT_IN_SPEC", note: "수정 요청" }] },
      );
      expect(inspectionResponse.status).toBe(200);
      expect(await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { status: true } }))
        .toEqual({ status: "REWORK_REQUESTED" });
      expect(await prisma.paymentInstallment.findUnique({
        where: { id: installments.interimId }, select: { status: true },
      })).toEqual({ status: "REWORK_REQUESTED" });
      expect(await prisma.inspectionRequest.count({ where: { deliveryId, status: "OPEN" } })).toBe(1);
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "INSPECTION_REQUESTED" },
      })).toBe(1);

      const resubmissionResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.interimId}/deliveries`),
        fixture.supplierId,
        { summary: "보완 납품", fileUrl: "private/delivery/revision-2" },
      );
      expect(resubmissionResponse.status).toBe(201);
      const resubmissionBody = assertRecord(await resubmissionResponse.json());
      const resubmissionId = String(assertRecord(resubmissionBody.delivery).id);
      expect(assertRecord(resubmissionBody.delivery).attemptNo).toBe(2);
      expect(await prisma.paymentInstallment.findUnique({
        where: { id: installments.interimId }, select: { status: true },
      })).toEqual({ status: "DELIVERED" });

      const approvalResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/deliveries/${resubmissionId}/inspection`),
        fixture.clientId,
        { requests: [] },
      );
      expect(approvalResponse.status).toBe(200);
      expect(await prisma.delivery.findUnique({ where: { id: resubmissionId }, select: { status: true } }))
        .toEqual({ status: "APPROVED" });
      expect(await prisma.paymentInstallment.findUnique({
        where: { id: installments.interimId }, select: { status: true, approvedAt: true },
      })).toMatchObject({ status: "APPROVED" });
      expect(await prisma.inspectionRequest.findFirstOrThrow({
        where: { deliveryId },
        select: { status: true },
      })).toEqual({ status: "RESOLVED" });
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "DELIVERY_SUBMITTED" },
      })).toBe(2);
      expect(await prisma.eventLog.count({
        where: { projectId: fixture.projectId, type: "INSPECTION_REQUESTED" },
      })).toBe(1);

    } finally {
      await closeServer(server);
    }
  });

  it("검수 요청은 현재 납품 구간에 배정된 작업 항목만 허용한다", async () => {
    const fixture = await createTradeFixture("ACTIVE", "DEPOSITED", true);
    const installments = await createInstallments(fixture.contractId);
    const finalSpecItemId = fixture.specItemIds[1];
    if (!finalSpecItemId) throw new Error("최종 구간 항목이 필요합니다.");
    const finalItem = await prisma.applicationItem.findFirstOrThrow({
      where: { applicationId: fixture.applicationId, specItemId: finalSpecItemId },
      select: { id: true },
    });
    const server = await startTradeServer(fixture.clientId, fixture.supplierId);

    try {
      const deliveryResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.interimId}/deliveries`),
        fixture.supplierId,
        { summary: "중간 납품", fileUrl: "private/delivery/interim" },
      );
      expect(deliveryResponse.status).toBe(201);
      const deliveryBody = assertRecord(await deliveryResponse.json());
      const deliveryId = String(assertRecord(deliveryBody.delivery).id);
      const inspectionResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/deliveries/${deliveryId}/inspection`),
        fixture.clientId,
        { requests: [{ applicationItemId: finalItem.id, reason: "NOT_IN_SPEC", note: "최종 구간 항목" }] },
      );

      expect(inspectionResponse.status).toBe(400);
      expect(await prisma.inspectionRequest.count({ where: { deliveryId } })).toBe(0);
    } finally {
      await closeServer(server);
    }
  });

  it("구간 지급은 이벤트를 만들지 않고 계약·구간 상태를 원자적으로 갱신한다", async () => {
    const fixture = await createTradeFixture("ACTIVE", "DEPOSITED");
    const installments = await createInstallments(fixture.contractId, "APPROVED");
    const server = await startTradeServer(fixture.clientId, fixture.supplierId);

    try {
      const supplierRelease = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.interimId}/release`),
        fixture.supplierId,
        {},
      );
      expect(supplierRelease.status).toBe(403);

      const interimResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.interimId}/release`),
        "admin-user",
        {},
      );
      expect(interimResponse.status).toBe(200);
      expect(await prisma.paymentInstallment.findUnique({
        where: { id: installments.interimId }, select: { status: true },
      })).toEqual({ status: "RELEASED" });
      expect(await prisma.contract.findUnique({
        where: { id: fixture.contractId }, select: { status: true, paymentStatus: true },
      })).toEqual({ status: "ACTIVE", paymentStatus: "PARTIALLY_RELEASED" });

      const finalResponse = await postJson(
        tradeUrl(server, `/api/contracts/${fixture.contractId}/installments/${installments.finalId}/release`),
        "admin-user",
        {},
      );
      expect(finalResponse.status).toBe(200);
      expect(await prisma.contract.findUnique({
        where: { id: fixture.contractId }, select: { status: true, paymentStatus: true, completedAt: true },
      })).toMatchObject({ status: "COMPLETED", paymentStatus: "RELEASED" });
      expect(await prisma.eventLog.count({ where: { projectId: fixture.projectId } })).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});

async function createTradeFixture(
  contractStatus: "ACTIVE" | "COMPLETED",
  paymentStatus: "DEPOSITED" | "RELEASED",
  includeFinalItem = false,
) {
  const project = await createProjectFixture({
    status: "CONTRACTED",
    ...(includeFinalItem ? { itemStatuses: ["INCLUDED", "INCLUDED"] } : {}),
  });
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
      totalAmount: 1_000_000,
      durationDays: 10,
      firstViewedAt: new Date(),
      items: {
        create: project.itemIds.map((itemId, index) => ({
          specItemId: itemId,
          isAvailable: true,
          amount: index === 0 ? 600_000 : 400_000,
        })),
      },
    },
  });
  const contract = await prisma.contract.create({
    data: {
      applicationId: application.id,
      status: contractStatus,
      specVersionNo: 1,
      specSnapshot: {
        specVersionNo: 1,
        included: project.itemIds.map((itemId, index) => ({
          specItemId: itemId,
          title: `기능 ${index + 1}`,
          description: "설명",
          amount: index === 0 ? 600_000 : 400_000,
          installmentStage: index === 0 ? "INTERIM" : "FINAL",
        })),
        excluded: [],
      },
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      supplierFee: 50_000,
      contentHash: `sha256:${"b".repeat(64)}`,
      pdfUrl: `contracts/c1/${"b".repeat(64)}.pdf`,
      paymentStatus,
      totalDeposited: 1_050_000,
      clientSignedAt: new Date("2026-10-27T10:00:00.000Z"),
      supplierSignedAt: new Date("2026-10-27T10:01:00.000Z"),
      completedAt: contractStatus === "COMPLETED" ? new Date("2026-10-27T11:00:00.000Z") : null,
    },
  });
  return {
    clientId: project.clientId,
    supplierId: supplier.id,
    projectId: project.projectId,
    applicationId: application.id,
    contractId: contract.id,
    specItemIds: project.itemIds,
  };
}

async function createInstallments(contractId: string, interimStatus: "PENDING" | "APPROVED" = "PENDING") {
  const [interim, final] = await Promise.all([
    prisma.paymentInstallment.create({
      data: {
        contractId,
        stage: "INTERIM",
        ratio: 50,
        amount: 500_000,
        supplierFee: 25_000,
        releaseAmount: 475_000,
        status: interimStatus,
      },
    }),
    prisma.paymentInstallment.create({
      data: {
        contractId,
        stage: "FINAL",
        ratio: 50,
        amount: 500_000,
        supplierFee: 25_000,
        releaseAmount: 475_000,
        status: "APPROVED",
      },
    }),
  ]);
  return { interimId: interim.id, finalId: final.id };
}

async function startTradeServer(clientId: string, supplierId: string, gateReviews = false): Promise<Server> {
  let reviewRequests = 0;
  let releaseReviews: (() => void) | undefined;
  const bothReviewsReady = new Promise<void>((resolve) => {
    releaseReviews = resolve;
  });
  const app = createApp({
    prismaClient: prisma,
    authVerifier: async (request: Request) => {
      const userId = request.header("x-test-user");
      if (userId === clientId) {
        if (gateReviews && request.path.endsWith("/reviews")) {
          reviewRequests += 1;
          if (reviewRequests === 2) releaseReviews?.();
          await bothReviewsReady;
        }
        return { userId, role: Role.CLIENT };
      }
      if (userId === supplierId) return { userId, role: Role.SUPPLIER };
      if (userId === "admin-user") return { userId, role: Role.ADMIN };
      return null;
    },
    extraRouters: [createTradeApiRouter({ prismaClient: prisma })],
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return server;
}

function tradeUrl(server: Server, path: string): string {
  return `http://127.0.0.1:${getServerPort(server)}${path}`;
}

function postJson(url: string, userId: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: JSON.stringify(body),
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
