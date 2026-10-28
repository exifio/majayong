import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture, createSupplierFixture } from "./project-fixtures.ts";
import { processProjectSchedules } from "../src/projects/projects.service.ts";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${getServerPort(server)}` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("F-08 프로젝트 탐색·공개 범위, F-17 추천, F-18 북마크", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.ALLOW_HEADER_AUTH = "true";
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("공급자 목록은 검색·업종·기술·예산 필터를 적용하고 정확한 예산은 공개하되 신원·원문은 숨긴다", async () => {
    const supplier = await createSupplierFixture();
    const matching = await createProjectFixture({
      title: "예약 캘린더 플랫폼",
      summary: "예약 가능한 날짜를 관리합니다",
      requiredSkills: ["React", "PostgreSQL"],
      hopeBudget: 1_250_000,
    });
    await createProjectFixture({
      title: "재고 관리",
      summary: "상품 재고를 관리합니다",
      requiredSkills: ["Python"],
      hopeBudget: 2_000_000,
    });
    await createProjectFixture({ title: "삭제된 예약 프로젝트", deleted: true });
    const { server, baseUrl } = await startServer();

    try {
      const response = await fetch(
        `${baseUrl}/api/projects?q=예약&industryCode=RESTAURANT_RESERVATION&skills=React&minBudget=1000000&maxBudget=1500000&sort=budget-high&page=1`,
        { headers: { "x-user-id": supplier.id, "x-user-role": "SUPPLIER" } },
      );
      expect(response.status).toBe(200);
      const body = assertRecord(await response.json());
      expect(body.total).toBe(1);
      expect(body.pageSize).toBe(10);
      if (!Array.isArray(body.items)) throw new Error("프로젝트 items는 배열이어야 합니다.");
      expect(body.items).toHaveLength(1);
      const item = assertRecord(body.items[0]);
      expect(item.id).toBe(matching.projectId);
      expect(item.title).toBe("예약 캘린더 플랫폼");
      expect(item.hopeBudget).toBe(1_250_000);
      expect(item).not.toHaveProperty("clientId");
      expect(JSON.stringify(item)).not.toContain("비공개 상호");
      expect(JSON.stringify(item)).not.toContain("010-1234-5678");
      expect(JSON.stringify(item)).not.toContain("원문 연락처");
      expect(
        await prisma.eventLog.count({
          where: { type: "SPEC_LIST_VIEWED", projectId: matching.projectId, userId: supplier.id },
        }),
      ).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("공급자 상세 열람은 열람 이벤트를 남기고 수락 전에는 신원과 원문을 숨긴다", async () => {
    const supplier = await createSupplierFixture();
    const project = await createProjectFixture();
    const { server, baseUrl } = await startServer();

    try {
      const response = await fetch(`${baseUrl}/api/projects/${project.projectId}`, {
        headers: { "x-user-id": supplier.id, "x-user-role": "SUPPLIER" },
      });
      expect(response.status).toBe(200);
      const body = assertRecord(await response.json());
      expect(assertRecord(body.project).hopeBudget).toBe(1_250_000);
      expect(body).not.toHaveProperty("client");
      expect(body).not.toHaveProperty("originalTexts");
      expect(JSON.stringify(body)).not.toContain("비공개 상호");
      expect(JSON.stringify(body)).not.toContain("원문 연락처");
      expect(
        await prisma.eventLog.count({
          where: { type: "SPEC_DETAIL_VIEWED", projectId: project.projectId, userId: supplier.id },
        }),
      ).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it("수락된 공급자에게만 의뢰인 정보와 원문을 추가 공개한다", async () => {
    const supplier = await createSupplierFixture();
    const project = await createProjectFixture({ status: "ACCEPTED" });
    const specItemId = project.itemIds[0];
    if (!specItemId) throw new Error("지원할 명세 항목이 필요합니다.");
    await prisma.application.create({
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
    const { server, baseUrl } = await startServer();

    try {
      const response = await fetch(`${baseUrl}/api/projects/${project.projectId}`, {
        headers: { "x-user-id": supplier.id, "x-user-role": "SUPPLIER" },
      });
      expect(response.status).toBe(200);
      const body = assertRecord(await response.json());
      expect(assertRecord(body.client)).toMatchObject({
        name: "의뢰인 이름",
        businessName: "비공개 상호",
        phone: "010-1234-5678",
        region: "서울",
      });
      expect(body.originalTexts).toEqual([
        { kind: "FIRST_SENTENCE", content: "원문 연락처 010-9876-5432와 private@example.test" },
      ]);
    } finally {
      await stopServer(server);
    }
  });

  it("프로젝트 소유 의뢰인에게만 고유 상세 열람자 수를 돌려준다", async () => {
    const owner = await createProjectFixture();
    const viewer = await createSupplierFixture();
    await prisma.eventLog.createMany({
      data: [viewer.id, viewer.id].map((userId) => ({
        type: "SPEC_DETAIL_VIEWED" as const,
        projectId: owner.projectId,
        userId,
        payload: {},
      })),
    });
    const { server, baseUrl } = await startServer();

    try {
      const ownResponse = await fetch(`${baseUrl}/api/projects/${owner.projectId}`, {
        headers: { "x-user-id": owner.clientId, "x-user-role": "CLIENT" },
      });
      expect(ownResponse.status).toBe(200);
      const ownBody = assertRecord(await ownResponse.json());
      expect(ownBody.uniqueDetailViewers).toBe(1);

      const supplierResponse = await fetch(`${baseUrl}/api/projects/${owner.projectId}`, {
        headers: { "x-user-id": viewer.id, "x-user-role": "SUPPLIER" },
      });
      const supplierBody = assertRecord(await supplierResponse.json());
      expect(supplierBody).not.toHaveProperty("uniqueDetailViewers");
    } finally {
      await stopServer(server);
    }
  });

  it("공급자는 자기 북마크를 중복 없이 저장·해제하고 마감 프로젝트도 목록에서 확인한다", async () => {
    const supplier = await createSupplierFixture();
    const project = await createProjectFixture({ status: "EXPIRED", deadline: new Date(Date.now() - 1_000) });
    const { server, baseUrl } = await startServer();
    const headers = { "x-user-id": supplier.id, "x-user-role": "SUPPLIER" };

    try {
      const first = await fetch(`${baseUrl}/api/projects/${project.projectId}/bookmark`, {
        method: "PUT",
        headers,
      });
      const second = await fetch(`${baseUrl}/api/projects/${project.projectId}/bookmark`, {
        method: "PUT",
        headers,
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await prisma.bookmark.count()).toBe(1);

      const list = await fetch(`${baseUrl}/api/supplier/bookmarks`, { headers });
      expect(list.status).toBe(200);
      const listBody = assertRecord(await list.json());
      if (!Array.isArray(listBody.items)) throw new Error("북마크 items는 배열이어야 합니다.");
      expect(listBody.items).toHaveLength(1);
      expect(assertRecord(listBody.items[0]).recruitmentStatus).toBe("CLOSED");

      const removed = await fetch(`${baseUrl}/api/projects/${project.projectId}/bookmark`, {
        method: "DELETE",
        headers,
      });
      expect(removed.status).toBe(204);
      expect(await prisma.bookmark.count()).toBe(0);
    } finally {
      await stopServer(server);
    }
  });

  it("추천은 같은 업종과 비슷한 기술 스택을 우선하고 다른 업종을 제외한다", async () => {
    const supplier = await createSupplierFixture();
    const current = await createProjectFixture({ requiredSkills: ["React", "PostgreSQL"] });
    const similar = await createProjectFixture({ title: "가까운 프로젝트", requiredSkills: ["React"] });
    await createProjectFixture({
      title: "다른 업종",
      industryCode: "OTHER",
      requiredSkills: ["React", "PostgreSQL"],
    });
    const { server, baseUrl } = await startServer();

    try {
      const response = await fetch(
        `${baseUrl}/api/projects/${current.projectId}/recommendations`,
        { headers: { "x-user-id": supplier.id, "x-user-role": "SUPPLIER" } },
      );
      expect(response.status).toBe(200);
      const body = assertRecord(await response.json());
      if (!Array.isArray(body.items)) throw new Error("추천 items는 배열이어야 합니다.");
      expect(body.items.map((item: unknown) => assertRecord(item).title)).toContain("가까운 프로젝트");
      expect(body.items.map((item: unknown) => assertRecord(item).title)).not.toContain("다른 업종");
    } finally {
      await stopServer(server);
    }
  });

  it("예약 시작 시 프로젝트를 공개하고 마감 시 의뢰인·지원 공급자에게 중복 없는 알림을 보낸다", async () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const scheduled = await createProjectFixture({
      status: "SCHEDULED",
      published: false,
      recruitStartAt: new Date("2026-10-27T11:00:00.000Z"),
      deadline: new Date("2026-10-28T12:00:00.000Z"),
    });
    const supplier = await createSupplierFixture();
    const expiring = await createProjectFixture({
      deadline: new Date("2026-10-27T11:00:00.000Z"),
    });
    const specItemId = expiring.itemIds[0];
    if (!specItemId) throw new Error("지원할 명세 항목이 필요합니다.");
    await prisma.application.create({
      data: {
        projectId: expiring.projectId,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "SUBMITTED",
        totalAmount: 100_000,
        durationDays: 5,
        firstViewedAt: now,
        items: { create: [{ specItemId, isAvailable: true, amount: 100_000 }] },
      },
    });

    await processProjectSchedules(prisma, now);
    await processProjectSchedules(prisma, now);

    expect(await prisma.project.findUnique({ where: { id: scheduled.projectId }, select: { status: true, publishedAt: true } }))
      .toMatchObject({ status: "RECRUITING", publishedAt: now });
    expect(await prisma.eventLog.count({ where: { type: "PROJECT_PUBLISHED", projectId: scheduled.projectId } })).toBe(1);
    expect(await prisma.project.findUnique({ where: { id: expiring.projectId }, select: { status: true } }))
      .toMatchObject({ status: "EXPIRED" });
    expect(await prisma.notification.count({ where: { targetId: expiring.projectId, type: "PROJECT_CLOSED" } })).toBe(2);
  });
});
