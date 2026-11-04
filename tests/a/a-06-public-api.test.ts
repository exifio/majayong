import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { BlockOrigin, DraftEntryType, PrismaClient, ProjectStatus, Role, SpecItemStatus } from "@prisma/client";
import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.ts";
import type { AuthenticatedDraftRoute } from "../../src/modules/draft/api.ts";
import { issueAccessToken } from "../../src/modules/identity/auth.ts";
import type { Actor } from "../../src/modules/identity/session.ts";
import { mountProjectApi } from "../../src/modules/project/api.ts";
import type { ProjectPorts } from "../../src/modules/project/ports.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-06 tests require the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const now = new Date("2026-11-03T09:00:00.000Z");
const futureDeadline = new Date("2026-11-10T09:00:00.000Z");
const servers: Server[] = [];
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const blockIds: string[] = [];

const nda = "nda-v1";
const tokenSecret = "a-06-http-test-token-secret-longer-than-32-bytes";

const authenticated: AuthenticatedDraftRoute = handler => (req, res, next) => {
  const userId = req.header("x-actor-id") ?? "";
  const role = (req.header("x-actor-role") as Role | undefined) ?? Role.CLIENT;
  Promise.resolve(handler(req, res, { userId, role })).catch(next);
};

async function startServer(ports: ProjectPorts): Promise<string> {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountProjectApi(router, db, () => now, () => "project-disclosure-v0.1-draft", authenticated, ports);
  app.use("/api/v1", router);
  app.use((error: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" });
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  servers.push(server);
  return `http://127.0.0.1:${address.port}/api/v1`;
}

function request(baseUrl: string, method: string, path: string, actor: Actor, body?: unknown): Promise<globalThis.Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-actor-id": actor.userId,
      "x-actor-role": actor.role,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function makeClient(): Promise<Actor> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a06h-${id}@example.invalid`, name: "김의뢰", role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
  return { userId: id, role: Role.CLIENT };
}

async function makeSupplier(): Promise<Actor> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a06h-sup-${id}@example.invalid`, role: Role.SUPPLIER } });
  await db.supplierProfile.create({ data: { userId: id, displayName: "공급자", ndaAgreedAt: now, ndaVersion: nda } });
  return { userId: id, role: Role.SUPPLIER };
}

async function makeProject(clientId: string, status: ProjectStatus = ProjectStatus.RECRUITING): Promise<string> {
  const draftId = randomUUID();
  const projectId = randomUUID();
  draftIds.push(draftId);
  projectIds.push(projectId);
  await db.draft.create({ data: { id: draftId, clientId, entryType: DraftEntryType.SENTENCE } });
  await db.project.create({
    data: {
      id: projectId, draftId, confirmedAt: now, disclosureConsentVersion: "v1", title: "예약 달력 외 1개 기능",
      summary: "예약 관련 기능", industryCode: "RESTAURANT", requiredSkills: ["react"], hopeBudget: 4_000_000,
      deadline: futureDeadline, status,
    },
  });
  return projectId;
}

