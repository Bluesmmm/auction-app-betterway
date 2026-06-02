import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readdirSync("apps/api/prisma/migrations")
  .filter((entry) => entry.includes("stage3_content_review"))
  .sort()
  .map((entry) =>
    readFileSync(`apps/api/prisma/migrations/${entry}/migration.sql`, "utf8")
  )
  .join("\n");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const schemaNormalized = normalize(schema);
const migrationNormalized = normalize(migration);

describe("Stage 3 content schema", () => {
  it("adds content version media as the authoritative image binding", () => {
    expect(schema).toContain("enum ContentMediaRole");
    expect(schema).toContain("model ContentVersionMedia");
    expect(schemaNormalized).toContain("mediaRole ContentMediaRole");
    expect(schemaNormalized).toContain("mediaAssetId String @unique");
    expect(schemaNormalized).toContain("@@unique([contentVersionId, mediaRole])");
    expect(schemaNormalized).toContain("@@unique([contentVersionId, sortOrder])");
    expect(schemaNormalized).toContain("contentVersion ContentVersion @relation");
    expect(schemaNormalized).toContain("mediaAsset MediaAsset @relation");
  });

  it("keeps item current and latest version pointers relational", () => {
    expect(schemaNormalized).toContain("currentPublicVersion ContentVersion?");
    expect(schemaNormalized).toContain("latestVersion ContentVersion?");
    expect(schemaNormalized).toContain('@relation("ItemCurrentPublicVersion"');
    expect(schemaNormalized).toContain('@relation("ItemLatestVersion"');
  });

  it("creates migration constraints for one-time media consumption", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "ContentMediaRole"');
    expect(migrationNormalized).toContain('CREATE TABLE "ContentVersionMedia"');
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "ContentVersionMedia_mediaAssetId_key"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "ContentVersionMedia_contentVersionId_mediaRole_key"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "ContentVersionMedia_contentVersionId_sortOrder_key"'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "ContentVersionMedia" ADD CONSTRAINT'
    );
  });
});
