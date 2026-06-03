-- CreateEnum
CREATE TYPE "PointAdjustmentSource" AS ENUM ('guardian_request', 'admin_initiated');

-- CreateEnum
CREATE TYPE "PointAdjustmentRequestType" AS ENUM ('correction', 'activity_reward', 'admin_award', 'admin_penalty', 'batch_award');

-- CreateEnum
CREATE TYPE "PointAdjustmentStatus" AS ENUM ('pending_review', 'pending_second_review', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "LedgerCheckRunStatus" AS ENUM ('running', 'passed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "LedgerCheckDiffType" AS ENUM ('snapshot_mismatch', 'negative_replay', 'orphan_ledger_entry', 'missing_account', 'active_hold_mismatch');

-- AlterTable
ALTER TABLE "PointAccount"
ADD COLUMN "totalAwardedPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalPenaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PointAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "source" "PointAdjustmentSource" NOT NULL,
    "requestType" "PointAdjustmentRequestType" NOT NULL,
    "status" "PointAdjustmentStatus" NOT NULL DEFAULT 'pending_review',
    "childId" TEXT NOT NULL,
    "guardianId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "secondReviewedByUserId" TEXT,
    "ledgerEntryId" TEXT,
    "requestedPoints" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewReason" TEXT,
    "secondReviewReason" TEXT,
    "requiresSecondReview" BOOLEAN NOT NULL DEFAULT false,
    "batchKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "secondReviewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerCheckRun" (
    "id" TEXT NOT NULL,
    "status" "LedgerCheckRunStatus" NOT NULL DEFAULT 'running',
    "checkedAccountCount" INTEGER NOT NULL DEFAULT 0,
    "ledgerDiffCount" INTEGER NOT NULL DEFAULT 0,
    "negativeReplayCount" INTEGER NOT NULL DEFAULT 0,
    "orphanLedgerCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "workerName" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "LedgerCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerCheckDiff" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "accountId" TEXT,
    "childId" TEXT,
    "ledgerEntryId" TEXT,
    "diffType" "LedgerCheckDiffType" NOT NULL,
    "expectedAvailablePoints" INTEGER,
    "actualAvailablePoints" INTEGER,
    "expectedFrozenPoints" INTEGER,
    "actualFrozenPoints" INTEGER,
    "evidenceJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerCheckDiff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointAdjustmentRequest_ledgerEntryId_key" ON "PointAdjustmentRequest"("ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PointAdjustmentRequest_idempotencyKey_key" ON "PointAdjustmentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_status_requiresSecondReview_idx" ON "PointAdjustmentRequest"("status", "requiresSecondReview");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_childId_createdAt_idx" ON "PointAdjustmentRequest"("childId", "createdAt");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_guardianId_status_idx" ON "PointAdjustmentRequest"("guardianId", "status");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_batchKey_idx" ON "PointAdjustmentRequest"("batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCheckRun_idempotencyKey_key" ON "LedgerCheckRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerCheckRun_status_startedAt_idx" ON "LedgerCheckRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "LedgerCheckDiff_runId_diffType_idx" ON "LedgerCheckDiff"("runId", "diffType");

-- CreateIndex
CREATE INDEX "LedgerCheckDiff_accountId_createdAt_idx" ON "LedgerCheckDiff"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerCheckDiff_childId_createdAt_idx" ON "LedgerCheckDiff"("childId", "createdAt");

-- Constraints
ALTER TABLE "PointAccount"
ADD CONSTRAINT "PointAccount_stage4_totals_non_negative_check"
CHECK ("totalAwardedPoints" >= 0 AND "totalPenaltyPoints" >= 0);

ALTER TABLE "PointAdjustmentRequest"
ADD CONSTRAINT "PointAdjustmentRequest_requestedPoints_non_zero_check"
CHECK ("requestedPoints" <> 0);

ALTER TABLE "PointAdjustmentRequest"
ADD CONSTRAINT "PointAdjustmentRequest_reason_non_empty_check"
CHECK (btrim("reason") <> '');

ALTER TABLE "PointAdjustmentRequest"
ADD CONSTRAINT "PointAdjustmentRequest_source_type_check"
CHECK (
  (
    "source" = 'guardian_request'
    AND "guardianId" IS NOT NULL
    AND "requestType" IN ('correction', 'activity_reward')
  )
  OR (
    "source" = 'admin_initiated'
    AND "guardianId" IS NULL
    AND "requestType" IN ('correction', 'admin_award', 'admin_penalty', 'batch_award')
  )
);

ALTER TABLE "PointAdjustmentRequest"
ADD CONSTRAINT "PointAdjustmentRequest_reviewer_separation_check"
CHECK (
  "secondReviewedByUserId" IS NULL
  OR (
    "secondReviewedByUserId" <> "requestedByUserId"
    AND (
      "reviewedByUserId" IS NULL
      OR "secondReviewedByUserId" <> "reviewedByUserId"
    )
  )
);

ALTER TABLE "PointAdjustmentRequest"
ADD CONSTRAINT "PointAdjustmentRequest_status_review_fields_check"
CHECK (
  (
    "status" = 'pending_review'
    AND "reviewedByUserId" IS NULL
    AND "reviewedAt" IS NULL
    AND "secondReviewedByUserId" IS NULL
    AND "secondReviewedAt" IS NULL
    AND "decidedAt" IS NULL
    AND "ledgerEntryId" IS NULL
  )
  OR (
    "status" = 'pending_second_review'
    AND "requiresSecondReview" = true
    AND "reviewedByUserId" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "secondReviewedByUserId" IS NULL
    AND "secondReviewedAt" IS NULL
    AND "decidedAt" IS NULL
    AND "ledgerEntryId" IS NULL
  )
  OR (
    "status" = 'approved'
    AND "reviewedByUserId" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "decidedAt" IS NOT NULL
    AND "ledgerEntryId" IS NOT NULL
    AND (
      "requiresSecondReview" = false
      OR (
        "secondReviewedByUserId" IS NOT NULL
        AND "secondReviewedAt" IS NOT NULL
      )
    )
  )
  OR (
    "status" IN ('rejected', 'cancelled')
    AND "decidedAt" IS NOT NULL
    AND "ledgerEntryId" IS NULL
  )
);

ALTER TABLE "LedgerCheckRun"
ADD CONSTRAINT "LedgerCheckRun_counts_non_negative_check"
CHECK (
  "checkedAccountCount" >= 0
  AND "ledgerDiffCount" >= 0
  AND "negativeReplayCount" >= 0
  AND "orphanLedgerCount" >= 0
);

ALTER TABLE "LedgerCheckRun"
ADD CONSTRAINT "LedgerCheckRun_status_time_check"
CHECK (
  ("status" = 'running' AND "finishedAt" IS NULL)
  OR ("status" IN ('passed', 'failed', 'skipped') AND "finishedAt" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_secondReviewedByUserId_fkey" FOREIGN KEY ("secondReviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "PointLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerCheckDiff" ADD CONSTRAINT "LedgerCheckDiff_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LedgerCheckRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerCheckDiff" ADD CONSTRAINT "LedgerCheckDiff_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
