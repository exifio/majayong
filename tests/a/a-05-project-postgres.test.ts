import { afterAll, describe, expect, it } from "@jest/globals";
import { BlockOrigin, DraftEntryType, DraftStatus, PrismaClient, Role } from "@prisma/client";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { Actor } from "../../src/modules/identity/session.ts";
import type { AuthenticatedDraftRoute } from "../../src/modules/draft/api.ts";
import { mountProjectApi } from "../../src/modules/project/api.ts";
import { publishDraft } from "../../src/modules/project/service.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test") {
  throw new Error("A-05 tests require the dedicated majayong_a00_test database");
}
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const userIds: string[] = [];
const draftIds: string[] = [];
const blockIds: string[] = [];
const servers: Server[] = [];
const now = new Date("2026-11-03T09:00:00.000Z");

async function makeDraft(pendingFeatures: unknown[] = []): Promise<{ clientId: string; draftId: string; blockIds: string[] }> {
  const clientId = randomUUID();
  const draftId = randomUUID();
  const ids: string[] = [];
  await db.user.create({ data: { id: clientId, email: `a05-project-${clientId}@example.invalid`, role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: clientId, businessName: "테스트 상호" } });
  await db.draft.create({
    data: { id: draftId, clientId, entryType: DraftEntryType.SENTENCE, hopeBudget: 500_000, pendingFeatures },
  });

  const definitions = [
    { name: "예약 달력", snapshotPrice: 1000, catalogPrice: 9000, techTags: ["react"], status: "ADDED", sortOrder: 0 },
    { name: "예약금 결제", snapshotPrice: 2000, catalogPrice: 18_000, techTags: ["payments"], status: "ADDED", sortOrder: 1 },
    { name: "제외된 기능", snapshotPrice: 3000, catalogPrice: 27_000, techTags: ["legacy"], status: "REMOVED", sortOrder: 2 },
  ] as const;
  for (const [index, definition] of definitions.entries()) {
    const blockId = randomUUID();
    await db.blockCatalog.create({
      data: {
        id: blockId,
        code: `a05-project-${blockId}`,
        name: definition.name,
        functionSummary: `${definition.name} 기능 요약`,
        description: `${definition.name} 상세 설명`,
        industryCode: "RESTAURANT",
        techTags: [...definition.techTags],
        unitPrice: definition.catalogPrice,
        priceBasis: `${definition.name} 산정 근거`,
        conditions: index === 0 ? [{ key: "refund", text: "환불 기준" }] : [],
        wireframe: { parts: [{ type: "CALENDAR", label: definition.name }] },
      },
    });
    await db.draftBlock.create({
      data: {
        draftId,
        blockId,
        origin: BlockOrigin.FIRST_SENTENCE,
        status: definition.status,
        unitPrice: definition.snapshotPrice,
        conditionNotes: index === 0 ? [{ key: "refund", note: "전날 취소", at: now.toISOString() }] : [],
        sortOrder: definition.sortOrder,
      },
    });
    ids.push(blockId);
  }
  userIds.push(clientId);
  draftIds.push(draftId);
  blockIds.push(...ids);
  return { clientId, draftId, blockIds: ids };
}

async function startProjectServer(actor: Actor): Promise<string> {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const authenticated: AuthenticatedDraftRoute = handler => (req, res, next) => {
    Promise.resolve(handler(req, res, actor)).catch(next);
  };
  mountProjectApi(router, db, () => now, () => "v2.0", authenticated);
  app.use("/api/v1", router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" });
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind");
  servers.push(server);
  return `http://127.0.0.1:${address.port}/api/v1`;
}

const publishInput = {
  recruitStartAt: new Date("2026-11-03T09:00:00.000Z"),
  deadline: new Date("2026-11-10T09:00:00.000Z"),
  disclosureConsentVersion: "v2.0",
  disclosureScope: "DETAIL" as const,
  disclosureConsent: true as const,
};

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  if (draftIds.length > 0) {
    const projects = await db.project.findMany({ where: { draftId: { in: draftIds } }, select: { id: true } });
    const projectIds = projects.map(project => project.id);
    if (projectIds.length > 0) {
      await db.eventLog.deleteMany({ where: { projectId: { in: projectIds } } });
      await db.specItem.deleteMany({ where: { projectId: { in: projectIds } } });
    }
    await db.project.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.draftBlock.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.clientUtterance.deleteMany({ where: { draftId: { in: draftIds } } });
    await db.draft.deleteMany({ where: { id: { in: draftIds } } });
  }
  if (blockIds.length > 0) await db.blockCatalog.deleteMany({ where: { id: { in: blockIds } } });
  if (userIds.length > 0) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length > 0) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$executeRaw`DROP TRIGGER IF EXISTS a05_test_reject_spec_item ON spec_items`;
  await db.$executeRaw`DROP FUNCTION IF EXISTS a05_test_reject_spec_item()`;
  await db.$disconnect();
});

