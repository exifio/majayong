import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdapterMissingError,
  ClockPolicyBlockedError,
  DecisionBlockedError,
  MoneyError,
  PortError,
  addBusinessDays,
  approvalGate,
  assertCompensationRate,
  blocksDepositDeadlineCancel,
  calculateCancelSettlement,
  calculateClientDeposit,
  calculateSupplierRelease,
  canOpenDeposit,
  clientFullRefundStorage,
  competingRejectOnSign,
  createMemoryAccounts,
  createMemoryContractPorts,
  createMemoryNotifications,
  createMockPayout,
  createMockStorage,
  createMockToss,
  fixedClock,
  isInspectionBasis,
  onDepositCompleted,
  requireExternalAdapters,
  splitInstallments,
} from "../../src/modules/settlement/policy.ts";

describe("C-00", () => {
  it("C-00-T01 합의금 1,000,000원의 의뢰인 수수료와 예치액", () => {
    assert.deepEqual(calculateClientDeposit(1_000_000), {
      principal: 1_000_000,
      clientFee: 50_000,
      depositAmount: 1_050_000,
    });
    assert.deepEqual(calculateClientDeposit(3_100_000), {
      principal: 3_100_000,
      clientFee: 155_000,
      depositAmount: 3_255_000,
    });
  });

  it("C-00-T02 중간 비율 10/50/90과 최종 잔여액", () => {
    assert.deepEqual(splitInstallments(1_000_001, 10), { interimAmount: 100_000, finalAmount: 900_001 });
    assert.deepEqual(splitInstallments(1_000_001, 50), { interimAmount: 500_000, finalAmount: 500_001 });
    assert.deepEqual(splitInstallments(1_000_001, 90), { interimAmount: 900_000, finalAmount: 100_001 });
    const even = splitInstallments(3_100_000, 50);
    assert.deepEqual(even, { interimAmount: 1_550_000, finalAmount: 1_550_000 });
    assert.equal(even.interimAmount + even.finalAmount, 3_100_000);
    assert.throws(() => splitInstallments(1_000_000, 9), MoneyError);
    assert.throws(() => splitInstallments(1_000_000, 91), MoneyError);
  });

  it("C-00-T03 0·음수·소수·Int 초과를 거부", () => {
    assert.throws(() => calculateClientDeposit(0), MoneyError);
    assert.throws(() => calculateClientDeposit(-1), MoneyError);
    assert.throws(() => calculateClientDeposit(0.5), MoneyError);
    assert.throws(() => calculateClientDeposit(2_147_483_648), MoneyError);
    assert.throws(() => calculateSupplierRelease({ amount: 0, kind: "INDIVIDUAL" }), MoneyError);
    assert.throws(() => calculateSupplierRelease({ amount: -1, kind: "BUSINESS" }), MoneyError);
    assert.throws(() => calculateSupplierRelease({ amount: 0.5, kind: "BUSINESS" }), MoneyError);
    assert.throws(() => calculateSupplierRelease({ amount: 2_147_483_648, kind: "BUSINESS" }), MoneyError);
    assert.throws(() => calculateClientDeposit(2_100_000_000), MoneyError);
  });

  it("C-00-T04 수수료와 원천징수를 금액에서 각각 원 단위로 내림", () => {
    assert.deepEqual(calculateSupplierRelease({ amount: 1_550_000, kind: "INDIVIDUAL" }), {
      supplierFee: 77_500,
      withholdingTax: 51_150,
      releaseAmount: 1_421_350,
    });
    assert.deepEqual(calculateSupplierRelease({ amount: 1_550_000, kind: "BUSINESS" }), {
      supplierFee: 77_500,
      withholdingTax: 0,
      releaseAmount: 1_472_500,
    });
    assert.deepEqual(calculateSupplierRelease({ amount: 16, kind: "INDIVIDUAL" }), {
      supplierFee: 0,
      withholdingTax: 0,
      releaseAmount: 16,
    });
    assert.deepEqual(calculateSupplierRelease({ amount: 1_000, kind: "INDIVIDUAL" }), {
      supplierFee: 50,
      withholdingTax: 33,
      releaseAmount: 917,
    });
  });

  it("C-00-T05 어댑터가 없으면 실 API를 호출하지 않음", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
      calls.push(String(input));
      return Promise.reject(new Error("real network"));
    };
    try {
      assert.throws(() => requireExternalAdapters(undefined), AdapterMissingError);
      assert.throws(() => requireExternalAdapters({}), AdapterMissingError);
      const ready = requireExternalAdapters({
        toss: createMockToss(),
        storage: createMockStorage(),
        payout: createMockPayout(),
      });
      assert.deepEqual(await ready.toss.readPayment("order-1"), { status: "UNKNOWN" });
      assert.deepEqual(await ready.storage.signRead("obj"), { url: "mock:obj", expiresInSec: 60 });
      assert.deepEqual(await ready.payout.check("supplier-1"), { verified: false, mode: "MOCK" });
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("취소 예시 수식과 보상 비율 CHECK, 24시간 저장은 D-16", () => {
    assert.deepEqual(
      calculateCancelSettlement({
        principal: 3_100_000,
        clientFee: 155_000,
        compensationPrincipal: 775_000,
      }),
      {
        supplierFee: 38_750,
        clientFeeKept: 38_750,
        clientFeeRefund: 116_250,
        refundAmount: 2_441_250,
        settledAmount: 736_250,
      },
    );
    assert.throws(() => assertCompensationRate("CLIENT", 0), MoneyError);
    assert.throws(() => assertCompensationRate("CLIENT", 49), MoneyError);
    assert.doesNotThrow(() => assertCompensationRate("CLIENT", 50));
    assert.doesNotThrow(() => assertCompensationRate("CLIENT", 100));
    assert.throws(() => assertCompensationRate("MUTUAL", 101), MoneyError);
    assert.doesNotThrow(() => assertCompensationRate("MUTUAL", 0));
    assert.throws(() => clientFullRefundStorage(), DecisionBlockedError);
  });

  it("서명에는 타 지원을 거절하지 않고 예치 완료에만 거절", () => {
    assert.equal(competingRejectOnSign(), false);
    assert.equal(canOpenDeposit("ACTIVE", "PENDING"), true);
    assert.equal(canOpenDeposit("PENDING_CONSENT", "PENDING"), false);
    assert.equal(canOpenDeposit("ACTIVE", "DEPOSITED"), false);
    assert.deepEqual(onDepositCompleted(), {
      contractStatus: "ACTIVE",
      paymentStatus: "DEPOSITED",
      depositStatus: "COMPLETED",
      rejectCompetingApplications: true,
    });
    assert.equal(blocksDepositDeadlineCancel("PENDING"), true);
    assert.equal(blocksDepositDeadlineCancel("HELD"), true);
    assert.equal(blocksDepositDeadlineCancel(null), false);
    assert.equal(approvalGate(false, true), "NOT_APPROVED");
    assert.equal(approvalGate(true, false), "HOLD_APPROVED");
    assert.equal(approvalGate(true, true), "READY_TO_RELEASE");
    assert.equal(isInspectionBasis("DECIDED"), true);
    assert.equal(isInspectionBasis("PROPOSED"), false);
    assert.equal(isInspectionBasis("UNDECIDED"), false);
  });

  it("Clock은 주입 시각만 반환하고 일수 가산은 D-02", () => {
    const clock = fixedClock(Date.parse("2026-11-04T05:20:00.000Z"));
    const at = clock.now();
    assert.equal(at.toISOString(), "2026-11-04T05:20:00.000Z");
    assert.equal(clock.now().toISOString(), at.toISOString());
    assert.throws(() => addBusinessDays(), ClockPolicyBlockedError);
  });

  it("Contract·Account·Notification 포트 실패 의미", async () => {
    const ports = createMemoryContractPorts([
      {
        id: "signed",
        status: "PENDING_CONSENT",
        paymentStatus: "PENDING",
        agreedAmount: 1_000_000,
        clientFee: 50_000,
        interimRatio: 50,
        durationDays: 42,
      },
      {
        id: "open",
        status: "ACTIVE",
        paymentStatus: "PENDING",
        agreedAmount: 1_000_000,
        clientFee: 50_000,
        interimRatio: 50,
        durationDays: 42,
      },
    ]);
    await assert.rejects(() => ports.getDepositable("missing"), (error: unknown) => {
      assert.ok(error instanceof PortError);
      assert.equal(error.code, "NOT_FOUND");
      return true;
    });
    await assert.rejects(() => ports.getDepositable("signed"), (error: unknown) => {
      assert.ok(error instanceof PortError);
      assert.equal(error.code, "CONFLICT");
      return true;
    });
    const open = await ports.getDepositable("open");
    assert.equal(open.id, "open");

    const accounts = createMemoryAccounts({ held: false, ready: true }, { held: false, ready: false });
    assert.equal(await accounts.requireVerifiedPayoutAccount("held"), false);
    assert.equal(await accounts.requireVerifiedPayoutAccount("ready"), true);
    assert.equal(await accounts.isSuspended("ready"), false);
    await assert.rejects(() => accounts.requireVerifiedPayoutAccount("missing"), (error: unknown) => {
      assert.ok(error instanceof PortError);
      assert.equal(error.code, "UNAVAILABLE");
      return true;
    });

    const notifications = createMemoryNotifications();
    assert.deepEqual(
      await notifications.createOnce({ userId: "u", type: "DEPOSIT_DUE", targetId: "c", targetUrl: "/a" }),
      { created: true },
    );
    assert.deepEqual(
      await notifications.createOnce({ userId: "u", type: "DEPOSIT_DUE", targetId: "c", targetUrl: "/b" }),
      { created: false },
    );
    assert.deepEqual(
      await notifications.createOnce({ userId: "u", type: "DEPOSIT_DUE", targetId: "other", targetUrl: "/a" }),
      { created: true },
    );
  });
});
