import { afterAll, describe, expect, it } from "@jest/globals";
import { DraftEntryType, PrismaClient, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createDraftCatalogAdapter } from "./draft-catalog-adapter.ts";
import type { CatalogBlockGenerator, CatalogFeatureExtractor } from "../modules/catalog/service.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-04 adapter tests require the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const industryCode = "ADAPTER_TEST";
const userIds: string[] = [];

const metadata = { model: "test-model", tokens: { input: 1, output: 1 }, costKrw: 0, latencyMs: 0 };

/** 기능 텍스트마다 서로 다른 블록을 만든다(같은 텍스트는 재사용). */
function blockGenerator(): CatalogBlockGenerator {
  return async ({ text }) => ({
    content: {
      name: text,
      functionSummary: text,
      description: `${text} 설명`,
      techTags: ["test"],
      wireframe: { parts: [{ type: "TEXT", label: text, props: {} }] },
      conditions: [{ key: "a", text: "조건 A" }, { key: "b", text: "조건 B" }],
      unitPrice: 1000,
      priceBasis: "범위\n가정\n참고 추정치",
    },
    metadata,
  });
}

function featureExtractor(features: string[]): CatalogFeatureExtractor {
  return async () => ({ features, metadata });
}

async function makeClient(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `adapter-${id}@example.invalid`, role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, industryField: industryCode } });
  return id;
}

async function makeBlock(input: {
  inDefaultDraft: boolean; isActive: boolean; recommendRank: number | null; sortOrder: number;
}): Promise<string> {
  const id = randomUUID();
  await db.blockCatalog.create({
    data: {
      id, code: `adapter-${id}`, name: `블록 ${id}`, functionSummary: `요약 ${id}`, description: "설명",
      industryCode, unitPrice: 1000, priceBasis: "범위\n가정\n참고 추정치", techTags: [],
      inDefaultDraft: input.inDefaultDraft, isActive: input.isActive,
      recommendRank: input.recommendRank, sortOrder: input.sortOrder,
    },
  });
  return id;
}

afterAll(async () => {
  await db.blockCatalog.deleteMany({ where: { industryCode } });
  if (userIds.length) await db.eventLog.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe("A-04 draft catalog adapter", () => {
  it("returns only active, unmerged default-draft blocks for DEFAULT_DRAFT", async () => {
    const clientId = await makeClient();
    const activeDefault = await makeBlock({ inDefaultDraft: true, isActive: true, recommendRank: 1, sortOrder: 1 });
    const nonDefault = await makeBlock({ inDefaultDraft: false, isActive: true, recommendRank: null, sortOrder: 2 });
    const inactiveDefault = await makeBlock({ inDefaultDraft: true, isActive: false, recommendRank: null, sortOrder: 3 });
    const adapter = createDraftCatalogAdapter(db);

    const defaults = await adapter.resolveExisting({ clientId, entryType: DraftEntryType.DEFAULT_DRAFT, utterances: [] });
    // 전용 테스트 DB에는 팀 승인 시드의 기본 초안 6개가 남을 수 있으므로 정확한 집합 대신 포함/제외로 검증한다.
    expect(defaults.blockIds).toContain(activeDefault);
    expect(defaults.blockIds).not.toContain(nonDefault);
    expect(defaults.blockIds).not.toContain(inactiveDefault);
    expect(defaults.pendingFeatures).toEqual([]);
  });

  it("extracts about five features and resolves each to a generated block", async () => {
    const clientId = await makeClient();
    const features = ["예약 달력", "예약금 결제", "노쇼 기록", "예약 알림", "리뷰 요청"];
    const adapter = createDraftCatalogAdapter(db, {
      extractor: featureExtractor(features),
      generator: blockGenerator(),
    });

    const result = await adapter.resolveExisting({
      clientId, entryType: DraftEntryType.SENTENCE,
      utterances: [{ kind: "FIRST_SENTENCE", text: "예약 서비스가 필요해요" }],
    });

    expect(result.blockIds).toHaveLength(5);
    expect(result.pendingFeatures).toEqual([]);
    expect(result).toMatchObject({ reusedBlocks: 0, generatedBlocks: 5 });
    expect(await db.blockCatalog.count({ where: { industryCode, functionSummary: { in: features } } })).toBe(5);

    const reused = await adapter.resolveExisting({
      clientId, entryType: DraftEntryType.SENTENCE,
      utterances: [{ kind: "FIRST_SENTENCE", text: "예약 서비스가 필요해요" }],
    });
    expect(reused).toMatchObject({ reusedBlocks: 5, generatedBlocks: 0 });
  });

  it("keeps one pending feature when extraction yields nothing", async () => {
    const clientId = await makeClient();
    const adapter = createDraftCatalogAdapter(db, {
      extractor: featureExtractor([]),
      generator: blockGenerator(),
    });
    const result = await adapter.resolveExisting({
      clientId, entryType: DraftEntryType.SENTENCE,
      utterances: [{ kind: "FIRST_SENTENCE", text: "예약 서비스가 필요해요" }],
    });
    expect(result.blockIds).toEqual([]);
    expect(result.pendingFeatures).toHaveLength(1);
  });

  it("generates a catalog block from a pending feature and clears pending", async () => {
    const clientId = await makeClient();
    const adapter = createDraftCatalogAdapter(db, { generator: blockGenerator() });
    const pending = [{ key: randomUUID(), summary: "예약 취소 기능", attempts: 0, lastTriedAt: null }];

    const first = await adapter.generatePending({
      clientId, entryType: DraftEntryType.SENTENCE,
      utterances: [{ kind: "FIRST_SENTENCE", text: "예약 취소 기능이 필요해요" }], pendingFeatures: pending,
    });
    expect(first.pendingFeatures).toEqual([]);
    expect(first.blockIds).toHaveLength(1);
    const stored = await db.blockCatalog.findFirstOrThrow({ where: { id: first.blockIds[0]!, industryCode } });
    expect(stored.functionSummary).toBe("예약 취소 기능");
    expect(stored.isActive).toBe(true);
  });

  it("keeps the pending feature unchanged when no generator is configured", async () => {
    const clientId = await makeClient();
    const adapter = createDraftCatalogAdapter(db, {});
    const pending = [{ key: randomUUID(), summary: "대기", attempts: 0, lastTriedAt: null }];
    const result = await adapter.generatePending({
      clientId, entryType: DraftEntryType.SENTENCE,
      utterances: [{ kind: "FIRST_SENTENCE", text: "아무 문장" }], pendingFeatures: pending,
    });
    expect(result.blockIds).toEqual([]);
    expect(result.pendingFeatures).toEqual(pending);
  });
});
