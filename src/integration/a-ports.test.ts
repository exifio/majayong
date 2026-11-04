import { afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { PrismaClient, Role } from "@prisma/client";
import { createApp } from "../app.ts";
import { issueAccessToken } from "../modules/identity/auth.ts";
import {
  createAProjectApplicationPort,
  createAProjectSearchPort,
  createAProjectViewPort,
  createProjectCandidatePort,
} from "./a-ports.ts";
import { createAProjectDb, createProjectCandidateDb } from "./prisma-wiring.ts";
import { createProjectSearchPort } from "../modules/market/project-search.ts";
import { createBRouters } from "../server.ts";
import { createIntegrationPorts } from "./external-ports.ts";
import { createPrismaIntegrationDb, createPrismaPorts } from "./prisma-wiring.ts";
import {
  getPublicProjectDetail,
  listPublicProjects,
  reviseSpec,
} from "../modules/project/service.ts";
import type { ProjectPorts } from "../modules/project/ports.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-06 tests require the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const now = new Date("2026-11-03T09:00:00.000Z");
const deadline = new Date("2026-11-10T09:00:00.000Z");
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const blockIds: string[] = [];
const servers: Server[] = [];
const tokenSecret = "a-06-integration-ports-token-secret-longer-than-32";

function projectIndustryCode(projectId: string): string {
  return `A06-${projectId}`;
}

async function makeClient(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a201-${id}@example.invalid`, role: "CLIENT" } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
  return id;
}

async function makeSupplier(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a201-sup-${id}@example.invalid`, role: "SUPPLIER" } });
  await db.supplierProfile.create({ data: { userId: id, displayName: "공급자", ndaAgreedAt: now, ndaVersion: "nda-v1" } });
  return id;
}

async function makeProject(clientId: string): Promise<string> {
  const draftId = randomUUID();
  const projectId = randomUUID();
  const blockId = randomUUID();
  draftIds.push(draftId);
  projectIds.push(projectId);
  blockIds.push(blockId);
  await db.draft.create({ data: { id: draftId, clientId, entryType: "SENTENCE" } });
  await db.project.create({
    data: {
       id: projectId, draftId, confirmedAt: now, disclosureConsentVersion: "v1", title: "예약 달력 외 1개 기능",
       summary: "예약 관련 기능", industryCode: projectIndustryCode(projectId), requiredSkills: ["react"], hopeBudget: 4_000_000,
      deadline, publishedAt: now, status: "RECRUITING",
    },
  });
  await db.blockCatalog.create({
    data: {
      id: blockId, code: `a201-${blockId}`, name: "예약 달력", functionSummary: "예약 달력", description: "예약 달력 설명",
      industryCode: "RESTAURANT", unitPrice: 100_000, priceBasis: "범위\n가정\n추정", conditions: [{ key: "k", text: "조건" }],
    },
  });
  await db.specItem.create({
    data: {
      projectId, versionNo: 1, blockId, title: "예약 달력", description: "예약 달력 설명", origin: "FIRST_SENTENCE",
      status: "INCLUDED", unitPrice: 100_000, conditions: [{ key: "k", text: "조건" }], sortOrder: 0,
    },
  });
  return projectId;
}

function realProjectPorts(prisma: PrismaClient): ProjectPorts {
  const aProjectDb = createAProjectDb(prisma);
  return {
    supplierNdaVersion: "nda-v1",
    search: createAProjectSearchPort(
      createProjectSearchPort(createProjectCandidatePort(createProjectCandidateDb(prisma))),
    ),
    view: createAProjectViewPort(aProjectDb),
    application: createAProjectApplicationPort(aProjectDb) as unknown as ProjectPorts["application"],
  };
}

