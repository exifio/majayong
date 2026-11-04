import { BlockSource } from "@prisma/client";
import { describe, expect, it } from "@jest/globals";
import { reservationRestaurantSeedBlocks } from "./seed.ts";

describe("A-03 식당 예약 제안 시드", () => {
  it("순위가 있는 활성·검수 블록 36개, 기본 6개, 검증된 카탈로그 형태를 가진다", () => {
    expect(reservationRestaurantSeedBlocks).toHaveLength(36);

    const codes = reservationRestaurantSeedBlocks.map(block => block.code);
    const ranks = reservationRestaurantSeedBlocks.map(block => block.recommendRank);
    expect(new Set(codes).size).toBe(36);
    expect(new Set(ranks).size).toBe(36);
    expect(reservationRestaurantSeedBlocks.filter(block => block.inDefaultDraft)).toHaveLength(6);
    expect(reservationRestaurantSeedBlocks.every(block => block.source === BlockSource.TEAM && block.isActive && block.reviewedAt instanceof Date)).toBe(true);

    const types = new Set<string>();
    for (const block of reservationRestaurantSeedBlocks) {
      expect(block.unitPrice).toEqual(expect.any(Number));
      expect(Number.isSafeInteger(block.unitPrice)).toBe(true);
      expect(Array.isArray(block.conditions) && block.conditions).toHaveLength(2);
      expect(block.priceBasis.split("\n")).toHaveLength(3);
      const wireframe = block.wireframe as { parts?: Array<{ type: string }> };
      for (const part of wireframe.parts ?? []) types.add(part.type);
    }
    expect([...types].sort()).toEqual(["BUTTON", "CALENDAR", "FORM", "LIST", "PREVIEW", "TEXT"]);
  });
});
