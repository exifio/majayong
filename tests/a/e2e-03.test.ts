import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { createApp } from "../../src/app.ts";
import { issueAccessToken } from "../../src/modules/identity/auth.ts";
import { createDraftCatalogAdapter } from "../../src/integration/draft-catalog-adapter.ts";
import { seedReservationRestaurantCatalog } from "../../src/modules/catalog/seed.ts";
import { createAProjectDb, createProjectCandidateDb, createPrismaIntegrationDb } from "../../src/integration/prisma-wiring.ts";
import { createAProjectSearchPort, createAProjectViewPort, createAProjectApplicationPort, createProjectCandidatePort } from "../../src/integration/a-ports.ts";
import { createProjectSearchPort } from "../../src/modules/market/project-search.ts";
import { createBRouters } from "../../src/server.ts";
import { createIntegrationPorts } from "../../src/integration/external-ports.ts";
import { createPrismaPorts } from "../../src/integration/prisma-wiring.ts";
import { createPrismaApplicationReadPort } from "../../src/modules/application/prisma-adapter.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("E2E-03 requires the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const tokenSecret = "e2e-03-token-secret-longer-than-32-chars";
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const servers: any[] = [];

async function makeClient(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e03c-${id}@example.invalid`, role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
  return id;
}
async function makeSupplier(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e03s-${id}@example.invalid`, role: Role.SUPPLIER } });
  await db.supplierProfile.create({ data: { userId: id, displayName: "공급자", ndaAgreedAt: new Date(), ndaVersion: "nda-v1" } });
  return id;
}

function startApp(): Promise<{ baseUrl: string; close: () => void }> {
  const aProjectDb = createAProjectDb(db);
  const candidateDb = createProjectCandidateDb(db);
  const projectPorts = {
    supplierNdaVersion: "nda-v1",
    search: createAProjectSearchPort(createProjectSearchPort(createProjectCandidatePort(candidateDb))),
    view: createAProjectViewPort(aProjectDb),
    application: createAProjectApplicationPort(aProjectDb) as never,
  };
  const integrationDb = createPrismaIntegrationDb(db);
  const externalPorts = createIntegrationPorts(integrationDb, { now: () => new Date() });
  const applicationRead = createPrismaApplicationReadPort(createPrismaPorts(db).applicationRead);
  const bRouters = createBRouters(createPrismaPorts(db), externalPorts, applicationRead).map((m: any) => m.router);
  const app = createApp({
    db,
    tokenSecret,
    google: { clientId: "", clientSecret: "", redirectUri: "" },
    projectDisclosureConsentVersion: () => "project-disclosure-v0.1-draft",
    project: projectPorts,
    draft: { catalog: createDraftCatalogAdapter(db, {}) },
    profile: { encryptionKey: process.env.PROFILE_DATA_KEY ?? "0123456789abcdef0123456789abcdef", supplierNdaVersion: "nda-v1" },
    routers: bRouters,
  });
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
    servers.push(server);
  });
}

async function req(baseUrl: string, method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await seedReservationRestaurantCatalog(db);
});

afterAll(async () => {
  await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
  await db.draft.deleteMany({ where: { id: { in: draftIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  for (const server of servers) server.close();
  await db.$disconnect();
});

describe("E2E-03 chat and agreement", () => {
  it("opens chat, exchanges messages, and confirms agreement", async () => {
    const clientId = await makeClient();
    const clientToken = issueAccessToken({ userId: clientId, role: Role.CLIENT, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const supplierId = await makeSupplier();
    const supplierToken = issueAccessToken({ userId: supplierId, role: Role.SUPPLIER, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const { baseUrl, close } = await startApp();

    const createDraft = await req(baseUrl, "POST", "/api/v1/drafts", clientToken, { entryType: "DEFAULT_DRAFT" });
    expect(createDraft.status).toBe(201);
    const draftId = createDraft.body.data.id;
    draftIds.push(draftId);

    const publish = await req(baseUrl, "POST", `/api/v1/drafts/${draftId}/publish`, clientToken, {
      disclosureConsentVersion: "project-disclosure-v0.1-draft",
      disclosureConsent: true,
      disclosureScope: "FULL",
      deadline: "2026-11-10T09:00:00.000Z",
    });
    expect(publish.status).toBe(201);
    const projectId = publish.body.data.projectId;
    projectIds.push(projectId);

    const specItems = await db.specItem.findMany({ where: { projectId, versionNo: 1, status: "INCLUDED" } });
    const detail = await req(baseUrl, "GET", `/api/v1/projects/${projectId}`, supplierToken);
    expect(detail.status).toBe(200);
    const submit = await req(baseUrl, "POST", `/api/v1/projects/${projectId}/applications`, supplierToken, {
      items: specItems.map(item => ({ specItemId: item.id, isAvailable: true })),
      totalAmount: 100000,
      durationDays: 3,
      message: "지원합니다",
      questions: [{ text: "질문1" }, { text: "질문2" }, { text: "질문3" }],
    });
    expect(submit.status).toBe(201);
    const applicationId = submit.body.data.id;

    const openChat = await req(baseUrl, "POST", `/api/v1/applications/${applicationId}/chat/open`, clientToken, {});
    expect(openChat.status).toBe(200);

    const clientMsg = await req(baseUrl, "POST", `/api/v1/applications/${applicationId}/messages`, clientToken, { body: "안녕하세요" });
    expect(clientMsg.status).toBe(201);
    const supplierMsg = await req(baseUrl, "POST", `/api/v1/applications/${applicationId}/messages`, supplierToken, { body: "네 안녕하세요" });
    expect(supplierMsg.status).toBe(201);

    const contracts = await req(baseUrl, "GET", "/api/v1/me/contracts", clientToken);
    console.error("CONTRACTS", contracts.status, JSON.stringify(contracts.body));
    const preview = await req(baseUrl, "GET", `/api/v1/applications/${applicationId}/agreement-preview`, clientToken);
    expect(preview.status).toBe(200);

    const spec = preview.body.data.draft.items;
    const agreementDraft = {
      items: spec.map((item: any) => ({
        blockId: item.blockId,
        specItemId: null,
        title: item.title,
        stage: item.stage,
        conditions: item.conditions.map((condition: any) => ({
          key: condition.key,
          text: condition.text,
          state: "UNDECIDED",
          evidenceMessageIds: [],
        })),
      })),
      interimRatio: 50,
      ratioState: "UNDECIDED",
      cachedAt: new Date().toISOString(),
      lastMessageAt: null,
    };
    await db.application.update({ where: { id: applicationId }, data: { agreementDraft } });

    const confirm = await req(baseUrl, "POST", `/api/v1/applications/${applicationId}/agreement/confirm`, clientToken, {});
    expect(confirm.status).toBe(201);

    close();
  });
});