async function addSpecItem(projectId: string, versionNo: number): Promise<void> {
  const blockId = randomUUID();
  blockIds.push(blockId);
  await db.blockCatalog.create({
    data: {
      id: blockId, code: `a06h-${blockId}`, name: "예약 달력", functionSummary: "예약 달력", description: "예약 달력 설명",
      industryCode: "RESTAURANT", unitPrice: 100_000, priceBasis: "범위\n가정\n추정", conditions: [{ key: "k", text: "조건" }],
      wireframe: { parts: [{ type: "TEXT" }] },
    },
  });
  await db.specItem.create({
    data: {
      projectId, versionNo, blockId, title: "예약 달력", description: "예약 달력 설명", origin: BlockOrigin.FIRST_SENTENCE,
      status: SpecItemStatus.INCLUDED, unitPrice: 100_000, conditions: [{ key: "k", text: "조건" }], sortOrder: 0,
    },
  });
}

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  if (projectIds.length) await db.eventLog.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.specItem.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
  if (draftIds.length) await db.draft.deleteMany({ where: { id: { in: draftIds } } });
  if (blockIds.length) await db.blockCatalog.deleteMany({ where: { id: { in: blockIds } } });
  if (userIds.length) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.supplierProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe("A-06 project HTTP API", () => {
  it("serves the client's own project list", async () => {
    const client = await makeClient();
    const projectId = await makeProject(client.userId);
    await addSpecItem(projectId, 1);
    const baseUrl = await startServer({});
    const response = await request(baseUrl, "GET", "/me/projects", client);
    expect(response.status).toBe(200);
    const data = (await response.json() as { data: Array<{ projectId: string; currentVersion: number }> }).data;
    expect(data.find(row => row.projectId === projectId)).toMatchObject({ projectId, currentVersion: 1 });
  });

  it("serves the public list through the search port exactly once and denies clients", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const projectId = await makeProject(client.userId);
    await addSpecItem(projectId, 1);
    const searchPublicProjects = jest.fn(async () => ({ projectIds: [projectId], total: 1 }));
    const baseUrl = await startServer({ search: { searchPublicProjects } });

    const forbidden = await request(baseUrl, "GET", "/projects", client);
    expect(forbidden.status).toBe(403);

    const response = await request(baseUrl, "GET", "/projects?industryCode=RESTAURANT&page=1", supplier);
    expect(response.status).toBe(200);
    const body = (await response.json() as { data: Array<Record<string, unknown>>; meta: { page: number; pageSize: number; total: number } });
    expect(searchPublicProjects).toHaveBeenCalledTimes(1);
    expect(body.meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    expect(body.data[0]).toMatchObject({ projectId, itemCount: 1, hopeBudgetBand: "300만원~500만원" });
    expect(JSON.stringify(body.data)).not.toContain("4000000");
    expect(body.data[0]).not.toHaveProperty("hopeBudget");
  });

  it("fails closed for the public list when no search port is wired", async () => {
    const supplier = await makeSupplier();
    const baseUrl = await startServer({});
    const response = await request(baseUrl, "GET", "/projects", supplier);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("PROJECT_SEARCH_UNAVAILABLE");
  });

  it("serves the public detail after NDA and records exactly one first view", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const projectId = await makeProject(client.userId);
    await addSpecItem(projectId, 1);
    const recordFirstView = jest.fn(async () => undefined);
    const baseUrl = await startServer({ supplierNdaVersion: nda, view: { recordFirstView } });

    const response = await request(baseUrl, "GET", `/projects/${projectId}`, supplier);
    expect(response.status).toBe(200);
    expect(recordFirstView).toHaveBeenCalledTimes(1);
    const data = (await response.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ projectId, hopeBudget: 4_000_000 });
    expect(data).not.toHaveProperty("unitPrice");
    expect(JSON.stringify(data)).not.toContain("clientFee");
  });

  it("revises the spec over HTTP and denies suppliers", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const projectId = await makeProject(client.userId);
    await addSpecItem(projectId, 1);
    const items = (await db.specItem.findMany({ where: { projectId, versionNo: 1 } })).map(item => ({
      blockId: item.blockId, title: item.title, description: "고친 설명", conditions: [{ key: "k", text: "조건" }], sortOrder: 0,
    }));
    const markSpecStale = jest.fn(async () => 0);
    const baseUrl = await startServer({ application: { countPending: jest.fn(async () => 0), markSpecStale, rejectPendingOnDelete: jest.fn(async () => 0) } });

    const denied = await request(baseUrl, "PATCH", `/projects/${projectId}/spec`, supplier, { items });
    expect(denied.status).toBe(403);

    const response = await request(baseUrl, "PATCH", `/projects/${projectId}/spec`, client, { items });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { currentVersion: number } }).data).toEqual({ projectId, currentVersion: 2, itemCount: 1 });
    expect(markSpecStale).toHaveBeenCalledTimes(1);
  });

  it("extends the deadline and rejects an over-cap value", async () => {
    const client = await makeClient();
    const projectId = await makeProject(client.userId);
    const baseUrl = await startServer({ notification: { enqueue: jest.fn(async () => undefined) } });

    const overCap = await request(baseUrl, "POST", `/projects/${projectId}/extend-deadline`, client, {
      deadline: new Date(futureDeadline.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(overCap.status).toBe(422);

    const ok = await request(baseUrl, "POST", `/projects/${projectId}/extend-deadline`, client, {
      deadline: new Date(futureDeadline.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json() as { data: { status: ProjectStatus } }).data.status).toBe(ProjectStatus.RECRUITING);
  });

  it("soft deletes an owner's project over HTTP", async () => {
    const client = await makeClient();
    const projectId = await makeProject(client.userId);
    const rejectPendingOnDelete = jest.fn(async () => 0);
    const baseUrl = await startServer({ application: { countPending: jest.fn(async () => 0), markSpecStale: jest.fn(async () => 0), rejectPendingOnDelete } });
    const response = await request(baseUrl, "DELETE", `/projects/${projectId}`, client);
    expect(response.status).toBe(200);
    expect(rejectPendingOnDelete).toHaveBeenCalledTimes(1);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ deletedAt: now });
  });
});

