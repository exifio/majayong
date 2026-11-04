import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DepositCompletionService,
  DepositHttpError,
  DepositService,
  createInMemoryDepositRepository,
  type DepositContractInfo,
  type DepositCompletionPort,
  type TossWebhookPayload,
} from "./index.ts";

describe("C-01: Toss sandbox 예치·PG 검증·중복 방지", () => {
  const WEBHOOK_SECRET = "test_toss_webhook_secret_key_12345";
  const now = new Date("2026-11-04T05:20:00.000Z");
const unusedCompletionPort: DepositCompletionPort = {
  async completeDeposit() {
    throw new Error("Unexpected deposit completion");
  },
};

  function createTestContext() {
    const repo = createInMemoryDepositRepository();
const contract: DepositContractInfo = {
      id: "contract-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE" as const,
      paymentStatus: "PENDING" as const,
      agreedAmount: 1_000_000,
      clientFee: 50_000,
interimRatio: 50,
durationDays: 42,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
totalDeposited: 0,
workDueAt: null,
    };

 const contractsPort = {
 async getContract(id: string) {
 if (id === contract.id) return contract;
 return null;
 },
 async updateContract(id: string, patch: Partial<DepositContractInfo>) {
 if (id !== contract.id) throw new Error("Contract not found");
 Object.assign(contract, patch);
 return contract;
 },
 };

 const completionPort = new DepositCompletionService({
 repo,
 contractsPort,
 marketplacePort: { async autoRejectCompetingApplications() { return { rejectedCount: 0 }; } },
 clock: { now: () => now },
 });

    const service = new DepositService({
      repo,
      contractsPort,
      webhookSecret: WEBHOOK_SECRET,
 tossAdapter: {
 async verifyPayment(orderId, paymentKey, amount) {
 return { verified: true, orderId, paymentKey, amount, status: "DONE" };
 },
 },
 completionPort,
      clock: { now: () => now },
    });

    return { repo, contract, service };
  }

  it("C-01-T01 비당사자 결제 403/404", async () => {
    const { service } = createTestContext();

    // 존재하지 않는 계약 -> 404
    await assert.rejects(
      () =>
        service.createDeposit(
          { userId: "client-1", role: "CLIENT" },
          {
            contractId: "missing-contract",
            idempotencyKey: "idem-1",
            method: "CARD",
            amount: 1_050_000,
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 404);
        return true;
      },
    );

    // 계약 당사자가 아닌 다른 의뢰인 -> 403
    await assert.rejects(
      () =>
        service.createDeposit(
          { userId: "other-user", role: "CLIENT" },
          {
            contractId: "contract-1",
            idempotencyKey: "idem-2",
            method: "CARD",
            amount: 1_050_000,
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );

    // 공급자가 예치 시도 -> 403 (의뢰인만 결제 가능)
    await assert.rejects(
      () =>
        service.createDeposit(
          { userId: "supplier-1", role: "SUPPLIER" },
          {
            contractId: "contract-1",
            idempotencyKey: "idem-3",
            method: "CARD",
            amount: 1_050_000,
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );
  });

  it("C-01-T02 금액·orderId 불일치 거부", async () => {
    const { service, contract } = createTestContext();

    // 1. 요청 금액 불일치 (1,050,000원이어야 하는데 1,000,000원 입력)
    await assert.rejects(
      () =>
        service.createDeposit(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            contractId: contract.id,
            idempotencyKey: "idem-mismatch",
            method: "CARD",
            amount: 1_000_000,
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /금액/);
        return true;
      },
    );

    // 정상 예치 생성 후 웹훅에서 orderId 불일치 테스트
    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      {
        contractId: contract.id,
        idempotencyKey: "idem-valid",
        method: "CARD",
        amount: 1_050_000,
      },
    );

    // 웹훅: 없는 orderId
    await assert.rejects(
      () =>
        service.handleTossWebhook(
          { serverSecret: WEBHOOK_SECRET },
          {
            orderId: "invalid-order-id",
            paymentKey: "toss_pk_123",
            amount: 1_050_000,
            status: "DONE",
            eventType: "PAYMENT_STATUS_CHANGED",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 404);
        return true;
      },
    );

    // 웹훅: 금액 불일치 (1,050,000원인데 500,000원 콜백) -> HELD 격리 및 AMOUNT_MISMATCH 이벤트
    const heldResult = await service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_mismatch",
        amount: 500_000,
        status: "DONE",
        eventType: "PAYMENT_STATUS_CHANGED",
      },
    );
    assert.equal(heldResult.status, "HELD");
    assert.equal(heldResult.deposit.status, "HELD");
    assert.equal(heldResult.deposit.heldReason, "AMOUNT_MISMATCH");
  });

  it("C-01-T03 동일 멱등키 3회→예치 1건", async () => {
    const { service, contract } = createTestContext();
    const idempotencyKey = "client-idem-key-999";

    const res1 = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey, method: "CARD", amount: 1_050_000 },
    );
    const res2 = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey, method: "CARD", amount: 1_050_000 },
    );
    const res3 = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey, method: "CARD", amount: 1_050_000 },
    );

    assert.equal(res1.isNew, true);
    assert.equal(res2.isNew, false);
    assert.equal(res3.isNew, false);
    assert.equal(res1.deposit.id, res2.deposit.id);
    assert.equal(res2.deposit.id, res3.deposit.id);
    assert.equal(res1.deposit.status, "PENDING");
  });

  it("C-01-T04 콜백 재송신 10회→결과 동일", async () => {
    const { service, contract, repo } = createTestContext();

    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-retransmit", method: "CARD", amount: 1_050_000 },
    );

    const webhookPayload: TossWebhookPayload = {
      orderId: deposit.id,
      paymentKey: "toss_pk_retransmit_test",
      amount: 1_050_000,
      status: "DONE",
      eventType: "PAYMENT_STATUS_CHANGED",
    };

    // 10회 연속 호출
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await service.handleTossWebhook({ serverSecret: WEBHOOK_SECRET }, webhookPayload));
    }

    // 첫 번째 호출은 처리됨, 나머지 9번은 중복 멱등 처리(DUPLICATE_BLOCKED / 동일 결과 반환)
    for (const res of results) {
      assert.equal(res.status, "COMPLETED");
      assert.equal(res.deposit.id, deposit.id);
      assert.equal(res.deposit.status, "COMPLETED");
    }
    const events = await repo.listPaymentEvents(deposit.id);
    const verifiedEvents = events.filter((e: { eventType: string }) => e.eventType === "VERIFIED");
    assert.equal(verifiedEvents.length, 1);
  });

  it("C-01-T05 PENDING/HELD 안전 정지", async () => {
    const { service, contract, repo } = createTestContext();

    // 1. PENDING 예치 생성
    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-held-safe", method: "CARD", amount: 1_050_000 },
    );
    assert.equal(deposit.status, "PENDING");

    // 2. 콜백에서 불확실한 상태(예: Toss status가 WAITING_FOR_DEPOSIT이거나 알 수 없는 상태)
    const heldRes = await service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_unknown_status",
        amount: 1_050_000,
        status: "WAITING_FOR_DEPOSIT", // 아직 입금 대기 중이거나 불확실
        eventType: "PAYMENT_STATUS_CHANGED",
      },
    );
    assert.equal(heldRes.status, "HELD");

    const currentDeposit = await repo.findById(deposit.id);
    assert.ok(currentDeposit);
    assert.equal(currentDeposit.status, "HELD");

    // HELD 상태에서는 운영자 확인 없이 COMPLETED로 승급되지 않음
    assert.equal(currentDeposit.depositedAt, null);
  });

  it("C-01-T06 위조 PG 인증 거부", async () => {
    const { service, contract } = createTestContext();

    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-fake-auth", method: "CARD", amount: 1_050_000 },
    );

    // 위조된 시크릿 키 / 서명
    await assert.rejects(
      () =>
        service.handleTossWebhook(
          { serverSecret: "wrong_fake_secret_key" },
          {
            orderId: deposit.id,
            paymentKey: "toss_pk_fake",
            amount: 1_050_000,
            status: "DONE",
            eventType: "PAYMENT_STATUS_CHANGED",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 401);
        assert.match(err.message, /인증/);
        return true;
      },
    );
  });

  it("C-01-T07 PG 네트워크 예외에서 성공 처리 0", async () => {
    const repo = createInMemoryDepositRepository();
    const contract = {
      id: "contract-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE" as const,
      paymentStatus: "PENDING" as const,
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
    };

    // PG 재조회 검증 시 네트워크 예외가 발생하는 모의 어댑터
    const failingTossAdapter = {
      async verifyPayment() {
        throw new Error("PG_NETWORK_TIMEOUT");
      },
    };

    const service = new DepositService({
      repo,
      contractsPort: { async getContract() { return contract; } },
      webhookSecret: WEBHOOK_SECRET,
      tossAdapter: failingTossAdapter,
 completionPort: unusedCompletionPort,
      clock: { now: () => now },
    });

    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-net-err", method: "CARD", amount: 1_050_000 },
    );

    const result = await service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      {
        orderId: deposit.id,
        paymentKey: "toss_pk_net_err",
        amount: 1_050_000,
        status: "DONE",
        eventType: "PAYMENT_STATUS_CHANGED",
      },
    );

    assert.equal(result.status, "HELD");
    assert.equal(result.reason, "VERIFY_FAILED");
    const checkDeposit = await repo.findById(deposit.id);
    assert.ok(checkDeposit);
    assert.equal(checkDeposit.status, "HELD");
    assert.equal(checkDeposit.depositedAt, null);
  });

  it("C-01-T07c 재조회 어댑터가 없으면 본문 DONE으로 완료하지 않음", async () => {
    const repo = createInMemoryDepositRepository();
    const contract = {
      id: "contract-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE" as const,
      paymentStatus: "PENDING" as const,
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
    };
    const service = new DepositService({
      repo,
      contractsPort: { async getContract() { return contract; } },
      webhookSecret: WEBHOOK_SECRET,
 completionPort: unusedCompletionPort,
      clock: { now: () => now },
    });
    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-no-lookup", method: "CARD", amount: 1_050_000 },
    );
    const result = await service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      { orderId: deposit.id, paymentKey: "toss_pk_no_lookup", amount: 1_050_000, status: "DONE" },
    );
    assert.equal(result.status, "HELD");
    assert.equal(result.reason, "VERIFY_UNAVAILABLE");
  });

  it("C-01-T07b PG 재조회 verified false는 완료하지 않음", async () => {
    const repo = createInMemoryDepositRepository();
    const contract = {
      id: "contract-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE" as const,
      paymentStatus: "PENDING" as const,
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
    };
    const service = new DepositService({
      repo,
      contractsPort: { async getContract() { return contract; } },
      webhookSecret: WEBHOOK_SECRET,
      tossAdapter: { async verifyPayment() { return { verified: false }; } },
 completionPort: unusedCompletionPort,
      clock: { now: () => now },
    });
    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-unverified", method: "CARD", amount: 1_050_000 },
    );

    const result = await service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      { orderId: deposit.id, paymentKey: "toss_pk_unverified", amount: 1_050_000, status: "DONE" },
    );

    assert.notEqual(result.status, "COMPLETED");
    assert.equal(result.deposit.depositedAt, null);
  });

  it("C-01-T08 /integrations가 공개 일반 토큰으로 호출되지 않음", async () => {
    const { service, contract } = createTestContext();

    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-public-token", method: "CARD", amount: 1_050_000 },
    );

    // 일반 유저 JWT가 담긴 Bearer 토큰으로 /integrations/toss/payment-events 호출 시도 -> 403 거부
    await assert.rejects(
      () =>
        service.handleTossWebhook(
          { bearerToken: "user_jwt_access_token_abc", isPublicUserToken: true },
          {
            orderId: deposit.id,
            paymentKey: "toss_pk_test",
            amount: 1_050_000,
            status: "DONE",
            eventType: "PAYMENT_STATUS_CHANGED",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DepositHttpError)) return false;
        assert.equal(err.status, 403);
        assert.match(err.message, /서버 전용/);
        return true;
      },
    );
  });

  function createLinkedContext(options?: {
 tossAdapter?: { verifyPayment(orderId: string, paymentKey: string, amount: number): Promise<unknown> };
    marketplace?: { autoRejectCompetingApplications(input: { projectId: string; acceptedApplicationId: string }): Promise<{ rejectedCount: number }> };
  }) {
    const repo = createInMemoryDepositRepository();
    let now = new Date("2026-11-04T05:20:00.000Z");
    const clock = {
      now: () => now,
      set(next: Date) {
        now = next;
      },
    };
    const contract: DepositContractInfo = {
      id: "contract-c01-link",
      projectId: "proj-c01",
      applicationId: "app-c01",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE",
      paymentStatus: "PENDING",
      agreedAmount: 1_000_000,
      clientFee: 50_000,
      interimRatio: 50,
      durationDays: 42,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
      totalDeposited: 0,
      workDueAt: null,
    };
    let rejectCalls = 0;
    const contractsPort = {
      async getContract(id: string) {
        if (id === contract.id) return contract;
        return null;
      },
      async updateContract(id: string, patch: Partial<DepositContractInfo>) {
        if (id !== contract.id) throw new Error("Contract not found");
        Object.assign(contract, patch);
        return contract;
      },
    };
    const marketplacePort = options?.marketplace ?? {
      async autoRejectCompetingApplications() {
        rejectCalls += 1;
        return { rejectedCount: 2 };
      },
    };
    const completionPort = new DepositCompletionService({
      repo,
      contractsPort,
      marketplacePort,
      clock,
    });
    const service = new DepositService({
      repo,
      contractsPort,
      webhookSecret: WEBHOOK_SECRET,
 tossAdapter: options?.tossAdapter ?? {
 async verifyPayment(orderId, paymentKey, amount) {
 return { verified: true, orderId, paymentKey, amount, status: "DONE" };
 },
 },
      clock,
      completionPort,
    });
    return { repo, contract, service, clock, rejectCalls: () => rejectCalls };
  }

  async function openLinkedDeposit(ctx: ReturnType<typeof createLinkedContext>, idempotencyKey: string) {
    return ctx.service.createDeposit(
      { userId: ctx.contract.clientUserId, role: "CLIENT" },
      { contractId: ctx.contract.id, idempotencyKey, method: "CARD", amount: 1_050_000 },
    );
  }

  it("C-01-F01 만료·누락·PG 근거 불일치는 완료와 후속 정산을 만들지 않음", async () => {
    const ctx = createLinkedContext({
      tossAdapter: {
        async verifyPayment() {
          return { verified: true, amount: 1, orderId: "other-order", paymentKey: "other-key" };
        },
      },
    });
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f01");
    ctx.clock.set(new Date("2026-11-07T15:00:00.000Z"));

    const expired = await ctx.service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      { orderId: deposit.id, paymentKey: "pk-expired", amount: 1_050_000, status: "DONE", transactionKey: "tx-expired" },
    );
    assert.notEqual(expired.status, "COMPLETED");
    assert.equal(expired.deposit.depositedAt, null);
    assert.equal(ctx.contract.paymentStatus, "PENDING");
    assert.equal(ctx.contract.workDueAt ?? null, null);
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 0);
    assert.equal(ctx.rejectCalls(), 0);

    ctx.clock.set(new Date("2026-11-04T05:20:00.000Z"));
    await assert.rejects(
      () =>
        ctx.service.handleTossWebhook(
          { serverSecret: WEBHOOK_SECRET },
          { orderId: deposit.id, paymentKey: "", amount: 1_050_000, status: "DONE" },
        ),
      (err: unknown) => err instanceof DepositHttpError && err.status === 400,
    );
    await assert.rejects(
      () =>
        ctx.service.handleTossWebhook(
          { serverSecret: "short" },
          { orderId: deposit.id, paymentKey: "pk-auth", amount: 1_050_000, status: "DONE" },
        ),
      (err: unknown) => err instanceof DepositHttpError && err.status === 401,
    );

    const mismatched = await ctx.service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      { orderId: deposit.id, paymentKey: "pk-evidence", amount: 1_050_000, status: "DONE", transactionKey: "tx-evidence" },
    );
    assert.notEqual(mismatched.status, "COMPLETED");
    assert.equal(mismatched.deposit.depositedAt, null);
    assert.equal(ctx.contract.paymentStatus, "PENDING");
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 0);
    assert.equal(ctx.rejectCalls(), 0);
    const saved = await ctx.repo.findById(deposit.id);
    assert.equal(saved?.status === "COMPLETED", false);
  });

  it("C-01-F01b verified 표지만 있고 PG 거래 식별 근거가 없으면 예치를 완료하지 않음", async () => {
    const ctx = createLinkedContext({
      tossAdapter: { async verifyPayment() { return { verified: true }; } },
    });
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f01b");

    const result = await ctx.service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      { orderId: deposit.id, paymentKey: "pk-unmatched", amount: 1_050_000, status: "DONE" },
    );

    assert.equal(result.status, "HELD");
    assert.equal(result.reason, "VERIFY_FAILED");
    assert.equal(ctx.contract.paymentStatus, "PENDING");
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 0);
    assert.equal(ctx.rejectCalls(), 0);
  });

  it("C-01-F01c null 웹훅 본문은 400으로 거절", async () => {
    const ctx = createLinkedContext();

    await assert.rejects(
      () => ctx.service.handleTossWebhook({ serverSecret: WEBHOOK_SECRET }, null),
      (err: unknown) => err instanceof DepositHttpError && err.status === 400,
    );
  });

  it("C-01-F01d 설정된 웹훅 비밀키가 비어 있으면 인증되지 않음", async () => {
    const service = new DepositService({
      repo: createInMemoryDepositRepository(),
      contractsPort: { async getContract() { return null; } },
      webhookSecret: "",
      tossAdapter: { async verifyPayment() { return { verified: false }; } },
      completionPort: { async completeDeposit() { throw new Error("unexpected completion"); } },
    });

    await assert.rejects(
      () =>
        service.handleTossWebhook(
          { serverSecret: "" },
          { orderId: "missing", paymentKey: "pk", amount: 1, status: "DONE" },
        ),
      (err: unknown) => err instanceof DepositHttpError && err.status === 401,
    );
  });

  it("C-01-F02 완료된 예치의 키·시각·금액·지급 상태는 다른 transactionKey로 바뀌지 않음", async () => {
    const ctx = createLinkedContext();
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f02");
    const depositedAt = new Date("2026-11-04T05:20:00.000Z");
    await ctx.repo.updateDeposit(deposit.id, {
      status: "COMPLETED",
      pgKey: "pk-original",
      depositedAt,
      amount: 1_050_000,
    });
    ctx.contract.paymentStatus = "DEPOSITED";
    ctx.contract.totalDeposited = 1_050_000;
    ctx.contract.workDueAt = new Date("2026-12-16T14:59:59.999Z");
    await ctx.repo.createPaymentEvent({
      depositId: deposit.id,
      eventType: "VERIFIED",
      dedupKey: "tx-original",
      payload: { paymentKey: "pk-original" },
      resultNote: "결제 검증 성공",
    });
    ctx.clock.set(new Date("2026-11-08T00:00:00.000Z"));

    const replay = await ctx.service.handleTossWebhook(
      { serverSecret: WEBHOOK_SECRET },
      {
        orderId: deposit.id,
        paymentKey: "pk-replaced",
        amount: 1_050_000,
        status: "DONE",
        transactionKey: "tx-replaced",
      },
    );

    assert.equal(replay.status, "COMPLETED");
    assert.equal(replay.deposit.pgKey, "pk-original");
    assert.equal(replay.deposit.depositedAt?.toISOString(), depositedAt.toISOString());
    assert.equal(replay.deposit.amount, 1_050_000);
    assert.equal(replay.deposit.status, "COMPLETED");
    assert.equal(ctx.contract.paymentStatus, "DEPOSITED");
    assert.equal(ctx.contract.totalDeposited, 1_050_000);
    assert.equal(ctx.contract.workDueAt?.toISOString(), "2026-12-16T14:59:59.999Z");
    const events = await ctx.repo.listPaymentEvents(deposit.id);
    assert.equal(events.filter((event) => event.eventType === "VERIFIED").length, 1);
    assert.equal(events.some((event) => event.dedupKey === "tx-replaced"), false);
    assert.equal(ctx.rejectCalls(), 0);
  });

  it("C-01-F02b 병렬 웹훅은 예치 확정과 VERIFIED 이벤트를 한 번만 남김", async () => {
    const ctx = createLinkedContext({
 tossAdapter: {
 async verifyPayment(orderId, paymentKey, amount) {
          await new Promise((resolve) => setTimeout(resolve, 20));
 return { verified: true, orderId, paymentKey, amount, status: "DONE" };
        },
      },
    });
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f02b");
    const payload = {
      orderId: deposit.id,
      amount: 1_050_000,
      status: "DONE",
    };

    const [first, second] = await Promise.all([
      ctx.service.handleTossWebhook(
        { serverSecret: WEBHOOK_SECRET },
        { ...payload, paymentKey: "pk-a", transactionKey: "tx-a" },
      ),
      ctx.service.handleTossWebhook(
        { serverSecret: WEBHOOK_SECRET },
        { ...payload, paymentKey: "pk-b", transactionKey: "tx-b" },
      ),
    ]);

    const saved = await ctx.repo.findById(deposit.id);
    assert.ok(saved);
    assert.equal(saved.status, "COMPLETED");
    assert.equal(first.deposit.pgKey, saved.pgKey);
    assert.equal(second.deposit.pgKey, saved.pgKey);
    assert.equal(first.deposit.depositedAt?.toISOString(), saved.depositedAt?.toISOString());
    assert.equal(second.deposit.depositedAt?.toISOString(), saved.depositedAt?.toISOString());
    assert.equal(saved.amount, 1_050_000);
    const verified = (await ctx.repo.listPaymentEvents(deposit.id)).filter((event) => event.eventType === "VERIFIED");
    assert.equal(verified.length, 1);
    assert.equal(ctx.contract.paymentStatus, "DEPOSITED");
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 2);
    assert.equal(ctx.rejectCalls(), 1);
  });

  it("C-01-F03 검증된 웹훅 1회가 예치 확정·구간·마감·지원 거절까지 연결됨", async () => {
    const ctx = createLinkedContext();
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f03");
    const payload: TossWebhookPayload = {
      orderId: deposit.id,
      paymentKey: "pk-confirmed",
      amount: 1_050_000,
      status: "DONE",
      transactionKey: "tx-confirmed",
    };

    const result = await ctx.service.handleTossWebhook({ serverSecret: WEBHOOK_SECRET }, payload);

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.deposit.pgKey, "pk-confirmed");
    assert.equal(result.deposit.depositedAt?.toISOString(), "2026-11-04T05:20:00.000Z");
    assert.equal(ctx.contract.paymentStatus, "DEPOSITED");
    assert.equal(ctx.contract.status, "ACTIVE");
    assert.equal(ctx.contract.totalDeposited, 1_050_000);
    assert.equal(ctx.contract.workDueAt?.toISOString(), "2026-12-16T14:59:59.999Z");
    const installments = await ctx.repo.listInstallments(ctx.contract.id);
    assert.equal(installments.length, 2);
    assert.ok(installments.some((row) => row.stage === "INTERIM"));
    assert.ok(installments.some((row) => row.stage === "FINAL"));
    assert.equal(ctx.rejectCalls(), 1);

    const replay = await ctx.service.handleTossWebhook({ serverSecret: WEBHOOK_SECRET }, payload);
    assert.equal(replay.deposit.pgKey, "pk-confirmed");
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 2);
    assert.equal(ctx.rejectCalls(), 1);
    assert.equal(
      (await ctx.repo.listPaymentEvents(deposit.id)).filter((event) => event.eventType === "VERIFIED").length,
      1,
    );
  });

  it("C-01-F03b 확정 도중 실패하면 예치·계약·구간·지원 거절이 남지 않음", async () => {
    const ctx = createLinkedContext({
      marketplace: {
        async autoRejectCompetingApplications() {
          throw new Error("DB_TRANSACTION_DEADLOCK");
        },
      },
    });
    const { deposit } = await openLinkedDeposit(ctx, "idem-c01-f03b");

    await assert.rejects(
      () =>
        ctx.service.handleTossWebhook(
          { serverSecret: WEBHOOK_SECRET },
          { orderId: deposit.id, paymentKey: "pk-rollback", amount: 1_050_000, status: "DONE", transactionKey: "tx-rollback" },
        ),
      (err: unknown) => err instanceof Error && /DB_TRANSACTION_DEADLOCK/.test(err.message),
    );

    const saved = await ctx.repo.findById(deposit.id);
    assert.ok(saved);
    assert.equal(saved.status, "PENDING");
    assert.equal(saved.pgKey, null);
    assert.equal(saved.depositedAt, null);
    assert.equal(saved.amount, 1_050_000);
    assert.equal(ctx.contract.paymentStatus, "PENDING");
    assert.equal(ctx.contract.totalDeposited ?? 0, 0);
    assert.equal(ctx.contract.workDueAt ?? null, null);
    assert.equal((await ctx.repo.listInstallments(ctx.contract.id)).length, 0);
    assert.equal(
      (await ctx.repo.listPaymentEvents(deposit.id)).filter((event) => event.eventType === "VERIFIED").length,
      0,
    );
  });

  it("C-01 sandbox confirm은 명시적 플래그에서만 예치를 완료한다", async () => {
    const ctx = createTestContext();
    const { deposit } = await ctx.service.createDeposit(
      { userId: "client-1", role: "CLIENT" },
      { contractId: ctx.contract.id, idempotencyKey: "idem-sandbox", method: "CARD", amount: 1_050_000 },
    );

    const previous = process.env.TOSS_SANDBOX_MOCK;
    delete process.env.TOSS_SANDBOX_MOCK;
    try {
      await assert.rejects(
        () => ctx.service.confirmSandboxDeposit(
          { userId: "client-1", role: "CLIENT" },
          { contractId: ctx.contract.id, depositId: deposit.id },
        ),
        (error: unknown) => error instanceof DepositHttpError && error.status === 404,
      );

      process.env.TOSS_SANDBOX_MOCK = "true";
      const result = await ctx.service.confirmSandboxDeposit(
        { userId: "client-1", role: "CLIENT" },
        { contractId: ctx.contract.id, depositId: deposit.id },
      );
      assert.equal(result.deposit.status, "COMPLETED");
      assert.equal(result.contract.paymentStatus, "DEPOSITED");
      assert.equal(result.installments.length, 2);
    } finally {
      if (previous === undefined) delete process.env.TOSS_SANDBOX_MOCK;
      else process.env.TOSS_SANDBOX_MOCK = previous;
    }
  });
});
