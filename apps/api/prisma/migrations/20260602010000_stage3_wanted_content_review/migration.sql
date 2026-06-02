CREATE TYPE "WantedPostStatus" AS ENUM (
  'draft',
  'ai_reviewing',
  'manual_reviewing',
  'active',
  'closed',
  'rejected',
  'delisted'
);

CREATE TYPE "WantedResponseStatus" AS ENUM (
  'submitted',
  'reviewing',
  'approved',
  'converted_to_item',
  'rejected',
  'cancelled'
);

CREATE TABLE "WantedPost" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "status" "WantedPostStatus" NOT NULL DEFAULT 'draft',
  "category" TEXT,
  "currentPublicVersionId" TEXT,
  "latestVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WantedPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WantedResponse" (
  "id" TEXT NOT NULL,
  "wantedPostId" TEXT NOT NULL,
  "responderChildId" TEXT NOT NULL,
  "itemId" TEXT,
  "status" "WantedResponseStatus" NOT NULL DEFAULT 'submitted',
  "currentPublicVersionId" TEXT,
  "latestVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WantedResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WantedPost_communityId_status_idx"
ON "WantedPost"("communityId", "status");

CREATE INDEX "WantedPost_childId_idx"
ON "WantedPost"("childId");

CREATE INDEX "WantedResponse_wantedPostId_status_idx"
ON "WantedResponse"("wantedPostId", "status");

CREATE INDEX "WantedResponse_responderChildId_idx"
ON "WantedResponse"("responderChildId");

CREATE INDEX "WantedResponse_itemId_idx"
ON "WantedResponse"("itemId");

ALTER TABLE "WantedPost"
ADD CONSTRAINT "WantedPost_communityId_fkey"
FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WantedPost"
ADD CONSTRAINT "WantedPost_childId_fkey"
FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WantedPost"
ADD CONSTRAINT "WantedPost_currentPublicVersionId_fkey"
FOREIGN KEY ("currentPublicVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WantedPost"
ADD CONSTRAINT "WantedPost_latestVersionId_fkey"
FOREIGN KEY ("latestVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WantedResponse"
ADD CONSTRAINT "WantedResponse_wantedPostId_fkey"
FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WantedResponse"
ADD CONSTRAINT "WantedResponse_responderChildId_fkey"
FOREIGN KEY ("responderChildId") REFERENCES "ChildProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WantedResponse"
ADD CONSTRAINT "WantedResponse_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WantedResponse"
ADD CONSTRAINT "WantedResponse_currentPublicVersionId_fkey"
FOREIGN KEY ("currentPublicVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WantedResponse"
ADD CONSTRAINT "WantedResponse_latestVersionId_fkey"
FOREIGN KEY ("latestVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