describe("A-05 project publication PostgreSQL integration", () => {
  it("A-05-T04 serializes duplicate publication and copies all selected rows into version 1", async () => {
    const { clientId, draftId } = await makeDraft();
    const outcomes = await Promise.allSettled([
      publishDraft(db, draftId, clientId, publishInput, "v2.0", now),
      publishDraft(db, draftId, clientId, publishInput, "v2.0", now),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);

    const project = await db.project.findUniqueOrThrow({ where: { draftId } });
    const items = await db.specItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } });
    expect(project).toMatchObject({ currentVersion: 1, status: "RECRUITING", title: "예약 달력, 예약금 결제" });
    expect(project.requiredSkills).toEqual(["react", "payments"]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      versionNo: 1,
      blockId: (await db.draftBlock.findFirstOrThrow({ where: { draftId, sortOrder: 0 }, select: { blockId: true } })).blockId,
      title: "예약 달력",
      description: "예약 달력 상세 설명",
      origin: "FIRST_SENTENCE",
      unitPrice: 1000,
      status: "INCLUDED",
      conditions: [{ key: "refund", text: "환불 기준", note: "전날 취소" }],
      wireframe: { parts: [{ type: "CALENDAR", label: "예약 달력" }] },
    });
    expect(items.map(item => item.unitPrice)).toEqual([1000, 2000]);
    expect(await db.eventLog.count({ where: { projectId: project.id, type: "PROJECT_PUBLISHED" } })).toBe(1);
  });

  it("A-05-T04 rolls back Project and Draft changes if SpecItem insertion fails", async () => {
    const { clientId, draftId } = await makeDraft();
    await db.$executeRaw`DROP TRIGGER IF EXISTS a05_test_reject_spec_item ON spec_items`;
    await db.$executeRaw`DROP FUNCTION IF EXISTS a05_test_reject_spec_item()`;
    await db.$executeRaw`CREATE FUNCTION a05_test_reject_spec_item() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'A05_TEST_SPECITEM_FAILURE'; END;
    $$ LANGUAGE plpgsql`;
    await db.$executeRaw`CREATE TRIGGER a05_test_reject_spec_item BEFORE INSERT ON spec_items
      FOR EACH ROW EXECUTE FUNCTION a05_test_reject_spec_item()`;
    try {
      await expect(publishDraft(db, draftId, clientId, publishInput, "v2.0", now)).rejects.toThrow();
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS a05_test_reject_spec_item ON spec_items`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS a05_test_reject_spec_item()`;
    }
    expect(await db.project.findUnique({ where: { draftId } })).toBeNull();
    expect(await db.draft.findUniqueOrThrow({ where: { id: draftId }, select: { status: true } })).toEqual({ status: DraftStatus.IN_PROGRESS });
  });

  it("A-05-T05 rejects a recruitment start that is not before the deadline", async () => {
    const { clientId, draftId } = await makeDraft();
    await expect(publishDraft(db, draftId, clientId, {
      ...publishInput,
      recruitStartAt: publishInput.deadline,
    }, "v2.0", now)).rejects.toMatchObject({ code: "INVALID_RECRUITMENT_PERIOD", status: 422 });
    expect(await db.project.findUnique({ where: { draftId } })).toBeNull();
  });

  it("A-05-T06 requires the active disclosure consent version before publishing", async () => {
    const { clientId, draftId } = await makeDraft();
    await expect(publishDraft(db, draftId, clientId, {
      ...publishInput,
      disclosureConsentVersion: "",
    }, "v2.0", now)).rejects.toMatchObject({ code: "DISCLOSURE_CONSENT_REQUIRED", status: 422 });
    expect(await db.project.findUnique({ where: { draftId } })).toBeNull();
  });

  it("returns only a public-safe project summary from POST /publish", async () => {
    const { clientId, draftId } = await makeDraft();
    const baseUrl = await startProjectServer({ userId: clientId, role: Role.CLIENT });
    const response = await fetch(`${baseUrl}/drafts/${draftId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recruitStartAt: publishInput.recruitStartAt.toISOString(),
        deadline: publishInput.deadline.toISOString(),
        disclosureConsentVersion: "v2.0",
        disclosureScope: "DETAIL",
        disclosureConsent: true,
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(201);
    expect(body).toContain('"title":"예약 달력, 예약금 결제"');
    expect(body).not.toContain("unitPrice");
    expect(body).not.toContain("estimatedTotal");
    expect(body).not.toContain("clientFee");
  });

  it("does not publish a draft while generated features are still pending", async () => {
    const { clientId, draftId } = await makeDraft([{ key: "pending", summary: "회원 알림", attempts: 1, lastTriedAt: null }]);
    await expect(publishDraft(db, draftId, clientId, publishInput, "v2.0", now))
      .rejects.toMatchObject({ code: "DRAFT_FEATURES_PENDING", status: 409 });
    expect(await db.project.findUnique({ where: { draftId } })).toBeNull();
  });
});
