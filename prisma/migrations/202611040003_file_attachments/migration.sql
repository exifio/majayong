CREATE TYPE "FilePurpose" AS ENUM ('DELIVERY', 'PORTFOLIO', 'SUPPORT_INQUIRY', 'CONTRACT_DOCUMENT');

CREATE TABLE "file_attachments" (
  "id" TEXT NOT NULL,
  "purpose" "FilePurpose" NOT NULL,
  "contractId" TEXT,
  "inquiryId" TEXT,
  "uploaderId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "file_attachments_objectKey_key" ON "file_attachments"("objectKey");
CREATE INDEX "file_attachments_inquiryId_idx" ON "file_attachments"("inquiryId");
CREATE INDEX "file_attachments_contractId_idx" ON "file_attachments"("contractId");
