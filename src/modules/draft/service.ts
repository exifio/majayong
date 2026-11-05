import { BlockOrigin, DraftEntryType, DraftStatus, EventType, Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  assertActionAllowed, assertDraftCapacity, assertDraftOwner, changesUserActivity, DraftError,
  initialPendingFeature, PendingFeature, retryPendingAttempt, sanitizeDraftText, snapshotDraftBlock, visibleDrafts,
} from "./rules.js";

export type DraftCatalogResolution = {
  blockIds: string[];
  pendingFeatures: PendingFeature[];
  reusedBlocks?: number;
  generatedBlocks?: number;
  durationMs?: number;
};
// A-04-local seam; adapt it to A-03 exports during integration instead of treating it as a shared contract.
export type DraftCatalogUtterance = { kind: "FIRST_SENTENCE" | "CHAT"; text: string };
export type DraftCatalogAdapter = {
  resolveExisting(input: { clientId: string; entryType: DraftEntryType; utterances: DraftCatalogUtterance[] }): Promise<DraftCatalogResolution>;
  generatePending(input: { clientId: string; entryType: DraftEntryType; utterances: DraftCatalogUtterance[]; pendingFeatures: PendingFeature[] }): Promise<DraftCatalogResolution>;
  recommend(input: { clientId: string; entryType: DraftEntryType; utterances: DraftCatalogUtterance[] }): Promise<string[]>;
};
export type DraftPorts = { catalog?: DraftCatalogAdapter };

type DraftTx = Prisma.TransactionClient;
type DraftRow = { id: string; clientId: string; status: DraftStatus; deletedAt: Date | null };
const draftDetails = {
  utterances: { orderBy: { createdAt: "asc" as const } },
  blocks: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { block: { select: { id: true, code: true, name: true, functionSummary: true, description: true, conditions: true, wireframe: true, unitPrice: true } } },
  },
} satisfies Prisma.DraftInclude;
type DraftDetails = Prisma.DraftGetPayload<{ include: typeof draftDetails }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPending(value: Prisma.JsonValue | null): PendingFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.summary !== "string" ||
      typeof item.attempts !== "number" || !Number.isSafeInteger(item.attempts) || item.attempts < 0 ||
      !(item.lastTriedAt === null || typeof item.lastTriedAt === "string")) return [];
    return [{ key: item.key, summary: item.summary, attempts: item.attempts, lastTriedAt: item.lastTriedAt }];
  });
}

function cleanPending(value: unknown, privateValues: string[]): PendingFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.key !== "string" || !item.key || item.key.length > 100 ||
      typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > 500) return [];
    const attempts = typeof item.attempts === "number" && Number.isSafeInteger(item.attempts) && item.attempts >= 0 ? item.attempts : 0;
    const lastTriedAt = typeof item.lastTriedAt === "string" && !Number.isNaN(Date.parse(item.lastTriedAt)) ? item.lastTriedAt : null;
    return [{ key: item.key, summary: sanitizeDraftText(item.summary, privateValues), attempts, lastTriedAt }];
  });
}

async function privateValues(db: PrismaClient, clientId: string): Promise<string[]> {
  const user = await db.user.findUnique({
    where: { id: clientId },
    select: { email: true, name: true, clientProfile: { select: { businessName: true, storeAddress: true, websiteUrl: true } } },
  });
  return user ? [user.email, user.name ?? "", user.clientProfile?.businessName ?? "", user.clientProfile?.storeAddress ?? "", user.clientProfile?.websiteUrl ?? ""] : [];
}

