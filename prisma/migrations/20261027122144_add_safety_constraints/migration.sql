-- 1) 프로젝트당 수락된 지원서 최대 1건
CREATE UNIQUE INDEX "application_one_accepted"
  ON "applications"("projectId")
  WHERE "status" = 'ACCEPTED';

-- 2) 프로젝트/공급자별 활성 지원 최대 1건
CREATE UNIQUE INDEX "application_one_active"
  ON "applications"("projectId", "supplierId")
  WHERE "status" IN ('SUBMITTED', 'STALE', 'ACCEPTED');

-- 3) 모집 시작일은 마감일보다 앞선다
ALTER TABLE "projects" ADD CONSTRAINT "recruit_before_deadline"
  CHECK ("recruitStartAt" IS NULL OR "deadline" IS NULL
         OR "recruitStartAt" < "deadline");

-- 4) 결제 콜백 수신/검증 이벤트에는 중복키가 필요하다
ALTER TABLE "payment_events" ADD CONSTRAINT "dedupkey_required_for_callback"
  CHECK ("eventType" NOT IN ('CALLBACK_RECEIVED', 'VERIFIED')
         OR "dedupKey" IS NOT NULL);

-- 5) 계약당 진행/보류/완료 입금 시도 최대 1건 (schema.prisma v0.6.1 확정본 제약)
CREATE UNIQUE INDEX "deposit_one_open"
  ON "escrow_deposits"("contractId")
  WHERE "status" IN ('PENDING', 'HELD', 'COMPLETED');
