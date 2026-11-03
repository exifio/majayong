import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DepositService,
  DepositCompletionService,
  createInMemoryDepositRepository,
  runDueJobs,
} from "../../src/modules/deposit/index.ts";
import {
  DeliveryService,
  InspectionBatchService,
  createInMemoryDeliveryRepository,
} from "../../src/modules/delivery/index.ts";
import {
  SettlementService,
  createInMemorySettlementRepository,
} from "../../src/modules/settlement/policy.ts";
import {
  CancellationService,
  createInMemoryCancellationRepository,
} from "../../src/modules/cancellation/index.ts";
import {
  ReviewService,
  createInMemoryReviewRepository,
} from "../../src/modules/review/index.ts";

describe("C-10: 배포용 기한 작업·전영역 연결 검증·인계", () => {
  const t0 = new Date("2026-11-04T05:20:00.000Z"); // 14:20 KST 체결 & 예치
  const t1 = new Date("2026-11-25T10:00:00.000Z"); // 중간 납품
  const t2 = new Date("2026-12-02T10:00:00.000Z"); // 7일 후 중간 자동 승인
  const t3 = new Date("2026-12-10T10:00:00.000Z"); // 최종 납품
  const t4 = new Date("2026-12-17T10:00:00.000Z"); // 최종 승인 & 완료
  const t5 = new Date("2026-12-18T10:00:00.000Z"); // 리뷰 작성

  function createFullContext() {
    const depositRepo = createInMemoryDepositRepository();
    const deliveryRepo = createInMemoryDeliveryRepository();
    const settlementRepo = createInMemorySettlementRepository();
    const cancelRepo = createInMemoryCancellationRepository();
    const reviewRepo = createInMemoryReviewRepository();

    const notificationsSent: Array<{ userId: string; type: string; targetId: string }> = [];
    const notificationPorts = {
      async createOnce(input: { userId: string; type: string; targetId: string }) {
        const key = `${input.userId}:${input.type}:${input.targetId}`;
        if (!notificationsSent.some((n) => `${n.userId}:${n.type}:${n.targetId}` === key)) {
          notificationsSent.push(input);
          return { created: true };
        }
        return { created: false };
      },
    };

    let competingRejected = false;
    const marketplacePort = {
      async autoRejectCompetingApplications(input: { projectId: string; acceptedApplicationId: string }) {
        competingRejected = true;
        return { rejectedCount: 2 };
      },
    };

    let profileReviewStatsUpdated = false;
    const profilePorts = {
      async updateProfileReviewStats() {
        profileReviewStatsUpdated = true;
        return { success: true };
      },
    };

    const contract = {
      id: "contract-e2e-10",
      projectId: "proj-10",
      applicationId: "app-10",
      clientUserId: "client-10",
      supplierUserId: "supplier-10",
      status: "ACTIVE" as const,
      paymentStatus: "PENDING" as const,
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      totalDeposited: 0,
      interimRatio: 50,
      durationDays: 42,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
      workDueAt: null as Date | null,
      supplierKind: "INDIVIDUAL" as const,
      payoutVerifiedAt: new Date("2026-11-01T00:00:00.000Z"),
    };

    const contractsPort = {
      async getContract(id: string) {
        if (id === contract.id) return contract;
        return null;
      },
      async updateContract(id: string, patch: Partial<typeof contract>) {
        Object.assign(contract, patch);
        return contract;
      },
    };

    let currentTime = t0;
    const clock = { now: () => currentTime, set: (d: Date) => { currentTime = d; } };

    const depositService = new DepositService({
      repo: depositRepo,
      contractsPort,
      webhookSecret: "wh_secret_c10",
      clock,
    });

    const completionService = new DepositCompletionService({
      repo: depositRepo,
      contractsPort,
      marketplacePort,
      clock,
    });

    const deliveryService = new DeliveryService({
      repo: deliveryRepo,
      clock,
    });

    const batchService = new InspectionBatchService({
      repo: deliveryRepo,
      notificationPorts,
      clock,
    });

    const settlementService = new SettlementService({
      repo: settlementRepo,
      clock,
    });

    const cancellationService = new CancellationService({
      repo: cancelRepo,
      clock,
    });

    const reviewService = new ReviewService({
      repo: reviewRepo,
      profilePorts,
      clock,
    });

    return {
      depositRepo,
      deliveryRepo,
      settlementRepo,
      cancelRepo,
      reviewRepo,
      contract,
      clock,
      depositService,
      completionService,
      deliveryService,
      batchService,
      settlementService,
      cancellationService,
      reviewService,
      notificationsSent,
      getCompetingRejected: () => competingRejected,
      getProfileReviewStatsUpdated: () => profileReviewStatsUpdated,
    };
  }

  it("C-10-T01 배치 두 번 실행해도 결과 동일", async () => {
    const ctx = createFullContext();
    const runTime = new Date("2026-11-15T00:00:00.000Z");
    const requestedAt = new Date("2026-11-10T00:00:00.000Z");

    ctx.cancelRepo.seedContract({
      id: ctx.contract.id,
      clientUserId: ctx.contract.clientUserId,
      supplierUserId: ctx.contract.supplierUserId,
      status: "CANCEL_REQUESTED",
      paymentStatus: "DEPOSITED",
      agreedAmount: ctx.contract.agreedAmount,
      clientFee: ctx.contract.clientFee,
      totalDeposited: 3_255_000,
      interimRatio: 50,
      depositedAt: t0,
      cancelCause: "CLIENT",
      cancelRequestedBy: ctx.contract.clientUserId,
      cancelRequestedAt: requestedAt,
      cancelNote: "무응답",
      objectionNote: null,
      objectionRate: null,
      cancelEvidence: null,
      cancelEscalatedAt: null,
      compensationRate: null,
      cancelResolution: null,
      cancelResolvedAt: null,
      refundAmount: null,
      clientFeeRefund: null,
      settledAmount: null,
      refundReason: null,
      refundedAt: null,
      cancelPayoutAt: null,
    });

    const job = {
      completionService: ctx.completionService,
      cancellationService: ctx.cancellationService,
      batchService: ctx.batchService,
      depositContractIds: [ctx.contract.id],
      cancellationContractIds: [ctx.contract.id],
    };

    const res1 = await runDueJobs(job, runTime);
    const res2 = await runDueJobs(job, runTime);

    assert.equal(res1.success, true);
    assert.equal(res1.actionsCount, 2);
    assert.equal(res2.success, true);
    assert.equal(res2.actionsCount, 0);
    assert.equal(ctx.contract.status, "CANCELLED");
    const cancel = await ctx.cancelRepo.getContract(ctx.contract.id);
    assert.equal(cancel?.cancelEscalatedAt?.toISOString(), runTime.toISOString());
  });

  it("C-10-T02 수동 처리와 자동 배치 동시 충돌", async () => {
    const ctx = createFullContext();

    // 예치 생성
    const { deposit } = await ctx.depositService.createDeposit(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, idempotencyKey: "idem-t02", method: "CARD", amount: 3_255_000 },
    );

    // 기한 경과 시점에 배치와 수동 처리가 동시 경합
    const expireTime = new Date("2026-11-08T00:00:00.000Z");

    const batchPromise = ctx.completionService.evaluateDepositDeadline(ctx.contract.id, expireTime);
    const completePromise = ctx.completionService.completeDeposit({ depositId: deposit.id, pgKey: "pk-race-c10" });

    const [batchRes, completeRes] = await Promise.all([batchPromise, completePromise]);
    assert.equal(batchRes.action, "HOLD_FOR_OPERATOR_REVIEW"); // 배치는 입금 시도 보고 결렬 보류
    assert.equal(completeRes.deposit.status, "COMPLETED"); // 예치는 안전하게 정상 확정
  });

  it("C-10-T03 전체 임시 계약→예치→중간 승인→최종 승인→리뷰 연계 포트", async () => {
    const ctx = createFullContext();

    // 1. 의뢰인 예치 생성 (합의금 3,100,000 + 5% 수수료 155,000 = 3,255,000원)
    ctx.clock.set(t0);
    const { deposit } = await ctx.depositService.createDeposit(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, idempotencyKey: "idem-e2e-happy", method: "CARD", amount: 3_255_000 },
    );

    // 2. PG 결제 검증 및 완료 트랜잭션 (타 지원 자동 거절 포트 연동)
    await ctx.depositService.handleTossWebhook(
      { serverSecret: "wh_secret_c10" },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_e2e_happy",
        amount: 3_255_000,
        status: "DONE",
      },
    );

    const completion = await ctx.completionService.completeDeposit({
      depositId: deposit.id,
      pgKey: "toss_pk_e2e_happy",
    });
    assert.equal(completion.deposit.status, "COMPLETED");
    assert.equal(completion.contract.paymentStatus, "DEPOSITED");
    assert.equal(ctx.getCompetingRejected(), true); // 타 지원 자동 거절됨

    // 3. 중간 구간 납품 및 승인
    ctx.clock.set(t1);
    ctx.deliveryRepo.seedContract(ctx.contract);
    ctx.deliveryRepo.seedInstallment({ id: "inst-interim", contractId: ctx.contract.id, stage: "INTERIM", status: "DELIVERED" });
    const interimDelivery = await ctx.deliveryRepo.createDelivery({
      installmentId: "inst-interim",
      attemptNo: 1,
      items: [{ contractItemId: "item-1", links: ["https://app/interim"], files: [], howToCheck: "확인" }],
      summary: "중간 납품 완료",
      status: "SUBMITTED",
      submittedAt: t1,
      inspectionDueAt: t2,
      reviewedAt: null,
    });

    // 중간 납품 항목 직접 승인
    ctx.deliveryRepo.seedContractItems([
      {
        id: "item-1",
        contractId: ctx.contract.id,
        stage: "INTERIM",
        title: "중간 기능",
        description: "기능",
        conditions: [],
        approvedAt: null,
        autoApproved: false,
      },
    ]);
    await ctx.deliveryService.approveItem(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractItemId: "item-1", deliveryId: interimDelivery.id },
    );

    // 4. 중간 구간 지급 승인 및 방출 (개인 공급자 3.3% 내림 적용)
    ctx.settlementRepo.seedContract({
      ...ctx.contract,
      status: "ACTIVE",
      paymentStatus: "DEPOSITED",
      totalDeposited: 3_255_000,
    });
    ctx.settlementRepo.seedInstallments([
      {
        id: "inst-interim",
        contractId: ctx.contract.id,
        stage: "INTERIM",
        ratio: 50,
        amount: 1_550_000,
        supplierFee: 77_500,
        withholdingTax: 51_150,
        releaseAmount: 1_421_350,
        status: "PENDING",
        approvedAt: null,
        releasedAt: null,
        taxInvoiceIssuedAt: null,
      },
      {
        id: "inst-final",
        contractId: ctx.contract.id,
        stage: "FINAL",
        ratio: 50,
        amount: 1_550_000,
        supplierFee: 77_500,
        withholdingTax: 51_150,
        releaseAmount: 1_421_350,
        status: "PENDING",
        approvedAt: null,
        releasedAt: null,
        taxInvoiceIssuedAt: null,
      },
    ]);
    ctx.settlementRepo.seedContractItems([
      { id: "item-1", contractId: ctx.contract.id, stage: "INTERIM", title: "중간", approvedAt: t1 },
      { id: "item-2", contractId: ctx.contract.id, stage: "FINAL", title: "최종", approvedAt: null },
    ]);

    await ctx.settlementService.approveInstallment({
      contractId: ctx.contract.id,
      installmentId: "inst-interim",
    });
    const r1 = await ctx.settlementService.releaseInstallment({ installmentId: "inst-interim" });
    assert.equal(r1.status, "RELEASED");
    assert.equal(r1.releaseAmount, 1_421_350);

    // 5. 최종 구간 승인 및 방출 -> 계약 COMPLETED 전이
    ctx.clock.set(t4);
    await ctx.settlementRepo.updateContractItem("item-2", { approvedAt: t4 });
    await ctx.settlementService.approveInstallment({
      contractId: ctx.contract.id,
      installmentId: "inst-final",
    });
    const r2 = await ctx.settlementService.releaseInstallment({ installmentId: "inst-final" });
    assert.equal(r2.status, "RELEASED");

    const finishedContract = await ctx.settlementRepo.getContract(ctx.contract.id);
    assert.equal(finishedContract?.status, "COMPLETED");

    // 6. 상호 리뷰 작성 (A 평점 포트 연동)
    ctx.clock.set(t5);
    ctx.reviewRepo.seedContract({
      id: ctx.contract.id,
      clientUserId: ctx.contract.clientUserId,
      supplierUserId: ctx.contract.supplierUserId,
      status: "COMPLETED",
    });

    const review = await ctx.reviewService.createReview(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, rating: 5, comment: "만족스러운 프로젝트였습니다.", tags: ["신속해요"] },
    );
    assert.equal(review.rating, 5);
    assert.equal(ctx.getProfileReviewStatsUpdated(), true); // 평점 캐시 갱신 포트 호출됨
  });

  it("C-10-T04 취소 흐름 분리", async () => {
    const ctx = createFullContext();

    ctx.cancelRepo.seedContract({
      id: ctx.contract.id,
      clientUserId: ctx.contract.clientUserId,
      supplierUserId: ctx.contract.supplierUserId,
      status: "CANCEL_REQUESTED",
      paymentStatus: "DEPOSITED",
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      totalDeposited: 3_255_000,
      interimRatio: 50,
      depositedAt: t0,
      cancelCause: "CLIENT",
      cancelRequestedBy: ctx.contract.clientUserId,
      cancelRequestedAt: t1,
      cancelNote: "취소",
      objectionNote: null,
      objectionRate: null,
      cancelEvidence: null,
      cancelEscalatedAt: null,
      compensationRate: null,
      cancelResolution: null,
      cancelResolvedAt: null,
      refundAmount: null,
      clientFeeRefund: null,
      settledAmount: null,
      refundReason: null,
      refundedAt: null,
      cancelPayoutAt: null,
    });

    // 취소 요청 중에는 일반 납품/검수 승인이 차단됨
    assert.equal(await ctx.cancellationService.isOperationsPaused(ctx.contract.id), true);

    // 판정 후 CANCELLED 상태 분리
    const decided = await ctx.cancellationService.decideCancellation({
      contractId: ctx.contract.id,
      compensationRate: 50,
      reason: "착수 보상 판정",
    });
    assert.equal(decided.status, "CANCELLED");
    assert.equal(decided.settledAmount, 736_250);
  });

  it("C-10-T05 비밀정보 로깅 0", async () => {
    const ctx = createFullContext();

    const { deposit } = await ctx.depositService.createDeposit(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, idempotencyKey: "idem-secret-check", method: "CARD", amount: 3_255_000 },
    );

    await ctx.depositService.handleTossWebhook(
      { serverSecret: "wh_secret_c10" },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_secret_check",
        amount: 3_255_000,
        status: "DONE",
      },
    );

    const events = await ctx.depositRepo.listPaymentEvents(deposit.id);
    for (const event of events) {
      const serialized = JSON.stringify(event);
      // 로그에 비밀키, 계좌번호 등 민감정보 비노출 검증
      assert.equal(serialized.includes("wh_secret_c10"), false);
      assert.equal(serialized.includes("password"), false);
    }
  });
});
