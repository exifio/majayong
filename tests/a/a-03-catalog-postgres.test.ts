import { afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { BlockOrigin, BlockSource, DraftEntryType, PrismaClient, Role } from "@prisma/client";
import { generateOrReuseCatalogBlock } from "../../src/modules/catalog/service.ts";
import { mergeCatalogBlock, setCatalogBlockActive, updateCatalogBlockPrice } from "../../src/modules/catalog/admin.ts";
import type { CatalogBlockGenerator } from "../../src/modules/catalog/service.ts";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("A-03 tests require the dedicated local majayong_a00_test database");
const parsedTestDatabaseUrl = new URL(testDatabaseUrl);
if (!['localhost', '127.0.0.1'].includes(parsedTestDatabaseUrl.hostname) || parsedTestDatabaseUrl.pathname !== "/majayong_a00_test") {
  throw new Error("A-03 tests refuse to run outside the dedicated local majayong_a00_test database");
}
process.env.DATABASE_URL = testDatabaseUrl;
const prisma = new PrismaClient();
const userIds = new Set<string>();
const blockIds = new Set<string>();
const draftIds = new Set<string>();
const projectIds = new Set<string>();
const industryCodes = new Set<string>();

function testIndustryCode(): string {
  const value = `A03-${randomUUID().replace(/[0-9]/g, "")}`;
  industryCodes.add(value);
  return value;
}

function generatedBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Reservation calendar",
    functionSummary: "show and edit available reservation hours",
    description: "Lets staff manage booking times.",
    techTags: ["calendar", "booking"],
    wireframe: { parts: [{ type: "CALENDAR" }, { type: "FORM" }] },
    conditions: [
      { key: "timezone", text: "Choose the store timezone." },
      { key: "capacity", text: "Set the available reservation capacity." },
    ],
    unitPrice: 120000,
    priceBasis: "Implement reservation calendar and API.\nConnect booking data and validation.\nFinal scope may change the effort.",
    ...overrides,
  };
}

function generationResponse(content = generatedBlock()) {
  return { content, metadata: { model: "gpt-5.4-mini", tokens: { input: 100, output: 50 }, costKrw: 2, latencyMs: 30 } };
}

async function createClient() {
  const id = randomUUID();
  userIds.add(id);
  return prisma.user.create({
    data: {
      id,
      email: `a03-${id}@example.invalid`,
      name: "김하나",
      role: Role.CLIENT,
      clientProfile: { create: { businessName: "Cafe Blue", storeAddress: "서울 마포구 월드컵로 12" } },
    },
  });
}

async function createAdmin() {
  const id = randomUUID();
  userIds.add(id);
  return prisma.user.create({ data: { id, email: `a03-admin-${id}@example.invalid`, role: Role.ADMIN } });
}

async function createExistingBlock(industryCode: string, unitPrice = 7000, functionSummary = "show and edit available reservation hours") {
  const id = randomUUID();
  blockIds.add(id);
  return prisma.blockCatalog.create({
    data: {
      id,
      code: `A03-${id}`,
      name: "Existing reservation calendar",
      functionSummary,
      description: "Existing fixture",
      industryCode,
      techTags: [],
      source: BlockSource.TEAM,
      unitPrice,
      priceBasis: "Existing fixture.\nExisting fixture.\nExisting fixture.",
      isActive: true,
    },
  });
}

function generationInput(clientId: string, industryCode: string) {
  return {
    clientId,
    industryCode,
    trigger: BlockOrigin.FIRST_SENTENCE,
    text: "Cafe Blue 김하나 서울 마포구 월드컵로 12 010-1234-5678 hana@example.invalid 예약 달력을 만들고 싶어요.",
  };
}

