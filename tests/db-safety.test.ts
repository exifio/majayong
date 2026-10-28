import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { prisma } from "../src/db.ts";
import { resetDatabase } from "./helpers.ts";

describe("M0 DB 스키마·인덱스 및 SQL 안전 규칙 검증", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("22개 테이블, 핵심 인덱스, SQL 안전 제약이 실제 DB에 존재한다", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    `;
    expect(tables.length).toBe(22);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;
    const indexSet = new Set(indexes.map((r) => r.indexname));
    expect(indexSet.has("application_one_accepted")).toBeTruthy();
    expect(indexSet.has("application_one_active")).toBeTruthy();
    expect(indexSet.has("deposit_one_open")).toBeTruthy();
    expect(indexSet.has("drafts_status_lastActiveAt_idx")).toBeTruthy();
    expect(indexSet.has("projects_status_recruitStartAt_idx")).toBeTruthy();
    expect(indexSet.has("projects_status_deadline_idx")).toBeTruthy();
    expect(indexSet.has("supplier_rates_supplierId_blockId_key")).toBeTruthy();

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('recruit_before_deadline', 'dedupkey_required_for_callback')
    `;
    expect(constraints.length).toBe(2);
  });

  it("SQL 안전 규칙 4개 + deposit_one_open 위반 데이터를 DB가 거부하고 정상 이력은 허용한다", async () => {
    const client = await prisma.user.create({
      data: { email: "c1@test.local", name: "의뢰인", role: "CLIENT" },
    });
    const sup1 = await prisma.user.create({
      data: {
        email: "s1@test.local",
        name: "공급자1",
        role: "SUPPLIER",
        supplierProfile: { create: { displayName: "공급자1" } },
      },
    });
    const sup2 = await prisma.user.create({
      data: {
        email: "s2@test.local",
        name: "공급자2",
        role: "SUPPLIER",
        supplierProfile: { create: { displayName: "공급자2" } },
      },
    });
    const draft = await prisma.draft.create({
      data: { clientId: client.id, entryType: "DEFAULT_DRAFT", status: "CONFIRMED" },
    });

    // 3) recruit_before_deadline: 시작일 >= 마감일 거부
    const t1 = new Date("2026-11-01T00:00:00Z");
    const t2 = new Date("2026-11-05T00:00:00Z");
    await expect(
      prisma.project.create({
        data: {
          draftId: draft.id,
          confirmedAt: t1,
          disclosureConsentVersion: "v1",
          title: "예약기반음식점 · 예약",
          summary: "예약",
          industryCode: "RESTAURANT_RESERVATION",
          recruitStartAt: t2,
          deadline: t1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.project.create({
        data: {
          draftId: draft.id,
          confirmedAt: t1,
          disclosureConsentVersion: "v1",
          title: "예약기반음식점 · 예약",
          summary: "예약",
          industryCode: "RESTAURANT_RESERVATION",
          recruitStartAt: t1,
          deadline: t1,
        },
      }),
    ).rejects.toThrow();

    const project = await prisma.project.create({
      data: {
        draftId: draft.id,
        confirmedAt: t1,
        disclosureConsentVersion: "v1",
        title: "예약기반음식점 · 예약",
        summary: "예약",
        industryCode: "RESTAURANT_RESERVATION",
        recruitStartAt: t1,
        deadline: t2,
      },
    });

    // 2) application_one_active: 동일 (projectId, supplierId)에 활성 지원 2건 거부, SUPERSEDED 후 재견적 허용
    const app1 = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup1.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "SUBMITTED",
        totalAmount: 500_000,
        durationDays: 14,
        firstViewedAt: t1,
      },
    });
    await expect(
      prisma.application.create({
        data: {
          projectId: project.id,
          supplierId: sup1.id,
          revisionNo: 2,
          specVersionNo: 1,
          status: "STALE",
          totalAmount: 550_000,
          durationDays: 14,
          firstViewedAt: t1,
        },
      }),
    ).rejects.toThrow();
    await prisma.application.update({
      where: { id: app1.id },
      data: { status: "SUPERSEDED" },
    });
    const app1Rev2 = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup1.id,
        revisionNo: 2,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 550_000,
        durationDays: 14,
        firstViewedAt: t1,
      },
    });

    // 1) application_one_accepted: 동일 프로젝트에 두 번째 ACCEPTED 거부, AUTO_REJECTED는 허용
    await expect(
      prisma.application.create({
        data: {
          projectId: project.id,
          supplierId: sup2.id,
          revisionNo: 1,
          specVersionNo: 1,
          status: "ACCEPTED",
          totalAmount: 600_000,
          durationDays: 10,
          firstViewedAt: t1,
        },
      }),
    ).rejects.toThrow();
    await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup2.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "AUTO_REJECTED",
        totalAmount: 600_000,
        durationDays: 10,
        firstViewedAt: t1,
      },
    });

    // 4) dedupkey_required_for_callback & 5) deposit_one_open
    const contract = await prisma.contract.create({
      data: {
        applicationId: app1Rev2.id,
        specVersionNo: 1,
        specSnapshot: { items: [] },
        agreedAmount: 550_000,
        clientFee: 27_500,
        supplierFee: 27_500,
      },
    });
    const dep1 = await prisma.escrowDeposit.create({
      data: {
        contractId: contract.id,
        principal: 550_000,
        clientFee: 27_500,
        amount: 577_500,
        status: "PENDING",
        idempotencyKey: "idem-1",
      },
    });
    await expect(
      prisma.escrowDeposit.create({
        data: {
          contractId: contract.id,
          principal: 550_000,
          clientFee: 27_500,
          amount: 577_500,
          status: "PENDING",
          idempotencyKey: "idem-2",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.paymentEvent.create({
        data: {
          depositId: dep1.id,
          eventType: "CALLBACK_RECEIVED",
          dedupKey: null,
        },
      }),
    ).rejects.toThrow();
    await prisma.paymentEvent.create({
      data: {
        depositId: dep1.id,
        eventType: "REQUESTED",
        dedupKey: null,
      },
    });
    await prisma.paymentEvent.create({
      data: {
        depositId: dep1.id,
        eventType: "CALLBACK_RECEIVED",
        dedupKey: "cb-1",
      },
    });
    await prisma.escrowDeposit.update({
      where: { id: dep1.id },
      data: { status: "FAILED" },
    });
    const dep2 = await prisma.escrowDeposit.create({
      data: {
        contractId: contract.id,
        principal: 550_000,
        clientFee: 27_500,
        amount: 577_500,
        status: "PENDING",
        idempotencyKey: "idem-2",
      },
    });
    expect(dep2.id).toBeTruthy();
  });
});
