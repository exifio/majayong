import { afterAll, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/majayong_a00_test") {
  throw new Error("A-01 tests require the dedicated majayong_a00_test database");
}
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient();
afterAll(async () => prisma.$disconnect());

describe("A-01 refresh session schema", () => {
  it("stores hashed rotating refresh-token sessions with family lineage", async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'refresh_sessions'
    `;

    expect(columns.map(({ column_name }) => column_name)).toEqual(expect.arrayContaining([
      "id", "userId", "familyId", "tokenHash", "expiresAt", "revokedAt", "replacedById", "createdAt",
    ]));
  });

  it("enforces unique token hashes and indexed family lookups", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'refresh_sessions'
    `;

    expect(indexes.some(({ indexdef }) => /UNIQUE.*\("tokenHash"\)/i.test(indexdef))).toBe(true);
    expect(indexes.some(({ indexdef }) => /\("familyId", "revokedAt"\)/i.test(indexdef))).toBe(true);
  });
});
