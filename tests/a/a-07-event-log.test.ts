import { afterAll, describe, expect, it } from "@jest/globals";
import { EventType, PrismaClient, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../src/core/observability.ts";
import { EventError, recordEvent, recordLlmCall } from "../../src/core/events.ts";
import { getProductMetrics, specCompletionRate } from "../../src/core/metrics.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test") {
  throw new Error("A-07 tests require the dedicated majayong_a00_test database");
}
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const userIds: string[] = [];

async function makeUser(role = Role.CLIENT): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `a07-${id}@example.invalid`, role } });
  userIds.push(id);
  return id;
}

afterAll(async () => {
  if (userIds.length > 0) {
    await db.eventLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.$disconnect();
});

describe("A-07 common event log", () => {
  it("A-07-T01 keeps tokens and cost on a failed LLM call and rejects bad metrics", async () => {
    const userId = await makeUser();
    const row = await db.$transaction(tx => recordLlmCall(tx, {
      userId, purpose: "BLOCK_CREATE", model: "gpt-test",
      tokens: { input: 120, output: 0 }, costKrw: 37, latencyMs: 250, succeeded: false,
    }));
    const saved = await db.eventLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.type).toBe(EventType.LLM_CALLED);
    expect(saved.payload).toEqual({
      purpose: "BLOCK_CREATE", model: "gpt-test", tokens: { input: 120, output: 0 },
      costKrw: 37, latencyMs: 250, succeeded: false,
    });

    await expect(recordLlmCall(db, { userId, purpose: "BLOCK_CREATE", model: "", tokens: { input: 0, output: 0 }, costKrw: 0, latencyMs: 0, succeeded: false }))
      .rejects.toBeInstanceOf(EventError);
    await expect(recordLlmCall(db, { userId, purpose: "BLOCK_CREATE", model: "m", tokens: { input: -1, output: 0 }, costKrw: 0, latencyMs: 0, succeeded: true }))
      .rejects.toBeInstanceOf(EventError);
    await expect(recordLlmCall(db, { userId, purpose: "NOT_A_PURPOSE" as never, model: "m", tokens: { input: 0, output: 0 }, costKrw: 0, latencyMs: 0, succeeded: true }))
      .rejects.toBeInstanceOf(EventError);
  });

  it("A-07-T02 round-trips event payloads without lossy transformation", async () => {
    const userId = await makeUser();
    const payload = { status: "DRAFT", count: 3, nested: { ok: true }, tags: ["a", "b"] };
    const first = await recordEvent(db, { type: EventType.PORTFOLIO_SUMMARIZED, userId, payload });
    const second = await recordEvent(db, { type: EventType.PORTFOLIO_SUMMARIZED, userId, payload });
    const rows = await db.eventLog.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.payload).toEqual(payload);
    expect(rows[1]!.payload).toEqual(payload);
  });

  it("A-07-T03 never logs or stores raw personal text", async () => {
    const userId = await makeUser();
    const lines: string[] = [];
    createLogger(line => lines.push(line)).log("error", "request_failed", {
      requestId: "req-1", userEmail: "private@example.invalid", clientUtterance: "원문", amount: 1234, status: "failed",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("request_failed");
    expect(lines[0]).toContain("req-1");
    expect(lines[0]).not.toMatch(/private|원문|1234/);

    await expect(recordEvent(db, { type: EventType.CHAT_SUBMITTED, userId, payload: { utterance: "원문", count: 1 } }))
      .rejects.toBeInstanceOf(EventError);
    await expect(recordEvent(db, { type: EventType.CHAT_SUBMITTED, userId, payload: { nested: { email: "a@b.invalid" } } }))
      .rejects.toBeInstanceOf(EventError);
  });

  it("A-07-T04 keeps product metrics consistent with the recorded events", async () => {
    const userId = await makeUser();
    const from = new Date("2099-06-01T00:00:00.000Z");
    const to = new Date("2099-06-02T00:00:00.000Z");
    const at = new Date("2099-06-01T09:00:00.000Z");
    await db.$transaction(async tx => {
      await recordEvent(tx, { type: EventType.DRAFT_RENDERED, userId, occurredAt: at, payload: { reusedBlocks: 2, generatedBlocks: 1, pendingFeatures: 0, durationMs: 1000 } });
      await recordEvent(tx, { type: EventType.DRAFT_RENDERED, userId, occurredAt: at, payload: { reusedBlocks: 3, generatedBlocks: 0, pendingFeatures: 1, durationMs: 3000 } });
      await recordEvent(tx, { type: EventType.SPEC_CONFIRMED, userId, occurredAt: at });
      await recordEvent(tx, { type: EventType.DRAFT_RENDERED, userId, occurredAt: new Date("2099-06-05T00:00:00.000Z"), payload: { reusedBlocks: 9 } });
    });

    const metrics = await getProductMetrics(db, { from, to });
    expect(metrics).toMatchObject({
      draftRendered: 2, specConfirmed: 1, specCompletionRate: 0.5,
      averageDraftRenderMs: 2000, reusedBlocks: 5, generatedBlocks: 1, pendingFeatures: 1,
    });
  });

  it("A-07-T05 rejects non-JSON payload values and clamps derived ratios", async () => {
    const userId = await makeUser();
    await expect(recordEvent(db, { type: EventType.SPEC_REVISED, userId, payload: { when: new Date() as unknown as string } }))
      .rejects.toBeInstanceOf(EventError);
    await expect(recordEvent(db, { type: EventType.SPEC_REVISED, userId, payload: { nan: Number.NaN } }))
      .rejects.toBeInstanceOf(EventError);

    expect(specCompletionRate(4, 2)).toBe(0.5);
    expect(specCompletionRate(2, 5)).toBe(1);
    expect(specCompletionRate(0, 3)).toBe(0);
  });
});
