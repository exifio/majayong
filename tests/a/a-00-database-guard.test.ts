import { describe, expect, it } from "@jest/globals";
import { assertTestDatabase } from "../../src/core/test-database.ts";

describe("A-00 database test isolation", () => {
  it("accepts a dedicated local test database and returns it", () => {
    expect(assertTestDatabase("postgresql://tester@localhost:5432/majayong_a00_test"))
      .toBe("postgresql://tester@localhost:5432/majayong_a00_test");
    expect(() => assertTestDatabase("postgresql://tester@127.0.0.1:5432/majayong_a00_test")).not.toThrow();
    expect(() => assertTestDatabase("postgresql://tester@[::1]:5432/majayong_a00_test")).not.toThrow();
    expect(() => assertTestDatabase("postgresql://tester@localhost:5432/majayong_gate2_check")).not.toThrow();
  });

  it("rejects a missing or empty test database URL", () => {
    expect(() => assertTestDatabase(undefined)).toThrow();
    expect(() => assertTestDatabase("")).toThrow();
    expect(() => assertTestDatabase("   ")).toThrow();
  });

  it("rejects production and remote databases", () => {
    expect(() => assertTestDatabase("not a url")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@localhost:5432/majayong")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@db.example.com:5432/majayong_a00_test")).toThrow();
    expect(() => assertTestDatabase("postgresql://tester@10.0.0.5:5432/majayong_a00_test")).toThrow();
  });
});
