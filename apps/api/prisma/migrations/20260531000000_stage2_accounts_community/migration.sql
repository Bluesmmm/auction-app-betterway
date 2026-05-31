-- Stage 2 accounts and community schema additions.

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "TrustedDeviceTrustLevel" AS ENUM ('normal', 'sensitive_allowed', 'revoked');

-- CreateEnum
CREATE TYPE "SensitiveOperationChallengeStatus" AS ENUM ('pending', 'passed', 'failed', 'expired', 'cooling_down');

-- CreateEnum
CREATE TYPE "GuardianDisputeStatus" AS ENUM ('pending_platform_review', 'frozen', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "GuardianDisputeType" AS ENUM ('guardian_change', 'unlink', 'deletion', 'consent', 'transaction');

-- CreateEnum
CREATE TYPE "CommunityCreationRequestStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "CommunityRuleVersionStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "RosterVerificationStatus" AS ENUM ('pending', 'matched', 'not_matched', 'manual_exception', 'rejected');

-- CreateEnum
CREATE TYPE "RiskSignalType" AS ENUM ('adult_impersonation_suspected', 'abnormal_join_pattern', 'contact_inducement_suspected', 'cross_community_anomaly', 'guardian_account_takeover_suspected');

-- CreateEnum
CREATE TYPE "RiskSignalStatus" AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "RiskRestrictionType" AS ENUM ('no_join', 'no_publish', 'no_bid', 'no_transaction_confirm', 'no_export', 'no_delete', 'sensitive_challenge_required', 'suspended');

-- CreateEnum
CREATE TYPE "RiskRestrictionScope" AS ENUM ('user', 'guardian', 'child', 'community_member', 'community');

-- CreateEnum
CREATE TYPE "RiskRestrictionStatus" AS ENUM ('active', 'resolved', 'expired');

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "deviceFingerprintHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgentHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceFingerprintHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "trustLevel" "TrustedDeviceTrustLevel" NOT NULL DEFAULT 'normal',
    "trustedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveOperationChallenge" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "SensitiveOperationChallengeStatus" NOT NULL DEFAULT 'pending',
    "riskLabelsJson" JSONB,
    "passedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveOperationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildGuardianSettings" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "canBid" BOOLEAN NOT NULL DEFAULT false,
    "canUseCourier" BOOLEAN NOT NULL DEFAULT false,
    "canUseGuardianArrangedDelivery" BOOLEAN NOT NULL DEFAULT false,
    "canFavorite" BOOLEAN NOT NULL DEFAULT false,
    "bidRequiresGuardianConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "maxBidPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildGuardianSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianDispute" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "submittingGuardianId" TEXT NOT NULL,
    "type" "GuardianDisputeType" NOT NULL,
    "status" "GuardianDisputeStatus" NOT NULL DEFAULT 'pending_platform_review',
    "frozenAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCreationRequest" (
    "id" TEXT NOT NULL,
    "applicantGuardianId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "approvedCommunityId" TEXT,
    "status" "CommunityCreationRequestStatus" NOT NULL DEFAULT 'pending_review',
    "requestedName" TEXT NOT NULL,
    "requestedDescription" TEXT,
    "requestedGradeBand" TEXT NOT NULL,
    "expectedMemberSize" INTEGER NOT NULL,
    "ruleDraftJson" JSONB NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityCreationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityRuleVersion" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "CommunityRuleVersionStatus" NOT NULL DEFAULT 'draft',
    "rulesJson" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSignal" (
    "id" TEXT NOT NULL,
    "type" "RiskSignalType" NOT NULL,
    "scope" "RiskRestrictionScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "communityMemberId" TEXT,
    "communityId" TEXT,
    "childId" TEXT,
    "guardianId" TEXT,
    "evidenceJson" JSONB NOT NULL,
    "status" "RiskSignalStatus" NOT NULL DEFAULT 'open',
    "reviewerUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolutionText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRestriction" (
    "id" TEXT NOT NULL,
    "type" "RiskRestrictionType" NOT NULL,
    "scope" "RiskRestrictionScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "communityMemberId" TEXT,
    "communityId" TEXT,
    "childId" TEXT,
    "guardianId" TEXT,
    "status" "RiskRestrictionStatus" NOT NULL DEFAULT 'active',
    "reason" TEXT NOT NULL,
    "imposedByUserId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskRestriction_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CommunityInviteCode"
ADD COLUMN "ruleVersionId" TEXT;

-- AlterTable
ALTER TABLE "CommunityMember"
ADD COLUMN "inviteCodeId" TEXT,
ADD COLUMN "ruleVersionId" TEXT,
ADD COLUMN "adminReviewedByUserId" TEXT,
ADD COLUMN "guardianConfirmedAt" TIMESTAMP(3),
ADD COLUMN "adminReviewedAt" TIMESTAMP(3),
ADD COLUMN "rosterVerificationStatus" "RosterVerificationStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "rosterEvidenceJson" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_status_idx"
ON "UserSession"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_userId_deviceFingerprintHash_key" ON "TrustedDevice"("userId", "deviceFingerprintHash");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_trustLevel_idx" ON "TrustedDevice"("userId", "trustLevel");

-- CreateIndex
CREATE INDEX "SensitiveOperationChallenge_actorUserId_status_idx" ON "SensitiveOperationChallenge"("actorUserId", "status");

-- CreateIndex
CREATE INDEX "SensitiveOperationChallenge_targetType_targetId_status_idx" ON "SensitiveOperationChallenge"("targetType", "targetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChildGuardianSettings_childId_key" ON "ChildGuardianSettings"("childId");

-- CreateIndex
CREATE INDEX "GuardianDispute_childId_status_idx" ON "GuardianDispute"("childId", "status");

-- CreateIndex
CREATE INDEX "GuardianDispute_submittingGuardianId_status_idx" ON "GuardianDispute"("submittingGuardianId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianDispute_one_unresolved_per_child_idx"
ON "GuardianDispute"("childId")
WHERE "status" IN ('pending_platform_review', 'frozen');

-- CreateIndex
CREATE INDEX "CommunityCreationRequest_applicantGuardianId_status_idx" ON "CommunityCreationRequest"("applicantGuardianId", "status");

-- CreateIndex
CREATE INDEX "CommunityCreationRequest_status_createdAt_idx" ON "CommunityCreationRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCreationRequest_approvedCommunityId_key" ON "CommunityCreationRequest"("approvedCommunityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRuleVersion_id_communityId_key" ON "CommunityRuleVersion"("id", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRuleVersion_communityId_versionNo_key" ON "CommunityRuleVersion"("communityId", "versionNo");

-- CreateIndex
CREATE INDEX "CommunityRuleVersion_communityId_status_idx" ON "CommunityRuleVersion"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRuleVersion_one_active_per_community_idx"
ON "CommunityRuleVersion"("communityId")
WHERE "status" = 'active';

-- Backfill Stage 1 communities and memberships into Stage 2 rule versioning.
INSERT INTO "CommunityRuleVersion" (
    "id",
    "communityId",
    "versionNo",
    "status",
    "rulesJson",
    "effectiveAt",
    "createdAt"
)
SELECT
    'stage2_rule_' || c."id",
    c."id",
    1,
    'active'::"CommunityRuleVersionStatus",
    jsonb_build_object('source', 'stage2_migration/default'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "AuctionCommunity" c
WHERE NOT EXISTS (
    SELECT 1
    FROM "CommunityRuleVersion" crv
    WHERE crv."communityId" = c."id"
);

UPDATE "CommunityInviteCode" cic
SET "ruleVersionId" = crv."id"
FROM "CommunityRuleVersion" crv
WHERE cic."ruleVersionId" IS NULL
  AND crv."communityId" = cic."communityId"
  AND crv."status" = 'active';

UPDATE "CommunityMember" cm
SET "ruleVersionId" = crv."id"
FROM "CommunityRuleVersion" crv
WHERE cm."ruleVersionId" IS NULL
  AND crv."communityId" = cm."communityId"
  AND crv."status" = 'active';

UPDATE "CommunityMember"
SET
    "rosterVerificationStatus" = 'manual_exception',
    "rosterEvidenceJson" = jsonb_build_object(
        'source', 'stage2_migration',
        'reason', 'legacy_active_stage1_member'
    )
WHERE "status" = 'active'
  AND "rosterEvidenceJson" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CommunityInviteCode_id_communityId_key" ON "CommunityInviteCode"("id", "communityId");

-- CreateIndex
CREATE INDEX "CommunityInviteCode_ruleVersionId_communityId_idx" ON "CommunityInviteCode"("ruleVersionId", "communityId");

-- CreateIndex
CREATE INDEX "CommunityMember_communityId_status_idx" ON "CommunityMember"("communityId", "status");

-- CreateIndex
CREATE INDEX "CommunityMember_inviteCodeId_communityId_idx" ON "CommunityMember"("inviteCodeId", "communityId");

-- CreateIndex
CREATE INDEX "CommunityMember_ruleVersionId_communityId_idx" ON "CommunityMember"("ruleVersionId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_id_communityId_childId_key" ON "CommunityMember"("id", "communityId", "childId");

-- CreateIndex
CREATE INDEX "RiskSignal_type_status_idx" ON "RiskSignal"("type", "status");

-- CreateIndex
CREATE INDEX "RiskSignal_scope_targetId_status_idx" ON "RiskSignal"("scope", "targetId", "status");

-- CreateIndex
CREATE INDEX "RiskSignal_childId_status_idx" ON "RiskSignal"("childId", "status");

-- CreateIndex
CREATE INDEX "RiskSignal_communityMemberId_communityId_childId_idx" ON "RiskSignal"("communityMemberId", "communityId", "childId");

-- CreateIndex
CREATE INDEX "RiskRestriction_scope_target_status_idx"
ON "RiskRestriction"("scope", "targetId", "status");

-- CreateIndex
CREATE INDEX "RiskRestriction_communityId_status_idx" ON "RiskRestriction"("communityId", "status");

-- CreateIndex
CREATE INDEX "RiskRestriction_childId_status_idx" ON "RiskRestriction"("childId", "status");

-- CreateIndex
CREATE INDEX "RiskRestriction_communityMemberId_communityId_childId_idx" ON "RiskRestriction"("communityMemberId", "communityId", "childId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensitiveOperationChallenge" ADD CONSTRAINT "SensitiveOperationChallenge_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildGuardianSettings" ADD CONSTRAINT "ChildGuardianSettings_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianDispute" ADD CONSTRAINT "GuardianDispute_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianDispute" ADD CONSTRAINT "GuardianDispute_submittingGuardianId_fkey" FOREIGN KEY ("submittingGuardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCreationRequest" ADD CONSTRAINT "CommunityCreationRequest_applicantGuardianId_fkey" FOREIGN KEY ("applicantGuardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCreationRequest" ADD CONSTRAINT "CommunityCreationRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCreationRequest" ADD CONSTRAINT "CommunityCreationRequest_approvedCommunityId_fkey" FOREIGN KEY ("approvedCommunityId") REFERENCES "AuctionCommunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityRuleVersion" ADD CONSTRAINT "CommunityRuleVersion_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityInviteCode" ADD CONSTRAINT "CommunityInviteCode_ruleVersion_community_fkey" FOREIGN KEY ("ruleVersionId", "communityId") REFERENCES "CommunityRuleVersion"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_inviteCode_community_fkey" FOREIGN KEY ("inviteCodeId", "communityId") REFERENCES "CommunityInviteCode"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_ruleVersion_community_fkey" FOREIGN KEY ("ruleVersionId", "communityId") REFERENCES "CommunityRuleVersion"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_adminReviewedByUserId_fkey" FOREIGN KEY ("adminReviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_imposedByUserId_fkey" FOREIGN KEY ("imposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddConstraint
ALTER TABLE "ChildGuardianSettings"
ADD CONSTRAINT "ChildGuardianSettings_maxBidPoints_positive_check"
CHECK ("maxBidPoints" IS NULL OR "maxBidPoints" > 0);

-- AddConstraint
ALTER TABLE "CommunityCreationRequest"
ADD CONSTRAINT "CommunityCreationRequest_expectedMemberSize_positive_check"
CHECK ("expectedMemberSize" > 0);

-- AddConstraint
ALTER TABLE "CommunityRuleVersion"
ADD CONSTRAINT "CommunityRuleVersion_versionNo_positive_check"
CHECK ("versionNo" > 0);

-- AddConstraint
ALTER TABLE "RiskSignal"
ADD CONSTRAINT "RiskSignal_scope_target_check"
CHECK (
  (
    "scope" = 'community'
    AND "communityId" IS NOT NULL
    AND "targetId" = "communityId"
    AND "childId" IS NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'child'
    AND "childId" IS NOT NULL
    AND "targetId" = "childId"
    AND "communityId" IS NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'guardian'
    AND "guardianId" IS NOT NULL
    AND "targetId" = "guardianId"
    AND "communityId" IS NULL
    AND "childId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'user'
    AND "targetUserId" IS NOT NULL
    AND "targetId" = "targetUserId"
    AND "communityId" IS NULL
    AND "childId" IS NULL
    AND "guardianId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'community_member'
    AND "communityMemberId" IS NOT NULL
    AND "targetId" = "communityMemberId"
    AND "communityId" IS NOT NULL
    AND "childId" IS NOT NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
  )
);

-- AddConstraint
ALTER TABLE "RiskRestriction"
ADD CONSTRAINT "RiskRestriction_scope_target_check"
CHECK (
  (
    "scope" = 'community'
    AND "communityId" IS NOT NULL
    AND "targetId" = "communityId"
    AND "childId" IS NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'child'
    AND "childId" IS NOT NULL
    AND "targetId" = "childId"
    AND "communityId" IS NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'guardian'
    AND "guardianId" IS NOT NULL
    AND "targetId" = "guardianId"
    AND "communityId" IS NULL
    AND "childId" IS NULL
    AND "targetUserId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'user'
    AND "targetUserId" IS NOT NULL
    AND "targetId" = "targetUserId"
    AND "communityId" IS NULL
    AND "childId" IS NULL
    AND "guardianId" IS NULL
    AND "communityMemberId" IS NULL
  )
  OR (
    "scope" = 'community_member'
    AND "communityMemberId" IS NOT NULL
    AND "targetId" = "communityMemberId"
    AND "communityId" IS NOT NULL
    AND "childId" IS NOT NULL
    AND "guardianId" IS NULL
    AND "targetUserId" IS NULL
  )
);
