-- Stage 1 review fixes: ledger traceability and scoped administrator foundation.

CREATE TYPE "AdminRole" AS ENUM ('activity_admin', 'platform_admin', 'institution_admin');
CREATE TYPE "AdminScopeStatus" AS ENUM ('active', 'suspended', 'revoked');

ALTER TYPE "PointLedgerEntryType" ADD VALUE IF NOT EXISTS 'admin_award';
ALTER TYPE "PointLedgerEntryType" ADD VALUE IF NOT EXISTS 'admin_penalty';
ALTER TYPE "PointLedgerEntryType" ADD VALUE IF NOT EXISTS 'correction';

CREATE TABLE "AdminProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminCommunityScope" (
    "id" TEXT NOT NULL,
    "adminProfileId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "status" "AdminScopeStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminCommunityScope_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PointLedgerEntry" ADD COLUMN "childId" TEXT;
ALTER TABLE "PointLedgerEntry" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'stage1 migration backfill';
ALTER TABLE "PointLedgerEntry" ADD COLUMN "createdByUserId" TEXT;

UPDATE "PointLedgerEntry"
SET "childId" = "PointAccount"."childId"
FROM "PointAccount"
WHERE "PointLedgerEntry"."accountId" = "PointAccount"."id";

ALTER TABLE "PointLedgerEntry" ALTER COLUMN "childId" SET NOT NULL;
ALTER TABLE "PointLedgerEntry" ALTER COLUMN "reason" DROP DEFAULT;

CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");
CREATE UNIQUE INDEX "AdminCommunityScope_adminProfileId_communityId_key" ON "AdminCommunityScope"("adminProfileId", "communityId");
CREATE INDEX "AdminCommunityScope_communityId_status_idx" ON "AdminCommunityScope"("communityId", "status");
CREATE INDEX "PointLedgerEntry_childId_createdAt_idx" ON "PointLedgerEntry"("childId", "createdAt");

ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminCommunityScope" ADD CONSTRAINT "AdminCommunityScope_adminProfileId_fkey" FOREIGN KEY ("adminProfileId") REFERENCES "AdminProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminCommunityScope" ADD CONSTRAINT "AdminCommunityScope_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointLedgerEntry" ADD CONSTRAINT "PointLedgerEntry_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointLedgerEntry" ADD CONSTRAINT "PointLedgerEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
