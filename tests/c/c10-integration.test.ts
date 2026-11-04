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
import { AdminOpsService } from "../../src/modules/admin-ops/index.ts";
import { createSharedStore } from "./fixtures/shared-store.ts";

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

    const completionService = new DepositCompletionService({
      repo: depositRepo,
      contractsPort,
      marketplacePort,
      clock,
    });

    const depositService = new DepositService({
      repo: depositRepo,
      contractsPort,
      webhookSecret: "wh_secret_c10",
      tossAdapter: {
        async verifyPayment(orderId, paymentKey, amount) {
          return { verified: true, orderId, paymentKey, amount, status: "DONE" };
        },
      },
      completionPort: completionService,
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

  function createSharedContext() {
    const store = createSharedStore({
      id: "contract-e2e-10",
      projectId: "proj-10",
      applicationId: "app-10",
      clientUserId: "client-10",
      supplierUserId: "supplier-10",
      status: "ACTIVE",
      paymentStatus: "PENDING",
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      interimRatio: 50,
      durationDays: 42,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
      supplierKind: "INDIVIDUAL",
      payoutVerifiedAt: new Date("2026-11-01T00:00:00.000Z"),
    });

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
      async autoRejectCompetingApplications() {
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

    let currentTime = t0;
    const clock = {
      now: () => currentTime,
      set: (date: Date) => {
        currentTime = date;
      },
    };

    const settlementService = new SettlementService({ repo: store.settlementRepository, clock });
    const completionService = new DepositCompletionService({
      repo: store.depositRepository,
      contractsPort: store.contractsPort,
      marketplacePort,
      clock,
    });
    const depositService = new DepositService({
      repo: store.depositRepository,
      contractsPort: store.contractsPort,
      webhookSecret: "wh_secret_c10",
      tossAdapter: {
        async verifyPayment(orderId, paymentKey, amount) {
          return { verified: true, orderId, paymentKey, amount, status: "DONE" };
        },
      },
      completionPort: completionService,
      clock,
    });
    const deliveryService = new DeliveryService({
      repo: store.deliveryRepository,
      clock,
      settlementPort: settlementService,
    });
    const batchService = new InspectionBatchService({
      repo: store.deliveryRepository,
      notificationPorts,
      clock,
      settlementPort: settlementService,
    });
    const cancellationService = new CancellationService({ repo: store.cancellationRepository, clock });
    const reviewService = new ReviewService({ repo: store.reviewRepository, profilePorts, clock });
    const adminService = new AdminOpsService({
      repo: store.adminRepository,
      catalogPort: {
        async executeBlockAction(input) {
          return { success: true, blockId: input.blockId, action: input.action };
        },
      },
      depositPort: completionService,
      inspectionPort: batchService,
      cancellationPort: cancellationService,
      clock,
    });

    return {
      store,
      contract: store.contract,
      clock,
      depositService,
      completionService,
      deliveryService,
      batchService,
      settlementService,
      cancellationService,
      reviewService,
      adminService,
      notificationsSent,
      getCompetingRejected: () => competingRejected,
      getProfileReviewStatsUpdated: () => profileReviewStatsUpdated,
    };
  }

  async function completeDeposit(ctx: ReturnType<typeof createSharedContext>) {
    const { deposit } = await ctx.depositService.createDeposit(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      {
        contractId: ctx.contract.id,
        idempotencyKey: `idem-${Math.random()}`,
        method: "CARD",
        amount: 3_255_000,
      },
    );
    await ctx.depositService.handleTossWebhook(
      { serverSecret: "wh_secret_c10" },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_shared",
        amount: 3_255_000,
        status: "DONE",
      },
    );
    const installments = (await ctx.store.depositRepository.listInstallments(ctx.contract.id)) as Array<{
      id: string;
      stage: "INTERIM" | "FINAL";
    }>;
    return { deposit, installments };
  }

  function seedItems(ctx: ReturnType<typeof createSharedContext>) {
    ctx.store.seedContractItems([
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
      {
        id: "item-2",
        contractId: ctx.contract.id,
        stage: "FINAL",
        title: "최종 기능",
        description: "기능",
        conditions: [],
        approvedAt: null,
        autoApproved: false,
      },
    ]);
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

  it("C-10-T03 공유 저장소로 예치→중간승인→최종승인→완료→리뷰 연결", async () => {
    const ctx = createSharedContext();
    ctx.clock.set(t0);
    const { installments } = await completeDeposit(ctx);
    assert.equal(ctx.getCompetingRejected(), true);
    assert.equal(installments.length, 2);
    const interim = installments.find((row) => row.stage === "INTERIM")!;
    const final = installments.find((row) => row.stage === "FINAL")!;
    seedItems(ctx);

    // 중간 납품 → 항목 승인 → 정산 승인·지급 (구간·항목은 예치 때 생성된 같은 행을 재사용)
    ctx.clock.set(t1);
    const d1 = await ctx.deliveryService.submitDelivery(
      { userId: ctx.contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: interim.id,
        items: [{ contractItemId: "item-1", links: ["https://app/interim"], files: [], howToCheck: "확인" }],
        summary: "중간 납품",
      },
    );
    await ctx.deliveryService.approveItem(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractItemId: "item-1", deliveryId: d1.id },
    );
    const approvedInterim = (await ctx.store.settlementRepository.listInstallments(ctx.contract.id)).find(
      (row) => row.stage === "INTERIM",
    );
    assert.equal(approvedInterim?.status, "APPROVED");
    const r1 = await ctx.settlementService.releaseInstallment({ installmentId: interim.id });
    assert.equal(r1.status, "RELEASED");
    assert.equal(r1.releaseAmount, 1_421_350);

    // 최종 납품 → 승인 → 지급 → 계약 완료
    ctx.clock.set(t4);
    const d2 = await ctx.deliveryService.submitDelivery(
      { userId: ctx.contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: final.id,
        items: [{ contractItemId: "item-2", links: ["https://app/final"], files: [], howToCheck: "확인" }],
        summary: "최종 납품",
      },
    );
    await ctx.deliveryService.approveItem(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractItemId: "item-2", deliveryId: d2.id },
    );
    const r2 = await ctx.settlementService.releaseInstallment({ installmentId: final.id });
    assert.equal(r2.status, "RELEASED");

    const finished = await ctx.store.getContract(ctx.contract.id);
    assert.equal(finished?.status, "COMPLETED");
    assert.equal(finished?.paymentStatus, "RELEASED");

    // 완료된 같은 계약으로 리뷰 작성 (재시드 없음)
    ctx.clock.set(t5);
    const review = await ctx.reviewService.createReview(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, rating: 5, comment: "만족스러운 프로젝트였습니다.", tags: ["신속해요"] },
    );
    assert.equal(review.rating, 5);
    assert.equal(ctx.getProfileReviewStatsUpdated(), true);
  });

  it("C-10-T04 취소 요청 중 승인·지급·자동승인·알림 실제 차단", async () => {
    const ctx = createSharedContext();
    ctx.clock.set(t0);
    const { installments } = await completeDeposit(ctx);
    const interim = installments.find((row) => row.stage === "INTERIM")!;
    seedItems(ctx);

    ctx.clock.set(t1);
    const delivery = await ctx.deliveryService.submitDelivery(
      { userId: ctx.contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: interim.id,
        items: [{ contractItemId: "item-1", links: ["https://app/interim"], files: [], howToCheck: "확인" }],
      },
    );

    await ctx.cancellationService.requestCancellation(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, cause: "CLIENT", note: "개인 사정" },
    );
    assert.equal(await ctx.cancellationService.isOperationsPaused(ctx.contract.id), true);

    const client = { userId: ctx.contract.clientUserId, role: "CLIENT" };
    const admin = { userId: "admin-1", role: "ADMIN" };

    await assert.rejects(
      () => ctx.deliveryService.approveItem(client, { contractItemId: "item-1", deliveryId: delivery.id }),
      /진행 중\(ACTIVE\) 계약만/,
    );
    await assert.rejects(
      () =>
        ctx.deliveryService.requestRework(client, {
          deliveryId: delivery.id,
          contractItemId: "item-1",
          reason: "NOT_WORKING",
          note: "미작동",
        }),
      /진행 중\(ACTIVE\) 계약만/,
    );
    await assert.rejects(
      () => ctx.settlementService.approveInstallment({ contractId: ctx.contract.id, installmentId: interim.id }),
      /취소 중에는/,
    );
    await assert.rejects(
      () => ctx.settlementService.releaseInstallment({ installmentId: interim.id }),
      /취소 중에는/,
    );

    const batch = await ctx.batchService.processAutoApproval(
      delivery.id,
      new Date(t1.getTime() + 8 * 24 * 60 * 60 * 1000),
    );
    assert.equal(batch.autoApprovedCount, 0);
    await ctx.batchService.sendDueNotifications(ctx.contract.id, t1);
    assert.equal(ctx.notificationsSent.filter((n) => n.type === "INSPECTION_DUE").length, 0);

    assert.equal((await ctx.store.deliveryRepository.getContractItem("item-1"))?.approvedAt, null);
    const unchanged = (await ctx.store.settlementRepository.listInstallments(ctx.contract.id)).find(
      (row) => row.stage === "INTERIM",
    );
    assert.equal(unchanged?.status, "DELIVERED");
    assert.equal((await ctx.store.deliveryRepository.getDelivery(delivery.id))?.status, "SUBMITTED");

    // 이의 → 관리자 판정도 같은 공유 계약/구간을 사용한다.
    await ctx.cancellationService.objectCancellation(
      { userId: ctx.contract.supplierUserId, role: "SUPPLIER" },
      { contractId: ctx.contract.id, objectionRate: 50, note: "보상 비율 이의" },
    );
    ctx.store.adminRepository.seedCancellationQueueContract({
      id: ctx.contract.id,
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      totalDeposited: 3_255_000,
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      cancelEscalatedAt: t1,
    });
    const decided = await ctx.adminService.decideCancellation(admin, ctx.contract.id, {
      compensationRate: 50,
      reason: "착수 보상 판정",
    });
    assert.equal(decided.status, "CANCELLED");
    const cancelled = await ctx.store.getContract(ctx.contract.id);
    assert.equal(cancelled?.status, "CANCELLED");
    assert.equal(cancelled?.settledAmount, 1_472_500);
    assert.equal(
      (await ctx.store.adminRepository.listEventLogs()).filter(
        (log) => log.actionType === "CANCELLATION_ADMIN_DECIDED",
      ).length,
      1,
    );
  });

  it("C-10-F01 기한 대상 조회·재시도·중복 방지", async () => {
    let depositAttempts = 0;
    let secondRun = false;
    const notified: string[] = [];
    const context = {
      targets: {
        async depositContractIds() {
          return ["contract-dep"];
        },
        async cancellationContractIds() {
          return ["contract-cancel"];
        },
        async deliveryIds() {
          return ["delivery-1"];
        },
        async notificationContractIds() {
          return ["contract-noti"];
        },
      },
      completionService: {
        async expireDepositIfDue() {
          depositAttempts += 1;
          if (depositAttempts === 1) throw new Error("TRANSIENT_DB");
          return { expired: !secondRun };
        },
      },
      cancellationService: {
        async checkCancellationDeadlines() {
          return { escalatedToAdmin: !secondRun };
        },
      },
      batchService: {
        async processAutoApproval() {
          return { autoApprovedCount: secondRun ? 0 : 1 };
        },
        async sendDueNotifications(contractId: string) {
          notified.push(contractId);
        },
      },
      retries: 1,
    };

    const first = await runDueJobs(context, t0);
    assert.equal(first.success, true);
    assert.equal(depositAttempts, 2); // 일시 실패 후 1회 재시도
    assert.equal(first.actionsCount, 3);
    assert.deepEqual(notified, ["contract-noti"]);

    secondRun = true;
    const second = await runDueJobs(context, t0);
    assert.equal(second.success, true);
    assert.equal(second.actionsCount, 0); // 재실행 멱등
  });

  it("C-10-F01b 일부 작업이 계속 실패해도 나머지는 처리하고 실패를 드러냄", async () => {
    const result = await runDueJobs(
      {
        depositContractIds: ["c-fail", "c-ok"],
        completionService: {
          async expireDepositIfDue(contractId) {
            if (contractId === "c-fail") throw new Error("PERSISTENT");
            return { expired: true };
          },
        },
        retries: 1,
      },
      t0,
    );
    assert.equal(result.success, false);
    assert.equal(result.actionsCount, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].job, "DEPOSIT_DEADLINE");
    assert.equal(result.failures[0].targetId, "c-fail");
    assert.equal(result.failures[0].attempts, 2);
    assert.match(result.failures[0].error, /PERSISTENT/);
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
