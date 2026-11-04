import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DraftEntryType, PrismaClient, Role } from "@prisma/client";
import express, { type Request, type Response as ExpressResponse } from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { issueAccessToken } from "../identity/auth.ts";
import { requireActor } from "../identity/session.ts";
import { mountDraftApi, type AuthenticatedDraftRoute } from "./api.ts";
import { archiveInactiveDrafts, retryDraftFeaturesInBackground, type DraftCatalogAdapter, type DraftPorts } from "./service.ts";

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

  async function makeAccount(role: Role = Role.CLIENT, name: string | null = null): Promise<Account> {
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
    app.use((error: unknown, _req: Request, res: ExpressResponse, _next: express.NextFunction) => {
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
  async function call(base: string, method: string, path: string, token: string, data?: unknown): Promise<globalThis.Response> {
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
      await db.eventLog.deleteMany({ where: { OR: [{ userId: { in: ownerIds } }, ...(ids.length ? [{ draftId: { in: ids } }] : [])] } });
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

  it("A-04-T01 실패 후에도 입력과 대기 상태를 유지하고 카탈로그 해석을 재시도한다", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock(7100);
    const resolveExisting = jest.fn<DraftCatalogAdapter["resolveExisting"]>().mockRejectedValueOnce(new Error("temporary"));
    const generatePending = jest.fn<DraftCatalogAdapter["generatePending"]>().mockResolvedValue({ blockIds: [blockId], pendingFeatures: [] });
    const running = await runServer({ catalog: { resolveExisting, generatePending, recommend: async () => [] } });
    try {
      const response = await create(running.baseUrl, client, "예약 시스템 test-private@example.invalid");
      expect(response.status).toBe(201);
      const data = ((await response.json()) as { data: { id: string; pendingFeatures: { attempts: number }[]; utterances: { content: string }[] } }).data;
      expect(data.pendingFeatures[0]?.attempts).toBe(1);
      expect(data.utterances[0]?.content).toContain("test-private@example.invalid");
      const firstRender = await db.eventLog.findFirstOrThrow({ where: { draftId: data.id, type: "DRAFT_RENDERED" } });
      expect(firstRender.userId).toBe(client.id);
      expect(firstRender.payload).toMatchObject({ reusedBlocks: 0, generatedBlocks: 0, pendingFeatures: 1, durationMs: expect.any(Number) });
      const retry = await call(running.baseUrl, "POST", `/drafts/${data.id}/retry`, client.token, {});
      expect(retry.status).toBe(200);
      const retried = ((await retry.json()) as { data: { pendingFeatures: unknown[]; blocks: { unitPrice: number }[] } }).data;
      expect(retried.pendingFeatures).toEqual([]);
      expect(retried.blocks.map(block => block.unitPrice)).toEqual([7100]);
      expect(await db.eventLog.count({ where: { draftId: data.id, type: "DRAFT_RENDERED" } })).toBe(1);
      expect(generatePending).toHaveBeenCalledTimes(1);
    } finally { await stopServer(running.server); }
  });

  it("최초로 저장된 초안 조회에 대해 렌더링 지표를 한 번만 기록한다", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock();
    const resolveExisting = jest.fn<DraftCatalogAdapter["resolveExisting"]>().mockResolvedValue({ blockIds: [blockId], pendingFeatures: [], reusedBlocks: 1 });
    activePorts = { catalog: { ...defaultCatalog, resolveExisting } };
    const running = await runServer();
    try {
      const created = await create(running.baseUrl, client);
      expect(created.status).toBe(201);
      const draft = ((await created.json()) as { data: { id: string } }).data;
      const rendered = await db.eventLog.findFirstOrThrow({ where: { draftId: draft.id, type: "DRAFT_RENDERED" } });
      expect(rendered.payload).toMatchObject({ reusedBlocks: 1, generatedBlocks: 0, pendingFeatures: 0, durationMs: expect.any(Number) });
      expect(await db.eventLog.count({ where: { draftId: draft.id, type: "DRAFT_INPUT_SUBMITTED" } })).toBe(1);

      await call(running.baseUrl, "POST", `/drafts/${draft.id}/messages`, client.token, { text: "예약 변경" });
      expect(await db.eventLog.count({ where: { draftId: draft.id, type: "DRAFT_RENDERED" } })).toBe(1);
    } finally { await stopServer(running.server); }
  });

  it("초안 생성과 채팅 해석이 겹쳐도 최초 렌더링 이벤트를 한 번만 기록한다", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock();
    let resolveCount = 0;
    let startFirst!: () => void;
    let releaseBoth!: () => void;
    const firstStarted = new Promise<void>(resolve => { startFirst = resolve; });
    const bothReady = new Promise<void>(resolve => { releaseBoth = resolve; });
    const resolveExisting: DraftCatalogAdapter["resolveExisting"] = async () => {
      resolveCount += 1;
      if (resolveCount === 1) startFirst();
      if (resolveCount === 2) releaseBoth();
      await bothReady;
      return { blockIds: [blockId], pendingFeatures: [], reusedBlocks: 1 };
    };
    const running = await runServer({ catalog: { ...defaultCatalog, resolveExisting } });
    try {
      const creating = create(running.baseUrl, client);
      await firstStarted;
      const draft = await db.draft.findFirstOrThrow({ where: { clientId: client.id, status: "IN_PROGRESS" }, orderBy: { createdAt: "desc" } });
      const editing = call(running.baseUrl, "POST", `/drafts/${draft.id}/messages`, client.token, { text: "예약 변경" });
      const [created, edited] = await Promise.all([creating, editing]);
      expect(created.status).toBe(201);
      expect(edited.status).toBe(200);
      expect(await db.eventLog.count({ where: { draftId: draft.id, type: "DRAFT_RENDERED" } })).toBe(1);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T02 채팅 30회 수정 후에도 추천·제거 액션을 보존한다", async () => {
    const client = await makeAccount();
    const assigned = await makeBlock();
    const recommendations = await Promise.all(Array.from({ length: 4 }, () => makeBlock()));
    activePorts = { catalog: { ...defaultCatalog, resolveExisting: async () => ({ blockIds: [assigned], pendingFeatures: [] }), recommend: async () => recommendations } };
    const running = await runServer();
    try {
      const data = ((await (await create(running.baseUrl, client)).json()) as { data: { id: string } }).data;
      for (let index = 0; index < 30; index += 1) {
        expect((await call(running.baseUrl, "POST", `/drafts/${data.id}/messages`, client.token, { text: `수정 ${index}` })).status).toBe(200);
      }
      expect((await call(running.baseUrl, "POST", `/drafts/${data.id}/messages`, client.token, { text: "31번째 수정" })).status).toBe(409);
      const suggested = await call(running.baseUrl, "GET", `/drafts/${data.id}/recommendations`, client.token);
      expect(suggested.status).toBe(200);
      expect(((await suggested.json()) as { data: unknown[] }).data).toHaveLength(4);
      expect((await call(running.baseUrl, "DELETE", `/drafts/${data.id}/blocks/${assigned}`, client.token)).status).toBe(200);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T03 초안 3개 제한을 강제하고 복원 시에도 다시 확인한다", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const created = await Promise.all(Array.from({ length: 3 }, () => create(running.baseUrl, client)));
      expect(created.every(item => item.status === 201)).toBe(true);
      const archivedIds = await Promise.all(created.map(async item => ((await item.json()) as { data: { id: string } }).data.id));
      expect((await create(running.baseUrl, client)).status).toBe(409);
      currentTime = new Date(currentTime.getTime() + 31 * 86_400_000);
      await archiveInactiveDrafts(db, currentTime);
      expect((await db.draft.findMany({ where: { id: { in: archivedIds }, status: "ABANDONED" } })).length).toBe(3);
      const active = await Promise.all(Array.from({ length: 3 }, () => create(running.baseUrl, client)));
      expect(active.every(item => item.status === 201)).toBe(true);
      expect((await call(running.baseUrl, "POST", `/drafts/${archivedIds[0]}/restore`, client.token, {})).status).toBe(409);
      const removeId = ((await active[0]!.json()) as { data: { id: string } }).data.id;
      expect((await call(running.baseUrl, "DELETE", `/drafts/${removeId}`, client.token)).status).toBe(200);
      expect((await call(running.baseUrl, "POST", `/drafts/${archivedIds[0]}/restore`, client.token, {})).status).toBe(200);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T04 활동 시각을 건드리지 않고 비활동 경계에서 정확히 보관 처리한다", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const data = ((await (await create(running.baseUrl, client)).json()) as { data: { id: string; lastActiveAt: string } }).data;
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

  it("A-04-T05 목록·상세에서 소프트 삭제 초안을 제외한다", async () => {
    const client = await makeAccount();
    const running = await runServer();
    try {
      const id = ((await (await create(running.baseUrl, client)).json()) as { data: { id: string } }).data.id;
      expect((await call(running.baseUrl, "DELETE", `/drafts/${id}`, client.token)).status).toBe(200);
      expect(((await (await call(running.baseUrl, "GET", "/drafts", client.token)).json()) as { data: unknown[] }).data).toEqual([]);
      expect((await call(running.baseUrl, "GET", `/drafts/${id}`, client.token)).status).toBe(404);
    } finally { await stopServer(running.server); }
  });

  it("A-04-T06 동시 블록 추가를 중복 제거하고 최초 가격 스냅샷을 보존한다", async () => {
    const client = await makeAccount();
    const blockId = await makeBlock(5000);
    const running = await runServer();
    try {
      const id = ((await (await call(running.baseUrl, "POST", "/drafts", client.token, { entryType: DraftEntryType.DEFAULT_DRAFT })).json()) as { data: { id: string } }).data.id;
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

  it("A-04-T07 조회·백그라운드 재시도가 아닌 사용자 액션에만 활동 시각을 갱신한다", async () => {
    const client = await makeAccount();
    const catalog: DraftCatalogAdapter = {
      resolveExisting: async () => ({ blockIds: [], pendingFeatures: [{ key: "new", summary: "새 기능", attempts: 0, lastTriedAt: null }] }),
      generatePending: async () => { throw new Error("retry failed"); },
      recommend: async () => [],
    };
    const running = await runServer({ catalog });
    try {
      const data = ((await (await create(running.baseUrl, client)).json()) as { data: { id: string; lastActiveAt: string } }).data;
      currentTime = new Date(currentTime.getTime() + 60_000);
      await call(running.baseUrl, "GET", `/drafts/${data.id}`, client.token);
      await call(running.baseUrl, "GET", "/drafts", client.token);
      await retryDraftFeaturesInBackground(db, data.id, { catalog }, currentTime);
      expect((await db.draft.findUniqueOrThrow({ where: { id: data.id } })).lastActiveAt.toISOString()).toBe(data.lastActiveAt);
      await call(running.baseUrl, "GET", `/drafts/${data.id}/recommendations`, client.token);
      expect((await db.draft.findUniqueOrThrow({ where: { id: data.id } })).lastActiveAt.getTime()).toBe(currentTime.getTime());
    } finally { await stopServer(running.server); }
  });

  it("A-04-T08 다른 의뢰인의 초안을 숨기고 공급자의 원문 발화 접근을 차단한다", async () => {
    const owner = await makeAccount(Role.CLIENT, "민들레 사장님");
    const other = await makeAccount();
    const supplier = await makeAccount(Role.SUPPLIER);
    await db.clientProfile.create({ data: { userId: owner.id, businessName: "민들레 가게", storeAddress: "서울 종로구", websiteUrl: "https://shop.example.invalid" } });
    const resolveExisting = jest.fn<DraftCatalogAdapter["resolveExisting"]>().mockResolvedValue({ blockIds: [], pendingFeatures: [] });
    const running = await runServer({ catalog: { ...defaultCatalog, resolveExisting } });
    try {
      const raw = "민들레 사장님 민들레 가게 서울 종로구 https://shop.example.invalid test-private@example.invalid 010-1234-5678";
      const data = ((await (await create(running.baseUrl, owner, raw)).json()) as { data: { id: string; utterances: { content: string }[] } }).data;
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
