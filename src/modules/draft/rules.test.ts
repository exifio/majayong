import { describe, expect, it } from "@jest/globals";
import {
  assertActionAllowed, assertDraftCapacity, assertDraftOwner, changesUserActivity, DraftError,
  initialPendingFeature, isInactiveForArchive, retryPendingAttempt, sanitizeDraftText, snapshotDraftBlock, visibleDrafts,
} from "./rules.ts";

describe("A-04 draft rules", () => {
  it("A-04-T01 records a failed generation as pending and increments the retry attempt", () => {
    const pending = initialPendingFeature("pending-1");
    const retry = retryPendingAttempt(pending, new Date("2026-11-03T00:00:00.000Z"));
    expect(pending).toMatchObject({ attempts: 0, lastTriedAt: null });
    expect(retry).toMatchObject({ attempts: 1, lastTriedAt: "2026-11-03T00:00:00.000Z" });
  });
  it("A-04-T02 rejects the 31st chat edit but allows block actions", () => {
    expect(() => assertActionAllowed("CHAT", 30)).toThrow(new DraftError("CHAT_EDIT_LIMIT_REACHED", 409));
    expect(() => assertActionAllowed("ADD_BLOCK", 30)).not.toThrow();
    expect(() => assertActionAllowed("REMOVE_BLOCK", 30)).not.toThrow();
  });
  it("A-04-T03 enforces the three-active-draft limit", () => {
    expect(() => assertDraftCapacity(2)).not.toThrow();
    expect(() => assertDraftCapacity(3)).toThrow(new DraftError("ACTIVE_DRAFT_LIMIT_REACHED", 409));
  });
  it("A-04-T04 archives at the inclusive 30-day boundary", () => {
    const now = new Date("2026-11-03T00:00:00.000Z");
    expect(isInactiveForArchive(new Date(now.getTime() - 30 * 86_400_000), now)).toBe(true);
    expect(isInactiveForArchive(new Date(now.getTime() - 30 * 86_400_000 + 1), now)).toBe(false);
  });
  it("A-04-T05 excludes soft-deleted drafts", () => {
    expect(visibleDrafts([{ id: "live", deletedAt: null }, { id: "gone", deletedAt: new Date() }]).map(row => row.id)).toEqual(["live"]);
  });
  it("A-04-T06 prevents duplicate rows from changing the first unit-price snapshot", () => {
    const first = snapshotDraftBlock(null, { blockId: "b1", unitPrice: 5000 }, "RECOMMENDATION");
    const readded = snapshotDraftBlock({ ...first, status: "REMOVED" }, { blockId: "b1", unitPrice: 9000 }, "RECOMMENDATION");
    expect(readded).toMatchObject({ blockId: "b1", status: "ADDED", unitPrice: 5000 });
  });
  it("A-04-T07 changes activity only for user actions", () => {
    expect(changesUserActivity("ADD_BLOCK")).toBe(true);
    expect(changesUserActivity("BACKGROUND_RETRY")).toBe(false);
    expect(changesUserActivity("BATCH_ARCHIVE")).toBe(false);
    expect(changesUserActivity("READ")).toBe(false);
  });
  it("A-04-T08 hides a draft from another owner", () => {
    expect(() => assertDraftOwner({ id: "d1", clientId: "owner", status: "IN_PROGRESS", deletedAt: null }, "other"))
      .toThrow(new DraftError("DRAFT_NOT_FOUND", 404));
  });
  it("redacts profile names, email addresses, and phone numbers before AI input", () => {
    const safe = sanitizeDraftText("김하나 010-1234-5678 hana@example.invalid", ["김하나"]);
    expect(safe).not.toContain("김하나");
    expect(safe).not.toContain("010-1234-5678");
    expect(safe).not.toContain("hana@example.invalid");
  });
});
