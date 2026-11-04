import { afterAll, describe, expect, it } from "@jest/globals";
import { BlockOrigin, DraftEntryType, PrismaClient, Role } from "@prisma/client";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app.ts";
import type { Actor } from "../identity/session.ts";
import { issueAccessToken } from "../identity/auth.ts";
import { mountPricingApi } from "./api.ts";
import type { AuthenticatedDraftRoute } from "../draft/api.ts";
import { applyEstimateToBudget, getPriceReport } from "./service.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test") {
  throw new Error("A-05 tests require the dedicated majayong_a00_test database");
}
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const userIds: string[] = [];
const draftIds: string[] = [];
const blockIds: string[] = [];
const servers: Server[] = [];
const tokenSecret = "a05-pricing-common-app-test-token-secret-long-enough";

async function makeUser(role: Role): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `a05-${id}@example.invalid`, role } });
  userIds.push(id);
  return id;
}

async function makeDraftWithBlock(): Promise<{ clientId: string; draftId: string; blockId: string }> {
  const clientId = randomUUID();
  const draftId = randomUUID();
  const blockId = randomUUID();
  await db.user.create({ data: { id: clientId, email: `a05-${clientId}@example.invalid`, role: Role.CLIENT } });
  await db.draft.create({ data: { id: draftId, clientId, entryType: DraftEntryType.SENTENCE, pendingFeatures: [] } });
  await db.blockCatalog.create({
    data: {
      id: blockId,
      code: `a05-${blockId}`,
      name: "예약 달력",
      functionSummary: "예약 가능 시간을 표시한다",
      description: "예약 날짜와 가능 시간을 표시합니다.",
      industryCode: "TEST",
      techTags: ["typescript"],
      unitPrice: 9000,
      priceBasis: "달력 화면과 예약 가능 시간 표시",
    },
  });
  await db.draftBlock.create({
    data: {
      draftId,
      blockId,
      origin: BlockOrigin.FIRST_SENTENCE,
      status: "ADDED",
      unitPrice: 1000,
      sortOrder: 0,
    },
  });
  userIds.push(clientId);
  draftIds.push(draftId);
  blockIds.push(blockId);
  return { clientId, draftId, blockId };
}

