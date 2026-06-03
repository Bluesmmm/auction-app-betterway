-- Stage 5 auction core: add session lifecycle, settlement traceability, and bid invalidation fields.

-- AlterTable
ALTER TABLE "AuctionSession"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3),
ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "settlementAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastSettlementError" TEXT;

-- Backfill
UPDATE "AuctionSession"
SET "idempotencyKey" = CONCAT('legacy-auction-session:', "id")
WHERE "idempotencyKey" IS NULL;

UPDATE "AuctionSession"
SET "createdAt" = "startAt"
WHERE "createdAt" IS NULL;

ALTER TABLE "AuctionSession"
ALTER COLUMN "idempotencyKey" SET NOT NULL;

ALTER TABLE "AuctionSession"
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE "AuctionSession"
DROP CONSTRAINT "AuctionSession_points_and_version_check";

ALTER TABLE "Bid"
DROP CONSTRAINT "Bid_amount_positive_check";

ALTER TABLE "PointHold"
DROP CONSTRAINT "PointHold_amount_positive_check";

ALTER TABLE "Bid"
ADD COLUMN "withdrawnAt" TIMESTAMP(3),
ADD COLUMN "outbidAt" TIMESTAMP(3),
ADD COLUMN "invalidatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AuctionSession_idempotencyKey_key" ON "AuctionSession"("idempotencyKey");

-- Preflight
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuctionSession"
    GROUP BY "itemId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Stage5 requires one auction session per item before creating the unique index on AuctionSession.itemId';
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "AuctionSession_itemId_key" ON "AuctionSession"("itemId");

-- Constraints
ALTER TABLE "AuctionSession"
ADD CONSTRAINT "AuctionSession_start_points_positive_check"
CHECK ("startPoints" > 0);

ALTER TABLE "AuctionSession"
ADD CONSTRAINT "AuctionSession_min_increment_positive_check"
CHECK ("minIncrementPoints" > 0);

ALTER TABLE "AuctionSession"
ADD CONSTRAINT "AuctionSession_current_price_non_negative_check"
CHECK ("currentPricePoints" >= 0);

ALTER TABLE "AuctionSession"
ADD CONSTRAINT "AuctionSession_version_positive_check"
CHECK ("version" > 0);

ALTER TABLE "Bid"
ADD CONSTRAINT "Bid_amount_points_positive_check"
CHECK ("amountPoints" > 0);

ALTER TABLE "PointHold"
ADD CONSTRAINT "PointHold_amount_points_positive_check"
CHECK ("amountPoints" > 0);

-- AddForeignKey
ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
