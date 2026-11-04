import { describe, expect, it } from "@jest/globals";
import { calculatePriceEstimate } from "./policy.ts";

describe("A-05-T01 price estimate", () => {
  it("sums only included snapshot prices and floors the client fee to whole won", () => {
    expect(calculatePriceEstimate([
      { blockId: "b1", name: "달력", status: "ADDED", unitPrice: 1, priceBasis: "작업 1" },
      { blockId: "b2", name: "결제", status: "ADDED", unitPrice: 19, priceBasis: "작업 2" },
      { blockId: "b3", name: "알림", status: "ADDED", unitPrice: 20, priceBasis: "작업 3" },
      { blockId: "b4", name: "삭제된 기능", status: "REMOVED", unitPrice: 500, priceBasis: "제외" },
    ], 2)).toEqual({
      subtotal: 40,
      clientFee: 2,
      estimatedTotal: 42,
      pendingFeatureCount: 2,
      items: [
        { blockId: "b1", name: "달력", status: "ADDED", unitPrice: 1, priceBasis: "작업 1", includedInEstimate: true, sharePercent: 2.5 },
        { blockId: "b2", name: "결제", status: "ADDED", unitPrice: 19, priceBasis: "작업 2", includedInEstimate: true, sharePercent: 47.5 },
        { blockId: "b3", name: "알림", status: "ADDED", unitPrice: 20, priceBasis: "작업 3", includedInEstimate: true, sharePercent: 50 },
        { blockId: "b4", name: "삭제된 기능", status: "REMOVED", unitPrice: 500, priceBasis: "제외", includedInEstimate: false, sharePercent: 0 },
      ],
    });
  });

  it("preserves zero and handles a one-won fee boundary", () => {
    const zero = calculatePriceEstimate([
      { blockId: "zero", name: "무료", status: "ADDED", unitPrice: 0, priceBasis: "무료" },
    ], 0);
    expect(zero).toMatchObject({ subtotal: 0, clientFee: 0, estimatedTotal: 0, pendingFeatureCount: 0 });
    expect(zero.items[0]?.sharePercent).toBe(0);

    expect(calculatePriceEstimate([
      { blockId: "nineteen", name: "19원", status: "ADDED", unitPrice: 19, priceBasis: "19" },
    ], 0)).toMatchObject({ subtotal: 19, clientFee: 0, estimatedTotal: 19 });
    expect(calculatePriceEstimate([
      { blockId: "twenty", name: "20원", status: "ADDED", unitPrice: 20, priceBasis: "20" },
    ], 0)).toMatchObject({ subtotal: 20, clientFee: 1, estimatedTotal: 21 });
  });

  it("rejects invalid snapshot money and an estimate outside the schema Int range", () => {
    expect(() => calculatePriceEstimate([
      { blockId: "negative", name: "잘못된 단가", status: "ADDED", unitPrice: -1, priceBasis: "" },
    ], 0)).toThrow(RangeError);
    expect(() => calculatePriceEstimate([
      { blockId: "overflow", name: "초과 단가", status: "ADDED", unitPrice: 2_147_483_647, priceBasis: "" },
    ], 0)).toThrow(RangeError);
  });
});