async function lockClient(tx: DraftTx, clientId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${clientId} FOR UPDATE`;
}

async function touchDraft(tx: DraftTx, draftId: string, action: Parameters<typeof changesUserActivity>[0], now: Date): Promise<void> {
  if (changesUserActivity(action)) await tx.draft.update({ where: { id: draftId }, data: { lastActiveAt: now } });
}

async function recordDraftRendered(tx: DraftTx, draftId: string, now: Date, resolution: DraftCatalogResolution): Promise<void> {
  const draft = await tx.draft.findUniqueOrThrow({ where: { id: draftId }, select: { clientId: true, renderedAt: true, firstInputAt: true } });
  if (draft.renderedAt) return;
  const claimed = await tx.draft.updateMany({ where: { id: draftId, renderedAt: null }, data: { renderedAt: now } });
  if (claimed.count === 0) return;
  await tx.eventLog.create({
    data: {
      userId: draft.clientId,
      draftId,
      type: EventType.DRAFT_RENDERED,
      occurredAt: now,
      payload: {
        reusedBlocks: resolution.reusedBlocks ?? 0,
        generatedBlocks: resolution.generatedBlocks ?? 0,
        pendingFeatures: resolution.pendingFeatures.length,
        durationMs: resolution.durationMs ?? Math.max(0, now.getTime() - (draft.firstInputAt?.getTime() ?? now.getTime())),
      },
    },
  });
}

async function ownedDraft(tx: DraftTx, draftId: string, clientId: string): Promise<DraftRow> {
  await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
  const draft = await tx.draft.findFirst({ where: { id: draftId, clientId, deletedAt: null }, select: { id: true, clientId: true, status: true, deletedAt: true } });
  assertDraftOwner(draft, clientId);
  return draft;
}

function requireInProgress(draft: DraftRow): void {
  if (draft.status !== DraftStatus.IN_PROGRESS) throw new DraftError("DRAFT_NOT_IN_PROGRESS", 409);
}

function toView(row: DraftDetails) {
  return {
    id: row.id,
    entryType: row.entryType,
    status: row.status,
    hopeBudget: row.hopeBudget,
    chatEditCount: row.chatEditCount,
    pendingFeatures: readPending(row.pendingFeatures),
    firstInputAt: row.firstInputAt,
    renderedAt: row.renderedAt,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    utterances: row.utterances.map(item => ({ id: item.id, kind: item.kind, content: item.content, createdAt: item.createdAt })),
    blocks: row.blocks.map(item => ({
      id: item.id, blockId: item.blockId, origin: item.origin, status: item.status, unitPrice: item.unitPrice,
      pricedAt: item.pricedAt, conditionNotes: item.conditionNotes, sortOrder: item.sortOrder, block: item.block,
    })),
  };
}

async function loadOwned(db: PrismaClient, draftId: string, clientId: string): Promise<DraftDetails> {
  const row = await db.draft.findFirst({ where: { id: draftId, clientId, deletedAt: null }, include: draftDetails });
  assertDraftOwner(row, clientId);
  return row;
}

async function currentUtterances(db: PrismaClient, draftId: string, secrets: string[]) {
  const rows = await db.clientUtterance.findMany({ where: { draftId }, orderBy: { createdAt: "asc" } });
  return rows.map(row => ({ id: row.id, kind: row.kind, text: sanitizeDraftText(row.content, secrets) }));
}

async function applyResolution(
  tx: DraftTx,
  draftId: string,
  utteranceId: string | null,
  origin: BlockOrigin,
  resolution: DraftCatalogResolution,
  secrets: string[],
  now: Date,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
  const ids = [...new Set(resolution.blockIds.filter(id => typeof id === "string" && id.length > 0 && id.length <= 100))];
  const catalogRows = ids.length ? await tx.blockCatalog.findMany({
    where: { id: { in: ids }, isActive: true, mergedIntoId: null }, select: { id: true, unitPrice: true },
  }) : [];
  for (const catalog of catalogRows) {
    const existing = await tx.draftBlock.findUnique({ where: { draftId_blockId: { draftId, blockId: catalog.id } }, select: { status: true } });
    if (existing?.status === "REMOVED") continue;
    await tx.draftBlock.upsert({
      where: { draftId_blockId: { draftId, blockId: catalog.id } },
      create: { draftId, blockId: catalog.id, utteranceId, origin, status: "ADDED", unitPrice: catalog.unitPrice },
      update: { status: "ADDED" },
    });
  }
  const pending = cleanPending(resolution.pendingFeatures, secrets);
  await tx.draft.update({ where: { id: draftId }, data: { pendingFeatures: pending } });
  await recordDraftRendered(tx, draftId, now, { ...resolution, pendingFeatures: pending });
}

async function preserveFailure(db: PrismaClient, draftId: string, secrets: string[], now: Date, previous: PendingFeature[], durationMs: number): Promise<void> {
  const pending = previous.length ? previous.map(item => retryPendingAttempt(item, now)) : [retryPendingAttempt(initialPendingFeature(randomUUID()), now)];
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
    await tx.draft.update({ where: { id: draftId }, data: { pendingFeatures: cleanPending(pending, secrets) } });
    await recordDraftRendered(tx, draftId, now, { blockIds: [], pendingFeatures: pending, durationMs });
  });
}

async function resolveExistingAndSave(db: PrismaClient, draftId: string, clientId: string, ports: DraftPorts, now: Date, startedAt = performance.now()): Promise<void> {
  const row = await db.draft.findFirst({ where: { id: draftId, clientId, deletedAt: null }, select: { entryType: true, pendingFeatures: true } });
  if (!row) return;
  const secrets = await privateValues(db, clientId);
  const utterances = await currentUtterances(db, draftId, secrets);
  const origin = row.entryType === DraftEntryType.DEFAULT_DRAFT ? BlockOrigin.DEFAULT_DRAFT :
    utterances.at(-1)?.kind === "CHAT" ? BlockOrigin.CHAT : BlockOrigin.FIRST_SENTENCE;
  let resolution: DraftCatalogResolution;
  try {
    if (!ports.catalog) throw new Error("CATALOG_ADAPTER_UNAVAILABLE");
    resolution = await ports.catalog.resolveExisting({ clientId, entryType: row.entryType, utterances: utterances.map(({ kind, text }) => ({ kind, text })) });
  } catch {
    await preserveFailure(db, draftId, secrets, now, readPending(row.pendingFeatures), Math.max(0, Math.round(performance.now() - startedAt)));
    return;
  }
  const timedResolution = { ...resolution, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  await db.$transaction(tx => applyResolution(tx, draftId, utterances.at(-1)?.id ?? null, origin, timedResolution, secrets, now));
}

async function generatePendingAndSave(db: PrismaClient, draftId: string, clientId: string, ports: DraftPorts, now: Date): Promise<void> {
  const row = await db.draft.findFirst({ where: { id: draftId, clientId, deletedAt: null }, select: { entryType: true, pendingFeatures: true } });
  if (!row) return;
  const previous = readPending(row.pendingFeatures);
  if (!previous.length) return;
  const secrets = await privateValues(db, clientId);
  const utterances = await currentUtterances(db, draftId, secrets);
  const origin = row.entryType === DraftEntryType.DEFAULT_DRAFT ? BlockOrigin.DEFAULT_DRAFT :
    utterances.at(-1)?.kind === "CHAT" ? BlockOrigin.CHAT : BlockOrigin.FIRST_SENTENCE;
  const startedAt = performance.now();
  let resolution: DraftCatalogResolution;
  try {
    if (!ports.catalog) throw new Error("CATALOG_ADAPTER_UNAVAILABLE");
    resolution = await ports.catalog.generatePending({
      clientId,
      entryType: row.entryType,
      utterances: utterances.map(({ kind, text }) => ({ kind, text })),
      pendingFeatures: previous,
    });
  } catch {
    await preserveFailure(db, draftId, secrets, now, previous, Math.max(0, Math.round(performance.now() - startedAt)));
    return;
  }
  const timedResolution = { ...resolution, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  await db.$transaction(tx => applyResolution(tx, draftId, utterances.at(-1)?.id ?? null, origin, timedResolution, secrets, now));
}

export async function createDraft(db: PrismaClient, clientId: string, input: { entryType: DraftEntryType; text?: string }, ports: DraftPorts, now: Date) {
  if (Number.isNaN(now.getTime())) throw new DraftError("INVALID_TIME", 500);
  if (input.entryType === DraftEntryType.SENTENCE && (!input.text?.trim() || input.text.length > 8000)) throw new DraftError("INVALID_REQUEST", 400);
  if (input.entryType === DraftEntryType.DEFAULT_DRAFT && input.text !== undefined) throw new DraftError("INVALID_REQUEST", 400);
  const startedAt = performance.now();
  const id = await db.$transaction(async tx => {
    await lockClient(tx, clientId);
    const activeCount = await tx.draft.count({ where: { clientId, status: DraftStatus.IN_PROGRESS, deletedAt: null } });
    assertDraftCapacity(activeCount);
    const draft = await tx.draft.create({
      data: {
        clientId, entryType: input.entryType, firstInputAt: now, lastActiveAt: now,
        pendingFeatures: [initialPendingFeature(randomUUID())],
      },
    });
    if (input.entryType === DraftEntryType.SENTENCE && input.text) {
      await tx.clientUtterance.create({ data: { draftId: draft.id, kind: "FIRST_SENTENCE", content: input.text.trim() } });
    }
    await tx.eventLog.create({
      data: {
        userId: clientId,
        draftId: draft.id,
        type: EventType.DRAFT_INPUT_SUBMITTED,
        occurredAt: now,
        payload: { entryType: input.entryType },
      },
    });
    return draft.id;
  });
  await resolveExistingAndSave(db, id, clientId, ports, now, startedAt);
  return toView(await loadOwned(db, id, clientId));
}

export async function listDrafts(db: PrismaClient, clientId: string) {
  const rows = await db.draft.findMany({ where: { clientId, deletedAt: null }, orderBy: [{ lastActiveAt: "desc" }, { id: "asc" }], include: draftDetails });
  return visibleDrafts(rows).map(toView);
}

export async function getDraft(db: PrismaClient, draftId: string, clientId: string) {
  return toView(await loadOwned(db, draftId, clientId));
}

export async function archiveInactiveDrafts(db: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = await db.draft.updateMany({
    where: { status: DraftStatus.IN_PROGRESS, deletedAt: null, lastActiveAt: { lte: cutoff } },
    data: { status: DraftStatus.ABANDONED },
  });
  return result.count;
}

export async function restoreDraft(db: PrismaClient, draftId: string, clientId: string, now: Date) {
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    if (draft.status !== DraftStatus.ABANDONED) throw new DraftError("DRAFT_NOT_ARCHIVED", 409);
    await lockClient(tx, clientId);
    const activeCount = await tx.draft.count({ where: { clientId, status: DraftStatus.IN_PROGRESS, deletedAt: null } });
    assertDraftCapacity(activeCount);
    await tx.draft.update({ where: { id: draftId }, data: { status: DraftStatus.IN_PROGRESS, lastActiveAt: now } });
  });
  return getDraft(db, draftId, clientId);
}

export async function deleteDraft(db: PrismaClient, draftId: string, clientId: string, now: Date): Promise<void> {
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    if (draft.status === DraftStatus.CONFIRMED) throw new DraftError("DRAFT_ALREADY_CONFIRMED", 409);
    await tx.draft.update({ where: { id: draftId }, data: { deletedAt: now } });
    await touchDraft(tx, draftId, "DELETE", now);
  });
}

export async function editDraftChat(db: PrismaClient, draftId: string, clientId: string, text: string, ports: DraftPorts, now: Date) {
  if (!text.trim() || text.length > 8000) throw new DraftError("INVALID_REQUEST", 400);
  const startedAt = performance.now();
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    const row = await tx.draft.findUniqueOrThrow({ where: { id: draftId }, select: { chatEditCount: true } });
    assertActionAllowed("CHAT", row.chatEditCount);
    await tx.clientUtterance.create({ data: { draftId, kind: "CHAT", content: text.trim() } });
    await tx.draft.update({ where: { id: draftId }, data: { chatEditCount: { increment: 1 } } });
    await touchDraft(tx, draftId, "CHAT", now);
  });
  await resolveExistingAndSave(db, draftId, clientId, ports, now, startedAt);
  return getDraft(db, draftId, clientId);
}

export async function retryDraftFeatures(db: PrismaClient, draftId: string, clientId: string, ports: DraftPorts, now: Date): Promise<void> {
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    const row = await tx.draft.findUniqueOrThrow({ where: { id: draftId }, select: { pendingFeatures: true } });
    if (!readPending(row.pendingFeatures).length) throw new DraftError("NO_PENDING_FEATURES", 409);
    await touchDraft(tx, draftId, "RETRY", now);
  });
  await generatePendingAndSave(db, draftId, clientId, ports, now);
}

export async function retryDraftFeaturesInBackground(db: PrismaClient, draftId: string, ports: DraftPorts, now: Date): Promise<void> {
  const row = await db.draft.findFirst({ where: { id: draftId, status: DraftStatus.IN_PROGRESS, deletedAt: null }, select: { clientId: true, pendingFeatures: true } });
  if (!row || !readPending(row.pendingFeatures).length) return;
  await generatePendingAndSave(db, draftId, row.clientId, ports, now);
}

export async function getRecommendations(db: PrismaClient, draftId: string, clientId: string, ports: DraftPorts, now: Date) {
  const context = await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    await touchDraft(tx, draftId, "RECOMMENDATIONS", now);
    const existing = await tx.draftBlock.findMany({ where: { draftId }, select: { blockId: true } });
    const row = await tx.draft.findUniqueOrThrow({ where: { id: draftId }, select: { entryType: true } });
    return { entryType: row.entryType, existingIds: new Set(existing.map(item => item.blockId)) };
  });
  if (!ports.catalog) throw new DraftError("CATALOG_UNAVAILABLE", 503);
  const secrets = await privateValues(db, clientId);
  const utterances = await currentUtterances(db, draftId, secrets);
  let selected: string[];
  try {
    selected = await ports.catalog.recommend({ clientId, entryType: context.entryType, utterances: utterances.map(({ kind, text }) => ({ kind, text })) });
  } catch {
    throw new DraftError("CATALOG_UNAVAILABLE", 503);
  }
  if (!Array.isArray(selected) || selected.some(id => typeof id !== "string")) throw new DraftError("CATALOG_INVALID_RESULT", 503);
  const ids = [...new Set(selected.filter(id => id.length > 0 && id.length <= 100))].filter(id => !context.existingIds.has(id)).slice(0, 4);
  const rows = ids.length ? await db.blockCatalog.findMany({
    where: { id: { in: ids }, isActive: true, mergedIntoId: null }, select: { id: true, name: true, functionSummary: true },
  }) : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => { const row = byId.get(id); return row ? [row] : []; });
}

export async function addDraftBlock(db: PrismaClient, draftId: string, clientId: string, blockId: string, now: Date) {
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    const catalog = await tx.blockCatalog.findFirst({ where: { id: blockId, isActive: true, mergedIntoId: null }, select: { id: true, unitPrice: true } });
    if (!catalog) throw new DraftError("BLOCK_NOT_FOUND", 404);
    const existing = await tx.draftBlock.findUnique({ where: { draftId_blockId: { draftId, blockId } }, select: { blockId: true, status: true, origin: true, unitPrice: true } });
    const snapshot = snapshotDraftBlock(existing, { blockId: catalog.id, unitPrice: catalog.unitPrice }, BlockOrigin.RECOMMENDATION);
    await tx.draftBlock.upsert({
      where: { draftId_blockId: { draftId, blockId } },
      create: { draftId, blockId, origin: snapshot.origin, status: snapshot.status, unitPrice: snapshot.unitPrice },
      update: { origin: snapshot.origin, status: snapshot.status },
    });
    await touchDraft(tx, draftId, "ADD_BLOCK", now);
  });
  return getDraft(db, draftId, clientId);
}

export async function removeDraftBlock(db: PrismaClient, draftId: string, clientId: string, blockId: string, now: Date) {
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    const block = await tx.draftBlock.findUnique({ where: { draftId_blockId: { draftId, blockId } }, select: { status: true } });
    if (!block) throw new DraftError("DRAFT_BLOCK_NOT_FOUND", 404);
    await tx.draftBlock.update({ where: { draftId_blockId: { draftId, blockId } }, data: { status: "REMOVED" } });
    await touchDraft(tx, draftId, "REMOVE_BLOCK", now);
  });
  return getDraft(db, draftId, clientId);
}

function conditionKeys(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.flatMap(item => isRecord(item) && typeof item.key === "string" ? [item.key] : []) : [];
}
function conditionNotes(value: Prisma.JsonValue | null): { key: string; note: string; at: string }[] {
  return Array.isArray(value) ? value.flatMap(item => isRecord(item) && typeof item.key === "string" && typeof item.note === "string" && typeof item.at === "string"
    ? [{ key: item.key, note: item.note, at: item.at }] : []) : [];
}

export async function updateConditionNote(db: PrismaClient, draftId: string, clientId: string, blockId: string, key: string, note: string, now: Date) {
  if (!key.trim() || key.length > 100 || note.length > 2000) throw new DraftError("INVALID_REQUEST", 400);
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    const block = await tx.draftBlock.findUnique({ where: { draftId_blockId: { draftId, blockId } }, include: { block: { select: { conditions: true } } } });
    if (!block || block.status !== "ADDED") throw new DraftError("DRAFT_BLOCK_NOT_FOUND", 404);
    if (!conditionKeys(block.block.conditions).includes(key)) throw new DraftError("CONDITION_NOT_FOUND", 422);
    const notes = conditionNotes(block.conditionNotes).filter(item => item.key !== key);
    if (note.trim()) notes.push({ key, note: note.trim(), at: now.toISOString() });
    await tx.draftBlock.update({ where: { draftId_blockId: { draftId, blockId } }, data: { conditionNotes: notes } });
    await touchDraft(tx, draftId, "CONDITION_NOTE", now);
  });
  return getDraft(db, draftId, clientId);
}

export async function updateHopeBudget(db: PrismaClient, draftId: string, clientId: string, hopeBudget: number | null, now: Date) {
  if (hopeBudget !== null && (!Number.isSafeInteger(hopeBudget) || hopeBudget < 0 || hopeBudget > 2_147_483_647)) throw new DraftError("INVALID_REQUEST", 400);
  await db.$transaction(async tx => {
    const draft = await ownedDraft(tx, draftId, clientId);
    requireInProgress(draft);
    await tx.draft.update({ where: { id: draftId }, data: { hopeBudget } });
    await touchDraft(tx, draftId, "BUDGET", now);
  });
  return getDraft(db, draftId, clientId);
}
