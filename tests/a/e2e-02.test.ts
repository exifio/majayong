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
  throw new Error("E2E-02 requires the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const tokenSecret = "e2e-02-token-secret-longer-than-32-chars";
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const servers: any[] = [];

async function makeClient(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e02c-${id}@example.invalid`, role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
  return id;
}

async function makeSupplier(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e02s-${id}@example.invalid`, role: Role.SUPPLIER } });
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
  const externalPorts = createIntegrationPorts(createPrismaIntegrationDb(db), { now: () => new Date() });
  const prismaPorts = createPrismaPorts(db);
  const applicationRead = createPrismaApplicationReadPort(prismaPorts.applicationRead);
  const bRouters = createBRouters(prismaPorts, externalPorts, applicationRead).map(mounted => mounted.router);
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

describe("E2E-02 공급자 지원", () => {
  it("공급자가 게시된 프로젝트를 열람하고 지원서를 제출한다", async () => {
    const clientId = await makeClient();
    const clientToken = issueAccessToken({ userId: clientId, role: Role.CLIENT, expiresAt: Date.now() + 60_000 }, tokenSecret);
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

    const supplierId = await makeSupplier();
    const supplierToken = issueAccessToken({ userId: supplierId, role: Role.SUPPLIER, expiresAt: Date.now() + 60_000 }, tokenSecret);

    const detail = await req(baseUrl, "GET", `/api/v1/projects/${projectId}`, supplierToken);
    expect(detail.status).toBe(200);
    const specItemIds = detail.body.data.items.map((item: { specItemId?: string }) => item.specItemId);
    expect(specItemIds.every(Boolean)).toBe(true);

    const submit = await req(baseUrl, "POST", `/api/v1/projects/${projectId}/applications`, supplierToken, {
      items: [{ specItemId: specItemIds[0], isAvailable: true }],
      totalAmount: 100000,
      durationDays: 3,
      message: "지원합니다",
      questions: [{ text: "질문1" }, { text: "질문2" }, { text: "질문3" }],
    });
    expect(submit.status).toBe(201);

    close();
  });
});
