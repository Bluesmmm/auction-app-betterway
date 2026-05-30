-- Stage 1 hardening: enforce foundation invariants that later stages depend on.

CREATE UNIQUE INDEX "GuardianChildLink_one_active_primary_per_child_idx"
ON "GuardianChildLink"("childId")
WHERE "role" = 'primary' AND "status" = 'active';

CREATE UNIQUE INDEX "AuctionSession_one_open_session_per_item_idx"
ON "AuctionSession"("itemId")
WHERE "status" IN ('pending_start', 'active', 'pending_settlement');

CREATE UNIQUE INDEX "PointHold_one_active_hold_per_auction_idx"
ON "PointHold"("auctionSessionId")
WHERE "status" = 'active';

CREATE UNIQUE INDEX "GuardianDecision_one_effective_decision_per_guardian_idx"
ON "GuardianDecision"("transactionId", "phase", "guardianId")
WHERE "effective" = true;

ALTER TABLE "AuctionCommunity"
ADD CONSTRAINT "AuctionCommunity_default_duration_positive_check"
CHECK ("defaultAuctionDurationMinutes" > 0);

ALTER TABLE "CommunityInviteCode"
ADD CONSTRAINT "CommunityInviteCode_usage_bounds_check"
CHECK (
  "usedCount" >= 0
  AND (
    "maxUses" IS NULL
    OR ("maxUses" > 0 AND "usedCount" <= "maxUses")
  )
);

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_size_and_policy_positive_check"
CHECK ("sizeBytes" > 0 AND "accessPolicyVersion" > 0);

ALTER TABLE "Item"
ADD CONSTRAINT "Item_points_and_version_positive_check"
CHECK ("startPoints" > 0 AND "minIncrementPoints" > 0 AND "version" > 0);

ALTER TABLE "ContentVersion"
ADD CONSTRAINT "ContentVersion_version_positive_check"
CHECK ("versionNo" > 0);

ALTER TABLE "AuctionSession"
ADD CONSTRAINT "AuctionSession_points_and_version_check"
CHECK (
  "startPoints" > 0
  AND "minIncrementPoints" > 0
  AND "currentPricePoints" >= 0
  AND "version" > 0
);

ALTER TABLE "Bid"
ADD CONSTRAINT "Bid_amount_positive_check"
CHECK ("amountPoints" > 0);

ALTER TABLE "PointAccount"
ADD CONSTRAINT "PointAccount_balances_non_negative_check"
CHECK (
  "availablePoints" >= 0
  AND "frozenPoints" >= 0
  AND "totalEarnedPoints" >= 0
  AND "totalSpentPoints" >= 0
);

ALTER TABLE "PointHold"
ADD CONSTRAINT "PointHold_amount_positive_check"
CHECK ("amountPoints" > 0);

ALTER TABLE "PointLedgerEntry"
ADD CONSTRAINT "PointLedgerEntry_snapshots_non_negative_check"
CHECK ("availableAfter" >= 0 AND "frozenAfter" >= 0);

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_points_and_version_positive_check"
CHECK ("pointsAmount" > 0 AND "version" > 0);
