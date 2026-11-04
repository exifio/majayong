import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { ContractStatus, EventType, PrismaClient, Role } from "@prisma/client";
import { createApp } from "../../app.ts";
import { issueAccessToken } from "../identity/auth.ts";
import * as profileApi from "./api.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-02 tests require dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();
const secret = "a-02-profile-test-token-secret-longer-than-32-bytes";
const encryptionKey = Buffer.alloc(32, 17).toString("base64");
const now = new Date("2026-11-03T09:00:00.000Z");
const createdUsers = new Set<string>();
const createdProjects = new Set<string>();
const createdDrafts = new Set<string>();
const createdApplications = new Set<string>();
const createdContracts = new Set<string>();

type Account = { id: string; token: string };

async function user(role: Role, name = "Profile User"): Promise<Account> {
  const row = await prisma.user.create({ data: { email: `a02-${randomUUID()}@example.invalid`, role, name } });
  createdUsers.add(row.id);
  return { id: row.id, token: issueAccessToken({ userId: row.id, role, expiresAt: now.getTime() + 60_000 }, secret) };
}

async function supplier(name = "Supplier Name"): Promise<Account> {
  const account = await user(Role.SUPPLIER, name);
  await prisma.supplierProfile.create({ data: { userId: account.id, displayName: name, industryCodes: ["CAFE"], skills: ["POS"] } });
  return account;
}

