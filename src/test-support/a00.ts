import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

export type A00Fixture = {
  projectId: string;
  draftId: string;
  clientId: string;
  supplierId: string;
  otherSupplierId: string;
  applicationId: string;
  contractId: string;
  depositId: string;
  blockId: string;
  messageId: string;
  reporterId: string;
  targetId: string;
  reviewerId: string;
};

class RollbackFixture extends Error {}

export async function withA00Fixture(
  db: PrismaClient,
  run: (tx: Prisma.TransactionClient, fixture: A00Fixture) => Promise<void>,
): Promise<void> {
  try {
    await db.$transaction(async tx => {
      const id = () => randomUUID();
      const fixture: A00Fixture = {
        projectId: id(), draftId: id(), clientId: id(), supplierId: id(), otherSupplierId: id(),
        applicationId: id(), contractId: id(), depositId: id(), blockId: id(), messageId: id(),
        reporterId: id(), targetId: id(), reviewerId: id(),
      };
      const users = [
        [fixture.clientId, "CLIENT"], [fixture.supplierId, "SUPPLIER"],
        [fixture.otherSupplierId, "SUPPLIER"], [fixture.reporterId, "CLIENT"],
        [fixture.targetId, "SUPPLIER"], [fixture.reviewerId, "CLIENT"],
      ] as const;
      for (const [userId, role] of users) {
        await tx.$executeRaw`INSERT INTO users (id, email, role, "updatedAt")
          VALUES (${userId}, ${`${userId}@example.invalid`}, ${role}::"Role", now())`;
      }
      for (const userId of [fixture.supplierId, fixture.otherSupplierId]) {
        await tx.$executeRaw`INSERT INTO supplier_profiles ("userId", "displayName")
          VALUES (${userId}, ${`supplier-${userId}`})`;
      }
      await tx.$executeRaw`INSERT INTO drafts (id, "clientId", "entryType")
        VALUES (${fixture.draftId}, ${fixture.clientId}, 'SENTENCE')`;
      await tx.$executeRaw`INSERT INTO projects
        (id, "draftId", "confirmedAt", "disclosureConsentVersion", title, summary, "industryCode")
        VALUES (${fixture.projectId}, ${fixture.draftId}, now(), 'v1', 'fixture', 'fixture', 'TEST')`;
      await tx.$executeRaw`INSERT INTO applications
        (id, "projectId", "supplierId", "specVersionNo", "totalAmount", "durationDays", "firstViewedAt")
        VALUES (${fixture.applicationId}, ${fixture.projectId}, ${fixture.supplierId}, 1, 100, 1, now())`;
      await tx.$executeRaw`INSERT INTO contracts
        (id, "applicationId", "specVersionNo", "agreedAmount", "durationDays", "clientFee", "supplierFee", "consentDeadline", "contentHash")
        VALUES (${fixture.contractId}, ${fixture.applicationId}, 1, 100, 1, 5, 5, now(), 'fixture')`;
      await tx.$executeRaw`INSERT INTO escrow_deposits
        (id, "contractId", principal, "clientFee", amount, "idempotencyKey")
        VALUES (${fixture.depositId}, ${fixture.contractId}, 100, 5, 105, ${id()})`;
      await tx.$executeRaw`INSERT INTO block_catalog
        (id, code, name, "functionSummary", description, "industryCode", "unitPrice", "priceBasis")
        VALUES (${fixture.blockId}, ${`fixture-${fixture.blockId}`}, 'fixture', 'fixture', 'fixture', 'TEST', 1, 'fixture')`;
      await tx.$executeRaw`INSERT INTO application_messages (id, "applicationId", body)
        VALUES (${fixture.messageId}, ${fixture.applicationId}, 'fixture')`;
      await tx.$executeRaw`INSERT INTO reports (id, "messageId", "reporterId", "targetUserId", reason)
        VALUES (${id()}, ${fixture.messageId}, ${fixture.reporterId}, ${fixture.targetId}, 'OTHER')`;
      await run(tx, fixture);
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  }
}
