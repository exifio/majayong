import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DepositCompletionService,
  calculateWorkDueAt,
  createInMemoryDepositRepository,
  type DepositContractInfo,
} from "../../src/modules/deposit/index.ts";

describe("C-02: 예치 확정·2구간 생성·보류 지원 처리", () => {
  const depositTime = new Date("2026-11-04T05:20:00.000Z"); // 14:20 KST

  function createTestSetup() {
    const repo = createInMemoryDepositRepository();

    const contract: DepositContractInfo & {
      projectId: string;
      applicationId: string;
      durationDays: number;
      interimRatio: number;
      totalDeposited: number;
      workDueAt: Date | null;
    } = {
      id: "contract-c02",
      projectId: "proj-100",
      applicationId: "app-accepted-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE",
      paymentStatus: "PENDING",
      agreedAmount: 3_100_000,
      clientFee: 155_000,
      interimRatio: 50,
      durationDays: 42,
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
      totalDeposited: 0,
      workDueAt: null,
    };

    let competingRejectedCount = 0;
    const marketplacePort = {
      async autoRejectCompetingApplications(input: { projectId: string; acceptedApplicationId: string }) {
        if (input.projectId === contract.projectId && input.acceptedApplicationId === contract.applicationId) {
          competingRejectedCount += 2; // 2건의 다른 보류 지원 거절
          return { rejectedCount: 2 };
        }
        return { rejectedCount: 0 };
      },
    };

    const contractsPort = {
      async getContract(id: string) {
        if (id === contract.id) return contract;
        return null;
      },
      async updateContract(id: string, patch: Partial<typeof contract>) {
        if (id === contract.id) {
          Object.assign(contract, patch);
          return contract;
        }
        throw new Error("Contract not found");
      },
    };

    const completionService = new DepositCompletionService({
      repo,
      contractsPort,
      marketplacePort,
      clock: { now: () => depositTime },
    });

    return { repo, contract, marketplacePort, getCompetingRejected: () => competingRejectedCount, completionService };
  }

  it("C-02-T01 서명 후 보류 유지", async () => {
    const { contract, getCompetingRejected } = createTestSetup();
    // 서명 완료 시점(ACTIVE, paymentStatus=PENDING)에는 타 지원을 거절하지 않음
    assert.equal(contract.status, "ACTIVE");
    assert.equal(contract.paymentStatus, "PENDING");
    assert.equal(getCompetingRejected(), 0);
  });

  it("C-02-T02 예치 완료 후 타 지원만 거절", async () => {
    const { repo, contract, completionService, getCompetingRejected } = createTestSetup();

    const deposit = await repo.createDeposit({
      contractId: contract.id,
      principal: contract.agreedAmount,
      clientFee: contract.clientFee,
      amount: contract.agreedAmount + contract.clientFee,
      method: "CARD",
      status: "PENDING",
      idempotencyKey: "idem-c02-t02",
      pgKey: "pg-key-1",
      depositedAt: null,
    });

    const result = await completionService.completeDeposit({
      depositId: deposit.id,
      pgKey: "toss-pk-confirmed",
    });

    assert.equal(result.deposit.status, "COMPLETED");
    assert.equal(result.contract.paymentStatus, "DEPOSITED");
    assert.equal(result.contract.totalDeposited, 3_255_000);
    // 타 지원 2건이 예치 완료 트랜잭션에서 자동 거절됨
    assert.equal(getCompetingRejected(), 2);
  });

  it("C-02-T03 원자성 중단 시 PG/구간/지원 변경 모두 롤백", async () => {
    const { repo, contract } = createTestSetup();

    const failingMarketplacePort = {
      async autoRejectCompetingApplications() {
        throw new Error("DB_TRANSACTION_DEADLOCK");
      },
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

    const completionService = new DepositCompletionService({
      repo,
      contractsPort,
      marketplacePort: failingMarketplacePort,
      clock: { now: () => depositTime },
    });

    const deposit = await repo.createDeposit({
      contractId: contract.id,
      principal: contract.agreedAmount,
      clientFee: contract.clientFee,
      amount: contract.agreedAmount + contract.clientFee,
      method: "CARD",
      status: "PENDING",
      idempotencyKey: "idem-c02-rollback",
      pgKey: "pg-key-rb",
      depositedAt: null,
    });

    await assert.rejects(
      () => completionService.completeDeposit({ depositId: deposit.id, pgKey: "toss-pk-rb" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /DB_TRANSACTION_DEADLOCK/);
        return true;
      },
    );

    // 원자성 롤백 검증: deposit은 COMPLETED가 되지 않고 PENDING으로 유지
    const checkDeposit = await repo.findById(deposit.id);
    assert.ok(checkDeposit);
    assert.equal(checkDeposit.status, "PENDING");
    assert.equal(checkDeposit.depositedAt, null);

    // 계약 상태 롤백 검증
    assert.equal(contract.paymentStatus, "PENDING");
    assert.equal(contract.totalDeposited, 0);

    // 생성된 구간 0건 검증
    const installments = await repo.listInstallments(contract.id);
    assert.equal(installments.length, 0);
  });

  it("C-02-T04 구간 정확히 2행/재시도 중복 0", async () => {
    const { repo, contract, completionService } = createTestSetup();

    const deposit = await repo.createDeposit({
      contractId: contract.id,
      principal: 3_100_000,
      clientFee: 155_000,
      amount: 3_255_000,
      method: "CARD",
      status: "PENDING",
      idempotencyKey: "idem-c02-t04",
      pgKey: "pg-t04",
      depositedAt: null,
    });

    // 1회차 완료
    const res1 = await completionService.completeDeposit({ depositId: deposit.id, pgKey: "pk-1" });
    // 2회차 재시도 (멱등 재실행)
    const res2 = await completionService.completeDeposit({ depositId: deposit.id, pgKey: "pk-1" });

    assert.equal(res1.deposit.status, "COMPLETED");
    assert.equal(res2.deposit.status, "COMPLETED");

    const installments = await repo.listInstallments(contract.id);
    // 정확히 2행이어야 함 (INTERIM, FINAL)
    assert.equal(installments.length, 2);

    const interim = installments.find((i) => i.stage === "INTERIM");
    const finalInst = installments.find((i) => i.stage === "FINAL");

    assert.ok(interim);
    assert.ok(finalInst);

    // 3,100,000원의 50:50 분할
    assert.equal(interim.amount, 1_550_000);
    assert.equal(interim.supplierFee, 77_500);
    assert.equal(interim.releaseAmount, 1_472_500);
    assert.equal(interim.status, "PENDING");

    assert.equal(finalInst.amount, 1_550_000);
    assert.equal(finalInst.supplierFee, 77_500);
    assert.equal(finalInst.releaseAmount, 1_472_500);
    assert.equal(finalInst.status, "PENDING");
  });

  it("C-02-T05 PENDING/HELD 자동 결렬 0", async () => {
    const { repo, contract, completionService } = createTestSetup();

    // 기한이 지났으나 예치가 PENDING 상태인 경우
    await repo.createDeposit({
      contractId: contract.id,
      principal: contract.agreedAmount,
      clientFee: contract.clientFee,
      amount: 3_255_000,
      method: "CARD",
      status: "PENDING",
      idempotencyKey: "idem-pending-batch",
      pgKey: null,
      depositedAt: null,
    });

    // 기한 지난 시점으로 검사
    const checkTime = new Date("2026-11-08T00:00:00.000Z");
    const batchResult = await completionService.evaluateDepositDeadline(contract.id, checkTime);

    // PENDING 입금 시도가 있으므로 자동 결렬하지 않고 운영자 확인으로 보류
    assert.equal(batchResult.action, "HOLD_FOR_OPERATOR_REVIEW");
    assert.equal(contract.status, "ACTIVE");
  });

  it("C-02-T06 기한 종료와 예치 성공 동시 충돌", async () => {
    const { repo, contract, completionService } = createTestSetup();

    const deposit = await repo.createDeposit({
      contractId: contract.id,
      principal: contract.agreedAmount,
      clientFee: contract.clientFee,
      amount: 3_255_000,
      method: "CARD",
      status: "PENDING",
      idempotencyKey: "idem-race",
      pgKey: null,
      depositedAt: null,
    });

    // 동시에 기한 종료 검사와 예치 성공 콜백이 들어왔을 때, PENDING 입금이 있으면 예치 확정 우선
    const completionPromise = completionService.completeDeposit({ depositId: deposit.id, pgKey: "pk-race" });
    const batchResult = await completionService.evaluateDepositDeadline(contract.id, new Date("2026-11-08T00:00:00.000Z"));

    assert.equal(batchResult.action, "HOLD_FOR_OPERATOR_REVIEW");
    const completed = await completionPromise;
    assert.equal(completed.deposit.status, "COMPLETED");
    assert.equal(contract.paymentStatus, "DEPOSITED");
  });

  it("C-02-T07 workDueAt 예치 다음 날 기준", () => {
    // PRD §9.6 시연 데이터: 11월 4일 14:20 예치, 기간 42일 -> 작업 마감 12월 16일
    const depositedAt = new Date("2026-11-04T05:20:00.000Z"); // 14:20 KST
    const workDueAt = calculateWorkDueAt(depositedAt, 42);

    assert.equal(workDueAt.toISOString(), "2026-12-16T14:59:59.999Z");
  });
});
