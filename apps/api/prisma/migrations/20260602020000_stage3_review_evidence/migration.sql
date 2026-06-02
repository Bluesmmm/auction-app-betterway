CREATE TYPE "AiProviderStatus" AS ENUM (
  'success',
  'timeout',
  'failed',
  'invalid_response'
);

CREATE TYPE "ManualReviewDecision" AS ENUM (
  'approve',
  'reject',
  'escalate'
);

CREATE TABLE "AiReviewResult" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "contentVersionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerStatus" "AiProviderStatus" NOT NULL,
  "riskLevel" TEXT,
  "labelsJson" JSONB,
  "ocrText" TEXT,
  "qrOrBarcodeDetected" BOOLEAN NOT NULL DEFAULT false,
  "metadataFindingsJson" JSONB,
  "failureReason" TEXT,
  "rawResultRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiReviewResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualReviewRecord" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "contentVersionId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "ManualReviewDecision" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ManualReviewRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiReviewResult_taskId_createdAt_idx"
ON "AiReviewResult"("taskId", "createdAt");

CREATE INDEX "AiReviewResult_contentVersionId_createdAt_idx"
ON "AiReviewResult"("contentVersionId", "createdAt");

CREATE INDEX "ManualReviewRecord_taskId_createdAt_idx"
ON "ManualReviewRecord"("taskId", "createdAt");

CREATE INDEX "ManualReviewRecord_contentVersionId_createdAt_idx"
ON "ManualReviewRecord"("contentVersionId", "createdAt");

CREATE INDEX "ManualReviewRecord_reviewerUserId_createdAt_idx"
ON "ManualReviewRecord"("reviewerUserId", "createdAt");

ALTER TABLE "AiReviewResult"
ADD CONSTRAINT "AiReviewResult_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ModerationTask"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiReviewResult"
ADD CONSTRAINT "AiReviewResult_contentVersionId_fkey"
FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualReviewRecord"
ADD CONSTRAINT "ManualReviewRecord_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ModerationTask"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualReviewRecord"
ADD CONSTRAINT "ManualReviewRecord_contentVersionId_fkey"
FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualReviewRecord"
ADD CONSTRAINT "ManualReviewRecord_reviewerUserId_fkey"
FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
