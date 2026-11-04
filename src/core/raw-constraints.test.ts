import { afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "./test-database.ts";
import { withA00Fixture } from "../test-support/a00.ts";

process.env.DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL);

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;

async function expectPgViolation(tx: Tx, sql: () => Promise<unknown>, code: "23505" | "23514") {
  await tx.$executeRawUnsafe("SAVEPOINT expected_constraint_violation");
  try {
    await sql();
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expected_constraint_violation");
    const pgCode = error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta?.code
      : undefined;
    expect(pgCode).toBe(code);
    return;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expected_constraint_violation");
  throw new Error(`Expected PostgreSQL constraint violation ${code}`);
}

afterAll(async () => prisma.$disconnect());

describe("v0.7 raw PostgreSQL constraints", () => {
  it("DB-01 permits only one accepted application per project", async () => withA00Fixture(prisma, async (tx, f) => {
    const otherId = randomUUID();
    await tx.$executeRaw`INSERT INTO applications
      (id, "projectId", "supplierId", "specVersionNo", "totalAmount", "durationDays", "firstViewedAt", status)
      VALUES (${otherId}, ${f.projectId}, ${f.otherSupplierId}, 1, 100, 1, now(), 'ACCEPTED')`;
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE applications SET status = 'ACCEPTED' WHERE id = ${f.applicationId}`, "23505");
  }));

  it("DB-02 permits only one active application per project and supplier", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`INSERT INTO applications
      (id, "projectId", "supplierId", "revisionNo", "specVersionNo", "totalAmount", "durationDays", "firstViewedAt", status)
      VALUES (${randomUUID()}, ${f.projectId}, ${f.supplierId}, 2, 1, 100, 1, now(), 'ACCEPTED')`, "23505");
  }));

  it("DB-03 rejects a recruitment start after its deadline", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE projects
      SET "recruitStartAt" = now() + interval '2 days', deadline = now() + interval '1 day'
      WHERE id = ${f.projectId}`, "23514");
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE projects
      SET "recruitStartAt" = now() + interval '1 day', deadline = now() + interval '1 day'
      WHERE id = ${f.projectId}`, "23514");
  }));

  it("DB-04 rejects callback events without a deduplication key", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`INSERT INTO payment_events (id, "depositId", "eventType")
      VALUES (${randomUUID()}, ${f.depositId}, 'CALLBACK_RECEIVED')`, "23514");
  }));

  it("DB-05 allows only one open deposit per contract", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`INSERT INTO escrow_deposits
      (id, "contractId", principal, "clientFee", amount, "idempotencyKey", status)
      VALUES (${randomUUID()}, ${f.contractId}, 100, 5, 105, ${randomUUID()}, 'HELD')`, "23505");
  }));

  it("DB-06 enforces the compensation rate range and client minimum", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE contracts
      SET "cancelCause" = 'CLIENT', "compensationRate" = 49 WHERE id = ${f.contractId}`, "23514");
  }));

  it("DB-07 rejects an interim ratio outside 10 through 90", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE contracts SET "interimRatio" = 9 WHERE id = ${f.contractId}`, "23514");
  }));

  it("DB-08 rejects a block merged into itself", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE block_catalog SET "mergedIntoId" = id WHERE id = ${f.blockId}`, "23514");
  }));

  it("DB-09 enforces review ratings from 1 through 5", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`INSERT INTO reviews
      (id, "contractId", "reviewerId", "revieweeId", "reviewerRole", rating)
      VALUES (${randomUUID()}, ${f.contractId}, ${f.reviewerId}, ${f.targetId}, 'CLIENT', 0)`, "23514");
  }));

  it("DB-10 prevents duplicate open reports by the same reporter", async () => withA00Fixture(prisma, async (tx, f) => {
    await expectPgViolation(tx, () => tx.$executeRaw`INSERT INTO reports
      (id, "messageId", "reporterId", "targetUserId", reason)
      VALUES (${randomUUID()}, ${f.messageId}, ${f.reporterId}, ${f.targetId}, 'OTHER')`, "23505");
  }));

  it("DB-03, DB-06, DB-07, and DB-09 accept their documented boundaries", async () => withA00Fixture(prisma, async (tx, f) => {
    await tx.$executeRaw`UPDATE projects SET "recruitStartAt" = now() + interval '1 day' - interval '1 millisecond',
      deadline = now() + interval '1 day' WHERE id = ${f.projectId}`;
    await tx.$executeRaw`UPDATE contracts SET "cancelCause" = 'CLIENT', "compensationRate" = 50,
      "interimRatio" = 10 WHERE id = ${f.contractId}`;
    await tx.$executeRaw`UPDATE contracts SET "compensationRate" = 100, "interimRatio" = 90
      WHERE id = ${f.contractId}`;
    await tx.$executeRaw`INSERT INTO reviews
      (id, "contractId", "reviewerId", "revieweeId", "reviewerRole", rating)
      VALUES (${randomUUID()}, ${f.contractId}, ${f.reviewerId}, ${f.targetId}, 'CLIENT', 1)`;
    await tx.$executeRaw`INSERT INTO reviews
      (id, "contractId", "reviewerId", "revieweeId", "reviewerRole", rating)
      VALUES (${randomUUID()}, ${f.contractId}, ${f.reporterId}, ${f.targetId}, 'CLIENT', 5)`;
    await expectPgViolation(tx, () => tx.$executeRaw`UPDATE contracts
      SET "compensationRate" = 101 WHERE id = ${f.contractId}`, "23514");
  }));
});
