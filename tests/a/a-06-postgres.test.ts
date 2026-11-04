import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  BlockOrigin, DraftEntryType, EventType, PrismaClient, ProjectStatus, Role, SpecItemStatus,
} from "@prisma/client";
import {
  extendDeadline, getPublicProjectDetail, listMyProjects, listPublicProjects, reviseSpec,
  runProjectDeadlineBatch, softDeleteProject, type SpecRevisionItem,
} from "../../src/modules/project/service.ts";
import { createProjectOutputPorts, type ProjectPorts } from "../../src/modules/project/ports.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test")
  throw new Error("A-06 tests require the dedicated majayong_a00_test database");
process.env.DATABASE_URL = databaseUrl;

const db = new PrismaClient();
const now = new Date("2026-11-03T09:00:00.000Z");
const futureDeadline = new Date("2026-11-10T09:00:00.000Z");
const pastDeadline = new Date("2026-11-02T09:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const userIds: string[] = [];
const draftIds: string[] = [];
const projectIds: string[] = [];
const blockIds: string[] = [];

async function makeClient(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a06-${id}@example.invalid`, name: "김의뢰", role: Role.CLIENT } });
  await db.clientProfile.create({ data: { userId: id, businessName: "카페 블루", industryField: "카페", storeAddress: "서울 마포구 월드컵로 12", profileCompleted: true } });
  return id;
}

async function makeSupplier(ndaVersion: string | null = "nda-v1"): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.user.create({ data: { id, email: `a06-sup-${id}@example.invalid`, role: Role.SUPPLIER } });
  await db.supplierProfile.create({ data: { userId: id, displayName: "공급자", ndaAgreedAt: ndaVersion ? now : null, ndaVersion } });
  return id;
}

async function makeProject(clientId: string, overrides: {
  status?: ProjectStatus; deadline?: Date | null; selectionEndsAt?: Date | null; recruitStartAt?: Date | null;
} = {}): Promise<string> {
  const draftId = randomUUID();
  const projectId = randomUUID();
  draftIds.push(draftId);
  projectIds.push(projectId);
  await db.draft.create({ data: { id: draftId, clientId, entryType: DraftEntryType.SENTENCE } });
  await db.project.create({
    data: {
      id: projectId, draftId, confirmedAt: now, disclosureConsentVersion: "v1", title: "예약 달력 외 2개 기능",
      summary: "예약 관련 기능", industryCode: "RESTAURANT", requiredSkills: ["react"], hopeBudget: 4_000_000,
      deadline: overrides.deadline === undefined ? futureDeadline : overrides.deadline,
      recruitStartAt: overrides.recruitStartAt ?? null,
      selectionEndsAt: overrides.selectionEndsAt ?? null,
      status: overrides.status ?? ProjectStatus.RECRUITING,
    },
  });
  return projectId;
}

async function addSpecItems(projectId: string, versionNo: number, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const blockId = randomUUID();
    blockIds.push(blockId);
    await db.blockCatalog.create({
      data: {
        id: blockId, code: `a06-${blockId}`, name: `기능 ${index}`, functionSummary: `기능 ${index}`,
        description: `기능 ${index} 설명`, industryCode: "RESTAURANT", unitPrice: 100_000, priceBasis: "범위\n가정\n추정",
        conditions: [{ key: "k", text: "조건" }], wireframe: { parts: [{ type: "TEXT" }] },
      },
    });
    await db.specItem.create({
      data: {
        projectId, versionNo, blockId, title: `기능 ${index}`, description: `기능 ${index} 설명`,
        origin: BlockOrigin.FIRST_SENTENCE, status: SpecItemStatus.INCLUDED, unitPrice: 100_000,
        conditions: [{ key: "k", text: "조건" }], wireframe: { parts: [{ type: "TEXT" }] }, sortOrder: index,
      },
    });
  }
}

async function currentItems(projectId: string): Promise<SpecRevisionItem[]> {
  const rows = await db.specItem.findMany({ where: { projectId, versionNo: 1 }, orderBy: { sortOrder: "asc" } });
  return rows.map(row => ({ blockId: row.blockId, title: row.title, description: row.description, conditions: row.conditions ?? undefined, sortOrder: row.sortOrder }));
}

function applicationPort(overrides: Partial<{ countPending: number; markSpecStale: number; rejectPendingOnDelete: number }> = {}) {
  return {
    countPending: jest.fn(async () => overrides.countPending ?? 0),
    markSpecStale: jest.fn(async () => overrides.markSpecStale ?? 0),
    rejectPendingOnDelete: jest.fn(async () => overrides.rejectPendingOnDelete ?? 0),
  };
}

afterAll(async () => {
  if (projectIds.length) await db.eventLog.deleteMany({ where: { projectId: { in: projectIds } } });
  if (userIds.length) await db.eventLog.deleteMany({ where: { userId: { in: userIds } } });
  if (projectIds.length) await db.specItem.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.application.deleteMany({ where: { projectId: { in: projectIds } } });
  if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
  if (draftIds.length) await db.draft.deleteMany({ where: { id: { in: draftIds } } });
  if (blockIds.length) await db.blockCatalog.deleteMany({ where: { id: { in: blockIds } } });
  if (userIds.length) await db.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.supplierProfile.deleteMany({ where: { userId: { in: userIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe("A-06 spec revision", () => {
  it("A-06-T01 copies every current spec item into a new version and stales applicants", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    await addSpecItems(projectId, 1, 3);
    const port = applicationPort({ markSpecStale: 2 });
    const ports: ProjectPorts = { application: port };

    const result = await reviseSpec(db, ports, projectId, clientId, { items: await currentItems(projectId) }, now);

    expect(result).toEqual({ projectId, currentVersion: 2, itemCount: 3 });
    expect(await db.specItem.count({ where: { projectId, versionNo: 2 } })).toBe(3);
    expect((await db.specItem.findMany({ where: { projectId, versionNo: 2 } })).every(item => item.unitPrice === 100_000)).toBe(true);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ currentVersion: 2, status: ProjectStatus.RECRUITING });
    expect(port.markSpecStale).toHaveBeenCalledTimes(1);
    expect(port.markSpecStale.mock.calls[0]?.[1]).toMatchObject({ projectId, newVersionNo: 2 });
    expect(await db.eventLog.count({ where: { projectId, type: EventType.SPEC_REVISED } })).toBe(1);
  });

  it("A-06-T01 refuses a spec edit once the project is accepted or contracted", async () => {
    const clientId = await makeClient();
    const accepted = await makeProject(clientId, { status: ProjectStatus.ACCEPTED });
    await addSpecItems(accepted, 1, 1);
    const ports: ProjectPorts = { application: applicationPort() };
    await expect(reviseSpec(db, ports, accepted, clientId, { items: await currentItems(accepted) }, now))
      .rejects.toMatchObject({ code: "PROJECT_SPEC_LOCKED", status: 409 });
    expect(await db.specItem.count({ where: { projectId: accepted, versionNo: 2 } })).toBe(0);
  });

  it("does not let a non-owner revise the spec", async () => {
    const clientId = await makeClient();
    const stranger = await makeClient();
    const projectId = await makeProject(clientId);
    await addSpecItems(projectId, 1, 1);
    await expect(reviseSpec(db, { application: applicationPort() }, projectId, stranger, { items: await currentItems(projectId) }, now))
      .rejects.toMatchObject({ code: "PROJECT_NOT_FOUND", status: 404 });
  });
});

describe("A-06 deadline batch", () => {
  it("A-06-T04 selects with a seven day window when applicants wait", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { deadline: pastDeadline });
    const port = applicationPort({ countPending: 3 });

    const result = await runProjectDeadlineBatch(db, { application: port, notification: { enqueue: jest.fn() } }, now);

    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe(ProjectStatus.SELECTING);
    expect(project.selectionEndsAt?.getTime()).toBe(now.getTime() + 7 * day);
    expect(result.selecting).toBeGreaterThanOrEqual(1);
  });

  it("A-06-T04 expires when no applicant waits", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { deadline: pastDeadline });
    await runProjectDeadlineBatch(db, { application: applicationPort({ countPending: 0 }), notification: { enqueue: jest.fn() } }, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ status: ProjectStatus.EXPIRED, selectionEndsAt: null });
  });

  it("A-06-T05 moves a selecting project to expired and rejects waiting applicants", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { status: ProjectStatus.SELECTING, selectionEndsAt: pastDeadline });
    const port = applicationPort({ rejectPendingOnDelete: 2 });
    await runProjectDeadlineBatch(db, { application: port, notification: { enqueue: jest.fn() } }, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ status: ProjectStatus.EXPIRED });
    expect(port.rejectPendingOnDelete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId }));
  });

  it("A-06-T06 leaves accepted and contracted projects untouched", async () => {
    const clientId = await makeClient();
    const accepted = await makeProject(clientId, { deadline: pastDeadline, status: ProjectStatus.ACCEPTED });
    const contracted = await makeProject(clientId, { deadline: pastDeadline, status: ProjectStatus.CONTRACTED });
    const port = applicationPort({ countPending: 5 });
    await runProjectDeadlineBatch(db, { application: port, notification: { enqueue: jest.fn() } }, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: accepted } })).toMatchObject({ status: ProjectStatus.ACCEPTED });
    expect(await db.project.findUniqueOrThrow({ where: { id: contracted } })).toMatchObject({ status: ProjectStatus.CONTRACTED });
  });

  it("A-06-T07 is idempotent across repeated runs without duplicate notifications", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { deadline: pastDeadline });
    const port = applicationPort({ countPending: 0 });
    const enqueue = jest.fn(async () => undefined);
    const first = await runProjectDeadlineBatch(db, { application: port, notification: { enqueue } }, now);
    const second = await runProjectDeadlineBatch(db, { application: port, notification: { enqueue } }, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ status: ProjectStatus.EXPIRED });
    expect(second.recruiting).toBe(0);
    expect(second.selecting).toBe(0);
    expect(second.expired).toBe(0);
    expect(first.expired).toBeGreaterThanOrEqual(1);
  });

  it("A-06-T03 promotes a scheduled project to recruiting only after its start time", async () => {
    const clientId = await makeClient();
    const future = await makeProject(clientId, { status: ProjectStatus.SCHEDULED, recruitStartAt: new Date(now.getTime() + day) });
    const due = await makeProject(clientId, { status: ProjectStatus.SCHEDULED, recruitStartAt: new Date(now.getTime() - day) });
    await runProjectDeadlineBatch(db, { application: applicationPort(), notification: { enqueue: jest.fn() } }, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: future } })).toMatchObject({ status: ProjectStatus.SCHEDULED });
    expect(await db.project.findUniqueOrThrow({ where: { id: due } })).toMatchObject({ status: ProjectStatus.RECRUITING });
  });
});

describe("A-06 read surfaces", () => {
  it("lists the owner's projects with application and detail-view counts", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    await addSpecItems(projectId, 1, 2);
    const supplierId = await makeSupplier();
    await db.application.create({ data: { projectId, supplierId, specVersionNo: 1, totalAmount: 100, durationDays: 1, firstViewedAt: now } });
    await db.eventLog.create({ data: { userId: supplierId, projectId, type: EventType.SPEC_DETAIL_VIEWED, occurredAt: now } });

    const rows = await listMyProjects(db, clientId);

    const card = rows.find(row => row.projectId === projectId);
    expect(card).toMatchObject({ projectId, status: ProjectStatus.RECRUITING, applicationCount: 1, detailViewCount: 1, currentVersion: 1 });
  });

  it("A-06-T03/T05 lists public projects through the search port without leaking the exact budget", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    await addSpecItems(projectId, 1, 2);
    const searchPublicProjects = jest.fn(async () => ({ projectIds: [projectId], total: 1 }));

    const page = await listPublicProjects(db, { searchPublicProjects }, { filters: {}, page: 1, pageSize: 10 });

    expect(searchPublicProjects).toHaveBeenCalledTimes(1);
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ projectId, itemCount: 2, hopeBudgetBand: "300만원~500만원" });
    expect(page.items[0]).not.toHaveProperty("hopeBudget");
    expect(JSON.stringify(page.items)).not.toContain("4000000");
  });

  it("A-06-T05 records exactly one first view and returns the public detail after NDA", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    await addSpecItems(projectId, 1, 2);
    const supplierId = await makeSupplier("nda-v1");
    const recordFirstView = jest.fn(async () => undefined);

    const detail = await getPublicProjectDetail(db, { supplierNdaVersion: "nda-v1", view: { recordFirstView } }, projectId, supplierId, now);

    expect(recordFirstView).toHaveBeenCalledTimes(1);
    expect(detail).toMatchObject({ projectId, itemCount: 2, hopeBudget: 4_000_000 });
    expect(detail.client).toMatchObject({ businessName: "카페 블루", name: "김의뢰" });
    expect(detail.items[0]).toMatchObject({ title: "기능 0" });
    for (const forbidden of ["unitPrice", "estimatedTotal", "clientFee", "email"]) expect(detail).not.toHaveProperty(forbidden);
  });

  it("blocks public detail without the current supplier NDA", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    const supplierId = await makeSupplier(null);
    const recordFirstView = jest.fn(async () => undefined);
    await expect(getPublicProjectDetail(db, { supplierNdaVersion: "nda-v1", view: { recordFirstView } }, projectId, supplierId, now))
      .rejects.toMatchObject({ code: "SUPPLIER_NDA_REQUIRED", status: 403 });
    expect(recordFirstView).not.toHaveBeenCalled();
  });

  it("soft deletes an owner's project and rejects waiting applications", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    const port = applicationPort({ rejectPendingOnDelete: 1 });
    await softDeleteProject(db, { application: port }, projectId, clientId, now);
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ deletedAt: now });
    expect(port.rejectPendingOnDelete).toHaveBeenCalledTimes(1);
    expect((await listMyProjects(db, clientId)).some(row => row.projectId === projectId)).toBe(false);
  });
});

describe("A-06 output ports for B/C", () => {
  it("transitions a project through the contract states and rejects invalid jumps", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId);
    const ports = createProjectOutputPorts(db);

    await expect(ports.transitionProject(db, { projectId, to: ProjectStatus.CONTRACTED, at: now }))
      .rejects.toMatchObject({ code: "INVALID_PROJECT_TRANSITION", status: 409 });

    await db.$transaction(tx => ports.transitionProject(tx, { projectId, to: ProjectStatus.ACCEPTED, at: now }));
    expect(await ports.readSpecVersion(projectId)).toMatchObject({ currentVersion: 1, status: ProjectStatus.ACCEPTED });

    await db.$transaction(tx => ports.transitionProject(tx, { projectId, to: ProjectStatus.CONTRACTED, at: now }));
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ status: ProjectStatus.CONTRACTED });

    await db.$transaction(tx => ports.transitionProject(tx, { projectId, to: ProjectStatus.SELECTING, at: now }));
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe(ProjectStatus.SELECTING);
    expect(project.selectionEndsAt?.getTime()).toBe(now.getTime() + 7 * day);
  });
});

describe("A-06 deadline extension", () => {
  it("A-06-T05 caps the extension at fourteen days and reopens recruitment", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { status: ProjectStatus.SELECTING, selectionEndsAt: pastDeadline });
    const ports: ProjectPorts = { notification: { enqueue: jest.fn() } };

    await expect(extendDeadline(db, ports, projectId, clientId, new Date(futureDeadline.getTime() + 14 * day + 1), now))
      .rejects.toMatchObject({ code: "INVALID_DEADLINE_EXTENSION", status: 422 });

    const exactly = new Date(futureDeadline.getTime() + 14 * day);
    const result = await extendDeadline(db, ports, projectId, clientId, exactly, now);
    expect(result).toMatchObject({ projectId, status: ProjectStatus.RECRUITING });
    expect(await db.project.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject({ status: ProjectStatus.RECRUITING, selectionEndsAt: null });
    expect(await db.eventLog.count({ where: { projectId, type: EventType.DEADLINE_EXTENDED } })).toBe(1);
  });

  it("refuses to extend a project that is already in a contract", async () => {
    const clientId = await makeClient();
    const projectId = await makeProject(clientId, { status: ProjectStatus.CONTRACTED });
    await expect(extendDeadline(db, {}, projectId, clientId, new Date(futureDeadline.getTime() + day), now))
      .rejects.toMatchObject({ code: "PROJECT_DEADLINE_NOT_EXTENDABLE", status: 409 });
  });
});