async function withServer<T>(profile: Record<string, unknown>, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createServer(createApp({ db: prisma, tokenSecret: secret, now: () => now, profile: profile as never }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  try { return await run(`http://127.0.0.1:${address.port}/api/v1`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

async function request(baseUrl: string, method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createProject(clientId: string): Promise<string> {
  const draftId = randomUUID();
  const projectId = randomUUID();
  createdDrafts.add(draftId);
  createdProjects.add(projectId);
  await prisma.draft.create({ data: { id: draftId, clientId, entryType: "SENTENCE" } });
  await prisma.project.create({
    data: {
      id: projectId,
      draftId,
      confirmedAt: now,
      disclosureConsentVersion: "disclosure-v1",
      title: "Client project",
      summary: "Public project summary",
      industryCode: "CAFE",
      requiredSkills: [],
    },
  });
  return projectId;
}

afterAll(async () => {
  const ids = [...createdUsers];
  const projectIds = [...createdProjects];
  const draftIds = [...createdDrafts];
  const applicationIds = [...createdApplications];
  const contractIds = [...createdContracts];
  if (projectIds.length) await prisma.eventLog.deleteMany({ where: { projectId: { in: projectIds } } });
  if (ids.length) await prisma.eventLog.deleteMany({ where: { userId: { in: ids } } });
  if (contractIds.length) await prisma.review.deleteMany({ where: { contractId: { in: contractIds } } });
  if (contractIds.length) await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  if (applicationIds.length) await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
  if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  if (draftIds.length) await prisma.draft.deleteMany({ where: { id: { in: draftIds } } });
  if (ids.length) {
    await prisma.clientProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.supplierProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("A-02 profile and disclosure API", () => {
  it("prevents client and supplier cross-role profile mutation", async () => {
    const client = await user(Role.CLIENT);
    const vendor = await supplier();
    await withServer({ encryptionKey }, async baseUrl => {
      const clientToSupplier = await request(baseUrl, "PATCH", "/me/supplier-profile", client.token, { displayName: "intrusion" });
      const supplierToClient = await request(baseUrl, "PATCH", "/me/client-profile", vendor.token, { businessName: "intrusion" });
      expect(clientToSupplier.status).toBe(403);
      expect(supplierToClient.status).toBe(403);
      const clientPatch = await request(baseUrl, "PATCH", "/me/client-profile", client.token, { name: "Client One", businessName: "Shop One", industryField: "Cafe" });
      expect(clientPatch.status).toBe(200);
      expect((await clientPatch.json() as { data: Record<string, unknown> }).data).toMatchObject({ name: "Client One", businessName: "Shop One", profileCompleted: true });
      const clientGet = await request(baseUrl, "GET", "/me/client-profile", client.token);
      expect((await clientGet.json() as { data: Record<string, unknown> }).data).toMatchObject({ industryField: "Cafe" });
      const tax = await request(baseUrl, "PATCH", "/me/client-tax-info", client.token, { bizRegNo: "123-45-67890", taxInvoiceEmail: "client-private@example.invalid" });
      expect(tax.status).toBe(200);
      const taxData = (await tax.json() as { data: Record<string, unknown> }).data;
      expect(taxData).toMatchObject({ bizRegNoMasked: "******7890", taxInvoiceEmail: "client-private@example.invalid" });
      const storedClient = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: client.id } });
      expect(storedClient.bizRegNo).toMatch(/^enc:v1:/);
      expect(storedClient.taxInvoiceEmail).toMatch(/^enc:v1:/);
      expect(JSON.stringify(storedClient)).not.toContain("1234567890");
      expect(JSON.stringify(storedClient)).not.toContain("client-private@example.invalid");
    });
    expect(await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).toMatchObject({ displayName: "Supplier Name" });
    expect(await prisma.clientProfile.findUnique({ where: { userId: client.id } })).toMatchObject({ businessName: "Shop One", profileCompleted: true });
  });

  it("encrypts tax and payout identifiers, masks reads, and leaves failed verification unverified", async () => {
    const vendor = await supplier();
    const verify = jest.fn(async () => false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await withServer({ encryptionKey, payoutVerification: { verify } }, async baseUrl => {
      const tax = await request(baseUrl, "PATCH", "/me/supplier-tax-info", vendor.token, {
        businessType: "BUSINESS", bizRegNo: "123-45-67890", taxInvoiceEmail: "private@example.invalid",
      });
      expect(tax.status).toBe(200);
      const payout = await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, {
        bank: "KB", accountNo: "1234567890", holder: "Supplier Name",
      });
      expect(payout.status).toBe(200);
      const stored = await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } });
      expect(stored.bizRegNo).toMatch(/^enc:v1:/);
      expect(stored.payoutAccountNo).toMatch(/^enc:v1:/);
      expect(stored.taxInvoiceEmail).toMatch(/^enc:v1:/);
      expect(stored.bizRegNo).not.toContain("1234567890");
      expect(stored.payoutAccountNo).not.toContain("1234567890");
      expect(stored.taxInvoiceEmail).not.toContain("private@example.invalid");

      const failed = await request(baseUrl, "POST", "/me/payout-account/verify", vendor.token, { code: "000001" });
      expect(failed.status).toBe(422);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).toMatchObject({ payoutVerifiedAt: null });

      const ownProfile = await request(baseUrl, "GET", "/me/supplier-profile", vendor.token);
      expect(ownProfile.status).toBe(200);
      const ownData = (await ownProfile.json() as { data: Record<string, unknown> }).data;
      expect(ownData.payoutAccountMasked).toBe("******7890");
      expect(JSON.stringify(ownData)).not.toContain("1234567890");
      expect(ownData).not.toHaveProperty("taxInvoiceEmail");

      const success = await request(baseUrl, "POST", "/me/payout-account/verify", vendor.token, { code: "000002" });
      expect(success.status).toBe(200);
      expect(await profileApi.createPayoutAccountStatusPort(prisma).isVerified(vendor.id)).toBe(true);
      await expect(profileApi.createPayoutAccountStatusPort(prisma).requireVerified(vendor.id)).resolves.toBeUndefined();
      await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, { bank: "KB", accountNo: "9999999999", holder: "Supplier Name" });
      expect(await profileApi.createPayoutAccountStatusPort(prisma).isVerified(vendor.id)).toBe(false);
      await expect(profileApi.createPayoutAccountStatusPort(prisma).requireVerified(vendor.id)).rejects.toMatchObject({ code: "PAYOUT_ACCOUNT_UNVERIFIED" });
    });
  });

  it("rejects payout-account changes from non-suppliers and mismatched holders", async () => {
    const client = await user(Role.CLIENT, "Some Client");
    const vendor = await supplier("Supplier Name");
    await withServer({ encryptionKey }, async baseUrl => {
      const crossRole = await request(baseUrl, "PATCH", "/me/payout-account", client.token, { bank: "KB", accountNo: "12345678", holder: "Some Client" });
      expect(crossRole.status).toBe(403);

      const mismatch = await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, { bank: "KB", accountNo: "12345678", holder: "Someone Else" });
      expect(mismatch.status).toBe(422);
      expect((await mismatch.json() as { error: { code: string } }).error.code).toBe("PAYOUT_HOLDER_MISMATCH");

      const invalidAccount = await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, { bank: "KB", accountNo: "abc", holder: "Supplier Name" });
      expect(invalidAccount.status).toBe(400);

      const accepted = await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, { bank: "KB", accountNo: "12345678", holder: "Supplier Name" });
      expect(accepted.status).toBe(200);
      expect(await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).toMatchObject({ payoutVerifiedAt: null });
    });
  });

  it("requires consent and enforces five daily summary generations under concurrent requests", async () => {
    const vendor = await supplier();
    const sourceText = "private source text that must not enter event logs";
    const sourceReader = { read: jest.fn(async () => [sourceText]) };
    const generator = { generate: jest.fn(async () => ({ summary: "Draft portfolio summary", model: "mock", tokens: { input: 1, output: 2 }, costKrw: 0 })) };
    await withServer({ portfolioSourceReader: sourceReader, portfolioSummaryGenerator: generator }, async baseUrl => {
      const withoutConsent = await request(baseUrl, "POST", "/me/portfolio-summary/regenerate", vendor.token, {});
      expect(withoutConsent.status).toBe(409);
      expect(sourceReader.read).not.toHaveBeenCalled();

      const consent = await request(baseUrl, "PATCH", "/me/supplier-profile", vendor.token, {
        portfolioItems: [{ type: "LINK", url: "https://portfolio.example.invalid/work", title: "Work" }],
        portfolioConsent: true,
      });
      expect(consent.status).toBe(200);
      const results = await Promise.all(Array.from({ length: 6 }, () => request(baseUrl, "POST", "/me/portfolio-summary/regenerate", vendor.token, {})));
      expect(results.filter(result => result.status === 200)).toHaveLength(5);
      expect(results.filter(result => result.status === 429)).toHaveLength(1);
      expect(sourceReader.read).toHaveBeenCalledTimes(5);
      expect(generator.generate).toHaveBeenCalledTimes(5);
    });
    const quotaEvents = await prisma.eventLog.findMany({ where: { userId: vendor.id, type: EventType.LLM_CALLED } });
    expect(quotaEvents).toHaveLength(5);
    expect(quotaEvents[0]?.payload).toMatchObject({ purpose: "PORTFOLIO_SUMMARY", model: "mock", tokens: { input: 1, output: 2 }, costKrw: 0, succeeded: true });
    expect(await prisma.eventLog.count({ where: { userId: vendor.id, type: EventType.PORTFOLIO_SUMMARIZED } })).toBe(5);
    expect(JSON.stringify(quotaEvents)).not.toContain(sourceText);
    expect(JSON.stringify(quotaEvents)).not.toContain("portfolio.example.invalid");
  });

  it("fails closed when real payout and portfolio providers are not configured", async () => {
    const vendor = await supplier();
    await prisma.supplierProfile.update({ where: { userId: vendor.id }, data: {
      portfolioConsentAt: now,
      portfolioItems: [{ type: "LINK", url: "https://portfolio.example.invalid/work" }],
    } });
    await withServer({ encryptionKey }, async baseUrl => {
      const payout = await request(baseUrl, "PATCH", "/me/payout-account", vendor.token, { bank: "KB", accountNo: "1234567890", holder: "Supplier Name" });
      expect(payout.status).toBe(200);
      const verify = await request(baseUrl, "POST", "/me/payout-account/verify", vendor.token, { code: "000001" });
      const summary = await request(baseUrl, "POST", "/me/portfolio-summary/regenerate", vendor.token, {});
      expect(verify.status).toBe(503);
      expect(summary.status).toBe(503);
    });
    expect(await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).toMatchObject({ payoutVerifiedAt: null });
  });

  it("exposes a review rating cache port for the review writer", async () => {
    const client = await user(Role.CLIENT, "Review Client");
    const vendor = await supplier();
    await prisma.clientProfile.create({ data: { userId: client.id, businessName: "Review Client", profileCompleted: true } });
    const projectId = await createProject(client.id);
    const application = await prisma.application.create({ data: {
      projectId, supplierId: vendor.id, specVersionNo: 1, totalAmount: 100, durationDays: 1, firstViewedAt: now,
    } });
    createdApplications.add(application.id);
    const contract = await prisma.contract.create({ data: {
      applicationId: application.id, specVersionNo: 1, agreedAmount: 100, durationDays: 1,
      clientFee: 5, supplierFee: 5, consentDeadline: now, contentHash: randomUUID(), status: ContractStatus.COMPLETED,
    } });
    createdContracts.add(contract.id);
    await prisma.review.create({ data: {
      contractId: contract.id, reviewerId: client.id, revieweeId: vendor.id, reviewerRole: Role.CLIENT,
      rating: 5, tags: [],
    } });
    await prisma.review.create({ data: {
      contractId: contract.id, reviewerId: vendor.id, revieweeId: client.id, reviewerRole: Role.SUPPLIER,
      rating: 4, tags: [],
    } });
    const portFactory = (profileApi as unknown as { createProfileRatingPort?: (db: PrismaClient) => { refresh(userId: string): Promise<void> } }).createProfileRatingPort;
    expect(typeof portFactory).toBe("function");
    await portFactory!(prisma).refresh(vendor.id);
    await portFactory!(prisma).refresh(client.id);
    expect(await prisma.supplierProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).toMatchObject({ ratingAvg: 5, reviewCount: 1 });
    expect(await prisma.clientProfile.findUniqueOrThrow({ where: { userId: client.id } })).toMatchObject({ ratingAvg: 4, reviewCount: 1 });
  });

  it("publishes only consented summaries and returns a strict supplier allowlist with signed files", async () => {
    const vendor = await supplier();
    const privateVendor = await supplier("Private Supplier");
    await prisma.supplierProfile.update({ where: { userId: privateVendor.id }, data: {
      portfolioSummary: "Hidden private draft",
      portfolioSummaryStatus: "DRAFT",
      portfolioItems: [{ type: "LINK", url: "https://private.example.invalid/work", title: "Private" }],
    } });
    const fileKey = `${vendor.id}/portfolio/work.pdf`;
    const sourceReader = { read: jest.fn(async () => ["safe mock source"]) };
    const generator = { generate: jest.fn(async () => ({ summary: "Public summary private@example.invalid", model: "mock", tokens: { input: 1, output: 2 }, costKrw: 0 })) };
    const createSignedUrl = jest.fn(async (_userId: string, _objectKey: string, _expiresInSeconds: number) => "https://storage.example.invalid/signed?token=short");
    const fileSigner = { createSignedUrl };
    await withServer({ portfolioSourceReader: sourceReader, portfolioSummaryGenerator: generator, portfolioFileSigner: fileSigner }, async baseUrl => {
      const unsafeFile = await request(baseUrl, "PATCH", "/me/supplier-profile", vendor.token, {
        portfolioItems: [{ type: "FILE", url: `${vendor.id}/portfolio/%2e%2e/work.pdf` }],
        portfolioConsent: true,
      });
      expect(unsafeFile.status).toBe(400);
      const consent = await request(baseUrl, "PATCH", "/me/supplier-profile", vendor.token, {
        bio: "Public bio contact private@example.invalid 010-1234-5678",
        portfolioItems: [{ type: "FILE", url: fileKey, title: "Portfolio PDF" }],
        portfolioConsent: true,
      });
      expect(consent.status).toBe(200);
      const privateData = await request(baseUrl, "GET", `/profiles/suppliers/${privateVendor.id}`, vendor.token);
      expect((await privateData.json() as { data: Record<string, unknown> }).data).toMatchObject({ portfolioSummary: null, portfolioItems: [] });
      const generate = await request(baseUrl, "POST", "/me/portfolio-summary/regenerate", vendor.token, {});
      expect(generate.status).toBe(200);
      const publish = await request(baseUrl, "POST", "/me/portfolio-summary/publish", vendor.token, {});
      expect(publish.status).toBe(200);
      const publicResponse = await request(baseUrl, "GET", `/profiles/suppliers/${vendor.id}`, vendor.token);
      expect(publicResponse.status).toBe(200);
      const publicData = (await publicResponse.json() as { data: Record<string, unknown> }).data;
      expect(Object.keys(publicData).sort()).toEqual([
        "supplierId", "name", "profileImageUrl", "bio", "displayName", "createdAt", "industryCodes", "skills",
        "careerYears", "ratingAvg", "reviewCount", "completedContractCount", "portfolioSummary", "portfolioItems",
      ].sort());
      expect(publicData.portfolioSummary).toBe("Public summary [연락처 비공개]");
      expect(publicData.bio).toBe("Public bio contact [연락처 비공개] [연락처 비공개]");
      expect(publicData.portfolioItems).toEqual([{ type: "FILE", title: "Portfolio PDF", url: "https://storage.example.invalid/signed?token=short" }]);
      for (const forbidden of ["email", "bizRegNo", "taxInvoiceEmail", "payoutBank", "payoutAccountNo", "payoutHolder", "payoutVerifiedAt", "portfolioConsentAt", "ndaVersion"]) {
        expect(publicData).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(publicData)).not.toContain(fileKey);
      expect(createSignedUrl).toHaveBeenCalledWith(vendor.id, fileKey, 300);
      const hidden = await request(baseUrl, "POST", "/me/portfolio-summary/hide", vendor.token, {});
      expect(hidden.status).toBe(200);
      const hiddenPublic = await request(baseUrl, "GET", `/profiles/suppliers/${vendor.id}`, vendor.token);
      expect((await hiddenPublic.json() as { data: Record<string, unknown> }).data).toMatchObject({ portfolioSummary: null, portfolioItems: [] });
    });
  });

  it("does not expose a client profile before supplier NDA and detailed-disclosure evidence", async () => {
    const client = await user(Role.CLIENT, "Client Owner");
    await prisma.clientProfile.create({ data: { userId: client.id, businessName: "Client Shop", industryField: "Cafe", storeAddress: "Private after NDA", bizRegNo: "111-22-33333", taxInvoiceEmail: "client-tax@example.invalid", profileCompleted: true } });
    const vendor = await supplier();
    const projectId = await createProject(client.id);
    await withServer({ encryptionKey, supplierNdaVersion: "nda-v1" }, async baseUrl => {
      const noNda = await request(baseUrl, "GET", `/projects/${projectId}/client-profile`, vendor.token);
      expect(noNda.status).toBe(403);
      const acceptance = await request(baseUrl, "PATCH", "/me/supplier-profile", vendor.token, { ndaConsent: true });
      expect(acceptance.status).toBe(200);
      const noDetail = await request(baseUrl, "GET", `/projects/${projectId}/client-profile`, vendor.token);
      expect(noDetail.status).toBe(403);
      await prisma.eventLog.create({ data: { userId: vendor.id, projectId, type: EventType.SPEC_DETAIL_VIEWED, occurredAt: now } });
      const visible = await request(baseUrl, "GET", `/projects/${projectId}/client-profile`, vendor.token);
      expect(visible.status).toBe(200);
      const publicData = (await visible.json() as { data: Record<string, unknown> }).data;
      expect(Object.keys(publicData).sort()).toEqual([
        "name", "profileImageUrl", "bio", "businessName", "industryField", "storeAddress", "websiteUrl",
        "createdAt", "ratingAvg", "reviewCount", "recruitingProjectCount",
      ].sort());
      expect(publicData).toMatchObject({ name: "Client Owner", businessName: "Client Shop", storeAddress: "Private after NDA" });
      for (const forbidden of ["email", "bizRegNo", "taxInvoiceEmail", "payoutAccountNo", "clientUtterance"]) {
        expect(publicData).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(publicData)).not.toContain("client-tax@example.invalid");
      expect(JSON.stringify(publicData)).not.toContain("1112233333");
    });
  });
});
