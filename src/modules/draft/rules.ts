export type DraftAction = "CHAT" | "RETRY" | "ADD_BLOCK" | "REMOVE_BLOCK" | "RECOMMENDATIONS" | "CONDITION_NOTE" | "BUDGET" | "DELETE" | "RESTORE";
export type DraftRecord = { id: string; clientId: string; status: "IN_PROGRESS" | "ABANDONED" | "CONFIRMED"; deletedAt: Date | null };
export type DraftBlockSnapshot = {
  blockId: string;
  status: "SUGGESTED" | "ADDED" | "REMOVED";
  origin: "FIRST_SENTENCE" | "CHAT" | "RECOMMENDATION" | "DEFAULT_DRAFT" | "AGREEMENT";
  unitPrice: number;
};
export type PendingFeature = { key: string; summary: string; attempts: number; lastTriedAt: string | null };

export class DraftError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function sanitizeDraftText(value: string, privateValues: string[]): string {
  let text = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[비공개]")
    .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[비공개]");
  for (const secret of privateValues) {
    if (secret.trim().length >= 2) text = text.replace(new RegExp(escapeRegExp(secret.trim()), "gi"), "[비공개]");
  }
  return text;
}

export function initialPendingFeature(key: string): PendingFeature {
  return { key, summary: "기능 분석 대기 중", attempts: 0, lastTriedAt: null };
}
export function retryPendingAttempt(feature: PendingFeature, triedAt: Date): PendingFeature {
  return { ...feature, attempts: feature.attempts + 1, lastTriedAt: triedAt.toISOString() };
}
export function assertActionAllowed(action: DraftAction, chatEditCount: number): void {
  if (action === "CHAT" && chatEditCount >= 30) throw new DraftError("CHAT_EDIT_LIMIT_REACHED", 409);
}
export function assertDraftCapacity(activeCount: number): void {
  if (activeCount >= 3) throw new DraftError("ACTIVE_DRAFT_LIMIT_REACHED", 409);
}
export function isInactiveForArchive(lastActiveAt: Date, now: Date): boolean {
  return lastActiveAt.getTime() <= now.getTime() - 30 * 24 * 60 * 60 * 1000;
}
export function visibleDrafts<T extends { deletedAt: Date | null }>(drafts: T[]): T[] {
  return drafts.filter(draft => draft.deletedAt === null);
}
export function assertDraftOwner(draft: DraftRecord | null, clientId: string): asserts draft is DraftRecord {
  if (!draft || draft.clientId !== clientId || draft.deletedAt !== null) throw new DraftError("DRAFT_NOT_FOUND", 404);
}
export function snapshotDraftBlock(
  existing: DraftBlockSnapshot | null,
  catalog: { blockId: string; unitPrice: number },
  origin: DraftBlockSnapshot["origin"],
): DraftBlockSnapshot {
  return { blockId: catalog.blockId, status: "ADDED", origin, unitPrice: existing?.unitPrice ?? catalog.unitPrice };
}
export function changesUserActivity(action: DraftAction | "BACKGROUND_RETRY" | "BATCH_ARCHIVE" | "READ"): boolean {
  return action !== "BACKGROUND_RETRY" && action !== "BATCH_ARCHIVE" && action !== "READ";
}
