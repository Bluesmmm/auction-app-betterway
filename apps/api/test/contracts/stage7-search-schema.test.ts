import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260605010000_stage7_search_favorites/migration.sql",
  "utf8"
);

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const migrationNormalized = normalize(migration);

function getBlock(kind: "model" | "enum", name: string) {
  const start = schema.indexOf(`${kind} ${name} {`);
  expect(start).toBeGreaterThanOrEqual(0);

  const remaining = schema.slice(start);
  const end = remaining.indexOf("\n}");
  expect(end).toBeGreaterThanOrEqual(0);

  return normalize(remaining.slice(0, end + 2));
}

describe("Stage 7 search and favorites schema", () => {
  it("adds search, favorite, and typed notification action enums", () => {
    expect(getBlock("enum", "NotificationActionType")).toContain(
      "view_transaction"
    );
    expect(getBlock("enum", "NotificationActionType")).toContain(
      "open_search_result"
    );
    expect(getBlock("enum", "SearchIndexTargetType")).toContain("item");
    expect(getBlock("enum", "SearchIndexTargetType")).toContain("wanted_post");
    expect(getBlock("enum", "SearchIndexVisibilityStatus")).toContain(
      "searchable"
    );
    expect(getBlock("enum", "SearchIndexVisibilityStatus")).toContain(
      "delisted"
    );
    expect(getBlock("enum", "ItemFavoriteStatus")).toContain("active");
    expect(getBlock("enum", "ItemFavoriteStatus")).toContain("removed");
  });

  it("defines search index documents as candidate records", () => {
    const search = getBlock("model", "SearchIndexDocument");
    const community = getBlock("model", "AuctionCommunity");
    const contentVersion = getBlock("model", "ContentVersion");

    expect(search).toContain("targetType SearchIndexTargetType");
    expect(search).toContain("contentVersionId String");
    expect(search).toContain("visibilityStatus SearchIndexVisibilityStatus @default(searchable)");
    expect(search).toContain("searchPayload Json");
    expect(search).toContain("searchText String");
    expect(search).toContain("sourceVersion Int");
    expect(search).toContain("auctionEndAt DateTime?");
    expect(search).toContain("bidCount Int @default(0)");
    expect(search).toContain("favoriteCount Int @default(0)");
    expect(search).toContain("@@unique([targetType, targetId])");
    expect(search).toContain(
      "@@index([communityId, visibilityStatus, indexedAt])"
    );
    expect(search).toContain(
      "@@index([communityId, visibilityStatus, favoriteCount])"
    );
    expect(community).toContain("searchIndexDocuments SearchIndexDocument[]");
    expect(contentVersion).toContain(
      "searchIndexDocuments SearchIndexDocument[]"
    );
  });

  it("defines item favorites as durable child-item facts", () => {
    const favorite = getBlock("model", "ItemFavorite");
    const child = getBlock("model", "ChildProfile");
    const item = getBlock("model", "Item");
    const community = getBlock("model", "AuctionCommunity");

    expect(favorite).toContain("childId String");
    expect(favorite).toContain("itemId String");
    expect(favorite).toContain("communityId String");
    expect(favorite).toContain("status ItemFavoriteStatus @default(active)");
    expect(favorite).toContain("removedAt DateTime?");
    expect(favorite).toContain("@@unique([childId, itemId])");
    expect(favorite).toContain("@@index([itemId, status])");
    expect(child).toContain("itemFavorites ItemFavorite[]");
    expect(item).toContain("favorites ItemFavorite[]");
    expect(community).toContain("itemFavorites ItemFavorite[]");
  });

  it("adds typed notification actions without arbitrary action payloads", () => {
    const notification = getBlock("model", "Notification");

    expect(notification).toContain("actionType NotificationActionType?");
    expect(notification).not.toContain("actionJson");
    expect(notification).not.toContain("actionPayload");
  });

  it("uses additive migration statements", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "SearchIndexTargetType"');
    expect(migrationNormalized).toContain('CREATE TABLE "SearchIndexDocument"');
    expect(migrationNormalized).toContain('CREATE TABLE "ItemFavorite"');
    expect(migrationNormalized).toContain(
      'ALTER TABLE "Notification" ADD COLUMN "actionType"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "SearchIndexDocument_targetType_targetId_key"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "ItemFavorite_childId_itemId_key"'
    );
    expect(migrationNormalized).not.toMatch(
      /DROP COLUMN|DROP TABLE|RENAME COLUMN|RENAME TO/i
    );
  });
});
