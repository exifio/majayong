import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { createApp } from "../../src/app.ts";
import { issueAccessToken } from "../../src/modules/identity/auth.ts";
import { createAProjectDb, createProjectCandidateDb, createPrismaIntegrationDb } from "../../src/integration/prisma-wiring.ts";
import { createDraftCatalogAdapter } from "../../src/integration/draft-catalog-adapter.ts";
import { createAProjectSearchPort, createAProjectViewPort, createAProjectApplicationPort, createProjectCandidatePort } from "../../src/integration/a-ports.ts";
import { createProjectSearchPort } from "../../src/modules/market/project-search.ts";
import { createBRouters } from "../../src/server.ts";
import { createIntegrationPorts } from "../../src/integration/external-ports.ts";
import { createPrismaPorts } from "../../src/integration/prisma-wiring.ts";
import { createPrismaApplicationReadPort } from "../../src/modules/application/prisma-adapter.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("E2E-09 requires the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const tokenSecret = "e2e-09-token-secret-longer-than-32-chars";
const userIds: string[] = [];
const servers: any[] = [];

async function makeUser(role: Role): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `e2e09-${role.toLowerCase()}-${id}@example.invalid`, role } });
  if (role === Role.CLIENT) await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", profileCompleted: true } });
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

async function req(baseUrl: string, method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  for (const server of servers) server.close();
  await db.$disconnect();
});

describe("E2E-09 고객 문의", () => {
  it("의뢰인이 문의를 만들고 관리자가 답변한다", async () => {
    const clientId = await makeUser(Role.CLIENT);
    const adminId = await makeUser(Role.ADMIN);
    const clientToken = issueAccessToken({ userId: clientId, role: Role.CLIENT, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const adminToken = issueAccessToken({ userId: adminId, role: Role.ADMIN, expiresAt: Date.now() + 60_000 }, tokenSecret);
    const { baseUrl, close } = await startApp();

    const create = await req(baseUrl, "POST", "/api/v1/support/inquiries", clientToken, {
      category: "OTHER",
      title: "문의 제목",
      body: "문의 내용",
    });
    expect(create.status).toBe(201);
    const inquiryId = create.body.data.id;

    const adminList = await req(baseUrl, "GET", "/api/v1/admin/support/inquiries", adminToken);
    expect(adminList.status).toBe(200);

    const answer = await req(baseUrl, "POST", `/api/v1/admin/support/inquiries/${inquiryId}/answer`, adminToken, {
      answer: "답변 내용",
    });
    expect(answer.status).toBe(200);

    const detail = await req(baseUrl, "GET", `/api/v1/support/inquiries/${inquiryId}`, clientToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status ?? detail.body.data.answer).toBeTruthy();

    close();
  });
});
