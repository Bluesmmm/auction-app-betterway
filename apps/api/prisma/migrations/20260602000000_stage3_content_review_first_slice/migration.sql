CREATE TYPE "ContentMediaRole" AS ENUM ('front', 'back', 'side', 'detail', 'avatar');

CREATE TABLE "ContentVersionMedia" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "mediaRole" "ContentMediaRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersionMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentVersionMedia_mediaAssetId_key"
ON "ContentVersionMedia"("mediaAssetId");

CREATE UNIQUE INDEX "ContentVersionMedia_contentVersionId_mediaRole_key"
ON "ContentVersionMedia"("contentVersionId", "mediaRole");

CREATE UNIQUE INDEX "ContentVersionMedia_contentVersionId_sortOrder_key"
ON "ContentVersionMedia"("contentVersionId", "sortOrder");

CREATE INDEX "ContentVersionMedia_contentVersionId_idx"
ON "ContentVersionMedia"("contentVersionId");

ALTER TABLE "ContentVersionMedia"
ADD CONSTRAINT "ContentVersionMedia_contentVersionId_fkey"
FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentVersionMedia"
ADD CONSTRAINT "ContentVersionMedia_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Item"
ADD CONSTRAINT "Item_currentPublicVersionId_fkey"
FOREIGN KEY ("currentPublicVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Item"
ADD CONSTRAINT "Item_latestVersionId_fkey"
FOREIGN KEY ("latestVersionId") REFERENCES "ContentVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
