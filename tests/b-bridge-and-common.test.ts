import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { AppError } from "../src/shared/errors.ts";
import { createNotification, logEvent } from "../src/shared/events.ts";
import {
  getAcceptedApplicationContext,
  transitionProjectForContract,
} from "../src/shared/contract-bridge.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";

describe("공통 서버·이벤트·알림 및 Agent B 계약 브리지 검증", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("서버 health, OpenAPI 문서, 공통 404 JSON 오류 형식을 반환한다", async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const port = getServerPort(server);
      const base = `http://127.0.0.1:${port}`;

      const healthRes = await fetch(`${base}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ status: "ok" });

      const docJsonRes = await fetch(`${base}/api-docs.json`);
      expect(docJsonRes.status).toBe(200);
      const docJson = assertRecord(await docJsonRes.json());
      expect(docJson.openapi).toBe("3.0.3");
      if (!Array.isArray(docJson.tags)) {
        throw new Error("OpenAPI tags는 배열이어야 합니다.");
      }
      const tagNames = docJson.tags.map((t: unknown) => assertRecord(t).name);
      expect(tagNames.includes("Supplier Space - Rates")).toBeTruthy();
      expect(tagNames.includes("Client Space - Estimates")).toBeTruthy();

      const docHtmlRes = await fetch(`${base}/api-docs`);
      expect(docHtmlRes.status).toBe(200);
      expect(await docHtmlRes.text()).toMatch(/SwaggerUIBundle/);

      const missingRes = await fetch(`${base}/api/unknown`);
      expect(missingRes.status).toBe(404);
      const missingBody = assertRecord(await missingRes.json());
      expect(assertRecord(missingBody.error).code).toBe("NOT_FOUND");
    } finally {
      server.close();
    }
  });

  it("logEvent는 민감 필드를 제거하고 배치 sessionId null을 허용하며, createNotification은 중복 미읽음 알림을 막는다", async () => {
    const user = await prisma.user.create({
      data: { email: "u@test.local", name: "사용자", role: "CLIENT" },
    });

    const ev = await logEvent(prisma, {
      type: "LLM_CALLED",
      userId: null,
      sessionId: null,
      payload: {
        model: "gpt-5-mini",
        purpose: "CLASSIFY",
        costKrw: 12,
        content: "원문 노출 금지",
        rawText: "마스킹되지 않은 원문",
        email: "private@example.test",
        apiKey: "sk-secret",
        nested: {
          phone: "010-1234-5678",
          ok: true,
          entries: [{ rawText: "배열 안 원문", keep: 0, enabled: false }],
        },
      },
    });
    const savedPayload = assertRecord(ev.payload);
    expect(savedPayload.model).toBe("gpt-5-mini");
    expect("content" in savedPayload).toBe(false);
    expect("rawText" in savedPayload).toBe(false);
    expect("email" in savedPayload).toBe(false);
    expect("apiKey" in savedPayload).toBe(false);
    expect(savedPayload.nested).toEqual({
      ok: true,
      entries: [{ keep: 0, enabled: false }],
    });

    await prisma.$transaction(async (tx) => {
      const n1 = await createNotification(tx, {
        userId: user.id,
        type: "APPLICATION_RECEIVED",
        targetId: "proj-1",
        targetUrl: "/client/projects/proj-1/applications",
      });
      const n2 = await createNotification(tx, {
        userId: user.id,
        type: "APPLICATION_RECEIVED",
        targetId: "proj-1",
        targetUrl: "/client/projects/proj-1/applications",
      });
      expect(n1.id).toBe(n2.id);
    });
  });

  it("getAcceptedApplicationContext와 transitionProjectForContract가 계약 범위 필터링 및 취소 시 모집 복귀·재계약을 한 트랜잭션으로 보장한다", async () => {
    const client = await prisma.user.create({
      data: { email: "client@test.local", name: "의뢰인", role: "CLIENT" },
    });
    const sup1 = await prisma.user.create({
      data: {
        email: "sup1@test.local",
        name: "공급자1",
        role: "SUPPLIER",
        supplierProfile: {
          create: { displayName: "공급자1", feeExempt: true, feeExemptUsedAt: null },
        },
      },
    });
    const sup2 = await prisma.user.create({
      data: {
        email: "sup2@test.local",
        name: "공급자2",
        role: "SUPPLIER",
        supplierProfile: { create: { displayName: "공급자2" } },
      },
    });

    const draft = await prisma.draft.create({
      data: { clientId: client.id, entryType: "SENTENCE", status: "CONFIRMED" },
    });
    const tStart = new Date("2026-10-27T00:00:00Z");
    const tDeadline = new Date("2026-11-10T00:00:00Z");
    const project = await prisma.project.create({
      data: {
        draftId: draft.id,
        currentVersion: 1,
        confirmedAt: tStart,
        disclosureConsentVersion: "v1",
        title: "예약기반음식점 · 예약 캘린더",
        summary: "예약 캘린더, 메뉴 소개",
        industryCode: "RESTAURANT_RESERVATION",
        recruitStartAt: tStart,
        deadline: tDeadline,
        status: "ACCEPTED",
        publishedAt: tStart,
      },
    });

    const itemIncludedOk = await prisma.specItem.create({
      data: {
        projectId: project.id,
        versionNo: 1,
        title: "예약 캘린더",
        description: "날짜별 예약",
        origin: "FIRST_SENTENCE",
        status: "INCLUDED",
        sortOrder: 1,
      },
    });
    const itemIncludedUnavailable = await prisma.specItem.create({
      data: {
        projectId: project.id,
        versionNo: 1,
        title: "결제 연동",
        description: "선결제",
        origin: "FIRST_SENTENCE",
        status: "INCLUDED",
        sortOrder: 2,
      },
    });
    const itemNeedsConfirm = await prisma.specItem.create({
      data: {
        projectId: project.id,
        versionNo: 1,
        title: "알림톡",
        description: "확인 필요 질문 미답변",
        origin: "RECOMMENDATION",
        status: "NEEDS_CONFIRMATION",
        sortOrder: 3,
      },
    });
    await prisma.specItem.create({
      data: {
        projectId: project.id,
        versionNo: 1,
        title: "다국어",
        description: "사용자 삭제 항목",
        origin: "DEFAULT_DRAFT",
        status: "EXCLUDED",
        sortOrder: 4,
      },
    });

    const acceptedApp = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup1.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 800_000,
        durationDays: 14,
        firstViewedAt: tStart,
        items: {
          create: [
            { specItemId: itemIncludedOk.id, isAvailable: true, amount: 800_000 },
            { specItemId: itemIncludedUnavailable.id, isAvailable: false, amount: null },
            { specItemId: itemNeedsConfirm.id, isAvailable: true, amount: 100_000 },
          ],
        },
      },
    });

    const autoRejectedApp = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup2.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "AUTO_REJECTED",
        totalAmount: 900_000,
        durationDays: 20,
        firstViewedAt: tStart,
      },
    });

    // 1. 수락 지원서 컨텍스트 조회: INCLUDED ∩ isAvailable만 포함, 나머지 3종 제외 사유 분류
    const ctx = await prisma.$transaction((tx) =>
      getAcceptedApplicationContext(tx, acceptedApp.id),
    );
    expect(ctx.clientId).toBe(client.id);
    expect(ctx.supplierId).toBe(sup1.id);
    expect(ctx.proposedTotalAmount).toBe(800_000);
    expect(ctx.includedItems.length).toBe(1);
    expect(ctx.includedItems[0]?.specItemId).toBe(itemIncludedOk.id);
    expect(ctx.excludedItems.length).toBe(3);
    expect(ctx.excludedItems.map((e) => e.reason)).toEqual(["SUPPLIER_UNAVAILABLE", "NEEDS_CONFIRMATION", "SPEC_EXCLUDED"]);
    expect(ctx.excludedItems[0]?.isFirstSentenceOrigin).toBe(true);

    // 2. 양측 서명 완료 시 Project -> CONTRACTED 전환
    const contract = await prisma.$transaction(async (tx) => {
      const createdContract = await tx.contract.create({
        data: {
          applicationId: acceptedApp.id,
          status: "ACTIVE",
          specVersionNo: ctx.specVersionNo,
          specSnapshot: { included: ctx.includedItems.map((i) => i.specItemId), durationDays: ctx.durationDays },
          agreedAmount: 750_000, // 제안금액(800,000)과 다른 합의금액 허용
          clientFee: 37_500,
          supplierFee: 37_500,
          clientSignedAt: new Date(),
          supplierSignedAt: new Date(),
        },
      });
      const transitioned = await transitionProjectForContract(tx, acceptedApp.id, {
        type: "CONTRACT_SIGNED",
        actorUserId: sup1.id,
      });
      expect(transitioned.projectStatus).toBe("CONTRACTED");
      return createdContract;
    });
    expect(await prisma.supplierProfile.findUniqueOrThrow({
      where: { userId: sup1.id },
      select: { feeExemptUsedAt: true },
    })).toEqual({ feeExemptUsedAt: null });

    // 3. 계약 취소 시 Contract CANCELLED + 지원서 REJECTED + 프로젝트 RECRUITING 복귀 (AUTO_REJECTED 복구 안 함)
    const extendedDeadline = new Date("2026-11-20T00:00:00Z");
    const invalidCancellation = prisma.$transaction((tx) =>
      transitionProjectForContract(tx, acceptedApp.id, {
        type: "CONTRACT_CANCELLED",
        newDeadline: tStart,
      }),
    );
    await expect(invalidCancellation).rejects.toBeInstanceOf(AppError);
    await expect(invalidCancellation).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contract.id },
        data: { status: "CANCELLED", refundReason: "합의 결렬" },
      });
      const cancelled = await transitionProjectForContract(tx, acceptedApp.id, {
        type: "CONTRACT_CANCELLED",
        newDeadline: extendedDeadline,
        actorUserId: client.id,
      });
      expect(cancelled.projectStatus).toBe("RECRUITING");
      expect(cancelled.applicationStatus).toBe("REJECTED");
    });

    const refreshedAutoRejected = await prisma.application.findUniqueOrThrow({
      where: { id: autoRejectedApp.id },
    });
    expect(refreshedAutoRejected.status).toBe("AUTO_REJECTED");

    // 4. 복귀한 프로젝트에서 다른 공급자가 revisionNo 2로 지원·수락·새 계약 생성 가능
    const sup2NewApp = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: sup2.id,
        revisionNo: 2,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 850_000,
        durationDays: 12,
        firstViewedAt: tStart,
        items: {
          create: [{ specItemId: itemIncludedOk.id, isAvailable: true, amount: 850_000 }],
        },
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: "ACCEPTED" },
    });
    const ctx2 = await prisma.$transaction((tx) =>
      getAcceptedApplicationContext(tx, sup2NewApp.id),
    );
    expect(ctx2.supplierId).toBe(sup2.id);

    // 5. B의 트랜잭션 내부에서 예외 발생 시 Project·Application 상태 전이도 함께 롤백된다
    await expect(
      prisma.$transaction(async (tx) => {
        await transitionProjectForContract(tx, sup2NewApp.id, { type: "CONTRACT_SIGNED" });
        throw new Error("contract write failed");
      }),
    ).rejects.toThrow("contract write failed");
    const stillAcceptedProj = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(stillAcceptedProj.status).toBe("ACCEPTED");

    // 6. 프로젝트 명세 버전이 올라가 구버전이 된 지원서는 계약 컨텍스트 조회를 거부한다
    await prisma.project.update({
      where: { id: project.id },
      data: { currentVersion: 2 },
    });
    await expect(
      prisma.$transaction((tx) => getAcceptedApplicationContext(tx, sup2NewApp.id)),
    ).rejects.toThrow(/최신 명세 버전/);
  });

  it("다른 프로젝트 소속 SpecItem을 연결한 지원 항목은 계약 범위 조회에서 거부한다", async () => {
    const client = await prisma.user.create({
      data: { email: "owner@test.local", name: "의뢰인", role: "CLIENT" },
    });
    const supplier = await prisma.user.create({
      data: {
        email: "supplier@test.local",
        name: "공급자",
        role: "SUPPLIER",
        supplierProfile: { create: { displayName: "공급자" } },
      },
    });
    const targetDraft = await prisma.draft.create({
      data: { clientId: client.id, entryType: "SENTENCE", status: "CONFIRMED" },
    });
    const otherDraft = await prisma.draft.create({
      data: { clientId: client.id, entryType: "SENTENCE", status: "CONFIRMED" },
    });
    const confirmedAt = new Date("2026-10-27T00:00:00Z");
    const project = await prisma.project.create({
      data: {
        draftId: targetDraft.id,
        confirmedAt,
        disclosureConsentVersion: "v1",
        title: "대상 프로젝트",
        summary: "대상 프로젝트",
        industryCode: "RESTAURANT_RESERVATION",
        status: "ACCEPTED",
      },
    });
    const otherProject = await prisma.project.create({
      data: {
        draftId: otherDraft.id,
        confirmedAt,
        disclosureConsentVersion: "v1",
        title: "다른 프로젝트",
        summary: "다른 프로젝트",
        industryCode: "RESTAURANT_RESERVATION",
      },
    });
    const foreignItem = await prisma.specItem.create({
      data: {
        projectId: otherProject.id,
        versionNo: 1,
        title: "다른 프로젝트 항목",
        description: "소속 검증 대상",
        origin: "DEFAULT_DRAFT",
        status: "INCLUDED",
      },
    });
    const application = await prisma.application.create({
      data: {
        projectId: project.id,
        supplierId: supplier.id,
        revisionNo: 1,
        specVersionNo: 1,
        status: "ACCEPTED",
        totalAmount: 100_000,
        durationDays: 7,
        firstViewedAt: confirmedAt,
        items: {
          create: [{ specItemId: foreignItem.id, isAvailable: true, amount: 100_000 }],
        },
      },
    });

    const invalidContext = prisma.$transaction((tx) =>
      getAcceptedApplicationContext(tx, application.id),
    );
    await expect(invalidContext).rejects.toBeInstanceOf(AppError);
    await expect(invalidContext).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
  });
});
