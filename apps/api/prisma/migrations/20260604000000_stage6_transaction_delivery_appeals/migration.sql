-- Stage 6 transaction delivery and appeals: additive evidence and private appeal facts.

-- CreateEnum
CREATE TYPE "TransactionSide" AS ENUM ('buyer', 'seller');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('designated_point', 'guardian_arranged', 'courier');

-- CreateEnum
CREATE TYPE "DeliveryPointStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "DeliveryRecordStatus" AS ENUM ('pending', 'completed', 'disputed', 'admin_resolved');

-- CreateEnum
CREATE TYPE "AppealTargetType" AS ENUM ('transaction');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('pending_activity_admin', 'resolved', 'escalated_platform', 'platform_resolved', 'rejected');

-- CreateEnum
CREATE TYPE "AppealAttachmentStatus" AS ENUM ('pending_scan', 'accepted', 'escalated_platform', 'rejected');

-- AlterTable
ALTER TABLE "GuardianDecision"
ADD COLUMN "side" "TransactionSide",
ADD COLUMN "childId" TEXT,
ADD COLUMN "guardianRole" "GuardianRole",
ADD COLUMN "transactionVersion" INTEGER,
ADD COLUMN "reason" TEXT;

-- CreateTable
CREATE TABLE "DeliveryPoint" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressText" TEXT NOT NULL,
    "availableTimeText" TEXT NOT NULL,
    "status" "DeliveryPointStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "deliveryPointId" TEXT,
    "sellerConfirmedAt" TIMESTAMP(3),
    "buyerConfirmedAt" TIMESTAMP(3),
    "status" "DeliveryRecordStatus" NOT NULL DEFAULT 'pending',
    "deadlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "targetType" "AppealTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "transactionId" TEXT,
    "submittedByGuardianId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'pending_activity_admin',
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealAttachment" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "status" "AppealAttachmentStatus" NOT NULL DEFAULT 'pending_scan',
    "sortOrder" INTEGER NOT NULL,
    "riskLabelsJson" JSONB,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AppealAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianDecision_transactionId_phase_side_effective_idx" ON "GuardianDecision"("transactionId", "phase", "side", "effective");

-- CreateIndex
CREATE INDEX "DeliveryPoint_communityId_status_idx" ON "DeliveryPoint"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_transactionId_key" ON "DeliveryRecord"("transactionId");

-- CreateIndex
CREATE INDEX "DeliveryRecord_deliveryMethod_status_idx" ON "DeliveryRecord"("deliveryMethod", "status");

-- CreateIndex
CREATE INDEX "DeliveryRecord_deliveryPointId_status_idx" ON "DeliveryRecord"("deliveryPointId", "status");

-- CreateIndex
CREATE INDEX "Appeal_communityId_status_idx" ON "Appeal"("communityId", "status");

-- CreateIndex
CREATE INDEX "Appeal_submittedByGuardianId_status_idx" ON "Appeal"("submittedByGuardianId", "status");

-- CreateIndex
CREATE INDEX "Appeal_transactionId_status_idx" ON "Appeal"("transactionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AppealAttachment_mediaAssetId_key" ON "AppealAttachment"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AppealAttachment_appealId_sortOrder_key" ON "AppealAttachment"("appealId", "sortOrder");

-- CreateIndex
CREATE INDEX "AppealAttachment_appealId_status_idx" ON "AppealAttachment"("appealId", "status");

-- Constraints
ALTER TABLE "DeliveryPoint"
ADD CONSTRAINT "DeliveryPoint_name_non_empty_check"
CHECK (btrim("name") <> '');

ALTER TABLE "DeliveryPoint"
ADD CONSTRAINT "DeliveryPoint_address_text_non_empty_check"
CHECK (btrim("addressText") <> '');

ALTER TABLE "DeliveryRecord"
ADD CONSTRAINT "DeliveryRecord_delivery_point_method_check"
CHECK (
  (
    "deliveryMethod" = 'designated_point'
    AND "deliveryPointId" IS NOT NULL
  )
  OR (
    "deliveryMethod" IN ('guardian_arranged', 'courier')
    AND "deliveryPointId" IS NULL
  )
);

ALTER TABLE "Appeal"
ADD CONSTRAINT "Appeal_reason_non_empty_check"
CHECK (btrim("reason") <> '');

ALTER TABLE "Appeal"
ADD CONSTRAINT "Appeal_transaction_target_check"
CHECK (
  "targetType" <> 'transaction'
  OR (
    "transactionId" IS NOT NULL
    AND "targetId" = "transactionId"
  )
);

ALTER TABLE "AppealAttachment"
ADD CONSTRAINT "AppealAttachment_sort_order_range_check"
CHECK ("sortOrder" BETWEEN 1 AND 4);

-- AddForeignKey
ALTER TABLE "GuardianDecision" ADD CONSTRAINT "GuardianDecision_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPoint" ADD CONSTRAINT "DeliveryPoint_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_deliveryPointId_fkey" FOREIGN KEY ("deliveryPointId") REFERENCES "DeliveryPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_submittedByGuardianId_fkey" FOREIGN KEY ("submittedByGuardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealAttachment" ADD CONSTRAINT "AppealAttachment_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealAttachment" ADD CONSTRAINT "AppealAttachment_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
