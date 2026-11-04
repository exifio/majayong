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
  throw new Error("E2E-12 requires the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const tokenSecret = "e2e-12-token-secret-longer-than-32-chars";
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const servers: any[] = [];

async function makeClient(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `e2e12c-${id}@example.invalid`;
  userIds.push(id);
  await db.user.create({ data: { id, email, role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
  return { id, email };
}
async function makeSupplier(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e12s-${id}@example.invalid`, role: Role.SUPPLIER } });
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
  const prismaPorts = createPrismaPorts(db);
  const applicationRead = createPrismaApplicationReadPort(prismaPorts.applicationRead);
  const bRouters = createBRouters(prismaPorts, externalPorts, applicationRead).map((m: any) => m.router);
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

async function req(baseUrl: string, method: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  return { status: response.status, text };
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

describe("E2E-12 개인정보와 보안", () => {
  it("공개 프로젝트 상세에서 의뢰인 이메일·계정·AI 단가를 노출하지 않는다", async () => {
    const client = await makeClient();
    const clientToken = issueAccessToken({ userId: client.id, role: Role.CLIENT, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const supplierId = await makeSupplier();
    const supplierToken = issueAccessToken({ userId: supplierId, role: Role.SUPPLIER, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const { baseUrl, close } = await startApp();

    // req helper doesn't send body for GET only; use fetch directly for POST
    const draftRes = await fetch(`${baseUrl}/api/v1/drafts`, {
      method: "POST",
      headers: { authorization: `Bearer ${clientToken}`, "content-type": "application/json" },
      body: JSON.stringify({ entryType: "DEFAULT_DRAFT" }),
    });
    const draftBody = await draftRes.json() as { data: { id: string } };
    expect(draftRes.status).toBe(201);
    const draftId = draftBody.data.id;
    draftIds.push(draftId);

    const publishRes = await fetch(`${baseUrl}/api/v1/drafts/${draftId}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${clientToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        disclosureConsentVersion: "project-disclosure-v0.1-draft",
        disclosureConsent: true,
        disclosureScope: "FULL",
        deadline: "2026-11-10T09:00:00.000Z",
      }),
    });
    const publishBody = await publishRes.json() as { data: { projectId: string } };
    expect(publishRes.status).toBe(201);
    const projectId = publishBody.data.projectId;
    projectIds.push(projectId);

    const detailRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      headers: { authorization: `Bearer ${supplierToken}` },
    });
    const detailText = await detailRes.text();
    expect(detailRes.status).toBe(200);
    expect(detailText).not.toContain(client.email);
    expect(detailText).not.toContain("payoutAccount");
    expect(detailText).not.toContain("unitPrice");

    close();
  });
});