function integratedApp(prisma: PrismaClient) {
  const routers = createBRouters(
    createPrismaPorts(prisma),
    createIntegrationPorts(createPrismaIntegrationDb(prisma), { now: () => now }),
  ).map(({ router }) => router);
  return createApp({ db: prisma, tokenSecret, now: () => now, project: realProjectPorts(prisma), routers });
}

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))));
  if (userIds.length) await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  if (projectIds.length) await db.eventLog.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.applicationItem.deleteMany({ where: { application: { projectId: { in: projectIds } } } });
  if (projectIds.length) await db.application.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.specItem.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
  if (draftIds.length) await db.draft.deleteMany({ where: { id: { in: draftIds } } });
  if (blockIds.length) await db.blockCatalog.deleteMany({ where: { id: { in: blockIds } } });
  if (userIds.length) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.supplierProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe("A-06-G2-01: 실제 PostgreSQL 기반 공개 프로젝트 Port", () => {
  it("실제 후보 소스로 목록을 조회하면서 정확한 예산을 노출하지 않는다", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);

    const page = await listPublicProjects(db, realProjectPorts(db).search, { filters: { industryCode: projectIndustryCode(projectId) }, page: 1, pageSize: 10 });
    const card = page.items.find(item => item.projectId === projectId);
    expect(card).toMatchObject({ projectId, itemCount: 1, hopeBudgetBand: "400~500만원" });
    expect(card).not.toHaveProperty("hopeBudget");
    expect(JSON.stringify(page.items)).not.toContain("4000000");
  });

  it("NDA 상세를 제공하고 실제 열람 Port로 최초 열람을 기록한다", async () => {
    const clientId = await makeClient();
    const supplierId = await makeSupplier();
    const projectId = await makeProject(clientId);

    const detail = await getPublicProjectDetail(db, realProjectPorts(db), projectId, supplierId, now);
    expect(detail).toMatchObject({ projectId, hopeBudget: 4_000_000, itemCount: 1 });
    expect(await db.eventLog.count({ where: { type: "SPEC_DETAIL_VIEWED", projectId, userId: supplierId } })).toBe(1);
  });

  it("같은 트랜잭션에서 지원자를 STALE 처리하고 재견적 알림을 적재한다", async () => {
    const clientId = await makeClient();
    const supplierId = await makeSupplier();
    const projectId = await makeProject(clientId);
    const applicationId = randomUUID();
    await db.application.create({
      data: {
        id: applicationId, projectId, supplierId, specVersionNo: 1, totalAmount: 3_000_000,
        durationDays: 30, firstViewedAt: now, status: "SUBMITTED",
      },
    });
    const items = (await db.specItem.findMany({ where: { projectId, versionNo: 1 } })).map(item => ({
      blockId: item.blockId, title: item.title, description: "고친 설명", sortOrder: item.sortOrder,
    }));

    const revised = await reviseSpec(db, realProjectPorts(db), projectId, clientId, { items }, now);

    expect(revised).toEqual({ projectId, currentVersion: 2, itemCount: 1 });
    expect(await db.application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: "STALE" });
    const notifications = await db.notification.findMany({ where: { userId: supplierId, type: "REQUOTE_REQUESTED" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ targetId: applicationId, targetUrl: `/applications/${applicationId}` });
  });

  it("실제 검색 Port와 createApp으로 HTTP GET /projects를 제공한다", async () => {
    const clientId = await makeClient();
    const supplierId = await makeSupplier();
    const projectId = await makeProject(clientId);

    const server = createServer(createApp({ db, tokenSecret, now: () => now, project: realProjectPorts(db) }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
    const token = issueAccessToken({ userId: supplierId, role: Role.SUPPLIER, expiresAt: now.getTime() + 60_000 }, tokenSecret);

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/projects?industryCode=${projectIndustryCode(projectId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data.find(item => item.projectId === projectId)).toMatchObject({ projectId, hopeBudgetBand: "400~500만원" });
    expect(JSON.stringify(body.data)).not.toContain("4000000");
  });

  it("통합 HTTP 앱으로 목록 → NDA 상세 → 지원 → 명세 수정 흐름을 완료한다", async () => {
    const clientId = await makeClient();
    const supplierId = await makeSupplier();
    const projectId = await makeProject(clientId);
    const item = await db.specItem.findFirstOrThrow({ where: { projectId, versionNo: 1 } });

    const server = createServer(integratedApp(db));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    const token = (userId: string, role: Role) => issueAccessToken({ userId, role, expiresAt: now.getTime() + 60_000 }, tokenSecret);
    const supplierAuth = { authorization: `Bearer ${token(supplierId, Role.SUPPLIER)}` };
    const clientAuth = { authorization: `Bearer ${token(clientId, Role.CLIENT)}` };

    const industryCode = projectIndustryCode(projectId);
    const listed = await fetch(`${baseUrl}/projects?industryCode=${industryCode}`, { headers: supplierAuth });
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { data: Array<Record<string, unknown>> };
    expect(listBody.data.find(row => row.projectId === projectId)).toMatchObject({
      projectId,
      hopeBudgetBand: "400~500만원",
    });
    expect(JSON.stringify(listBody.data)).not.toContain("4000000");

    const outsideBudget = await fetch(`${baseUrl}/projects?industryCode=${industryCode}&minBudget=5000000`, { headers: supplierAuth });
    expect(outsideBudget.status).toBe(200);
    expect((await outsideBudget.json() as { data: Array<Record<string, unknown>> }).data)
      .not.toContainEqual(expect.objectContaining({ projectId }));

    const detailResponse = await fetch(`${baseUrl}/projects/${projectId}`, { headers: supplierAuth });
    expect(detailResponse.status).toBe(200);
    expect((await detailResponse.json() as { data: Record<string, unknown> }).data)
      .toMatchObject({ projectId, hopeBudget: 4_000_000 });
    expect(await db.eventLog.count({ where: { type: "SPEC_DETAIL_VIEWED", projectId, userId: supplierId } })).toBe(1);

    const applicationResponse = await fetch(`${baseUrl}/projects/${projectId}/applications`, {
      method: "POST",
      headers: { ...supplierAuth, "content-type": "application/json" },
      body: JSON.stringify({
        totalAmount: 3_000_000,
        durationDays: 30,
        items: [{ specItemId: item.id, isAvailable: true }],
      }),
    });
    expect(applicationResponse.status).toBe(201);
    const applicationBody = await applicationResponse.json() as { data: { id: string } };
    const applicationId = applicationBody.data.id;

    const reviseResponse = await fetch(`${baseUrl}/projects/${projectId}/spec`, {
      method: "PATCH",
      headers: { ...clientAuth, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ blockId: item.blockId, title: item.title, description: "수정된 예약 달력 설명" }] }),
    });
    expect(reviseResponse.status).toBe(200);
    expect(await db.application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: "STALE" });
    expect(await db.notification.findMany({ where: { userId: supplierId, type: "REQUOTE_REQUESTED", targetId: applicationId } }))
      .toHaveLength(1);
  });
});