afterAll(async () => {
  const ids = [...userIds];
  const fixtureBlocks = industryCodes.size
    ? await prisma.blockCatalog.findMany({ where: { industryCode: { in: [...industryCodes] } }, select: { id: true } })
    : [];
  const blockList = [...new Set([...blockIds, ...fixtureBlocks.map(block => block.id)])];
  const draftList = [...draftIds];
  const projectList = [...projectIds];
  if (ids.length) await prisma.eventLog.deleteMany({ where: { userId: { in: ids } } });
  if (projectList.length) await prisma.specItem.deleteMany({ where: { projectId: { in: projectList } } });
  if (projectList.length) await prisma.project.deleteMany({ where: { id: { in: projectList } } });
  if (draftList.length) await prisma.draftBlock.deleteMany({ where: { draftId: { in: draftList } } });
  if (draftList.length) await prisma.draft.deleteMany({ where: { id: { in: draftList } } });
  if (blockList.length) await prisma.blockCatalog.updateMany({ where: { id: { in: blockList } }, data: { mergedIntoId: null } });
  if (blockList.length) await prisma.blockCatalog.deleteMany({ where: { id: { in: blockList } } });
  if (ids.length) await prisma.clientProfile.deleteMany({ where: { userId: { in: ids } } });
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("A-03 catalog generation and reuse", () => {
  it("redacts client profile data before AI input and reuses an existing price", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    const existing = await createExistingBlock(industryCode, 7000);
    const providerInputs: string[] = [];
    const generator: CatalogBlockGenerator = async input => {
      providerInputs.push(input.text);
      return generationResponse(generatedBlock({ unitPrice: 120000 }));
    };

    const result = await generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), generator);

    expect(result.status).toBe("REUSED");
    if (result.status !== "REUSED") throw new Error("Expected an existing catalog block");
    expect(result.block.id).toBe(existing.id);
    expect(result.block.unitPrice).toBe(7000);
    blockIds.add(result.block.id);
    for (const value of ["Cafe Blue", "김하나", "서울 마포구 월드컵로 12", "010-1234-5678", "hana@example.invalid"]) {
      expect(providerInputs[0]).not.toContain(value);
    }
    expect(await prisma.blockCatalog.count({ where: { industryCode } })).toBe(1);
  });

  it("does not reuse inactive or merged blocks", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    const inactive = await createExistingBlock(industryCode, 7000);
    await prisma.blockCatalog.update({ where: { id: inactive.id }, data: { isActive: false } });
    const target = await createExistingBlock(industryCode, 9000, "a different function");
    const merged = await createExistingBlock(industryCode, 8000);
    await prisma.blockCatalog.update({ where: { id: merged.id }, data: { mergedIntoId: target.id } });

    const result = await generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), async () => generationResponse());

    expect(result.status).toBe("CREATED");
    if (result.status !== "CREATED") throw new Error("Expected a new catalog block");
    blockIds.add(result.block.id);
    expect(result.block.unitPrice).toBe(120000);
    expect(await prisma.blockCatalog.count({ where: { industryCode, isActive: true, mergedIntoId: null } })).toBe(2);
  });

  it("serializes concurrent same-industry creation and stores one block", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    const calls: string[] = [];
    const generator: CatalogBlockGenerator = async input => {
      calls.push(input.text);
      await new Promise(resolve => setTimeout(resolve, 10));
      return generationResponse();
    };

    const results = await Promise.all([
      generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), generator),
      generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), generator),
    ]);

    expect(calls).toHaveLength(2);
    expect(results.map(result => result.status).sort()).toEqual(["CREATED", "REUSED"]);
    for (const result of results) if (result.status !== "PENDING") blockIds.add(result.block.id);
    expect(await prisma.blockCatalog.count({ where: { industryCode, isActive: true, mergedIntoId: null } })).toBe(1);
  });

  it("retries one invalid private output, then stores only the safe response", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    const outputs = [generationResponse(generatedBlock({ name: "Cafe Blue schedule" })), generationResponse()];
    let calls = 0;
    const generator: CatalogBlockGenerator = async () => outputs[calls++];

    const result = await generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), generator);

    expect(calls).toBe(2);
    expect(result.status).toBe("CREATED");
    if (result.status !== "CREATED") throw new Error("Expected a catalog block");
    blockIds.add(result.block.id);
    expect(JSON.stringify(result)).not.toContain("Cafe Blue");
    expect(await prisma.blockCatalog.count({ where: { industryCode } })).toBe(1);
  });

  it("records token cost for each completed catalog generation call", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    const result = await generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), async () => ({
      content: generatedBlock(),
      metadata: { model: "gpt-5.4-mini", tokens: { input: 100, output: 50 }, costKrw: 2, latencyMs: 30 },
    }));
    expect(result.status).toBe("CREATED");
    if (result.status !== "CREATED") throw new Error("Expected a catalog block");
    blockIds.add(result.block.id);
    expect(await prisma.eventLog.findMany({ where: { userId: client.id, type: "LLM_CALLED" }, select: { payload: true } })).toEqual([
      { payload: { purpose: "BLOCK_CREATE", model: "gpt-5.4-mini", tokens: { input: 100, output: 50 }, costKrw: 2, latencyMs: 30, succeeded: true } },
    ]);
  });
  it("returns generic pending after exactly two invalid generation attempts", async () => {
    const client = await createClient();
    const industryCode = testIndustryCode();
    let calls = 0;
    const generator: CatalogBlockGenerator = async () => {
      calls += 1;
      return generationResponse(generatedBlock({ unitPrice: 1.5 }));
    };

    const result = await generateOrReuseCatalogBlock(prisma, generationInput(client.id, industryCode), generator);

    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: "PENDING", pendingFeature: { summary: "기능 분석 대기 중", attempts: 2 } });
    expect(JSON.stringify(result)).not.toContain("Cafe Blue");
    expect(JSON.stringify(result)).not.toContain("예약 달력을 만들고 싶어요");
    expect(await prisma.blockCatalog.count({ where: { industryCode } })).toBe(0);
    const failedCalls = await prisma.eventLog.findMany({ where: { userId: client.id, type: "LLM_CALLED" }, select: { payload: true } });
    expect(failedCalls).toHaveLength(2);
    expect(failedCalls).toEqual(expect.arrayContaining([
      { payload: { purpose: "BLOCK_CREATE", model: "gpt-5.4-mini", tokens: { input: 100, output: 50 }, costKrw: 2, latencyMs: 30, succeeded: false } },
      { payload: { purpose: "BLOCK_CREATE", model: "gpt-5.4-mini", tokens: { input: 100, output: 50 }, costKrw: 2, latencyMs: 30, succeeded: false } },
    ]));
  });
});

