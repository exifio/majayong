-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'SUPPLIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "DraftEntryType" AS ENUM ('SENTENCE', 'DEFAULT_DRAFT');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('IN_PROGRESS', 'CONFIRMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "UtteranceKind" AS ENUM ('FIRST_SENTENCE', 'CHAT');

-- CreateEnum
CREATE TYPE "BlockOrigin" AS ENUM ('FIRST_SENTENCE', 'CHAT', 'RECOMMENDATION', 'CONFIRM_QUESTION', 'DEFAULT_DRAFT');

-- CreateEnum
CREATE TYPE "DraftBlockStatus" AS ENUM ('SUGGESTED', 'ADDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SpecItemStatus" AS ENUM ('INCLUDED', 'EXCLUDED', 'NEEDS_CONFIRMATION');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('SCHEDULED', 'RECRUITING', 'ACCEPTED', 'CONTRACTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'STALE', 'ACCEPTED', 'REJECTED', 'AUTO_REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'HELD', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'DEPOSITED', 'PARTIALLY_RELEASED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('REQUESTED', 'CALLBACK_RECEIVED', 'DUPLICATE_BLOCKED', 'AMOUNT_MISMATCH', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "InstallmentStage" AS ENUM ('INTERIM', 'FINAL');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'DELIVERED', 'REWORK_REQUESTED', 'APPROVED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUBMITTED', 'PARTIALLY_APPROVED', 'APPROVED', 'REWORK_REQUESTED');

-- CreateEnum
CREATE TYPE "InspectionReason" AS ENUM ('IN_SPEC', 'NOT_IN_SPEC', 'INTERPRETATION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('OPEN', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_AUTO_REJECTED', 'APPLICATION_REJECTED', 'PROJECT_CLOSED', 'REQUOTE_REQUESTED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SESSION_START', 'SIGNUP_COMPLETED', 'SPACE_SWITCHED', 'DRAFT_INPUT_SUBMITTED', 'DRAFT_RENDERED', 'DRAFT_RESUMED', 'DRAFT_ABANDONED', 'LLM_CALLED', 'RECOMMENDATION_ADDED', 'BLOCK_REMOVED', 'CHAT_SUBMITTED', 'QUESTION_ANSWERED', 'QUESTION_DEFERRED', 'SPEC_CONFIRMED', 'SPEC_REVISED', 'PROJECT_PUBLISHED', 'SPEC_LIST_VIEWED', 'SPEC_DETAIL_VIEWED', 'SUPPLIER_RATE_STARTED', 'SUPPLIER_RATE_COMPLETED', 'APPLICATION_SUBMITTED', 'APPLICATION_ACCEPTED', 'CONTRACT_AGREED', 'PAYMENT_DEPOSITED', 'OPERATOR_DEPOSIT_REVIEWED', 'REFUND_PROCESSED', 'DELIVERY_SUBMITTED', 'INSPECTION_REQUESTED', 'REVIEW_SUBMITTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "authProvider" "AuthProvider",
    "providerUserId" TEXT,
    "profileImageUrl" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "userId" TEXT NOT NULL,
    "businessName" TEXT,
    "industryField" TEXT,
    "websiteUrl" TEXT,
    "phone" TEXT,
    "region" TEXT,
    "ratingAvg" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "industryCodes" TEXT[],
    "skills" TEXT[],
    "careerYears" INTEGER,
    "hourlyRate" INTEGER,
    "portfolioUrl" TEXT,
    "ratingAvg" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "rateCompleted" BOOLEAN NOT NULL DEFAULT false,
    "feeExempt" BOOLEAN NOT NULL DEFAULT false,
    "feeExemptUsedAt" TIMESTAMP(3),
    "rateCheckedAt" TIMESTAMP(3),
    "ndaAgreedAt" TIMESTAMP(3),
    "ndaVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "block_catalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industryCode" TEXT NOT NULL,
    "techTags" TEXT[],
    "rendererKey" TEXT,
    "configSchema" JSONB,
    "isDrawable" BOOLEAN NOT NULL DEFAULT true,
    "inDefaultDraft" BOOLEAN NOT NULL DEFAULT false,
    "recommendRank" INTEGER,
    "questions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_rates" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "price" INTEGER,
    "isAvgReference" BOOLEAN NOT NULL DEFAULT false,
    "isCapable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "DraftEntryType" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "hopeBudget" INTEGER,
    "chatEditCount" INTEGER NOT NULL DEFAULT 0,
    "firstInputAt" TIMESTAMP(3),
    "renderedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_utterances" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "UtteranceKind" NOT NULL,
    "content" TEXT NOT NULL,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_utterances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_blocks" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "utteranceId" TEXT,
    "origin" "BlockOrigin" NOT NULL,
    "status" "DraftBlockStatus" NOT NULL DEFAULT 'ADDED',
    "estUnit" INTEGER,
    "estMin" INTEGER,
    "estMax" INTEGER,
    "isEstimable" BOOLEAN NOT NULL DEFAULT true,
    "pricedAt" TIMESTAMP(3),
    "answers" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "disclosureConsentVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "industryCode" TEXT NOT NULL,
    "requiredSkills" TEXT[],
    "hopeBudget" INTEGER,
    "recruitStartAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'RECRUITING',
    "deletedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "blockId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rawText" TEXT,
    "isRedacted" BOOLEAN NOT NULL DEFAULT false,
    "rendererKey" TEXT,
    "renderConfig" JSONB,
    "questions" JSONB,
    "origin" "BlockOrigin" NOT NULL,
    "status" "SpecItemStatus" NOT NULL DEFAULT 'INCLUDED',
    "estUnit" INTEGER,
    "estMin" INTEGER,
    "estMax" INTEGER,
    "isEstimable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "spec_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "specVersionNo" INTEGER NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "totalAmount" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_items" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "specItemId" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "amount" INTEGER,
    "memo" TEXT,
    "isContactMasked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "application_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "specVersionNo" INTEGER NOT NULL,
    "specSnapshot" JSONB NOT NULL,
    "agreedAmount" INTEGER NOT NULL,
    "clientFee" INTEGER NOT NULL,
    "supplierFee" INTEGER NOT NULL,
    "interimRatio" INTEGER NOT NULL DEFAULT 50,
    "contentHash" TEXT,
    "clientSignedAt" TIMESTAMP(3),
    "supplierSignedAt" TIMESTAMP(3),
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "totalDeposited" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER,
    "clientFeeRefund" INTEGER,
    "settledAmount" INTEGER,
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_deposits" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "clientFee" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "pgKey" TEXT,
    "depositedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "eventType" "PaymentEventType" NOT NULL,
    "dedupKey" TEXT,
    "payload" JSONB,
    "resultNote" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_installments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "stage" "InstallmentStage" NOT NULL,
    "ratio" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "supplierFee" INTEGER NOT NULL,
    "releaseAmount" INTEGER NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "fileUrl" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_requests" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "applicationItemId" TEXT NOT NULL,
    "reason" "InspectionReason" NOT NULL,
    "note" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "revieweeId" TEXT NOT NULL,
    "reviewerRole" "Role" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "type" "EventType" NOT NULL,
    "draftId" TEXT,
    "projectId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "users_authProvider_providerUserId_key" ON "users"("authProvider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "block_catalog_code_key" ON "block_catalog"("code");

-- CreateIndex
CREATE INDEX "block_catalog_industryCode_isActive_idx" ON "block_catalog"("industryCode", "isActive");

-- CreateIndex
CREATE INDEX "supplier_rates_blockId_isAvgReference_isCapable_idx" ON "supplier_rates"("blockId", "isAvgReference", "isCapable");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_rates_supplierId_blockId_key" ON "supplier_rates"("supplierId", "blockId");

-- CreateIndex
CREATE INDEX "drafts_clientId_status_idx" ON "drafts"("clientId", "status");

-- CreateIndex
CREATE INDEX "drafts_status_lastActiveAt_idx" ON "drafts"("status", "lastActiveAt");

-- CreateIndex
CREATE INDEX "client_utterances_draftId_kind_idx" ON "client_utterances"("draftId", "kind");

-- CreateIndex
CREATE INDEX "draft_blocks_draftId_status_idx" ON "draft_blocks"("draftId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "draft_blocks_draftId_blockId_key" ON "draft_blocks"("draftId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_draftId_key" ON "projects"("draftId");

-- CreateIndex
CREATE INDEX "projects_status_industryCode_publishedAt_idx" ON "projects"("status", "industryCode", "publishedAt");

-- CreateIndex
CREATE INDEX "projects_industryCode_status_idx" ON "projects"("industryCode", "status");

-- CreateIndex
CREATE INDEX "projects_status_recruitStartAt_idx" ON "projects"("status", "recruitStartAt");

-- CreateIndex
CREATE INDEX "projects_status_deadline_idx" ON "projects"("status", "deadline");

-- CreateIndex
CREATE INDEX "spec_items_projectId_versionNo_idx" ON "spec_items"("projectId", "versionNo");

-- CreateIndex
CREATE INDEX "spec_items_projectId_status_idx" ON "spec_items"("projectId", "status");

-- CreateIndex
CREATE INDEX "applications_projectId_status_idx" ON "applications"("projectId", "status");

-- CreateIndex
CREATE INDEX "applications_supplierId_status_idx" ON "applications"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "applications_projectId_supplierId_revisionNo_key" ON "applications"("projectId", "supplierId", "revisionNo");

-- CreateIndex
CREATE INDEX "application_items_specItemId_idx" ON "application_items"("specItemId");

-- CreateIndex
CREATE UNIQUE INDEX "application_items_applicationId_specItemId_key" ON "application_items"("applicationId", "specItemId");

-- CreateIndex
CREATE INDEX "bookmarks_supplierId_createdAt_idx" ON "bookmarks"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_supplierId_projectId_key" ON "bookmarks"("supplierId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_applicationId_key" ON "contracts"("applicationId");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_deposits_idempotencyKey_key" ON "escrow_deposits"("idempotencyKey");

-- CreateIndex
CREATE INDEX "escrow_deposits_contractId_status_idx" ON "escrow_deposits"("contractId", "status");

-- CreateIndex
CREATE INDEX "payment_events_depositId_occurredAt_idx" ON "payment_events"("depositId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_depositId_dedupKey_key" ON "payment_events"("depositId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installments_contractId_stage_key" ON "payment_installments"("contractId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_installmentId_attemptNo_key" ON "deliveries"("installmentId", "attemptNo");

-- CreateIndex
CREATE INDEX "inspection_requests_deliveryId_status_idx" ON "inspection_requests"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "reviews_revieweeId_createdAt_idx" ON "reviews"("revieweeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_contractId_reviewerId_key" ON "reviews"("contractId", "reviewerId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_type_occurredAt_idx" ON "event_logs"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "event_logs_sessionId_idx" ON "event_logs"("sessionId");

-- CreateIndex
CREATE INDEX "event_logs_draftId_type_idx" ON "event_logs"("draftId", "type");

-- CreateIndex
CREATE INDEX "event_logs_projectId_type_userId_idx" ON "event_logs"("projectId", "type", "userId");

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_rates" ADD CONSTRAINT "supplier_rates_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_rates" ADD CONSTRAINT "supplier_rates_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_utterances" ADD CONSTRAINT "client_utterances_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_blocks" ADD CONSTRAINT "draft_blocks_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_blocks" ADD CONSTRAINT "draft_blocks_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_blocks" ADD CONSTRAINT "draft_blocks_utteranceId_fkey" FOREIGN KEY ("utteranceId") REFERENCES "client_utterances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_specItemId_fkey" FOREIGN KEY ("specItemId") REFERENCES "spec_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_deposits" ADD CONSTRAINT "escrow_deposits_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "escrow_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "payment_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_applicationItemId_fkey" FOREIGN KEY ("applicationItemId") REFERENCES "application_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
