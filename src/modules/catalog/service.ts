import { BlockSource, EventType, Role } from "@prisma/client";
import type { BlockCatalog, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { sanitizeUserText } from "../../core/privacy.js";
import { CatalogError } from "./errors.js";
import { normalizeFunctionSummary, parseGeneratedBlock } from "./rules.js";

export type CatalogGenerationMetadata = { model: string; tokens: { input: number; output: number }; costKrw: number; latencyMs: number };
export type CatalogBlockGeneration = { content: unknown; metadata: CatalogGenerationMetadata };
export type CatalogBlockGenerator = (input: { industryCode: string; text: string }) => Promise<CatalogBlockGeneration>;
export type CatalogGenerationInput = {
  clientId: string;
  industryCode: string;
  trigger: "FIRST_SENTENCE" | "CHAT";
  text: string;
};
export type CatalogPendingFeature = { key: string; summary: string; attempts: number; lastTriedAt: string | null };
export type CatalogGenerationResult =
  | { status: "CREATED" | "REUSED"; block: BlockCatalog }
  | { status: "PENDING"; pendingFeature: CatalogPendingFeature };

function requiredText(value: string): string {
  const text = value.trim();
  if (!text) throw new CatalogError("INVALID_GENERATION_INPUT", 400);
  return text;
}

async function readPrivateValues(db: PrismaClient, clientId: string): Promise<string[]> {
  const user = await db.user.findUnique({
    where: { id: clientId },
    select: {
      role: true,
      email: true,
      name: true,
      clientProfile: {
        select: { businessName: true, storeAddress: true, websiteUrl: true, taxInvoiceEmail: true },
      },
    },
  });
  if (!user || user.role !== Role.CLIENT) throw new CatalogError("CLIENT_REQUIRED", 403);
  return [
    user.email,
    user.name ?? "",
    user.clientProfile?.businessName ?? "",
    user.clientProfile?.storeAddress ?? "",
    user.clientProfile?.websiteUrl ?? "",
    user.clientProfile?.taxInvoiceEmail ?? "",
  ];
}

async function persistOrReuse(
  db: PrismaClient,
  input: Pick<CatalogGenerationInput, "clientId" | "industryCode" | "trigger">,
  block: ReturnType<typeof parseGeneratedBlock>,
): Promise<CatalogGenerationResult> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.industryCode}, 0))::text`;
    const candidates = await tx.blockCatalog.findMany({
      where: { industryCode: input.industryCode, isActive: true, mergedIntoId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const normalizedSummary = normalizeFunctionSummary(block.functionSummary);
    const existing = candidates.find(candidate => normalizeFunctionSummary(candidate.functionSummary) === normalizedSummary);
    if (existing) return { status: "REUSED", block: existing };

    const created = await tx.blockCatalog.create({
      data: {
        code: `AI-${randomUUID()}`,
        name: block.name,
        functionSummary: block.functionSummary,
        description: block.description,
        industryCode: input.industryCode,
        techTags: block.techTags,
        source: BlockSource.AI,
        wireframe: block.wireframe,
        conditions: block.conditions,
        isDrawable: true,
        unitPrice: block.unitPrice,
        priceBasis: block.priceBasis,
        inDefaultDraft: false,
        recommendRank: null,
        reviewedAt: null,
        isActive: true,
      },
    });
    await tx.eventLog.create({
      data: {
        userId: input.clientId,
        type: EventType.BLOCK_CREATED,
        payload: { blockId: created.id, trigger: input.trigger },
      },
    });
    return { status: "CREATED", block: created };
  });
}

async function reserveLlmCall(db: PrismaClient, clientId: string): Promise<string> {
  const event = await db.eventLog.create({
    data: {
      userId: clientId,
      type: EventType.LLM_CALLED,
      payload: { purpose: "BLOCK_CREATE", model: "pending", tokens: { input: 0, output: 0 }, costKrw: 0, latencyMs: 0, succeeded: false, reserved: true },
    },
  });
  return event.id;
}

async function finishLlmCall(
  db: PrismaClient,
  eventId: string,
  metadata: CatalogGenerationMetadata | undefined,
  succeeded: boolean,
): Promise<void> {
  await db.eventLog.update({
    where: { id: eventId },
    data: { payload: {
      purpose: "BLOCK_CREATE",
      model: metadata?.model ?? "unknown",
      tokens: metadata?.tokens ?? { input: 0, output: 0 },
      costKrw: metadata?.costKrw ?? 0,
      latencyMs: metadata?.latencyMs ?? 0,
      succeeded,
    } },
  });
}

function validGenerationMetadata(value: unknown): value is CatalogGenerationMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  if (typeof metadata.model !== "string" || metadata.model.length === 0 || metadata.model.length > 100 ||
      typeof metadata.costKrw !== "number" || !Number.isSafeInteger(metadata.costKrw) || metadata.costKrw < 0 ||
      typeof metadata.latencyMs !== "number" || !Number.isSafeInteger(metadata.latencyMs) || metadata.latencyMs < 0 ||
      !metadata.tokens || typeof metadata.tokens !== "object") return false;
  const tokens = metadata.tokens as Record<string, unknown>;
  return typeof tokens.input === "number" && Number.isSafeInteger(tokens.input) && tokens.input >= 0 &&
    typeof tokens.output === "number" && Number.isSafeInteger(tokens.output) && tokens.output >= 0;
}

export async function generateOrReuseCatalogBlock(
  db: PrismaClient,
  input: CatalogGenerationInput,
  generator: CatalogBlockGenerator,
): Promise<CatalogGenerationResult> {
  const industryCode = requiredText(input.industryCode);
  const text = requiredText(input.text);
  const privateValues = await readPrivateValues(db, input.clientId);
  const safeText = sanitizeUserText(text, privateValues);
  const safeInput = { clientId: input.clientId, industryCode, trigger: input.trigger };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const eventId = await reserveLlmCall(db, input.clientId);
    let generated: unknown;
    try {
      generated = await generator({ industryCode, text: safeText });
    } catch {
      await finishLlmCall(db, eventId, undefined, false);
      if (attempt === 2) {
        return {
          status: "PENDING",
          pendingFeature: {
            key: randomUUID(),
            summary: "기능 분석 대기 중",
            attempts: attempt,
            lastTriedAt: new Date().toISOString(),
          },
        };
      }
      continue;
    }

    const response = generated as Partial<CatalogBlockGeneration> | null;
    const metadata = validGenerationMetadata(response?.metadata) ? response.metadata : undefined;
    let block: ReturnType<typeof parseGeneratedBlock>;
    try {
      if (!metadata) throw new Error("INVALID_GENERATION_METADATA");
      block = parseGeneratedBlock(response?.content, privateValues);
    } catch {
      await finishLlmCall(db, eventId, metadata, false);
      if (attempt === 2) {
        return {
          status: "PENDING",
          pendingFeature: {
            key: randomUUID(),
            summary: "기능 분석 대기 중",
            attempts: attempt,
            lastTriedAt: new Date().toISOString(),
          },
        };
      }
      continue;
    }
    await finishLlmCall(db, eventId, metadata, true);
    return persistOrReuse(db, safeInput, block);
  }
  throw new CatalogError("CATALOG_GENERATION_FAILED", 503);
}