describe("A-03 catalog admin mutations", () => {
  it("requires ADMIN and a reason, and leaves draft/spec price snapshots unchanged", async () => {
    const client = await createClient();
    const admin = await createAdmin();
    const industryCode = testIndustryCode();
    const source = await createExistingBlock(industryCode, 7000, "source function");
    const target = await createExistingBlock(industryCode, 9000, "target function");
    const draftId = randomUUID();
    const projectId = randomUUID();
    draftIds.add(draftId);
    projectIds.add(projectId);
    await prisma.draft.create({ data: { id: draftId, clientId: client.id, entryType: DraftEntryType.SENTENCE } });
    await prisma.draftBlock.create({ data: { draftId, blockId: source.id, origin: BlockOrigin.FIRST_SENTENCE, unitPrice: 7000 } });
    await prisma.project.create({
      data: {
        id: projectId,
        draftId,
        confirmedAt: new Date(),
        disclosureConsentVersion: "test-v1",
        title: "A-03 test project",
        summary: "A-03 test project",
        industryCode,
        requiredSkills: [],
      },
    });
    await prisma.specItem.create({
      data: {
        projectId,
        blockId: source.id,
        title: "Saved feature snapshot",
        description: "Saved feature snapshot",
        origin: BlockOrigin.FIRST_SENTENCE,
        unitPrice: 7000,
      },
    });

    await expect(updateCatalogBlockPrice(prisma, {
      actorId: client.id, blockId: source.id, unitPrice: 10000, reason: "approved price update",
    })).rejects.toMatchObject({ code: "ADMIN_REQUIRED", status: 403 });
    await expect(updateCatalogBlockPrice(prisma, {
      actorId: admin.id, blockId: source.id, unitPrice: 10000, reason: "  ",
    })).rejects.toMatchObject({ code: "REASON_REQUIRED", status: 400 });

    await updateCatalogBlockPrice(prisma, {
      actorId: admin.id, blockId: source.id, unitPrice: 10000, reason: "approved price update",
    });
    await mergeCatalogBlock(prisma, {
      actorId: admin.id, sourceId: source.id, targetId: target.id, reason: "duplicate block",
    });
    await setCatalogBlockActive(prisma, {
      actorId: admin.id, blockId: target.id, isActive: false, reason: "temporarily unavailable",
    });
    await setCatalogBlockActive(prisma, {
      actorId: admin.id, blockId: target.id, isActive: true, reason: "restored after review",
    });

    expect(await prisma.blockCatalog.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
      unitPrice: 10000, isActive: false, mergedIntoId: target.id,
    });
    expect(await prisma.blockCatalog.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ isActive: true });
    expect(await prisma.draftBlock.findUniqueOrThrow({ where: { draftId_blockId: { draftId, blockId: source.id } } })).toMatchObject({ unitPrice: 7000 });
    expect(await prisma.specItem.findFirstOrThrow({ where: { projectId, blockId: source.id } })).toMatchObject({ unitPrice: 7000 });
    expect(await prisma.eventLog.count({ where: { userId: admin.id, type: { in: ["BLOCK_PRICE_UPDATED", "BLOCK_MERGED", "BLOCK_DEACTIVATED"] } } })).toBe(4);
  });
});
