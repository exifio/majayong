import { BlockSource } from "@prisma/client";
import { describe, expect, it } from "@jest/globals";
import { reservationRestaurantSeedBlocks } from "./seed.ts";

describe("A-03 proposed restaurant reservation seed", () => {
  it("has 36 ranked active reviewed blocks, six defaults, and validated catalog shapes", () => {
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
