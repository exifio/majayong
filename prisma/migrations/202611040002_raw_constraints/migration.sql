-- raw constraints from docs/sources/schema_v0.7.prisma header (1-10)
CREATE UNIQUE INDEX application_one_accepted
  ON applications("projectId") WHERE status = 'ACCEPTED';
CREATE UNIQUE INDEX application_one_active
  ON applications("projectId","supplierId") WHERE status IN ('SUBMITTED','STALE','ACCEPTED');
ALTER TABLE projects ADD CONSTRAINT recruit_before_deadline
  CHECK ("recruitStartAt" IS NULL OR deadline IS NULL OR "recruitStartAt" < deadline);
ALTER TABLE payment_events ADD CONSTRAINT dedupkey_required_for_callback
  CHECK ("eventType" NOT IN ('CALLBACK_RECEIVED','VERIFIED') OR "dedupKey" IS NOT NULL);
CREATE UNIQUE INDEX deposit_one_open
  ON escrow_deposits("contractId") WHERE status IN ('PENDING','HELD','COMPLETED');
ALTER TABLE contracts ADD CONSTRAINT compensation_rate_floor
  CHECK ("compensationRate" IS NULL OR ("compensationRate" BETWEEN 0 AND 100
         AND ("cancelCause" IS DISTINCT FROM 'CLIENT' OR "compensationRate" >= 50)));
ALTER TABLE contracts ADD CONSTRAINT interim_ratio_range CHECK ("interimRatio" BETWEEN 10 AND 90);
ALTER TABLE block_catalog ADD CONSTRAINT block_not_merged_into_self
  CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> id);
ALTER TABLE reviews ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
CREATE UNIQUE INDEX report_one_open_per_reporter
  ON reports("messageId","reporterId") WHERE status = 'OPEN';
