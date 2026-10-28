import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";
import { markApplicationsStale } from "../src/applications/applications.service.ts";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${getServerPort(server)}` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function recordDetailView(projectId: string, supplierId: string, occurredAt = new Date()) {
  await prisma.eventLog.create({
    data: { type: "SPEC_DETAIL_VIEWED", projectId, userId: supplierId, occurredAt },
  });
}

async function submitQuote(baseUrl: string, projectId: string, supplierId: string, specItemId: string, amount = 100_000) {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/applications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": supplierId, "x-user-role": "SUPPLIER" },
    body: JSON.stringify({
      durationDays: 5,
      items: [{ specItemId, isAvailable: true, amount, memo: "연락처 010-3333-4444 또는 dev@example.test" }],
    }),
  });
  return { response, body: assertRecord(await response.json()) };
}

describe("F-05 견적 제출·재견적, F-09 비교, F-10 수락·자동 거절", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.ALLOW_HEADER_AUTH = "true";
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("상세 열람이 없는 지원을 막고, 유효 견적은 서버 최초 열람 시각·합계와 마스킹 메모를 저장한다", async () => {
    const project = await createProjectFixture();
    const supplier = await createSupplierFixture();
    const itemId = project.itemIds[0];
    if (!itemId) throw new Error("견적 항목이 필요합니다.");
    const { server, baseUrl } = await startServer();

    try {
      const blocked = await submitQuote(baseUrl, project.projectId, supplier.id, itemId);
      expect(blocked.response.status).toBe(409);
      expect(await prisma.application.count()).toBe(0);

      const firstViewedAt = new Date("2026-10-27T10:00:00.000Z");
      await recordDetailView(project.projectId, supplier.id, firstViewedAt);
      await recordDetailView(project.projectId, supplier.id, new Date("2026-10-27T11:00:00.000Z"));
      const submitted = await submitQuote(baseUrl, project.projectId, supplier.id, itemId);

      expect(submitted.response.status).toBe(201);
      expect(submitted.body.totalAmount).toBe(100_000);
      const application = await prisma.application.findFirst({
        where: { projectId: project.projectId, supplierId: supplier.id },
        include: { items: true },
      });
      expect(application?.firstViewedAt).toEqual(firstViewedAt);
      expect(application?.items[0]?.memo).toBe("연락처 [연락처 숨김] 또는 [연락처 숨김]");
      expect(application?.items[0]?.isContactMasked).toBe(true);
      expect(await prisma.notification.count({ where: { userId: project.clientId, type: "APPLICATION_RECEIVED" } })).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("재견적은 이전 제출을 SUPERSEDED로 보존하고 비교에는 공급자별 최신 지원만 노출한다", async () => {
    const project = await createProjectFixture();
    const supplier = await createSupplierFixture();
    const itemId = project.itemIds[0];
    if (!itemId) throw new Error("견적 항목이 필요합니다.");
    await recordDetailView(project.projectId, supplier.id);
    const { server, baseUrl } = await startServer();

    try {
      const first = await submitQuote(baseUrl, project.projectId, supplier.id, itemId, 100_000);
      const second = await submitQuote(baseUrl, project.projectId, supplier.id, itemId, 120_000);
      expect(first.response.status).toBe(201);
      expect(second.response.status).toBe(201);
      expect(await prisma.application.count({ where: { supplierId: supplier.id, status: "SUPERSEDED" } })).toBe(1);

      const comparison = await fetch(`${baseUrl}/api/projects/${project.projectId}/applications/compare`, {
        headers: { "x-user-id": project.clientId, "x-user-role": "CLIENT" },
      });
      expect(comparison.status).toBe(200);
      const body = assertRecord(await comparison.json());
      if (!Array.isArray(body.items)) throw new Error("비교 items는 배열이어야 합니다.");
      expect(body.items).toHaveLength(1);
      expect(assertRecord(body.items[0])).toMatchObject({ totalAmount: 120_000, totalWithClientFee: 126_000, durationDays: 5 });
    } finally {
      await stopServer(server);
    }
  });

  it("수락은 같은 트랜잭션에서 프로젝트·다른 제출 자동 거절·알림을 처리한다", async () => {
    const project = await createProjectFixture();
    const acceptedSupplier = await createSupplierFixture();
    const rejectedSupplier = await createSupplierFixture();
    const itemId = project.itemIds[0];
    if (!itemId) throw new Error("견적 항목이 필요합니다.");
    await recordDetailView(project.projectId, acceptedSupplier.id);
    await recordDetailView(project.projectId, rejectedSupplier.id);
    const { server, baseUrl } = await startServer();

    try {
      const accepted = await submitQuote(baseUrl, project.projectId, acceptedSupplier.id, itemId);
      const rejected = await submitQuote(baseUrl, project.projectId, rejectedSupplier.id, itemId);
      const acceptedId = String(accepted.body.id);
      const response = await fetch(`${baseUrl}/api/applications/${acceptedId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": project.clientId, "x-user-role": "CLIENT" },
        body: JSON.stringify({ confirmedExcludedItemIds: [] }),
      });

      expect(response.status).toBe(200);
      expect(assertRecord(await response.json()).applicationStatus).toBe("ACCEPTED");
      expect(await prisma.project.findUnique({ where: { id: project.projectId }, select: { status: true } }))
        .toMatchObject({ status: "ACCEPTED" });
      expect(await prisma.application.findUnique({ where: { id: acceptedId }, select: { status: true } }))
        .toMatchObject({ status: "ACCEPTED" });
      expect(await prisma.application.findUnique({ where: { id: String(rejected.body.id) }, select: { status: true } }))
        .toMatchObject({ status: "AUTO_REJECTED" });
      expect(await prisma.notification.count({ where: { userId: acceptedSupplier.id, type: "APPLICATION_ACCEPTED" } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: rejectedSupplier.id, type: "APPLICATION_AUTO_REJECTED" } })).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("명세 버전 변경 트랜잭션에서 이전 제출을 STALE 처리하고 재견적 알림을 남긴다", async () => {
    const project = await createProjectFixture();
    const supplier = await createSupplierFixture();
    const itemId = project.itemIds[0];
    if (!itemId) throw new Error("견적 항목이 필요합니다.");
    await recordDetailView(project.projectId, supplier.id);
    const { server, baseUrl } = await startServer();

    try {
      const submitted = await submitQuote(baseUrl, project.projectId, supplier.id, itemId);
      const applicationId = String(submitted.body.id);
      await prisma.$transaction(async (tx) => {
        await tx.project.update({ where: { id: project.projectId }, data: { currentVersion: 2 } });
        await tx.specItem.create({
          data: {
            projectId: project.projectId,
            versionNo: 2,
            title: "수정된 기능",
            description: "새 명세 버전",
            origin: "FIRST_SENTENCE",
            status: "INCLUDED",
          },
        });
        expect(await markApplicationsStale(tx, project.projectId, 2)).toBe(1);
      });

      expect(await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true } }))
        .toMatchObject({ status: "STALE" });
      expect(await prisma.notification.count({ where: { userId: supplier.id, type: "REQUOTE_REQUESTED", targetId: applicationId } })).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("수행 불가 항목을 확인하고 첫 문장 항목 제외 경고에 동의해야 수락한다", async () => {
    const project = await createProjectFixture({ itemStatuses: ["INCLUDED", "INCLUDED"] });
    const supplier = await createSupplierFixture();
    const availableItemId = project.itemIds[0];
    const unavailableItemId = project.itemIds[1];
    if (!availableItemId || !unavailableItemId) throw new Error("견적 항목 두 개가 필요합니다.");
    await recordDetailView(project.projectId, supplier.id);
    const { server, baseUrl } = await startServer();

    try {
      const submission = await fetch(`${baseUrl}/api/projects/${project.projectId}/applications`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": supplier.id, "x-user-role": "SUPPLIER" },
        body: JSON.stringify({
          durationDays: 5,
          items: [
            { specItemId: availableItemId, isAvailable: true, amount: 100_000 },
            { specItemId: unavailableItemId, isAvailable: false, amount: null },
          ],
        }),
      });
      const applicationId = String(assertRecord(await submission.json()).id);
      const headers = { "content-type": "application/json", "x-user-id": project.clientId, "x-user-role": "CLIENT" };
      const path = `${baseUrl}/api/applications/${applicationId}/accept`;

      expect((await fetch(path, { method: "POST", headers, body: JSON.stringify({ confirmedExcludedItemIds: [] }) })).status).toBe(409);
      expect((await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ confirmedExcludedItemIds: [unavailableItemId] }),
      })).status).toBe(409);
      expect((await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ confirmedExcludedItemIds: [unavailableItemId], firstSentenceExclusionConfirmed: true }),
      })).status).toBe(200);
    } finally {
      await stopServer(server);
    }
  });

  it("한 프로젝트의 동시 수락 경쟁에서는 한 지원만 성공한다", async () => {
    const project = await createProjectFixture();
    const firstSupplier = await createSupplierFixture();
    const secondSupplier = await createSupplierFixture();
    const itemId = project.itemIds[0];
    if (!itemId) throw new Error("견적 항목이 필요합니다.");
    await recordDetailView(project.projectId, firstSupplier.id);
    await recordDetailView(project.projectId, secondSupplier.id);
    const { server, baseUrl } = await startServer();

    try {
      const first = await submitQuote(baseUrl, project.projectId, firstSupplier.id, itemId);
      const second = await submitQuote(baseUrl, project.projectId, secondSupplier.id, itemId);
      const headers = { "content-type": "application/json", "x-user-id": project.clientId, "x-user-role": "CLIENT" };
      const results = await Promise.all([first, second].map(({ body }) => fetch(
        `${baseUrl}/api/applications/${String(body.id)}/accept`,
        { method: "POST", headers, body: JSON.stringify({ confirmedExcludedItemIds: [] }) },
      )));

      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await prisma.application.count({ where: { projectId: project.projectId, status: "ACCEPTED" } })).toBe(1);
    } finally {
      await stopServer(server);
    }
  });
});
