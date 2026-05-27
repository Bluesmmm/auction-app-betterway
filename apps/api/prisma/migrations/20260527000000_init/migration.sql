-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'restricted', 'closed');

-- CreateEnum
CREATE TYPE "GuardianStatus" AS ENUM ('active', 'restricted', 'closed');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('pending_guardian', 'active', 'restricted', 'closed');

-- CreateEnum
CREATE TYPE "GuardianRole" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('pending', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('draft', 'pending_review', 'active', 'suspended', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "InviteCodeStatus" AS ENUM ('active', 'disabled', 'expired');

-- CreateEnum
CREATE TYPE "CommunityMemberStatus" AS ENUM ('pending_guardian', 'pending_admin', 'active', 'removed', 'banned');

-- CreateEnum
CREATE TYPE "ContentTargetType" AS ENUM ('item', 'wanted_request', 'wanted_response', 'avatar');

-- CreateEnum
CREATE TYPE "ContentVersionStatus" AS ENUM ('pending_ai', 'pending_manual', 'approved', 'rejected', 'escalated', 'blocked');

-- CreateEnum
CREATE TYPE "ModerationTaskStatus" AS ENUM ('pending', 'processing', 'needs_manual_review', 'approved', 'rejected', 'escalated', 'failed');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('temp_private', 'formal_private', 'deleted');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('draft', 'ai_reviewing', 'manual_reviewing', 'approved', 'rejected', 'listed', 'withdrawn', 'delisted');

-- CreateEnum
CREATE TYPE "AuctionSessionStatus" AS ENUM ('pending_start', 'active', 'pending_settlement', 'settled', 'cancelled', 'unsold', 'delisted');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('active', 'outbid', 'withdrawn', 'invalidated');

-- CreateEnum
CREATE TYPE "PointHoldStatus" AS ENUM ('active', 'released', 'transferred', 'cancelled', 'disputed');

-- CreateEnum
CREATE TYPE "PointLedgerEntryType" AS ENUM ('initial_grant', 'admin_adjustment', 'hold', 'release', 'transfer_out', 'transfer_in', 'reversal');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending_guardian_confirm', 'pending_delivery_confirm', 'completed', 'cancelled', 'disputed', 'platform_review');

-- CreateEnum
CREATE TYPE "DecisionPhase" AS ENUM ('guardian_confirm', 'delivery_confirm');

-- CreateEnum
CREATE TYPE "DecisionValue" AS ENUM ('confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('processing', 'completed', 'failed', 'conflict');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WechatIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openid" TEXT NOT NULL,
    "unionid" TEXT,
    "avatarUrl" TEXT,
    "nickname" TEXT,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "WechatIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneLast4" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "status" "GuardianStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "GuardianProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarAssetId" TEXT,
    "gradeBand" TEXT NOT NULL,
    "status" "ChildStatus" NOT NULL DEFAULT 'pending_guardian',
    "createdByGuardianId" TEXT,
    "initialPointsGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianChildLink" (
    "id" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "role" "GuardianRole" NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'pending',
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "GuardianChildLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionCommunity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creatorGuardianId" TEXT NOT NULL,
    "status" "CommunityStatus" NOT NULL DEFAULT 'draft',
    "defaultAuctionDurationMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionCommunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityInviteCode" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "InviteCodeStatus" NOT NULL DEFAULT 'active',
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CommunityInviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "status" "CommunityMemberStatus" NOT NULL DEFAULT 'pending_guardian',
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'temp_private',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "accessPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "sellerChildId" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'draft',
    "startPoints" INTEGER NOT NULL,
    "minIncrementPoints" INTEGER NOT NULL,
    "currentPublicVersionId" TEXT,
    "latestVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "targetType" "ContentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'pending_ai',
    "title" TEXT,
    "description" TEXT,
    "payloadJson" JSONB NOT NULL,
    "riskLevel" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationTask" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "status" "ModerationTaskStatus" NOT NULL DEFAULT 'pending',
    "providerRiskLevel" TEXT,
    "ruleTagsJson" JSONB,
    "reviewerUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "ModerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionSession" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "AuctionSessionStatus" NOT NULL DEFAULT 'active',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "startPoints" INTEGER NOT NULL,
    "minIncrementPoints" INTEGER NOT NULL,
    "currentPricePoints" INTEGER NOT NULL DEFAULT 0,
    "highestBidId" TEXT,
    "highestBidderChildId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AuctionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "auctionSessionId" TEXT NOT NULL,
    "bidderChildId" TEXT NOT NULL,
    "amountPoints" INTEGER NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'active',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointAccount" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "availablePoints" INTEGER NOT NULL DEFAULT 0,
    "frozenPoints" INTEGER NOT NULL DEFAULT 0,
    "totalEarnedPoints" INTEGER NOT NULL DEFAULT 0,
    "totalSpentPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointHold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "auctionSessionId" TEXT NOT NULL,
    "bidId" TEXT,
    "amountPoints" INTEGER NOT NULL,
    "status" "PointHoldStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "transferredAt" TIMESTAMP(3),

    CONSTRAINT "PointHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "PointLedgerEntryType" NOT NULL,
    "amountPoints" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "frozenAfter" INTEGER NOT NULL,
    "relatedType" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "auctionSessionId" TEXT NOT NULL,
    "buyerChildId" TEXT NOT NULL,
    "sellerChildId" TEXT NOT NULL,
    "pointHoldId" TEXT NOT NULL,
    "pointsAmount" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending_guardian_confirm',
    "guardianConfirmDeadlineAt" TIMESTAMP(3) NOT NULL,
    "deliveryConfirmDeadlineAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianDecision" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "phase" "DecisionPhase" NOT NULL,
    "value" "DecisionValue" NOT NULL,
    "effective" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'processing',
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WechatIdentity_openid_key" ON "WechatIdentity"("openid");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianProfile_userId_key" ON "GuardianProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChildProfile_userId_key" ON "ChildProfile"("userId");

-- CreateIndex
CREATE INDEX "GuardianChildLink_childId_role_status_idx" ON "GuardianChildLink"("childId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianChildLink_guardianId_childId_key" ON "GuardianChildLink"("guardianId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityInviteCode_code_key" ON "CommunityInviteCode"("code");

-- CreateIndex
CREATE INDEX "CommunityInviteCode_communityId_status_idx" ON "CommunityInviteCode"("communityId", "status");

-- CreateIndex
CREATE INDEX "CommunityMember_childId_status_idx" ON "CommunityMember"("childId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_communityId_childId_key" ON "CommunityMember"("communityId", "childId");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerUserId_visibility_idx" ON "MediaAsset"("ownerUserId", "visibility");

-- CreateIndex
CREATE INDEX "Item_communityId_status_idx" ON "Item"("communityId", "status");

-- CreateIndex
CREATE INDEX "Item_sellerChildId_idx" ON "Item"("sellerChildId");

-- CreateIndex
CREATE INDEX "ContentVersion_targetType_targetId_status_idx" ON "ContentVersion"("targetType", "targetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_targetType_targetId_versionNo_key" ON "ContentVersion"("targetType", "targetId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationTask_contentVersionId_key" ON "ModerationTask"("contentVersionId");

-- CreateIndex
CREATE INDEX "AuctionSession_status_endAt_idx" ON "AuctionSession"("status", "endAt");

-- CreateIndex
CREATE INDEX "AuctionSession_itemId_status_idx" ON "AuctionSession"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_idempotencyKey_key" ON "Bid"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Bid_auctionSessionId_createdAt_idx" ON "Bid"("auctionSessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointAccount_childId_key" ON "PointAccount"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "PointHold_bidId_key" ON "PointHold"("bidId");

-- CreateIndex
CREATE INDEX "PointHold_auctionSessionId_status_idx" ON "PointHold"("auctionSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedgerEntry_idempotencyKey_key" ON "PointLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointLedgerEntry_accountId_createdAt_idx" ON "PointLedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_auctionSessionId_key" ON "Transaction"("auctionSessionId");

-- CreateIndex
CREATE INDEX "GuardianDecision_transactionId_phase_effective_idx" ON "GuardianDecision"("transactionId", "phase", "effective");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_actorUserId_action_targetType_targetI_key" ON "IdempotencyRecord"("key", "actorUserId", "action", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "WechatIdentity" ADD CONSTRAINT "WechatIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianProfile" ADD CONSTRAINT "GuardianProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildProfile" ADD CONSTRAINT "ChildProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildLink" ADD CONSTRAINT "GuardianChildLink_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianChildLink" ADD CONSTRAINT "GuardianChildLink_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityInviteCode" ADD CONSTRAINT "CommunityInviteCode_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sellerChildId_fkey" FOREIGN KEY ("sellerChildId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationTask" ADD CONSTRAINT "ModerationTask_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionSessionId_fkey" FOREIGN KEY ("auctionSessionId") REFERENCES "AuctionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderChildId_fkey" FOREIGN KEY ("bidderChildId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointHold" ADD CONSTRAINT "PointHold_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointHold" ADD CONSTRAINT "PointHold_auctionSessionId_fkey" FOREIGN KEY ("auctionSessionId") REFERENCES "AuctionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointHold" ADD CONSTRAINT "PointHold_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedgerEntry" ADD CONSTRAINT "PointLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_auctionSessionId_fkey" FOREIGN KEY ("auctionSessionId") REFERENCES "AuctionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianDecision" ADD CONSTRAINT "GuardianDecision_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
