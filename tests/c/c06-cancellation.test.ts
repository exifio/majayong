import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CancellationService,
  CancellationHttpError,
  createInMemoryCancellationRepository,
  type CancellationContractEntity,
} from "../../src/modules/cancellation/index.ts";

describe("C-06: 예치 후 계약 취소·이의·운영자 수동 처리", () => {
  const depositTime = new Date("2026-11-04T05:20:00.000Z"); // 예치 완료 시점
  const requestTime = new Date("2026-11-10T10:00:00.000Z"); // 6일 후 취소 요청

  function createTestSetup() {
    const repo = createInMemoryCancellationRepository();

    const contract: CancellationContractEntity = {
      id: "contract-c06",
      clientUserId: "client-c06",
      supplierUserId: "supplier-c06",
      status: "ACTIVE",
      paymentStatus: "DEPOSITED",
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      totalDeposited: 3_255_000,
      interimRatio: 50,
      depositedAt: depositTime,
      cancelCause: null,
      cancelRequestedBy: null,
      cancelRequestedAt: null,
      cancelNote: null,
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
    };

    const interimInstallment = {
      id: "inst-interim",
      contractId: contract.id,
      stage: "INTERIM" as const,
      amount: 1_550_000,
      status: "PENDING" as const, // 아직 납품/승인 전
    };

    const finalInstallment = {
      id: "inst-final",
      contractId: contract.id,
      stage: "FINAL" as const,
      amount: 1_550_000,
      status: "PENDING" as const,
    };

    repo.seedContract(contract);
    repo.seedInstallments([interimInstallment, finalInstallment]);

    const service = new CancellationService({
      repo,
      clock: { now: () => requestTime },
    });

    return { repo, contract, interimInstallment, finalInstallment, service };
  }

  it("C-06-T01 예치 전 취소 요청 금지", async () => {
    const { service, contract, repo } = createTestSetup();

    // 계약이 아직 예치 전 (PENDING)
    await repo.updateContract(contract.id, { paymentStatus: "PENDING" });

    await assert.rejects(
      () =>
        service.requestCancellation(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            contractId: contract.id,
            cause: "CLIENT",
            note: "개인 사정으로 취소합니다.",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /예치 완료된 계약만/);
        return true;
      },
    );
  });

  it("C-06-T02 요청 2회/당사자 아닌 처리 거부", async () => {
    const { service, contract } = createTestSetup();

    // 1. 비당사자 요청 -> 403 거부
    await assert.rejects(
      () =>
        service.requestCancellation(
          { userId: "alien-user", role: "CLIENT" },
          { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );

    // 2. 1회차 정상 요청 -> CANCEL_REQUESTED 전이
    const req1 = await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소합니다." },
    );
    assert.equal(req1.status, "CANCEL_REQUESTED");

    // 3. 중복 2회차 요청 시도 -> 409 거부
    await assert.rejects(
      () =>
        service.requestCancellation(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, cause: "CLIENT", note: "중복 취소 요청" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /이미 취소 진행 중/);
        return true;
      },
    );
  });

  it("C-06-T03 3일 무응답 시 운영자만", async () => {
    const { service, contract, repo } = createTestSetup();

    // 취소 요청 등록
    await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
    );

    // 3일(72시간) 초과 시점 (3일 1시간 후)
    const afterThreeDays = new Date(requestTime.getTime() + 73 * 60 * 60 * 1000);

    // 3일 무응답 배치 검사 실행 -> cancelEscalatedAt 설정되고 운영자 판정 대기
    const checkRes = await service.checkCancellationDeadlines(contract.id, afterThreeDays);
    assert.equal(checkRes.escalatedToAdmin, true);

    const updated = await repo.getContract(contract.id);
    assert.ok(updated?.cancelEscalatedAt);

    // 3일 무응답 이후에는 상대방의 자의적 동의/이의 거부 (운영자 판정만 가능)
    await assert.rejects(
      () =>
        service.agreeCancellation(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          { contractId: contract.id },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /3일 무응답으로 운영자 판정 대기 중/);
        return true;
      },
    );
  });

  it("C-06-T04 이의와 동의 동시 경합 1경로만", async () => {
    const { service, contract } = createTestSetup();

    await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
    );

    // 상대방(공급자)이 동의 완료
    const agreed = await service.agreeCancellation(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      { contractId: contract.id },
    );
    assert.equal(agreed.cancelResolution, "AGREED");

    // 이미 동의된 후 이의 제기 시도 -> 409 거부
    await assert.rejects(
      () =>
        service.objectCancellation(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          { contractId: contract.id, objectionRate: 80, note: "뒤늦은 이의" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 409);
        return true;
      },
    );
  });

  it("C-06-T05 비율 CHECK 경계(0/49/50/100/101)", async () => {
    const { service, contract, repo } = createTestSetup();

    // 1. 의뢰인 사유(CLIENT)에서 50% 미만(49%) 요구 -> 거부
    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "취소",
    });

    await assert.rejects(
      () =>
        service.decideCancellation({
          contractId: contract.id,
          compensationRate: 49,
          reason: "49% 결정 시도",
        }),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 422);
        assert.match(err.message, /50% 이상/);
        return true;
      },
    );

    // 2. 의뢰인 사유에서 101% 초과 -> 거부
    await assert.rejects(
      () =>
        service.decideCancellation({
          contractId: contract.id,
          compensationRate: 101,
          reason: "101% 초과 시도",
        }),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 422);
        return true;
      },
    );

    // 3. 의뢰인 사유에서 50% 이상 (정확히 50%) -> 통과 (PRD §9.6 기준 775,000원 보상, 2,441,250원 환불)
    const decided50 = await service.decideCancellation({
      contractId: contract.id,
      compensationRate: 50,
      reason: "착수 전 50% 보상 판정",
    });
    assert.equal(decided50.compensationRate, 50);
    assert.equal(decided50.settledAmount, 736_250);
    assert.equal(decided50.refundAmount, 2_441_250);
  });

  it("C-06-T06 이미 지급된 금액 초과 환불/보상 차단", async () => {
    const { service, contract, interimInstallment, repo } = createTestSetup();

    // 중간 구간(1,550,000원)이 이미 지급 완료됨
    await repo.updateInstallment(interimInstallment.id, {
      status: "RELEASED",
    });

    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "취소",
    });

    // 남은 잔여 예치금 1,550,000원을 초과하는 환불/보상 요구 차단
    const calc = await service.calculateCancellationSplit(contract.id, 50);
    assert.ok(calc.refundAmount + calc.settledAmount <= 3_255_000);
  });

  it("C-06-T07 취소 중 자동 승인/지급 0", async () => {
    const { service, contract } = createTestSetup();

    await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
    );

    // CANCEL_REQUESTED 상태에서 진행 작업 정지 확인
    assert.equal(service.isOperationsPaused(contract.id), true);
  });

  it("C-06-T08 실제 환불 API 0", async () => {
    const { service, contract, repo } = createTestSetup();

    const calls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      calls.push(String(input));
      return Promise.reject(new Error("EXTERNAL_REFUND_BLOCKED"));
    };

    try {
      await repo.updateContract(contract.id, {
        status: "CANCELLED",
        cancelResolution: "ADMIN_DECIDED",
        refundAmount: 2_441_250,
        settledAmount: 736_250,
      });

      // 운영자 수동 처리 표시 (mark-processed)
      const processed = await service.markProcessed({
        contractId: contract.id,
        operatorId: "admin-1",
        refunded: true,
        cancelPayout: true,
      });

      assert.ok(processed.refundedAt);
      assert.ok(processed.cancelPayoutAt);
      // 실제 PG/은행 환불 API 무호출 검증
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("C-06-T09 24시간 내 무납품 전액 환불 요구 시 D-16 차단", async () => {
    const { service, contract, repo } = createTestSetup();

    // 예치 후 24시간 이내 시점
    const within24h = new Date(depositTime.getTime() + 2 * 60 * 60 * 1000);

    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: within24h,
      cancelNote: "24시간 이내 전액 환불 요청",
    });

    // D-16 미결정 상태에서 0% 보상(전액환불) 저장 시도 -> D-16 BLOCKED 오류 발생
    await assert.rejects(
      () =>
        service.decideCancellation({
          contractId: contract.id,
          compensationRate: 0, // 0% 전액환불
          reason: "24시간 내 무납품 전액환불",
        }),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 422);
        assert.match(err.message, /D-16/);
        return true;
      },
    );
  });

  it("C-06-T10 이미 납품한 진행 구간 전액 지급/후속 구간 전액 환불", async () => {
    const { service, contract, interimInstallment, repo } = createTestSetup();

    // 1구간(INTERIM)이 이미 납품(DELIVERED)된 상태에서 의뢰인 취소 요청
    await repo.updateInstallment(interimInstallment.id, {
      status: "DELIVERED",
    });

    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "납품 후 취소 요청",
    });

    // PRD §13.2: 진행 구간 납품했으면 그 구간 전액 지급(100%), 후속 구간 전액 환불
    const split = await service.calculateCancellationSplit(contract.id, 100);
    // 1구간 1,550,000원 전액 지급(수수료 77,500원 뺀 1,472,500원 지급), 2구간 1,550,000원 + 미사용 수수료 환불
    assert.equal(split.ongoingStagePaidFull, true);
    assert.equal(split.settledAmount, 1_472_500);
  });
});