async function startPricingServer(actor: Actor): Promise<string> {
  const app = express();
  const router = express.Router();
  const authenticated: AuthenticatedDraftRoute = handler => (req, res, next) => {
    Promise.resolve(handler(req, res, actor)).catch(next);
  };
  mountPricingApi(router, db, () => new Date("2026-11-03T09:00:00.000Z"), authenticated);
  app.use("/api/v1", router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" });
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  servers.push(server);
  return `http://127.0.0.1:${address.port}/api/v1`;
}

async function startCommonAppServer(): Promise<string> {
  const app = createApp({ db, tokenSecret, now: () => new Date("2026-11-03T09:00:00.000Z") });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  servers.push(server);
  return `http://127.0.0.1:${address.port}/api/v1`;
}

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  if (draftIds.length > 0) {
    const projects = await db.project.findMany({ where: { draftId: { in: draftIds } }, select: { id: true } });
    const projectIds = projects.map(project => project.id);
    if (projectIds.length > 0) await db.specItem.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.draftBlock.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.clientUtterance.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.draft.deleteMany({ where: { id: { in: draftIds } } });
  }
  if (blockIds.length > 0) await db.blockCatalog.deleteMany({ where: { id: { in: blockIds } } });
  if (userIds.length > 0) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length > 0) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe("A-05 pricing PostgreSQL integration", () => {
  it("routes price reports through the common app with bearer authentication", async () => {
    const { clientId, draftId } = await makeDraftWithBlock();
    const token = issueAccessToken({
      userId: clientId,
      role: Role.CLIENT,
      expiresAt: new Date("2026-11-03T09:00:00.000Z").getTime() + 60_000,
    }, tokenSecret);
    const baseUrl = await startCommonAppServer();
    const response = await fetch(`${baseUrl}/drafts/${draftId}/price-report`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json() as { data?: { estimatedTotal?: number } };

    expect(response.status).toBe(200);
    expect(body.data?.estimatedTotal).toBe(1050);

    const applyResponse = await fetch(`${baseUrl}/drafts/${draftId}/apply-estimate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const applyBody = await applyResponse.json() as { data?: { estimatedTotal?: number; hopeBudget?: number } };

    expect(applyResponse.status).toBe(200);
    expect(applyBody.data).toMatchObject({ estimatedTotal: 1050, hopeBudget: 1050 });
  });

  it("A-05-T02 keeps the existing DraftBlock price snapshot after catalog price changes", async () => {
    const { clientId, draftId, blockId } = await makeDraftWithBlock();
    const before = await getPriceReport(db, draftId, clientId);
    await db.blockCatalog.update({ where: { id: blockId }, data: { unitPrice: 25_000 } });
    const after = await getPriceReport(db, draftId, clientId);

    expect(before).toMatchObject({ subtotal: 1000, clientFee: 50, estimatedTotal: 1050 });
    expect(after).toMatchObject({ subtotal: 1000, clientFee: 50, estimatedTotal: 1050 });
    expect(after.items).toEqual(expect.arrayContaining([expect.objectContaining({ blockId, unitPrice: 1000 })]));
  });

  it("applies the snapshot estimate to the owner's hope budget and records the user action", async () => {
    const { clientId, draftId } = await makeDraftWithBlock();
    const now = new Date("2026-11-03T10:00:00.000Z");
    await db.draft.update({ where: { id: draftId }, data: { hopeBudget: 5000, lastActiveAt: new Date("2026-10-01T00:00:00.000Z") } });

    await expect(applyEstimateToBudget(db, draftId, clientId, now)).resolves.toMatchObject({
      hopeBudget: 1050,
      estimatedTotal: 1050,
    });
    const savedDraft = await db.draft.findUniqueOrThrow({ where: { id: draftId }, select: { hopeBudget: true, lastActiveAt: true } });
    expect(savedDraft).toEqual({ hopeBudget: 1050, lastActiveAt: now });
  });

  it("does not let another client apply the estimate to the draft", async () => {
    const { clientId, draftId } = await makeDraftWithBlock();
    const otherClientId = await makeUser(Role.CLIENT);
    const original = await db.draft.findUniqueOrThrow({ where: { id: draftId }, select: { hopeBudget: true } });

    await expect(applyEstimateToBudget(db, draftId, otherClientId, new Date("2026-11-03T10:00:00.000Z")))
      .rejects.toMatchObject({ status: 404 });
    expect(await db.draft.findUniqueOrThrow({ where: { id: draftId }, select: { hopeBudget: true } })).toEqual(original);
    expect(clientId).not.toBe(otherClientId);
  });

  it("A-05-T03 denies suppliers before any AI unit price is returned", async () => {
    const { draftId } = await makeDraftWithBlock();
    const supplierId = await makeUser(Role.SUPPLIER);
    const baseUrl = await startPricingServer({ userId: supplierId, role: Role.SUPPLIER });
    const response = await fetch(`${baseUrl}/drafts/${draftId}/price-report`);
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).not.toContain("1000");
    expect(body).not.toContain("priceBasis");
  });

  it("A-05-T03 hides another client's report as not found", async () => {
    const { draftId } = await makeDraftWithBlock();
    const otherClientId = await makeUser(Role.CLIENT);
    const baseUrl = await startPricingServer({ userId: otherClientId, role: Role.CLIENT });
    const response = await fetch(`${baseUrl}/drafts/${draftId}/price-report`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain("1000");
    expect(body).not.toContain("priceBasis");
  });

  it("POST /apply-estimate saves and returns the owner's snapshot total", async () => {
    const { clientId, draftId } = await makeDraftWithBlock();
    const baseUrl = await startPricingServer({ userId: clientId, role: Role.CLIENT });
    const response = await fetch(`${baseUrl}/drafts/${draftId}/apply-estimate`, { method: "POST" });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"hopeBudget":1050');
    expect(body).toContain('"estimatedTotal":1050');
  });
});
