/**
 * Gate 2: A-04 초안이 A-03 카탈로그를 쓰도록 연결하는 어댑터.
 *
 * F-01 흐름: 문장에서 사용자 목적(블록 후보)을 뽑고(추출기) → 활성·미병합 블록과 비교해
 * 같으면 재사용, 다르면 생성기로 새 블록을 만든다. 목표 블록 수는 5개 근처다.
 * 생성기는 없으면 '만드는 중'(pendingFeatures)만 남기고 실패로 만들지 않는다.
 */
import { DraftEntryType, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  extractCatalogFeatures,
  generateOrReuseCatalogBlock,
  type CatalogBlockGenerator,
  type CatalogFeatureExtractor,
} from "../modules/catalog/service.js";
import { initialPendingFeature, type PendingFeature } from "../modules/draft/rules.js";
import type { DraftCatalogAdapter, DraftCatalogUtterance } from "../modules/draft/service.js";

export type DraftCatalogAi = { generator?: CatalogBlockGenerator; extractor?: CatalogFeatureExtractor };

const MAX_FEATURE_SUMMARY = 200;

function triggerOf(utterances: readonly DraftCatalogUtterance[]): "FIRST_SENTENCE" | "CHAT" {
  return utterances.at(-1)?.kind === "CHAT" ? "CHAT" : "FIRST_SENTENCE";
}

function pendingOf(summary: string, lastTriedAt: string | null): PendingFeature {
  return {
    key: randomUUID(),
    summary: summary.slice(0, MAX_FEATURE_SUMMARY) || "기능 분석 대기 중",
    attempts: 0,
    lastTriedAt,
  };
}

export function createDraftCatalogAdapter(
  db: PrismaClient,
  ai: DraftCatalogAi = {},
): DraftCatalogAdapter {
  // ponytail: 초안에는 업종이 없다. A-03의 업종 코드는 같은 기능 재사용을 묶는 범위 키일 뿐
  // 가격/계약 계약이 아니므로, 의뢰인 프로필의 industryField를 쓰고 없으면 GENERAL로 둔다.
  async function industryCodeOf(clientId: string): Promise<string> {
    const profile = await db.clientProfile.findUnique({
      where: { userId: clientId },
      select: { industryField: true },
    });
    return profile?.industryField?.trim() || "GENERAL";
  }

  /** 기능 하나를 기존 블록 재사용 또는 새 블록 생성으로 해소한다. 생성기 실패 시 pending으로 남긴다. */
  async function resolveFeature(input: {
    clientId: string;
    industryCode: string;
    trigger: "FIRST_SENTENCE" | "CHAT";
    text: string;
  }): Promise<{ blockId: string; status: "CREATED" | "REUSED" } | { pending: PendingFeature }> {
    const fallback = pendingOf(input.text, null);
    if (!ai.generator) return { pending: fallback };
    try {
      const result = await generateOrReuseCatalogBlock(
        db,
        { clientId: input.clientId, industryCode: input.industryCode, trigger: input.trigger, text: input.text },
        ai.generator,
      );
      return result.status === "PENDING" ? { pending: result.pendingFeature } : { blockId: result.block.id, status: result.status };
    } catch {
      return { pending: fallback };
    }
  }

  function collect(outcomes: ReadonlyArray<{ blockId?: string; status?: "CREATED" | "REUSED"; pending?: PendingFeature }>) {
    const pendingFeatures: PendingFeature[] = [];
    const byBlock = new Map<string, "CREATED" | "REUSED">();
    for (const outcome of outcomes) {
      if (outcome.blockId !== undefined) {
        const previous = byBlock.get(outcome.blockId);
        byBlock.set(outcome.blockId, previous === "CREATED" || outcome.status === "CREATED" ? "CREATED" : "REUSED");
      }
      else if (outcome.pending !== undefined) pendingFeatures.push(outcome.pending);
    }
    const blockIds = [...byBlock.keys()];
    return {
      blockIds,
      pendingFeatures,
      reusedBlocks: [...byBlock.values()].filter(status => status === "REUSED").length,
      generatedBlocks: [...byBlock.values()].filter(status => status === "CREATED").length,
    };
  }

  return {
    async resolveExisting({ clientId, entryType, utterances }) {
      if (entryType === DraftEntryType.DEFAULT_DRAFT) {
        // 업종 기본 초안: 승인·활성 상태의 기본 초안 블록만 결정론적으로 돌려준다.
        const rows = await db.blockCatalog.findMany({
          where: { isActive: true, mergedIntoId: null, inDefaultDraft: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        return { blockIds: rows.map(row => row.id), pendingFeatures: [], reusedBlocks: rows.length, generatedBlocks: 0 };
      }
      const text = utterances.map(utterance => utterance.text).join("\n").trim();
      if (!ai.extractor || !text) {
        return { blockIds: [], pendingFeatures: [initialPendingFeature(randomUUID())] };
      }
      const industryCode = await industryCodeOf(clientId);
      const trigger = triggerOf(utterances);
      const features = await extractCatalogFeatures(db, { clientId, industryCode, trigger, text }, ai.extractor);
      if (features.length === 0) {
        return { blockIds: [], pendingFeatures: [initialPendingFeature(randomUUID())] };
      }
      const outcomes = [];
      for (const feature of features) {
        outcomes.push(await resolveFeature({ clientId, industryCode, trigger, text: feature }));
      }
      return collect(outcomes);
    },

    async generatePending({ clientId, utterances, pendingFeatures }) {
      if (!ai.generator || pendingFeatures.length === 0) return { blockIds: [], pendingFeatures };
      const industryCode = await industryCodeOf(clientId);
      const trigger = triggerOf(utterances);
      const outcomes = [];
      for (const feature of pendingFeatures) {
        outcomes.push(await resolveFeature({ clientId, industryCode, trigger, text: feature.summary }));
      }
      return collect(outcomes);
    },

    async recommend() {
      const rows = await db.blockCatalog.findMany({
        where: { isActive: true, mergedIntoId: null, recommendRank: { not: null } },
        orderBy: [{ recommendRank: "asc" }, { id: "asc" }],
        select: { id: true },
        take: 12,
      });
      return rows.map(row => row.id);
    },
  };
}
