import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DepositService,
  DepositHttpError,
  createInMemoryDepositRepository,
  type TossWebhookPayload,
} from "../../src/modules/deposit/index.ts";

describe("C-01: Toss sandbox 예치·PG 검증·중복 방지", () => {
  const WEBHOOK_SECRET = "test_toss_webhook_secret_key_12345";
  const now = new Date("2026-11-04T05:20:00.000Z");

  function createTestContext() {
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

    const contractsPort = {
      async getContract(id: string) {
        if (id === contract.id) return contract;
        return null;
      },
    };

    const service = new DepositService({
      repo,
      contractsPort,
      webhookSecret: WEBHOOK_SECRET,
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
      clock: { now: () => now },
    });

    const { deposit } = await service.createDeposit(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, idempotencyKey: "idem-net-err", method: "CARD", amount: 1_050_000 },
    );

    // 콜백 수신 중 Toss API 추가 검증에서 네트워크 에러 발생
    await assert.rejects(
      () =>
        service.handleTossWebhook(
          { serverSecret: WEBHOOK_SECRET },
          {
            orderId: deposit.id,
            paymentKey: "toss_pk_net_err",
            amount: 1_050_000,
            status: "DONE",
            eventType: "PAYMENT_STATUS_CHANGED",
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );

    // 성공 처리 0건 검증: deposit 상태는 여전히 PENDING/HELD이고 결코 COMPLETED가 되지 않음
    const checkDeposit = await repo.findById(deposit.id);
    assert.ok(checkDeposit);
    assert.notEqual(checkDeposit.status, "COMPLETED");
    assert.equal(checkDeposit.depositedAt, null);
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
});
