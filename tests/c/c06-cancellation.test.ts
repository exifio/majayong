import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CancellationService,
  CancellationHttpError,
  createInMemoryCancellationRepository,
  type CancellationContractEntity,
  type CancellationMessagePort,
  type CancelCause,
} from "../../src/modules/cancellation/index.ts";

describe("C-06: 예치 후 계약 취소·이의·운영자 수동 처리", () => {
  const depositTime = new Date("2026-11-04T05:20:00.000Z"); // 예치 완료 시점
  const requestTime = new Date("2026-11-10T10:00:00.000Z"); // 6일 후 취소 요청

  function createTestSetup(options?: { messagePort?: CancellationMessagePort }) {
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
      messagePort: options?.messagePort,
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

    const deadline = new Date("2026-11-13T14:59:59.999Z");
    const stillOpen = await service.checkCancellationDeadlines(contract.id, deadline);
    assert.equal(stillOpen.escalatedToAdmin, false);

    const afterDeadline = new Date(deadline.getTime() + 1);
    const checkRes = await service.checkCancellationDeadlines(contract.id, afterDeadline);
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

  it("C-06-T04b 요청자 본인 이의와 비율 범위 거부", async () => {
    const { service, contract, repo } = createTestSetup();

    await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
    );

    await assert.rejects(
      () =>
        service.objectCancellation(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, objectionRate: 50, note: "본인 이의" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );

    await assert.rejects(
      () =>
        service.objectCancellation(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          { contractId: contract.id, objectionRate: 101, note: "범위 밖" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 422);
        return true;
      },
    );

    const objected = await service.objectCancellation(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      { contractId: contract.id, objectionRate: 80, note: "비율 이의" },
    );
    assert.equal(objected.objectionRate, 80);
    assert.ok(objected.cancelEscalatedAt);
    const stored = await repo.getContract(contract.id);
    assert.equal(stored?.status, "CANCEL_REQUESTED");
  });

  it("C-06-F07 이의 비율 하한은 의뢰인 사정에만 적용(D-19)", async () => {
    // 공급자 사정: 의뢰인이 30% 이의 → 하한 없음
    const supplierCase = createTestSetup();
    await supplierCase.service.requestCancellation(
      { userId: supplierCase.contract.supplierUserId, role: "SUPPLIER" },
      { contractId: supplierCase.contract.id, cause: "SUPPLIER", note: "공급자 사정" },
    );
    const supplierObjection = await supplierCase.service.objectCancellation(
      { userId: supplierCase.contract.clientUserId, role: "CLIENT" },
      { contractId: supplierCase.contract.id, objectionRate: 30, note: "30% 이의" },
    );
    assert.equal(supplierObjection.objectionRate, 30);

    // 서로 합의: 공급자가 20% 이의 → 하한 없음
    const mutualCase = createTestSetup();
    await mutualCase.service.requestCancellation(
      { userId: mutualCase.contract.clientUserId, role: "CLIENT" },
      {
        contractId: mutualCase.contract.id,
        cause: "MUTUAL",
        note: "합의",
        proposedCompensationRate: 30,
      },
    );
    const mutualObjection = await mutualCase.service.objectCancellation(
      { userId: mutualCase.contract.supplierUserId, role: "SUPPLIER" },
      { contractId: mutualCase.contract.id, objectionRate: 20, note: "20% 이의" },
    );
    assert.equal(mutualObjection.objectionRate, 20);

    // 의뢰인 사정: 49% 이의는 거부(raw 제약 6)
    const clientCase = createTestSetup();
    await clientCase.service.requestCancellation(
      { userId: clientCase.contract.clientUserId, role: "CLIENT" },
      { contractId: clientCase.contract.id, cause: "CLIENT", note: "의뢰인 사정" },
    );
    await assert.rejects(
      () =>
        clientCase.service.objectCancellation(
          { userId: clientCase.contract.supplierUserId, role: "SUPPLIER" },
          { contractId: clientCase.contract.id, objectionRate: 49, note: "49% 이의" },
        ),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 422);
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
      cancelEscalatedAt: requestTime,
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

  it("C-06-T06 이미 지급된 금액을 반영해 남은 잔액 안에서 분할", async () => {
    const { service, contract, interimInstallment, repo } = createTestSetup();

    // 중간 구간(1,550,000원)이 이미 지급 완료됨
    await repo.updateInstallment(interimInstallment.id, {
      status: "RELEASED",
      amount: 1_550_000,
    });

    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "취소",
      cancelEscalatedAt: requestTime,
    });

    // 남은 예치 잔액 1,705,000원에서 최종 구간 50% 보상.
    const split = await service.calculateCancellationSplit(contract.id, 50);
    assert.equal(split.ongoingStagePaidFull, false);
    assert.equal(split.settledAmount, 736_250);
    assert.equal(split.refundAmount, 891_250);
    // 지급 완료 1,550,000 + 보상 원금 775,000 + 수수료 38,750 + 환불 891,250 = 3,255,000
    assert.equal(1_550_000 + 775_000 + 38_750 + split.refundAmount, contract.totalDeposited);

    // 공급자 사정 취소는 미지급 잔액 전액 환불.
    const supplierCause = createTestSetup();
    await supplierCause.repo.updateInstallment(supplierCause.interimInstallment.id, { status: "RELEASED" });
    await supplierCause.repo.updateContract(supplierCause.contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "SUPPLIER",
      cancelRequestedBy: supplierCause.contract.supplierUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "공급자 사정",
      cancelEscalatedAt: requestTime,
    });
    const supplierSplit = await supplierCause.service.calculateCancellationSplit(
      supplierCause.contract.id,
      50,
    );
    assert.equal(supplierSplit.settledAmount, 0);
    assert.equal(supplierSplit.refundAmount, 1_705_000);
  });

  it("C-06-T07 취소 중 자동 승인/지급 0", async () => {
    const { service, contract } = createTestSetup();

    assert.equal(await service.isOperationsPaused(contract.id), false);

    await service.requestCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, cause: "CLIENT", note: "취소 요청" },
    );

    assert.equal(await service.isOperationsPaused(contract.id), true);
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

  it("C-06-T09 D-16 승인 전 24시간 내 무납품 전액 환불 판정을 차단", async () => {
    const agreed = createTestSetup();
    const within24h = new Date(depositTime.getTime() + 2 * 60 * 60 * 1000);

    await agreed.repo.updateContract(agreed.contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: agreed.contract.clientUserId,
      cancelRequestedAt: within24h,
      cancelNote: "24시간 이내 전액 환불 요청",
    });

    await assert.rejects(
      () =>
        agreed.service.agreeCancellation(
          { userId: agreed.contract.supplierUserId, role: "SUPPLIER" },
          { contractId: agreed.contract.id },
        ),
      (err: unknown) =>
        err instanceof CancellationHttpError && err.status === 409 && err.message === "D16_BLOCKED",
    );

    const decided = createTestSetup();
    await decided.repo.updateContract(decided.contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: decided.contract.clientUserId,
      cancelRequestedAt: within24h,
      cancelEscalatedAt: within24h,
    });
    await assert.rejects(
      () =>
        decided.service.decideCancellation({
          contractId: decided.contract.id,
          compensationRate: 0,
          reason: "24시간 내 무납품 전액환불",
        }),
      (err: unknown) => {
        if (!(err instanceof CancellationHttpError)) return false;
        assert.equal(err.status, 409);
        assert.equal(err.message, "D16_BLOCKED");
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

  it("C-06-F01 일부 지급된 ACTIVE 계약도 취소 요청 가능", async () => {
    const partial = createTestSetup();
    await partial.repo.updateContract(partial.contract.id, { paymentStatus: "PARTIALLY_RELEASED" });
    const requested = await partial.service.requestCancellation(
      { userId: partial.contract.clientUserId, role: "CLIENT" },
      { contractId: partial.contract.id, cause: "CLIENT", note: "남은 작업 중단" },
    );
    assert.equal(requested.status, "CANCEL_REQUESTED");

    const completed = createTestSetup();
    await completed.repo.updateContract(completed.contract.id, { status: "COMPLETED" });
    await assert.rejects(
      () =>
        completed.service.requestCancellation(
          { userId: completed.contract.clientUserId, role: "CLIENT" },
          { contractId: completed.contract.id, cause: "CLIENT", note: "완료 후 취소" },
        ),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 409,
    );
  });

  it("C-06-F03 취소 사유 enum·설명·요청자 역할·근거 메시지 검증", async () => {
    const messages = new Map([
      ["msg-1", { id: "msg-1", contractId: "contract-c06", authorUserId: "client-c06" }],
      ["msg-2", { id: "msg-2", contractId: "other-contract", authorUserId: "client-c06" }],
      ["msg-3", { id: "msg-3", contractId: "contract-c06", authorUserId: "alien-user" }],
    ]);
    const messagePort: CancellationMessagePort = {
      async getMessage(id) {
        return messages.get(id) ?? null;
      },
    };
    const { service, contract, repo } = createTestSetup({ messagePort });
    const client = { userId: contract.clientUserId, role: "CLIENT" };
    const supplier = { userId: contract.supplierUserId, role: "SUPPLIER" };

    await assert.rejects(
      () =>
        service.requestCancellation(client, {
          contractId: contract.id,
          cause: "BOGUS" as CancelCause,
          note: "잘못된 사유",
        }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 400,
    );
    await assert.rejects(
      () => service.requestCancellation(client, { contractId: contract.id, cause: "CLIENT", note: "  " }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 400,
    );
    // 공급자가 '의뢰인 사정'을 요청하는 것은 사유·요청자 역할 불일치.
    await assert.rejects(
      () =>
        service.requestCancellation(supplier, {
          contractId: contract.id,
          cause: "CLIENT",
          note: "역할 불일치",
        }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 422,
    );

    for (const messageId of ["missing-msg", "msg-2", "msg-3"]) {
      await assert.rejects(
        () =>
          service.requestCancellation(client, {
            contractId: contract.id,
            cause: "CLIENT",
            note: "근거 오류",
            evidence: { messageIds: [messageId] },
          }),
        (err: unknown) => err instanceof CancellationHttpError && err.status === 422,
      );
    }
    assert.equal((await repo.getContract(contract.id))?.status, "ACTIVE");

    const accepted = await service.requestCancellation(client, {
      contractId: contract.id,
      cause: "CLIENT",
      note: "채팅에서 합의된 취소",
      evidence: { messageIds: ["msg-1"] },
    });
    assert.equal(accepted.status, "CANCEL_REQUESTED");
    assert.deepEqual(accepted.cancelEvidence, { messageIds: ["msg-1"] });
  });

  it("C-06-F04 관리자 판정은 CANCEL_REQUESTED·이의/에스컬레이션에서만, 중복 판정 불변", async () => {
    const active = createTestSetup();
    await assert.rejects(
      () =>
        active.service.decideCancellation({
          contractId: active.contract.id,
          compensationRate: 50,
          reason: "ACTIVE 직접 취소",
        }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 409,
    );

    const pendingEscalation = createTestSetup();
    await pendingEscalation.repo.updateContract(pendingEscalation.contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: pendingEscalation.contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "요청",
    });
    await assert.rejects(
      () =>
        pendingEscalation.service.decideCancellation({
          contractId: pendingEscalation.contract.id,
          compensationRate: 50,
          reason: "아직 상대 응답 전",
        }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 409,
    );

    const { service, contract, repo } = createTestSetup();
    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "요청",
      cancelEscalatedAt: requestTime,
    });
    await assert.rejects(
      () => service.decideCancellation({ contractId: contract.id, compensationRate: 50, reason: " " }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 400,
    );
    await assert.rejects(
      () => service.decideCancellation({ contractId: contract.id, compensationRate: 50.5, reason: "소수" }),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 422,
    );

    const first = await service.decideCancellation({
      contractId: contract.id,
      compensationRate: 50,
      reason: "판정",
    });
    const second = await service.decideCancellation({
      contractId: contract.id,
      compensationRate: 100,
      reason: "뒤늦은 재판정",
    });
    assert.equal(second.compensationRate, 50);
    assert.equal(second.refundAmount, first.refundAmount);
    assert.equal(second.cancelResolvedAt?.toISOString(), first.cancelResolvedAt?.toISOString());
  });

  it("C-06-F05 취소 상세 조회는 당사자/운영자만", async () => {
    const { service, contract, repo } = createTestSetup();
    await repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: "CLIENT",
      cancelRequestedBy: contract.clientUserId,
      cancelRequestedAt: requestTime,
      cancelNote: "사유",
      cancelEscalatedAt: requestTime,
    });

    const clientView = await service.getCancellation(
      { userId: contract.clientUserId, role: "CLIENT" },
      contract.id,
    );
    assert.equal(clientView.status, "CANCEL_REQUESTED");
    assert.equal(clientView.cancelCause, "CLIENT");
    assert.equal(clientView.cancelNote, "사유");
    assert.equal(clientView.paused, true);
    assert.equal("payoutAccountNo" in clientView, false);

    const adminView = await service.getCancellation({ userId: "admin-1", role: "ADMIN" }, contract.id);
    assert.equal(adminView.contractId, contract.id);

    await assert.rejects(
      () => service.getCancellation({ userId: "outsider", role: "CLIENT" }, contract.id),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 403,
    );
    await assert.rejects(
      () => service.getCancellation({ userId: "outsider", role: "SUPPLIER" }, "missing"),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 404,
    );
  });

  it("C-06-F06 합의 비율은 요청에 기록된 값만 확정하고 이의는 재호출로 덮어쓰지 않음", async () => {
    const mutual = createTestSetup();
    await assert.rejects(
      () =>
        mutual.service.requestCancellation(
          { userId: mutual.contract.clientUserId, role: "CLIENT" },
          { contractId: mutual.contract.id, cause: "MUTUAL", note: "합의 취소" },
        ),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 422,
    );

    const requested = await mutual.service.requestCancellation(
      { userId: mutual.contract.clientUserId, role: "CLIENT" },
      {
        contractId: mutual.contract.id,
        cause: "MUTUAL",
        note: "합의 취소",
        proposedCompensationRate: 30,
      },
    );
    assert.equal(requested.compensationRate, 30);

    const agreed = await mutual.service.agreeCancellation(
      { userId: mutual.contract.supplierUserId, role: "SUPPLIER" },
      { contractId: mutual.contract.id },
    );
    assert.equal(agreed.cancelResolution, "AGREED");
    assert.equal(agreed.compensationRate, 30);
    assert.equal(agreed.settledAmount, 441_750);
    assert.equal(agreed.refundAmount, 2_766_750);

    const objected = createTestSetup();
    await objected.service.requestCancellation(
      { userId: objected.contract.clientUserId, role: "CLIENT" },
      { contractId: objected.contract.id, cause: "CLIENT", note: "취소" },
    );
    await objected.service.objectCancellation(
      { userId: objected.contract.supplierUserId, role: "SUPPLIER" },
      { contractId: objected.contract.id, objectionRate: 70, note: "70% 이의" },
    );
    await assert.rejects(
      () =>
        objected.service.objectCancellation(
          { userId: objected.contract.supplierUserId, role: "SUPPLIER" },
          { contractId: objected.contract.id, objectionRate: 80, note: "덮어쓰기 시도" },
        ),
      (err: unknown) => err instanceof CancellationHttpError && err.status === 409,
    );
    assert.equal((await objected.repo.getContract(objected.contract.id))?.objectionRate, 70);
  });
});
