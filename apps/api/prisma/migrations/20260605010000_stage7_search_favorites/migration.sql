-- Stage 7 search/list candidates, item favorites, and typed notification actions.
CREATE TYPE "NotificationActionType" AS ENUM (
    'view_auction',
    'view_transaction',
    'view_appeal',
    'view_points',
    'open_search_result'
);

CREATE TYPE "SearchIndexTargetType" AS ENUM (
    'item',
    'wanted_post'
);

CREATE TYPE "SearchIndexVisibilityStatus" AS ENUM (
    'searchable',
    'hidden',
    'delisted'
);

CREATE TYPE "ItemFavoriteStatus" AS ENUM (
    'active',
    'removed'
);

ALTER TABLE "Notification"
    ADD COLUMN "actionType" "NotificationActionType";

CREATE TABLE "SearchIndexDocument" (
    "id" TEXT NOT NULL,
    "targetType" "SearchIndexTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "visibilityStatus" "SearchIndexVisibilityStatus" NOT NULL DEFAULT 'searchable',
    "searchPayload" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "category" TEXT,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceVersion" INTEGER NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "auctionEndAt" TIMESTAMP(3),
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchIndexDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemFavorite" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "status" "ItemFavoriteStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ItemFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchIndexDocument_targetType_targetId_key"
    ON "SearchIndexDocument"("targetType", "targetId");

CREATE INDEX "SearchIndexDocument_communityId_visibilityStatus_indexedAt_idx"
    ON "SearchIndexDocument"("communityId", "visibilityStatus", "indexedAt");

CREATE INDEX "SearchIndexDocument_communityId_targetType_visibilityStatus_indexedAt_idx"
    ON "SearchIndexDocument"("communityId", "targetType", "visibilityStatus", "indexedAt");

CREATE INDEX "SearchIndexDocument_communityId_category_visibilityStatus_indexedAt_idx"
    ON "SearchIndexDocument"("communityId", "category", "visibilityStatus", "indexedAt");

CREATE INDEX "SearchIndexDocument_communityId_visibilityStatus_auctionEndAt_idx"
    ON "SearchIndexDocument"("communityId", "visibilityStatus", "auctionEndAt");

CREATE INDEX "SearchIndexDocument_communityId_visibilityStatus_bidCount_idx"
    ON "SearchIndexDocument"("communityId", "visibilityStatus", "bidCount");

CREATE INDEX "SearchIndexDocument_communityId_visibilityStatus_favoriteCount_idx"
    ON "SearchIndexDocument"("communityId", "visibilityStatus", "favoriteCount");

CREATE UNIQUE INDEX "ItemFavorite_childId_itemId_key"
    ON "ItemFavorite"("childId", "itemId");

CREATE INDEX "ItemFavorite_childId_communityId_status_updatedAt_idx"
    ON "ItemFavorite"("childId", "communityId", "status", "updatedAt");

CREATE INDEX "ItemFavorite_itemId_status_idx"
    ON "ItemFavorite"("itemId", "status");

CREATE INDEX "ItemFavorite_communityId_status_updatedAt_idx"
    ON "ItemFavorite"("communityId", "status", "updatedAt");

CREATE INDEX "Notification_actionType_createdAt_idx"
    ON "Notification"("actionType", "createdAt");

ALTER TABLE "SearchIndexDocument"
    ADD CONSTRAINT "SearchIndexDocument_communityId_fkey"
    FOREIGN KEY ("communityId")
    REFERENCES "AuctionCommunity"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "SearchIndexDocument"
    ADD CONSTRAINT "SearchIndexDocument_contentVersionId_fkey"
    FOREIGN KEY ("contentVersionId")
    REFERENCES "ContentVersion"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "ItemFavorite"
    ADD CONSTRAINT "ItemFavorite_childId_fkey"
    FOREIGN KEY ("childId")
    REFERENCES "ChildProfile"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "ItemFavorite"
    ADD CONSTRAINT "ItemFavorite_itemId_fkey"
    FOREIGN KEY ("itemId")
    REFERENCES "Item"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "ItemFavorite"
    ADD CONSTRAINT "ItemFavorite_communityId_fkey"
    FOREIGN KEY ("communityId")
    REFERENCES "AuctionCommunity"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