describe("A-06 common-app wiring", () => {
  it("exposes #044~#049 through createApp and fails closed without ports", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const projectId = await makeProject(client.userId);

    const server = createServer(createApp({ db, tokenSecret, now: () => now }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    const clientToken = issueAccessToken({ userId: client.userId, role: Role.CLIENT, expiresAt: now.getTime() + 60_000 }, tokenSecret);
    const supplierToken = issueAccessToken({ userId: supplier.userId, role: Role.SUPPLIER, expiresAt: now.getTime() + 60_000 }, tokenSecret);

    const mine = await fetch(`${baseUrl}/me/projects`, { headers: { authorization: `Bearer ${clientToken}` } });
    expect(mine.status).toBe(200);

    const list = await fetch(`${baseUrl}/projects`, { headers: { authorization: `Bearer ${supplierToken}` } });
    expect(list.status).toBe(503);

    const detail = await fetch(`${baseUrl}/projects/${projectId}`, { headers: { authorization: `Bearer ${supplierToken}` } });
    expect(detail.status).toBe(503);

    const softDelete = await fetch(`${baseUrl}/projects/${projectId}`, { method: "DELETE", headers: { authorization: `Bearer ${clientToken}` } });
    expect(softDelete.status).toBe(503);
  });

  it("A-06-T05/T06 injects view and application ports from createApp when provided", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const projectId = await makeProject(client.userId);
    await addSpecItem(projectId, 1);
    const recordFirstView = jest.fn(async () => undefined);
    const rejectPendingOnDelete = jest.fn(async () => 0);

    const server = createServer(createApp({
      db, tokenSecret, now: () => now,
      project: {
        supplierNdaVersion: nda,
        view: { recordFirstView },
        application: { countPending: jest.fn(async () => 0), markSpecStale: jest.fn(async () => 0), rejectPendingOnDelete },
      },
    }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    const supplierToken = issueAccessToken({ userId: supplier.userId, role: Role.SUPPLIER, expiresAt: now.getTime() + 60_000 }, tokenSecret);
    const detail = await fetch(`${baseUrl}/projects/${projectId}`, { headers: { authorization: `Bearer ${supplierToken}` } });
    expect(detail.status).toBe(200);
    expect(recordFirstView).toHaveBeenCalledTimes(1);

    const clientToken = issueAccessToken({ userId: client.userId, role: Role.CLIENT, expiresAt: now.getTime() + 60_000 }, tokenSecret);
    const softDelete = await fetch(`${baseUrl}/projects/${projectId}`, { method: "DELETE", headers: { authorization: `Bearer ${clientToken}` } });
    expect(softDelete.status).toBe(200);
    expect(rejectPendingOnDelete).toHaveBeenCalledTimes(1);
  });
});
