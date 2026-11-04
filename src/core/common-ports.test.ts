import { describe, expect, it } from "@jest/globals";
import { mutableClock, systemClock } from "./clock.ts";
import { loadCoreConfig } from "./config.ts";
import { withTransaction, type TransactionHost } from "./transaction.ts";

describe("A-00 공통 Port 제안", () => {
  it("시간 경계 테스트를 위한 가변 시계를 제공한다", () => {
    const clock = mutableClock(new Date("2026-11-04T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-11-04T00:00:00.000Z");

    clock.advance(30 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-11-04T00:30:00.000Z");

    clock.set(new Date("2026-12-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-12-01T00:00:00.000Z");

    expect(Math.abs(systemClock().now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("런타임 환경 설정을 검증한다", () => {
    const base = {
      DATABASE_URL: "postgresql://tester@localhost:5432/majayong_a00_test",
      TOKEN_SECRET: "x".repeat(32),
    };

    const expected = { databaseUrl: base.DATABASE_URL, tokenSecret: base.TOKEN_SECRET };
    expect(loadCoreConfig({ ...base, PORT: "4000" })).toEqual({ ...expected, port: 4000 });
    expect(loadCoreConfig(base)).toEqual({ ...expected, port: 3000 });

    expect(() => loadCoreConfig({ TOKEN_SECRET: base.TOKEN_SECRET })).toThrow();
    expect(() => loadCoreConfig({ ...base, TOKEN_SECRET: "short" })).toThrow();
    expect(() => loadCoreConfig({ ...base, PORT: "abc" })).toThrow();
    expect(() => loadCoreConfig({ ...base, PORT: "70000" })).toThrow();
  });

  it("콜백에 타입이 지정된 트랜잭션 핸들과 상관관계 ID를 전달한다", async () => {
    const host: TransactionHost<string> = {
      async $transaction<Result>(run: (tx: string) => Promise<Result>): Promise<Result> {
        return run("tx-handle");
      },
    };
    const seen: string[] = [];

    const result = await withTransaction(host, "req-1", async context => {
      seen.push(context.correlationId);
      seen.push(context.tx);
      return 7;
    });

    expect(result).toBe(7);
    expect(seen).toEqual(["req-1", "tx-handle"]);
  });
});
