import { describe, expect, it } from "@jest/globals";
import { planContract, type AcceptedContext } from "../src/trade/contract.ts";

const accepted: AcceptedContext = {
  application: { id: "app-1", status: "ACCEPTED", specVersionNo: 3, totalAmount: 200_000, durationDays: 14 },
  specItems: [
    { id: "item-a", versionNo: 3, title: "기능 A", description: "중간 작업", status: "INCLUDED", sortOrder: 1 },
    { id: "item-b", versionNo: 3, title: "기능 B", description: "최종 작업", status: "INCLUDED", sortOrder: 2 },
  ],
  appItems: [
    { specItemId: "item-a", isAvailable: true, amount: 100_000 },
    { specItemId: "item-b", isAvailable: true, amount: 100_000 },
  ],
};

describe("계약 스냅샷", () => {
  it("양측이 선택한 구간과 지원서 달력일 소요일수를 보존하고 계약 생성 시 쿠폰을 쓰지 않는다", () => {
    const plan = planContract(accepted, {
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { "item-a": "INTERIM", "item-b": "FINAL" },
    });

    expect(plan.specSnapshot).toMatchObject({
      durationDays: 14,
      included: [
        { specItemId: "item-a", installmentStage: "INTERIM" },
        { specItemId: "item-b", installmentStage: "FINAL" },
      ],
    });
    expect(plan.supplierFee).toBe(10_000);
    expect(plan.installments[0]?.supplierFee).toBe(5_000);
  });

  it("포함 범위의 누락·초과 구간 배정은 거부한다", () => {
    expect(() => planContract(accepted, {
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { "item-a": "INTERIM" },
    })).toThrow();
    expect(() => planContract(accepted, {
      agreedAmount: 200_000,
      installmentStageBySpecItemId: { "item-a": "INTERIM", "item-b": "FINAL", foreign: "FINAL" },
    })).toThrow();
  });
});
