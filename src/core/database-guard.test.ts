import { describe, expect, it } from "@jest/globals";
import { assertTestDatabase } from "./test-database.ts";

describe("A-00 테스트 DB 격리", () => {
  it("전용 로컬 테스트 DB를 허용하고 그대로 반환한다", () => {
    expect(assertTestDatabase("postgresql://tester@localhost:5432/majayong_a00_test"))
      .toBe("postgresql://tester@localhost:5432/majayong_a00_test");
    expect(() => assertTestDatabase("postgresql://tester@127.0.0.1:5432/majayong_a00_test")).not.toThrow();
    expect(() => assertTestDatabase("postgresql://tester@[::1]:5432/majayong_a00_test")).not.toThrow();
    expect(() => assertTestDatabase("postgresql://tester@localhost:5432/majayong_gate2_check")).not.toThrow();
  });

  it("테스트 DB URL이 없거나 비어 있으면 거부한다", () => {
    expect(() => assertTestDatabase(undefined)).toThrow();
    expect(() => assertTestDatabase("")).toThrow();
    expect(() => assertTestDatabase("   ")).toThrow();
  });

  it("운영·원격 DB는 거부한다", () => {
    expect(() => assertTestDatabase("not a url")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@localhost:5432/majayong")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@db.example.com:5432/majayong_a00_test")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@10.0.0.5:5432/majayong_a00_test")).toThrow();
  });
});
