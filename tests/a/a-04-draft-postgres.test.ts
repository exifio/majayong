import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DraftEntryType, PrismaClient, Role } from "@prisma/client";
import express, { type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { issueAccessToken } from "../../src/modules/identity/auth.ts";
import { requireActor } from "../../src/modules/identity/session.ts";
import { mountDraftApi, type AuthenticatedDraftRoute } from "../../src/modules/draft/api.ts";
import { archiveInactiveDrafts, retryDraftFeaturesInBackground, type DraftCatalogAdapter, type DraftPorts } from "../../src/modules/draft/service.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const safeDedicatedDatabase = (() => {
  if (!databaseUrl) return false;
  try { return new URL(databaseUrl).pathname === "/majayong_a00_test"; } catch { return false; }
})();
const postgresDescribe = safeDedicatedDatabase ? describe : describe.skip;
if (safeDedicatedDatabase && databaseUrl) process.env.DATABASE_URL = databaseUrl;

const secret = "a-04-draft-postgres-test-token-secret-over-32-bytes";
const baseTime = new Date("2026-11-03T09:00:00.000Z");
type Account = { id: string; token: string };
type RunningServer = { server: Server; baseUrl: string };

postgresDescribe("A-04 PostgreSQL integration (safe only for majayong_a00_test)", () => {
  let db: PrismaClient;
  let currentTime = new Date(baseTime);
  const accounts: Account[] = [];
  const catalogIds: string[] = [];
  let activePorts: DraftPorts;

  const defaultCatalog: DraftCatalogAdapter = {
    resolveExisting: async () => ({ blockIds: [], pendingFeatures: [] }),
    generatePending: async () => ({ blockIds: [], pendingFeatures: [] }),
    recommend: async () => [],
  };

  async function makeAccount(role = Role.CLIENT, name: string | null = null): Promise<Account> {
    const id = randomUUID();
    const row = await db.user.create({ data: { id, email: `a04-${id}@example.invalid`, role, name } });
    const token = issueAccessToken({ userId: row.id, role, expiresAt: currentTime.getTime() + 365 * 86_400_000 }, secret);
    const account = { id: row.id, token };
    accounts.push(account);
    return account;
  }

  async function makeBlock(price = 5000): Promise<string> {
    const id = randomUUID();
    await db.blockCatalog.create({ data: {
      id, code: `a04-${id}`, name: "예약 관리", functionSummary: "예약 시간을 관리한다", description: "예약 시간과 상태 표시",
      industryCode: "TEST", techTags: [], unitPrice: price, priceBasis: "테스트 단가", conditions: [{ key: "capacity", text: "수용 인원" }],
    } });
    catalogIds.push(id);
    return id;
  }

  async function runServer(ports: DraftPorts = activePorts): Promise<RunningServer> {
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
    const router = express.Router();
    const authenticated: AuthenticatedDraftRoute = handler => (req, res, next) => {
      const match = /^Bearer ([^\s]+)$/.exec(req.get("authorization") ?? "");
      if (!match) { res.status(401).end(); return; }
      void requireActor(db, match[1]!, secret, currentTime.getTime()).then(actor => handler(req, res, actor)).catch(next);
    };
    mountDraftApi(router, db, ports, () => new Date(currentTime), authenticated);
    app.use("/api/v1", router);
    app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: error instanceof Error ? error.message : "INTERNAL_ERROR" } });
    });
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
    return { server, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
  }

  async function stopServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  async function call(base: string, method: string, path: string, token: string, data?: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(data === undefined ? {} : { "content-type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  }
  function create(base: string, client: Account, text = "예약 페이지를 만들고 싶어요") {
    return call(base, "POST", "/drafts", client.token, { entryType: DraftEntryType.SENTENCE, text });
  }

  beforeAll(() => { db = new PrismaClient(); });
  beforeEach(() => { currentTime = new Date(baseTime); activePorts = { catalog: defaultCatalog }; });
  afterAll(async () => {
    if (accounts.length) {
      const ownerIds = accounts.map(item => item.id);
      const drafts = await db.draft.findMany({ where: { clientId: { in: ownerIds } }, select: { id: true } });
      const ids = drafts.map(item => item.id);
      if (ids.length) {
        await db.draftBlock.deleteMany({ where: { draftId: { in: ids } } });
        await db.clientUtterance.deleteMany({ where: { draftId: { in: ids } } });
        await db.draft.deleteMany({ where: { id: { in: ids } } });
      }
      await db.clientProfile.deleteMany({ where: { userId: { in: ownerIds } } });
      await db.user.deleteMany({ where: { id: { in: ownerIds } } });
    }
    if (catalogIds.length) await db.blockCatalog.deleteMany({ where: { id: { in: catalogIds } } });
    await db.$disconnect();
  });

  it("A-04-T01 keeps input and pending state after failure, then retries catalog resolution", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock(7100);
    const resolveExisting = jest.fn<DraftCatalogAdapter["resolveExisting"]>().mockRejectedValueOnce(new Error("temporary"));
    const generatePending = jest.fn<DraftCatalogAdapter["generatePending"]>().mockResolvedValue({ blockIds: [blockId], pendingFeatures: [] });
    const running = await runServer({ catalog: { resolveExisting, generatePending, recommend: async () => [] } });
    try {
      const response = await create(running.baseUrl, client, "예약 시스템 test-private@example.invalid");
      expect(response.status).toBe(201);
      const data = (await response.json() as { data: { id: string; pendingFeatures: { attempts: number }[]; utterances: { content: string }[] } }).data;
      expect(data.pendingFeatures[0]?.attempts).toBe(1);
      expect(data.utterances[0]?.content).toContain("test-private@example.invalid");
      const retry = await call(running.baseUrl, "POST", `/drafts/${data.id}/retry`, client.token, {});
      expect(retry.status).toBe(200);
      const retried = (await retry.json() as { data: { pendingFeatures: unknown[]; blocks: { unitPrice: number }[] } }).data;
      expect(retried.pendingFeatures).toEqual([]);
      expect(retried.blocks.map(block => block.unitPrice)).toEqual([7100]);
      expect(generatePending).toHaveBeenCalledTimes(1);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T02 preserves recommendation and removal actions after 30 chat edits", async () => {
    const client = await makeAccount();
    const assigned = await makeBlock();
    const recommendations = await Promise.all(Array.from({ length: 4 }, () => makeBlock()));
    activePorts = { catalog: { ...defaultCatalog, resolveExisting: async () => ({ blockIds: [assigned], pendingFeatures: [] }), recommend: async () => recommendations } };
    const running = await runServer();
    try {
      const data = (await (await create(running.baseUrl, client)).json() as { data: { id: string } }).data;
      for (let index = 0; index < 30; index += 1) {
        expect((await call(running.baseUrl, "POST", `/drafts/${data.id}/messages`, client.token, { text: `수정 ${index}` })).status).toBe(200);
      }
      expect((await call(running.baseUrl, "POST", `/drafts/${data.id}/messages`, client.token, { text: "31번째 수정" })).status).toBe(409);
      const suggested = await call(running.baseUrl, "GET", `/drafts/${data.id}/recommendations`, client.token);
      expect(suggested.status).toBe(200);
      expect((await suggested.json() as { data: unknown[] }).data).toHaveLength(4);
      expect((await call(running.baseUrl, "DELETE", `/drafts/${data.id}/blocks/${assigned}`, client.token)).status).toBe(200);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T03 enforces the three-draft limit and checks it again on restore", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const created = await Promise.all(Array.from({ length: 3 }, () => create(running.baseUrl, client)));
      expect(created.every(item => item.status === 201)).toBe(true);
      const archivedIds = await Promise.all(created.map(async item => (await item.json() as { data: { id: string } }).data.id));
      expect((await create(running.baseUrl, client)).status).toBe(409);
      currentTime = new Date(currentTime.getTime() + 31 * 86_400_000);
      await archiveInactiveDrafts(db, currentTime);
      expect((await db.draft.findMany({ where: { id: { in: archivedIds }, status: "ABANDONED" } })).length).toBe(3);
      const active = await Promise.all(Array.from({ length: 3 }, () => create(running.baseUrl, client)));
      expect(active.every(item => item.status === 201)).toBe(true);
      expect((await call(running.baseUrl, "POST", `/drafts/${archivedIds[0]}/restore`, client.token, {})).status).toBe(409);
      const removeId = (await active[0]!.json() as { data: { id: string } }).data.id;
      expect((await call(running.baseUrl, "DELETE", `/drafts/${removeId}`, client.token)).status).toBe(200);
      expect((await call(running.baseUrl, "POST", `/drafts/${archivedIds[0]}/restore`, client.token, {})).status).toBe(200);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T04 archives exactly on the inclusive inactivity boundary without touching activity time", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const data = (await (await create(running.baseUrl, client)).json() as { data: { id: string; lastActiveAt: string } }).data;
      currentTime = new Date(currentTime.getTime() + 30 * 86_400_000 - 1);
      await archiveInactiveDrafts(db, currentTime);
      expect((await db.draft.findUniqueOrThrow({ where: { id: data.id } })).status).toBe("IN_PROGRESS");
      currentTime = new Date(currentTime.getTime() + 1);
      await archiveInactiveDrafts(db, currentTime);
      const row = await db.draft.findUniqueOrThrow({ where: { id: data.id } });
      expect(row.status).toBe("ABANDONED");
      expect(row.lastActiveAt.toISOString()).toBe(data.lastActiveAt);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T05 omits soft-deleted drafts from list and detail", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const id = (await (await create(running.baseUrl, client)).json() as { data: { id: string } }).data.id;
      expect((await call(running.baseUrl, "DELETE", `/drafts/${id}`, client.token)).status).toBe(200);
      expect((await (await call(running.baseUrl, "GET", "/drafts", client.token)).json() as { data: unknown[] }).data).toEqual([]);
      expect((await call(running.baseUrl, "GET", `/drafts/${id}`, client.token)).status).toBe(404);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T06 deduplicates concurrent block adds and preserves the first price snapshot", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock(5000);
    const running = await runServer();
    try {
      const id = (await (await call(running.baseUrl, "POST", "/drafts", client.token, { entryType: DraftEntryType.DEFAULT_DRAFT })).json() as { data: { id: string } }).data.id;
      await Promise.all([
        call(running.baseUrl, "POST", `/drafts/${id}/blocks`, client.token, { blockId }),
        call(running.baseUrl, "POST", `/drafts/${id}/blocks`, client.token, { blockId }),
      ]);
      await db.blockCatalog.update({ where: { id: blockId }, data: { unitPrice: 9000 } });
      await call(running.baseUrl, "DELETE", `/drafts/${id}/blocks/${blockId}`, client.token);
      expect((await call(running.baseUrl, "POST", `/drafts/${id}/blocks`, client.token, { blockId })).status).toBe(200);
      const rows = await db.draftBlock.findMany({ where: { draftId: id, blockId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.unitPrice).toBe(5000);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T07 updates activity only for user actions, not reads or background retries", async () => {
    const client = await makeAccount();
    const catalog: DraftCatalogAdapter = {
      resolveExisting: async () => ({ blockIds: [], pendingFeatures: [{ key: "new", summary: "새 기능", attempts: 0, lastTriedAt: null }] }),
      generatePending: async () => { throw new Error("retry failed"); },
      recommend: async () => [],
    };
    const running = await runServer({ catalog });
    try {
      const data = (await (await create(running.baseUrl, client)).json() as { data: { id: string; lastActiveAt: string } }).data;
      currentTime = new Date(currentTime.getTime() + 60_000);
      await call(running.baseUrl, "GET", `/drafts/${data.id}`, client.token);
      await call(running.baseUrl, "GET", "/drafts", client.token);
      await retryDraftFeaturesInBackground(db, data.id, { catalog }, currentTime);
      expect((await db.draft.findUniqueOrThrow({ where: { id: data.id } })).lastActiveAt.toISOString()).toBe(data.lastActiveAt);
      await call(running.baseUrl, "GET", `/drafts/${data.id}/recommendations`, client.token);
      expect((await db.draft.findUniqueOrThrow({ where: { id: data.id } })).lastActiveAt.getTime()).toBe(currentTime.getTime());
    } finally { await stopServer(running.server); }
  });

  it("A-04-T08 hides another client's draft and blocks supplier access to raw utterances", async () => {
    const owner = await makeAccount(Role.CLIENT, "민들레 사장님");
    const other = await makeAccount();
    const supplier = await makeAccount(Role.SUPPLIER);
    await db.clientProfile.create({ data: { userId: owner.id, businessName: "민들레 가게", storeAddress: "서울 종로구", websiteUrl: "https://shop.example.invalid" } });
    const resolveExisting = jest.fn<DraftCatalogAdapter["resolveExisting"]>().mockResolvedValue({ blockIds: [], pendingFeatures: [] });
    const running = await runServer({ catalog: { ...defaultCatalog, resolveExisting } });
    try {
      const raw = "민들레 사장님 민들레 가게 서울 종로구 https://shop.example.invalid test-private@example.invalid 010-1234-5678";
      const data = (await (await create(running.baseUrl, owner, raw)).json() as { data: { id: string; utterances: { content: string }[] } }).data;
      expect(data.utterances[0]?.content).toContain("test-private@example.invalid");
      expect((await call(running.baseUrl, "GET", `/drafts/${data.id}`, other.token)).status).toBe(404);
      expect((await call(running.baseUrl, "DELETE", `/drafts/${data.id}`, other.token)).status).toBe(404);
      const supplierRead = await call(running.baseUrl, "GET", `/drafts/${data.id}`, supplier.token);
      expect(supplierRead.status).toBe(403);
      expect(JSON.stringify(await supplierRead.json())).not.toContain("test-private@example.invalid");
      const sentText = resolveExisting.mock.calls[0]?.[0].utterances[0]?.text ?? "";
      for (const privateText of ["민들레 사장님", "민들레 가게", "서울 종로구", "https://shop.example.invalid", "test-private@example.invalid", "010-1234-5678"]) {
        expect(sentText).not.toContain(privateText);
      }
    } finally { await stopServer(running.server); }
  });
});
