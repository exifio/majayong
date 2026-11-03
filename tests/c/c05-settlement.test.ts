import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SettlementService,
  SettlementHttpError,
  createInMemorySettlementRepository,
  type SettlementContractInfo,
} from "../../src/modules/settlement/policy.ts";

describe("C-05: 지급 구간·정산 카드·세금 증빙", () => {
  const baseTime = new Date("2026-11-20T10:00:00.000Z");

  function createTestSetup(options?: { supplierKind?: "INDIVIDUAL" | "BUSINESS"; payoutVerified?: boolean }) {
    const repo = createInMemorySettlementRepository();

    const supplierKind = options?.supplierKind ?? "INDIVIDUAL";
    const payoutVerified = options?.payoutVerified ?? true;

    const contract: SettlementContractInfo = {
      id: "contract-c05",
      clientUserId: "client-c05",
      supplierUserId: "supplier-c05",
      status: "ACTIVE",
      paymentStatus: "DEPOSITED",
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      totalDeposited: 3_255_000,
      interimRatio: 50,
      supplierKind,
      payoutVerifiedAt: payoutVerified ? new Date("2026-11-01T00:00:00.000Z") : null,
      payoutAccountNo: "110-123-456789", // 민감 계좌번호
    };

    const interimInstallment = {
      id: "inst-interim",
      contractId: contract.id,
      stage: "INTERIM" as const,
      ratio: 50,
      amount: 1_550_000,
      supplierFee: 77_500,
      withholdingTax: 0,
      releaseAmount: 1_472_500,
      status: "PENDING" as const,
      approvedAt: null,
      releasedAt: null,
      taxInvoiceIssuedAt: null,
    };

    const finalInstallment = {
      id: "inst-final",
      contractId: contract.id,
      stage: "FINAL" as const,
      ratio: 50,
      amount: 1_550_000,
      supplierFee: 77_500,
      withholdingTax: 0,
      releaseAmount: 1_472_500,
      status: "PENDING" as const,
      approvedAt: null,
      releasedAt: null,
      taxInvoiceIssuedAt: null,
    };

    const item1 = {
      id: "item-1",
      contractId: contract.id,
      stage: "INTERIM" as const,
      title: "기능 1",
      approvedAt: null,
    };

    const item2 = {
      id: "item-2",
      contractId: contract.id,
      stage: "INTERIM" as const,
      title: "기능 2",
      approvedAt: null,
    };

    const finalItem = {
      id: "item-final",
      contractId: contract.id,
      stage: "FINAL" as const,
      title: "최종 기능",
      approvedAt: null,
    };

    repo.seedContract(contract);
    repo.seedInstallments([interimInstallment, finalInstallment]);
    repo.seedContractItems([item1, item2, finalItem]);

    const service = new SettlementService({
      repo,
      clock: { now: () => baseTime },
    });

    return { repo, contract, interimInstallment, finalInstallment, item1, item2, finalItem, service };
  }

  it("C-05-T01 한 항목 미승인으로 부분지급 차단", async () => {
    const { service, contract, interimInstallment, item1, repo } = createTestSetup();

    // item1만 승인, item2는 아직 미승인
    await repo.updateContractItem(item1.id, { approvedAt: baseTime });

    // 지급 승인 진입 시도 -> 미승인 항목이 있으므로 거부
    await assert.rejects(
      () =>
        service.approveInstallment({
          contractId: contract.id,
          installmentId: interimInstallment.id,
        }),
      (err: unknown) => {
        if (!(err instanceof SettlementHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /모든 계약 항목이 승인/);
        return true;
      },
    );
  });

  it("C-05-T02 계좌 미인증 APPROVED 보류", async () => {
    // 계좌 미인증 상태
    const { service, contract, interimInstallment, item1, item2, repo } = createTestSetup({
      payoutVerified: false,
    });

    // 모든 항목 승인
    await repo.updateContractItem(item1.id, { approvedAt: baseTime });
    await repo.updateContractItem(item2.id, { approvedAt: baseTime });

    const result = await service.approveInstallment({
      contractId: contract.id,
      installmentId: interimInstallment.id,
    });

    // 계좌가 미인증이므로 APPROVED 상태에 머물고 지급(RELEASED)되지 않고 보류됨
    assert.equal(result.status, "APPROVED");
    assert.equal(result.releasedAt, null);
    assert.equal(result.holdReason, "PAYOUT_ACCOUNT_UNVERIFIED");

    // 방출 시도 시 거부
    await assert.rejects(
      () => service.releaseInstallment({ installmentId: interimInstallment.id }),
      (err: unknown) => {
        if (!(err instanceof SettlementHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /정산 계좌가 인증되지 않았습니다/);
        return true;
      },
    );
  });

  it("C-05-T03 개인 3.3% 소수점 원 단위 내림", async () => {
    const { service, contract, interimInstallment, item1, item2, repo } = createTestSetup({
      supplierKind: "INDIVIDUAL",
      payoutVerified: true,
    });

    await repo.updateContractItem(item1.id, { approvedAt: baseTime });
    await repo.updateContractItem(item2.id, { approvedAt: baseTime });

    await service.approveInstallment({
      contractId: contract.id,
      installmentId: interimInstallment.id,
    });

    const released = await service.releaseInstallment({ installmentId: interimInstallment.id });
    assert.equal(released.status, "RELEASED");
    assert.ok(released.releasedAt);

    // 1,550,000원 -> 수수료 77,500원(5%), 원천징수 51,150원(3.3%), 실수령 1,421,350원
    assert.equal(released.amount, 1_550_000);
    assert.equal(released.supplierFee, 77_500);
    assert.equal(released.withholdingTax, 51_150);
    assert.equal(released.releaseAmount, 1_421_350);
  });

  it("C-05-T04 사업자 withholding=0", async () => {
    const { service, contract, interimInstallment, item1, item2, repo } = createTestSetup({
      supplierKind: "BUSINESS",
      payoutVerified: true,
    });

    await repo.updateContractItem(item1.id, { approvedAt: baseTime });
    await repo.updateContractItem(item2.id, { approvedAt: baseTime });

    await service.approveInstallment({
      contractId: contract.id,
      installmentId: interimInstallment.id,
    });

    const released = await service.releaseInstallment({ installmentId: interimInstallment.id });
    assert.equal(released.status, "RELEASED");
    assert.equal(released.withholdingTax, 0);
    assert.equal(released.releaseAmount, 1_472_500);

    // 사업자 공급자가 '세금계산서 발행했어요' 표시
    const marked = await service.markTaxInvoiceIssued(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      { installmentId: interimInstallment.id },
    );
    assert.ok(marked.taxInvoiceIssuedAt);
  });

  it("C-05-T05 구간 합계/끝수 정확", async () => {
    const { service, contract, interimInstallment, finalInstallment, item1, item2, finalItem, repo } = createTestSetup({
      supplierKind: "INDIVIDUAL",
      payoutVerified: true,
    });

    // 1구간 승인 및 방출
    await repo.updateContractItem(item1.id, { approvedAt: baseTime });
    await repo.updateContractItem(item2.id, { approvedAt: baseTime });
    await service.approveInstallment({ contractId: contract.id, installmentId: interimInstallment.id });
    const r1 = await service.releaseInstallment({ installmentId: interimInstallment.id });

    // 2구간(FINAL) 승인 및 방출
    await repo.updateContractItem(finalItem.id, { approvedAt: baseTime });
    await service.approveInstallment({ contractId: contract.id, installmentId: finalInstallment.id });
    const r2 = await service.releaseInstallment({ installmentId: finalInstallment.id });

    // 구간 합계 검증
    assert.equal(r1.amount + r2.amount, contract.agreedAmount);
    assert.equal(r1.supplierFee + r2.supplierFee, 155_000);
    assert.equal(r1.withholdingTax + r2.withholdingTax, 102_300);
    assert.equal(r1.releaseAmount + r2.releaseAmount, 2_842_700);

    // 두 구간 모두 방출 시 계약은 COMPLETED 상태 전이
    const updatedContract = await repo.getContract(contract.id);
    assert.equal(updatedContract?.paymentStatus, "RELEASED");
    assert.equal(updatedContract?.status, "COMPLETED");
  });

  it("C-05-T06 순서 어긋난 최종 구간 지급 금지", async () => {
    const { service, contract, finalInstallment, finalItem, repo } = createTestSetup();

    // 중간 구간(INTERIM)이 아직 RELEASED되지 않았는데 FINAL 구간 지급 시도 -> 400 거부
    await repo.updateContractItem(finalItem.id, { approvedAt: baseTime });

    await assert.rejects(
      () =>
        service.approveInstallment({
          contractId: contract.id,
          installmentId: finalInstallment.id,
        }),
      (err: unknown) => {
        if (!(err instanceof SettlementHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /중간 구간이 먼저 지급되어야 합니다/);
        return true;
      },
    );
  });

  it("C-05-T07 타인 정산 조회/계좌 원문 누출 0", async () => {
    const { service, contract } = createTestSetup();

    // 타인이 정산 카드 조회 시도 -> 403 거부
    await assert.rejects(
      () =>
        service.getContractStatement(
          { userId: "alien-user", role: "CLIENT" },
          contract.id,
        ),
      (err: unknown) => {
        if (!(err instanceof SettlementHttpError)) return false;
        assert.equal(err.status, 403);
        return true;
      },
    );

    // 의뢰인이 조회 시: 상대방 계좌번호 원문이 노출되지 않음
    const clientView = await service.getContractStatement(
      { userId: contract.clientUserId, role: "CLIENT" },
      contract.id,
    );
    assert.equal("payoutAccountNo" in clientView, false);
    assert.equal(clientView.totalDeposited, 3_255_000);

    // 공급자가 조회 시: 본인 정보 확인, 계좌번호는 마스킹되거나 비공개
    const supplierView = await service.getContractStatement(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      contract.id,
    );
    assert.equal("payoutAccountNo" in supplierView, false);
  });

  it("C-05-T08 실제 금융이체 네트워크 호출 0", async () => {
    const { service, contract, interimInstallment, item1, item2, repo } = createTestSetup({
      supplierKind: "INDIVIDUAL",
      payoutVerified: true,
    });

    const calls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      calls.push(String(input));
      return Promise.reject(new Error("REAL_BANK_TRANSFER_BLOCKED"));
    };

    try {
      await repo.updateContractItem(item1.id, { approvedAt: baseTime });
      await repo.updateContractItem(item2.id, { approvedAt: baseTime });

      await service.approveInstallment({
        contractId: contract.id,
        installmentId: interimInstallment.id,
      });

      const released = await service.releaseInstallment({ installmentId: interimInstallment.id });
      assert.equal(released.status, "RELEASED");

      // 실제 외부 금융 이체 네트워크 호출 0건 증명
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
