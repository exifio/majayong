import { afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedBlockCatalog } from "./seed.ts";
import { assertTestDatabase } from "./test-database.ts";

process.env.DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL);

const prisma = new PrismaClient();
afterAll(async () => prisma.$disconnect());

describe("A-00 seed safety", () => {
  it("runs twice without duplicate catalog rows or overwriting an existing price", async () => {
    const code = `A00-${randomUUID()}`;
    const seed = {
      code,
      name: "A-00 test block",
      functionSummary: "A deterministic seed test fixture",
      description: "Test only",
      industryCode: "TEST",
      unitPrice: 100,
      priceBasis: "Test fixture",
    };

    try {
      const firstCreated = await seedBlockCatalog(prisma, [seed]);
      const secondCreated = await seedBlockCatalog(prisma, [{ ...seed, unitPrice: 999 }]);
      const rows = await prisma.blockCatalog.findMany({ where: { code } });

      expect(firstCreated).toBe(1);
      expect(secondCreated).toBe(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.unitPrice).toBe(seed.unitPrice);
    } finally {
      await prisma.blockCatalog.deleteMany({ where: { code } });
    }
  });
});
