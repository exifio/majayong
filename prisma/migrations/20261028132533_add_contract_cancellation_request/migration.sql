ALTER TYPE "EventType" ADD VALUE 'CANCELLATION_REQUESTED';

ALTER TABLE "contracts"
  ADD COLUMN "cancelRequestedBy" TEXT,
  ADD COLUMN "cancelRequestedParty" TEXT,
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
