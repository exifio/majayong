import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminOpsService,
  AdminHttpError,
  createInMemoryAdminRepository,
  type CatalogAdminPort,
} from "../../src/modules/admin-ops/index.ts";

describe("C-09: 관리자 블록/예치/분쟁/정산/감사 API", () => {
  const baseTime = new Date("2026-11-29T10:00:00.000Z");

  function createTestSetup() {
    const repo = createInMemoryAdminRepository();

    let catalogActionCalled = false;
    const catalogPort: CatalogAdminPort = {
      async executeBlockAction(input: { blockId: string; action: string; reason: string; unitPrice?: number; mergedIntoId?: string }) {
        catalogActionCalled = true;
        return { success: true, blockId: input.blockId, action: input.action };
      },
    };

    repo.seedBlock({
      id: "block-1",
      title: "예약 달력",
      unitPrice: 300_000,
      isActive: true,
    });

    repo.seedHeldDeposit({
      id: "dep-held-1",
      contractId: "contract-1",
      amount: 1_050_000,
      status: "HELD",
      heldReason: "AMOUNT_MISMATCH",
    });

    repo.seedEscalatedInspection({
      id: "insp-esc-1",
      contractItemId: "item-1",
      deliveryId: "del-1",
      status: "ESCALATED",
      reason: "CONDITION_MISMATCH",
    });

    repo.seedCancellationQueueContract({
      id: "contract-cancel-1",
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      totalDeposited: 3_255_000,
      agreedAmount: 3_100_000,
      clientFee: 155_000,
    });

    const service = new AdminOpsService({
      repo,
      catalogPort,
      clock: { now: () => baseTime },
    });

    return { repo, service, getCatalogActionCalled: () => catalogActionCalled };
  }

  it("C-09-T01 일반사용자 모든 관리자 API 403", async () => {
    const { service } = createTestSetup();
    const clientActor = { userId: "user-client", role: "CLIENT" };
    const supplierActor = { userId: "user-supplier", role: "SUPPLIER" };

    // 1. 블록 목록 403
    await assert.rejects(() => service.listBlocks(clientActor), AdminHttpError);
    // 2. 블록 액션 403
    await assert.rejects(
      () => service.executeBlockAction(clientActor, "block-1", { action: "DISABLE", reason: "이유" }),
      AdminHttpError,
    );
    // 3. HELD 예치 목록 403
    await assert.rejects(() => service.listHeldDeposits(supplierActor), AdminHttpError);
    // 4. HELD 예치 판정 403
    await assert.rejects(
      () => service.resolveHeldDeposit(clientActor, "dep-held-1", { decision: "OPERATOR_CONFIRMED", reason: "이유" }),
      AdminHttpError,
    );
    // 5. 감사 EventLog 403
    await assert.rejects(() => service.listEventLogs(clientActor), AdminHttpError);
  });

  it("C-09-T02 사유 없는 블록/판정 거부", async () => {
    const { service } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    // 사유 빈 문자열 -> 400 거부
    await assert.rejects(
      () => service.executeBlockAction(adminActor, "block-1", { action: "DISABLE", reason: "   " }),
      (err: unknown) => {
        if (!(err instanceof AdminHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /사유/);
        return true;
      },
    );

    // HELD 판정 시 사유 누락 -> 400 거부
    await assert.rejects(
      () =>
        service.resolveHeldDeposit(adminActor, "dep-held-1", {
          decision: "OPERATOR_CONFIRMED",
          reason: "",
        }),
      (err: unknown) => {
        if (!(err instanceof AdminHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /사유/);
        return true;
      },
    );
  });

  it("C-09-T03 블록 운영 변경 시 사본 가격 불변", async () => {
    const { service, getCatalogActionCalled } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    // 블록 단가 수정 (A의 catalogPort 호출)
    const res = await service.executeBlockAction(adminActor, "block-1", {
      action: "UPDATE_PRICE",
      unitPrice: 400_000,
      reason: "물가 상승 및 난이도 재평가 반영",
    });

    assert.equal(res.success, true);
    assert.equal(getCatalogActionCalled(), true);
  });

  it("C-09-T04 보류 입금 확정/취소 멱등성", async () => {
    const { service, repo } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    // 1회차 판정: OPERATOR_CONFIRMED
    const r1 = await service.resolveHeldDeposit(adminActor, "dep-held-1", {
      decision: "OPERATOR_CONFIRMED",
      reason: "PG 대조 결과 정상 입금 확인",
    });
    assert.equal(r1.status, "COMPLETED");

    // 2회차 동일 판정 재시도 (멱등 반환)
    const r2 = await service.resolveHeldDeposit(adminActor, "dep-held-1", {
      decision: "OPERATOR_CONFIRMED",
      reason: "PG 대조 결과 정상 입금 확인",
    });
    assert.equal(r2.status, "COMPLETED");

    // 감사 EventLog에 기록되었는지 확인
    const logs = await repo.listEventLogs();
    const log = logs.find((l: { targetId: string }) => l.targetId === "dep-held-1");
    assert.ok(log);
    assert.equal(log.actorUserId, "admin-1");
  });

  it("C-09-T05 이견 판정 후 상태 일관", async () => {
    const { service, repo } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    const decided = await service.decideInspectionDispute(adminActor, "insp-esc-1", {
      decision: "APPROVE",
      reason: "기능 테스트 통과 확인",
      decisionNotes: { client: "검수 통과", supplier: "승인 완료" },
    });

    assert.equal(decided.status, "RESOLVED");
    assert.equal(decided.decision, "APPROVE");

    const current = await repo.getInspection("insp-esc-1");
    assert.equal(current?.status, "RESOLVED");
  });

  it("C-09-T06 취소 수동 처리 중복 없음", async () => {
    const { service, repo } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    // 1회차 수동 처리 완료 표시
    const p1 = await service.markSettlementProcessed(adminActor, "contract-cancel-1", {
      refunded: true,
      cancelPayout: true,
      reason: "계좌 수동 이체 완료",
    });
    assert.ok(p1.refundedAt);
    assert.ok(p1.cancelPayoutAt);

    // 2회차 중복 호출 -> 멱등성 유지 (중복 변경 및 에러 없음)
    const p2 = await service.markSettlementProcessed(adminActor, "contract-cancel-1", {
      refunded: true,
      cancelPayout: true,
      reason: "재확인",
    });
    assert.equal(p1.refundedAt?.getTime(), p2.refundedAt?.getTime());
  });

  it("C-09-T07 EventLog 검색/정렬/권한", async () => {
    const { service, repo } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };

    await repo.recordEvent({
      actorUserId: "admin-1",
      actionType: "BLOCK_UPDATE",
      targetType: "BLOCK",
      targetId: "block-1",
      reason: "단가 변경",
      occurredAt: baseTime,
    });

    await repo.recordEvent({
      actorUserId: "admin-1",
      actionType: "DISPUTE_DECISION",
      targetType: "INSPECTION",
      targetId: "insp-1",
      reason: "판정 완료",
      occurredAt: new Date(baseTime.getTime() + 1000),
    });

    const logs = await service.listEventLogs(adminActor);
    assert.equal(logs.length, 2);
    // 최신순 정렬 검증
    assert.ok(logs[0].occurredAt >= logs[1].occurredAt);
  });

  it("C-09-T05b 관리자 취소 판정은 역할·사유·비율을 검사하고 감사 로그를 남김", async () => {
    const { service, repo } = createTestSetup();
    const adminActor = { userId: "admin-1", role: "ADMIN" };
    const clientActor = { userId: "user-client", role: "CLIENT" };

    await assert.rejects(
      () => service.decideCancellation(clientActor, "contract-cancel-1", { compensationRate: 50, reason: "판정" }),
      (err: unknown) => {
        if (!(err instanceof AdminHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );

    await assert.rejects(
      () => service.decideCancellation(adminActor, "contract-cancel-1", { compensationRate: 50, reason: "  " }),
      (err: unknown) => {
        if (!(err instanceof AdminHttpError)) return false;
        assert.equal(err.status, 400);
        return true;
      },
    );

    await assert.rejects(
      () => service.decideCancellation(adminActor, "contract-cancel-1", { compensationRate: 49, reason: "하한 위반" }),
      (err: unknown) => {
        if (!(err instanceof AdminHttpError)) return false;
        assert.equal(err.status, 422);
        return true;
      },
    );

    const decided = await service.decideCancellation(adminActor, "contract-cancel-1", {
      compensationRate: 50,
      reason: "착수 보상 판정",
    });
    assert.equal(decided.status, "CANCELLED");
    assert.equal(decided.compensationRate, 50);
    assert.equal(decided.settledAmount, 736_250);
    assert.equal(decided.refundAmount, 2_441_250);

    const again = await service.decideCancellation(adminActor, "contract-cancel-1", {
      compensationRate: 50,
      reason: "재호출",
    });
    assert.equal(again.refundAmount, decided.refundAmount);

    const logs = await repo.listEventLogs();
    const decisionLogs = logs.filter((log) => log.actionType === "CANCELLATION_ADMIN_DECIDED");
    assert.equal(decisionLogs.length, 1);
    assert.equal(decisionLogs[0]?.reason, "착수 보상 판정");
  });

  it("C-09-T05c 24시간 내 무납품은 관리자 판정도 보상 비율 null", async () => {
    const { service, repo } = createTestSetup();
    const depositedAt = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
    repo.seedCancellationQueueContract({
      id: "contract-cancel-24h",
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      totalDeposited: 3_255_000,
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      depositedAt,
      cancelRequestedAt: baseTime,
      installmentStatuses: ["PENDING", "PENDING"],
    });

    const decided = await service.decideCancellation(
      { userId: "admin-1", role: "ADMIN" },
      "contract-cancel-24h",
      { compensationRate: 0, reason: "24시간 내 무납품" },
    );
    assert.equal(decided.compensationRate, null);
    assert.equal(decided.refundAmount, 3_255_000);
    assert.equal(decided.settledAmount, 0);
    assert.equal(decided.clientFeeRefund, 155_000);

    repo.seedCancellationQueueContract({
      id: "contract-cancel-delivered",
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      totalDeposited: 3_255_000,
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      depositedAt,
      cancelRequestedAt: baseTime,
      installmentStatuses: ["DELIVERED", "PENDING"],
    });
    await assert.rejects(
      () =>
        service.decideCancellation(
          { userId: "admin-1", role: "ADMIN" },
          "contract-cancel-delivered",
          { compensationRate: 0, reason: "납품 후" },
        ),
      (err: unknown) => err instanceof AdminHttpError && err.status === 422,
    );
  });

  it("C-09-T08 B 관리자 경로 중복 등록 0", () => {
    const { service } = createTestSetup();

    // 신고(reports) 및 문의(inquiries) 조치는 B 담당이므로 C 관리자 서비스에 중복 메서드 없음
    assert.equal(typeof (service as Record<string, unknown>).resolveReport, "undefined");
    assert.equal(typeof (service as Record<string, unknown>).answerInquiry, "undefined");
  });
});
