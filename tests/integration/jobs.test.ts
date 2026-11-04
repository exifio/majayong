import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDueJobRunner, startDueJobScheduler } from "../../src/jobs/index.ts";

describe("INT-C-04: 배치 러너·스케줄러", () => {
  const t0 = new Date("2026-11-04T05:20:00.000Z");

  function services(options?: { failOnce?: boolean }) {
    let attempts = 0;
    let autoApproved = 0;
    return {
      get attempts() {
        return attempts;
      },
      get autoApproved() {
        return autoApproved;
      },
      batchService: {
        async processAutoApproval() {
          return { autoApprovedCount: autoApproved };
        },
        async sendDueNotifications() {},
      },
      completionService: {
        async expireDepositIfDue() {
          attempts += 1;
          if (options?.failOnce && attempts === 1) throw new Error("TRANSIENT");
          autoApproved = 1;
          return { expired: true };
        },
      },
      cancellationService: {
        async checkCancellationDeadlines() {
          return { escalatedToAdmin: false };
        },
      },
    };
  }

  it("targets로 대상을 조회하고 일시 실패를 재시도한다", async () => {
    const target = services({ failOnce: true });
    const runner = createDueJobRunner({
      services: target,
      targets: {
        async depositContractIds() {
          return ["contract-1"];
        },
      },
      retries: 1,
      clock: { now: () => t0 },
    });

    const result = await runner.runOnce();
    assert.equal(result.success, true);
    assert.equal(result.actionsCount, 1);
    assert.equal(target.attempts, 2);
  });

  it("실패는 결과에 남기고 스케줄러는 예외를 onError로 넘긴다", async () => {
    const errors: unknown[] = [];
    const runner = createDueJobRunner({
      services: {
        completionService: {
          async expireDepositIfDue() {
            throw new Error("PERSISTENT");
          },
        },
      },
      targets: {
        async depositContractIds() {
          return ["contract-fail"];
        },
      },
      retries: 0,
    });

    const result = await runner.runOnce(t0);
    assert.equal(result.success, false);
    assert.equal(result.failures[0].job, "DEPOSIT_DEADLINE");

    // 스케줄러는 runOnce 거부를 삼키지 않고 onError로 전달한다.
    const timer: { handler: (() => void) | null } = { handler: null };
    const stop = startDueJobScheduler(
      {
        async runOnce() {
          throw new Error("SCHEDULER_FAIL");
        },
      },
      {
        timers: {
          setInterval(fn) {
            timer.handler = fn;
            return 1;
          },
          clearInterval() {},
        },
        onError(err) {
          errors.push(err);
        },
      },
    );
    assert.ok(timer.handler);
    timer.handler!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((errors[0] as Error).message, "SCHEDULER_FAIL");
    stop();
  });

  it("60초 반복 틱은 이전 실행이 끝나기 전에 겹치지 않는다", async () => {
    const timer: { handler: (() => void) | null } = { handler: null };
    let runs = 0;
    let release: (() => void) | null = null;
    const stop = startDueJobScheduler(
      {
        async runOnce() {
          runs += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { success: true, actionsCount: 0, failures: [] };
        },
      },
      {
        intervalMs: 60_000,
        timers: {
          setInterval(fn) {
            timer.handler = fn;
            return 1;
          },
          clearInterval() {},
        },
      },
    );

    timer.handler!();
    timer.handler!();
    assert.equal(runs, 1); // 이전 실행 중에는 겹치지 않음
    release!();
    await new Promise((resolve) => setImmediate(resolve));
    timer.handler!();
    assert.equal(runs, 2);
    stop();
  });
});
