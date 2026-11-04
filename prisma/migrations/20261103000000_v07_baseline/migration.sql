-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'SUPPLIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('BUSINESS', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "BlockSource" AS ENUM ('TEAM', 'AI');

-- CreateEnum
CREATE TYPE "PortfolioSummaryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "DraftEntryType" AS ENUM ('SENTENCE', 'DEFAULT_DRAFT');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('IN_PROGRESS', 'CONFIRMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "UtteranceKind" AS ENUM ('FIRST_SENTENCE', 'CHAT');

-- CreateEnum
CREATE TYPE "BlockOrigin" AS ENUM ('FIRST_SENTENCE', 'CHAT', 'RECOMMENDATION', 'DEFAULT_DRAFT', 'AGREEMENT');

-- CreateEnum
CREATE TYPE "DraftBlockStatus" AS ENUM ('SUGGESTED', 'ADDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SpecItemStatus" AS ENUM ('INCLUDED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('SCHEDULED', 'RECRUITING', 'SELECTING', 'ACCEPTED', 'CONTRACTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'STALE', 'ACCEPTED', 'REJECTED', 'AUTO_REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'CANCEL_REQUESTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancelCause" AS ENUM ('CLIENT', 'SUPPLIER', 'MUTUAL');

-- CreateEnum
CREATE TYPE "CancelResolution" AS ENUM ('AGREED', 'ADMIN_DECIDED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'HELD', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'DEPOSITED', 'PARTIALLY_RELEASED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('REQUESTED', 'CALLBACK_RECEIVED', 'DUPLICATE_BLOCKED', 'AMOUNT_MISMATCH', 'VERIFIED', 'FAILED', 'OPERATOR_CONFIRMED', 'OPERATOR_VOIDED');

-- CreateEnum
CREATE TYPE "InstallmentStage" AS ENUM ('INTERIM', 'FINAL');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'DELIVERED', 'REWORK_REQUESTED', 'APPROVED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUBMITTED', 'PARTIALLY_APPROVED', 'APPROVED', 'REWORK_REQUESTED');

-- CreateEnum
CREATE TYPE "InspectionReason" AS ENUM ('CONDITION_MISMATCH', 'NOT_WORKING', 'MISSING_PART', 'OTHER');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('OPEN', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "DisputeDecision" AS ENUM ('REWORK_VALID', 'APPROVE', 'UNDECIDED_CONDITION');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('CONTACT_OR_OFFSITE', 'ABUSE', 'FALSE_INFO', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportAction" AS ENUM ('NONE', 'WARNING', 'CHAT_RESTRICT_7D', 'SUSPEND');

-- CreateEnum
CREATE TYPE "InquiryCategory" AS ENUM ('USAGE', 'PAYMENT', 'INSPECTION', 'CANCEL', 'ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('WAITING', 'ANSWERED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_AUTO_REJECTED', 'APPLICATION_REJECTED', 'PROJECT_CLOSED', 'REQUOTE_REQUESTED', 'NEW_MESSAGE', 'CONTRACT_BROKEN', 'DEPOSIT_DUE', 'INSPECTION_DUE', 'WORK_DUE', 'WORK_OVERDUE', 'AUTO_APPROVED', 'REPORT_REVIEWED', 'INQUIRY_ANSWERED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SESSION_START', 'SIGNUP_COMPLETED', 'ACCOUNT_WITHDRAWN', 'DRAFT_INPUT_SUBMITTED', 'DRAFT_RENDERED', 'DRAFT_FAILED', 'DRAFT_RESUMED', 'DRAFT_ABANDONED', 'LLM_CALLED', 'BLOCK_CREATED', 'BLOCK_MERGED', 'BLOCK_PRICE_UPDATED', 'BLOCK_DEACTIVATED', 'RECOMMENDATION_ADDED', 'BLOCK_REMOVED', 'CHAT_SUBMITTED', 'CONDITION_NOTED', 'PRICE_REPORT_VIEWED', 'BUDGET_APPLIED', 'SPEC_CONFIRMED', 'SPEC_REVISED', 'DEADLINE_EXTENDED', 'PROJECT_PUBLISHED', 'SPEC_LIST_VIEWED', 'SPEC_DETAIL_VIEWED', 'CLIENT_PROFILE_VIEWED', 'PORTFOLIO_SUMMARIZED', 'APPLICATION_SUBMITTED', 'APPLICATION_WITHDRAWN', 'APPLICATION_REJECTED', 'INQUIRY_OPENED', 'QUOTE_REVISED', 'AGREEMENT_OPENED', 'APPLICATION_ACCEPTED', 'CONTRACT_SIGNED', 'CONTRACT_AGREED', 'CONTRACT_BROKEN', 'PAYMENT_DEPOSITED', 'OPERATOR_DEPOSIT_REVIEWED', 'DELIVERY_SUBMITTED', 'INSPECTION_REQUESTED', 'ITEM_APPROVED', 'INSTALLMENT_RELEASED', 'DISPUTE_ESCALATED', 'DISPUTE_DECIDED', 'CANCEL_REQUESTED', 'CANCEL_OBJECTED', 'CANCEL_RESOLVED', 'REFUND_PROCESSED', 'REVIEW_SUBMITTED', 'REPORT_SUBMITTED', 'REPORT_RESOLVED', 'SUPPORT_INQUIRY_SUBMITTED', 'SUPPORT_INQUIRY_ANSWERED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "role" "Role" NOT NULL,
    "authProvider" "AuthProvider",
    "providerUserId" TEXT,
    "profileImageUrl" TEXT,
    "bio" TEXT,
    "termsVersion" TEXT,
    "termsAgreedAt" TIMESTAMP(3),
    "chatRestrictedUntil" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "userId" TEXT NOT NULL,
    "businessName" TEXT,
    "industryField" TEXT,
    "storeAddress" TEXT,
    "websiteUrl" TEXT,
    "bizRegNo" TEXT,
    "taxInvoiceEmail" TEXT,
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
    "portfolioItems" JSONB,
    "portfolioSummary" TEXT,
    "portfolioSummaryStatus" "PortfolioSummaryStatus",
    "portfolioSummarizedAt" TIMESTAMP(3),
    "portfolioConsentAt" TIMESTAMP(3),
    "ratingAvg" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "ndaAgreedAt" TIMESTAMP(3),
    "ndaVersion" TEXT,
    "businessType" "BusinessType",
    "bizRegNo" TEXT,
    "taxInvoiceEmail" TEXT,
    "payoutBank" TEXT,
    "payoutAccountNo" TEXT,
    "payoutHolder" TEXT,
    "payoutVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "block_catalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "functionSummary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industryCode" TEXT NOT NULL,
    "techTags" TEXT[],
    "source" "BlockSource" NOT NULL DEFAULT 'TEAM',
    "wireframe" JSONB,
    "isDrawable" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB,
    "unitPrice" INTEGER NOT NULL,
    "priceBasis" TEXT NOT NULL,
    "priceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inDefaultDraft" BOOLEAN NOT NULL DEFAULT false,
    "recommendRank" INTEGER,
    "mergedIntoId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryType" "DraftEntryType" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "hopeBudget" INTEGER,
    "chatEditCount" INTEGER NOT NULL DEFAULT 0,
    "pendingFeatures" JSONB,
    "firstInputAt" TIMESTAMP(3),
    "renderedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_utterances" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "UtteranceKind" NOT NULL,
    "content" TEXT NOT NULL,
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
    "unitPrice" INTEGER NOT NULL,
    "pricedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conditionNotes" JSONB,
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
    "selectionEndsAt" TIMESTAMP(3),
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
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "wireframe" JSONB,
    "conditions" JSONB,
    "origin" "BlockOrigin" NOT NULL,
    "status" "SpecItemStatus" NOT NULL DEFAULT 'INCLUDED',
    "unitPrice" INTEGER NOT NULL,
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
    "message" TEXT,
    "questions" JSONB,
    "isMessageMasked" BOOLEAN NOT NULL DEFAULT false,
    "revisionReason" TEXT,
    "agreementDraft" JSONB,
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

    CONSTRAINT "application_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_messages" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "senderId" TEXT,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "isMasked" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_messages_pkey" PRIMARY KEY ("id")
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
    "agreedAmount" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "clientFee" INTEGER NOT NULL,
    "supplierFee" INTEGER NOT NULL,
    "interimRatio" INTEGER NOT NULL DEFAULT 50,
    "consentDeadline" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "clientSignedAt" TIMESTAMP(3),
    "supplierSignedAt" TIMESTAMP(3),
    "depositDeadline" TIMESTAMP(3),
    "workDueAt" TIMESTAMP(3),
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "totalDeposited" INTEGER NOT NULL DEFAULT 0,
    "cancelCause" "CancelCause",
    "cancelRequestedBy" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelNote" TEXT,
    "objectionNote" TEXT,
    "objectionRate" INTEGER,
    "cancelEvidence" JSONB,
    "cancelEscalatedAt" TIMESTAMP(3),
    "compensationRate" INTEGER,
    "cancelResolution" "CancelResolution",
    "cancelResolvedAt" TIMESTAMP(3),
    "refundAmount" INTEGER,
    "clientFeeRefund" INTEGER,
    "settledAmount" INTEGER,
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "cancelPayoutAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_items" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "conditions" JSONB,
    "origin" "BlockOrigin" NOT NULL,
    "stage" "InstallmentStage" NOT NULL DEFAULT 'FINAL',
    "approvedAt" TIMESTAMP(3),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contract_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_deposits" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "clientFee" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
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
    "withholdingTax" INTEGER NOT NULL DEFAULT 0,
    "releaseAmount" INTEGER NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "taxInvoiceIssuedAt" TIMESTAMP(3),

    CONSTRAINT "payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB,
    "summary" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionDueAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_requests" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "contractItemId" TEXT NOT NULL,
    "reason" "InspectionReason" NOT NULL,
    "conditionKey" TEXT,
    "note" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'OPEN',
    "escalatedAt" TIMESTAMP(3),
    "escalation" JSONB,
    "decision" "DisputeDecision",
    "decisionNotes" JSONB,
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
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "detail" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "action" "ReportAction",
    "actionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_inquiries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "InquiryCategory" NOT NULL,
    "contractId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "status" "InquiryStatus" NOT NULL DEFAULT 'WAITING',
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB,
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
    "contractId" TEXT,
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
CREATE INDEX "block_catalog_source_reviewedAt_idx" ON "block_catalog"("source", "reviewedAt");

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
CREATE INDEX "projects_status_selectionEndsAt_idx" ON "projects"("status", "selectionEndsAt");

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
CREATE INDEX "application_messages_applicationId_createdAt_idx" ON "application_messages"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "bookmarks_supplierId_createdAt_idx" ON "bookmarks"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_supplierId_projectId_key" ON "bookmarks"("supplierId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_applicationId_key" ON "contracts"("applicationId");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_status_consentDeadline_idx" ON "contracts"("status", "consentDeadline");

-- CreateIndex
CREATE INDEX "contracts_status_depositDeadline_idx" ON "contracts"("status", "depositDeadline");

-- CreateIndex
CREATE INDEX "contracts_status_workDueAt_idx" ON "contracts"("status", "workDueAt");

-- CreateIndex
CREATE INDEX "contracts_status_cancelRequestedAt_idx" ON "contracts"("status", "cancelRequestedAt");

-- CreateIndex
CREATE INDEX "contract_items_contractId_stage_idx" ON "contract_items"("contractId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_deposits_idempotencyKey_key" ON "escrow_deposits"("idempotencyKey");

-- CreateIndex
CREATE INDEX "escrow_deposits_contractId_status_idx" ON "escrow_deposits"("contractId", "status");

-- CreateIndex
CREATE INDEX "escrow_deposits_status_createdAt_idx" ON "escrow_deposits"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_events_depositId_occurredAt_idx" ON "payment_events"("depositId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_depositId_dedupKey_key" ON "payment_events"("depositId", "dedupKey");

-- CreateIndex
CREATE INDEX "payment_installments_status_idx" ON "payment_installments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installments_contractId_stage_key" ON "payment_installments"("contractId", "stage");

-- CreateIndex
CREATE INDEX "deliveries_status_inspectionDueAt_idx" ON "deliveries"("status", "inspectionDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_installmentId_attemptNo_key" ON "deliveries"("installmentId", "attemptNo");

-- CreateIndex
CREATE INDEX "inspection_requests_deliveryId_status_idx" ON "inspection_requests"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "inspection_requests_status_escalatedAt_idx" ON "inspection_requests"("status", "escalatedAt");

-- CreateIndex
CREATE INDEX "reviews_revieweeId_createdAt_idx" ON "reviews"("revieweeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_contractId_reviewerId_key" ON "reviews"("contractId", "reviewerId");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_targetUserId_action_idx" ON "reports"("targetUserId", "action");

-- CreateIndex
CREATE INDEX "support_inquiries_userId_createdAt_idx" ON "support_inquiries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_inquiries_status_createdAt_idx" ON "support_inquiries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_type_targetId_idx" ON "notifications"("userId", "type", "targetId");

-- CreateIndex
CREATE INDEX "event_logs_type_occurredAt_idx" ON "event_logs"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "event_logs_sessionId_idx" ON "event_logs"("sessionId");

-- CreateIndex
CREATE INDEX "event_logs_draftId_type_idx" ON "event_logs"("draftId", "type");

-- CreateIndex
CREATE INDEX "event_logs_projectId_type_userId_idx" ON "event_logs"("projectId", "type", "userId");

-- CreateIndex
CREATE INDEX "event_logs_contractId_occurredAt_idx" ON "event_logs"("contractId", "occurredAt");

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_catalog" ADD CONSTRAINT "block_catalog_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "block_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_items" ADD CONSTRAINT "application_items_specItemId_fkey" FOREIGN KEY ("specItemId") REFERENCES "spec_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_messages" ADD CONSTRAINT "application_messages_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_messages" ADD CONSTRAINT "application_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "application_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_inquiries" ADD CONSTRAINT "support_inquiries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_inquiries" ADD CONSTRAINT "support_inquiries_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_inquiries" ADD CONSTRAINT "support_inquiries_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Raw constraints required by schema_v0.7.prisma and ERD v0.7.
CREATE UNIQUE INDEX "application_one_accepted"
ON "applications"("projectId") WHERE "status" = 'ACCEPTED';

CREATE UNIQUE INDEX "application_one_active"
ON "applications"("projectId", "supplierId") WHERE "status" IN ('SUBMITTED', 'STALE', 'ACCEPTED');

ALTER TABLE "projects" ADD CONSTRAINT "recruit_before_deadline"
CHECK ("recruitStartAt" IS NULL OR "deadline" IS NULL OR "recruitStartAt" < "deadline");

ALTER TABLE "payment_events" ADD CONSTRAINT "dedupkey_required_for_callback"
CHECK ("eventType" NOT IN ('CALLBACK_RECEIVED', 'VERIFIED') OR "dedupKey" IS NOT NULL);

CREATE UNIQUE INDEX "deposit_one_open"
ON "escrow_deposits"("contractId") WHERE "status" IN ('PENDING', 'HELD', 'COMPLETED');

ALTER TABLE "contracts" ADD CONSTRAINT "compensation_rate_floor"
CHECK (
  "compensationRate" IS NULL OR (
    "compensationRate" BETWEEN 0 AND 100
    AND ("cancelCause" IS DISTINCT FROM 'CLIENT' OR "compensationRate" >= 50)
  )
);

ALTER TABLE "contracts" ADD CONSTRAINT "interim_ratio_range"
CHECK ("interimRatio" BETWEEN 10 AND 90);

ALTER TABLE "block_catalog" ADD CONSTRAINT "block_not_merged_into_self"
CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");

ALTER TABLE "reviews" ADD CONSTRAINT "review_rating_range"
CHECK ("rating" BETWEEN 1 AND 5);

CREATE UNIQUE INDEX "report_one_open_per_reporter"
ON "reports"("messageId", "reporterId") WHERE "status" = 'OPEN';
