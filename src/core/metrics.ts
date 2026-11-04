import { EventType, type PrismaClient } from "@prisma/client";

export type MetricsWindow = { from: Date; to: Date };

export type ProductMetrics = {
  draftRendered: number;
  specConfirmed: number;
  specCompletionRate: number;
  averageDraftRenderMs: number;
  reusedBlocks: number;
  generatedBlocks: number;
  pendingFeatures: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function specCompletionRate(draftRendered: number, specConfirmed: number): number {
  if (!Number.isFinite(draftRendered) || draftRendered <= 0) return 0;
  return Math.max(0, Math.min(1, specConfirmed / draftRendered));
}

export async function getProductMetrics(db: PrismaClient, window: MetricsWindow): Promise<ProductMetrics> {
  if (Number.isNaN(window.from.getTime()) || Number.isNaN(window.to.getTime())) throw new Error("INVALID_METRICS_WINDOW");
  const occurredAt = { gte: window.from, lt: window.to };

  const [draftRendered, specConfirmed, renderedRows] = await Promise.all([
    db.eventLog.count({ where: { type: EventType.DRAFT_RENDERED, occurredAt } }),
    db.eventLog.count({ where: { type: EventType.SPEC_CONFIRMED, occurredAt } }),
    db.eventLog.findMany({ where: { type: EventType.DRAFT_RENDERED, occurredAt }, select: { payload: true } }),
  ]);

  let reusedBlocks = 0;
  let generatedBlocks = 0;
  let pendingFeatures = 0;
  let durationTotal = 0;
  let durationCount = 0;
  for (const row of renderedRows) {
    if (!isRecord(row.payload)) continue;
    reusedBlocks += nonNegative(row.payload.reusedBlocks);
    generatedBlocks += nonNegative(row.payload.generatedBlocks);
    pendingFeatures += nonNegative(row.payload.pendingFeatures);
    if (typeof row.payload.durationMs === "number" && Number.isSafeInteger(row.payload.durationMs) && row.payload.durationMs >= 0) {
      durationTotal += row.payload.durationMs;
      durationCount += 1;
    }
  }

  return {
    draftRendered,
    specConfirmed,
    specCompletionRate: specCompletionRate(draftRendered, specConfirmed),
    averageDraftRenderMs: durationCount === 0 ? 0 : Math.round(durationTotal / durationCount),
    reusedBlocks,
    generatedBlocks,
    pendingFeatures,
  };
}
