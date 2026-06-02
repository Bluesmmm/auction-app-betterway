import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readdirSync("apps/api/prisma/migrations")
  .filter((entry) => entry.includes("stage3"))
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

  it("adds wanted posts and wanted responses as content version targets", () => {
    expect(schema).toContain("enum WantedPostStatus");
    expect(schema).toContain("enum WantedResponseStatus");
    expect(schema).toContain("model WantedPost");
    expect(schema).toContain("model WantedResponse");
    expect(schemaNormalized).toContain("wantedPosts WantedPost[]");
    expect(schemaNormalized).toContain("wantedResponses WantedResponse[]");
    expect(schemaNormalized).toContain('@relation("WantedPostCurrentPublicVersion"');
    expect(schemaNormalized).toContain('@relation("WantedResponseCurrentPublicVersion"');
    expect(schemaNormalized).toContain("targetType ContentTargetType");
    expect(schemaNormalized).toContain("wanted_request");
    expect(schemaNormalized).toContain("wanted_response");
  });

  it("creates migration constraints for wanted content business facts", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "WantedPostStatus"');
    expect(migrationNormalized).toContain('CREATE TYPE "WantedResponseStatus"');
    expect(migrationNormalized).toContain('CREATE TABLE "WantedPost"');
    expect(migrationNormalized).toContain('CREATE TABLE "WantedResponse"');
    expect(migrationNormalized).toContain(
      'CREATE INDEX "WantedPost_communityId_status_idx"'
    );
    expect(migrationNormalized).toContain(
      'CREATE INDEX "WantedResponse_wantedPostId_status_idx"'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "WantedPost" ADD CONSTRAINT "WantedPost_currentPublicVersionId_fkey"'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_currentPublicVersionId_fkey"'
    );
  });

  it("adds persistent AI and manual review evidence", () => {
    expect(schema).toContain("enum AiProviderStatus");
    expect(schema).toContain("enum ManualReviewDecision");
    expect(schema).toContain("model AiReviewResult");
    expect(schema).toContain("model ManualReviewRecord");
    expect(schemaNormalized).toContain("aiReviewResults AiReviewResult[]");
    expect(schemaNormalized).toContain("manualReviewRecords ManualReviewRecord[]");
    expect(schemaNormalized).toContain("providerStatus AiProviderStatus");
    expect(schemaNormalized).toContain("decision ManualReviewDecision");
  });

  it("creates migration constraints for review evidence", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "AiProviderStatus"');
    expect(migrationNormalized).toContain('CREATE TYPE "ManualReviewDecision"');
    expect(migrationNormalized).toContain('CREATE TABLE "AiReviewResult"');
    expect(migrationNormalized).toContain('CREATE TABLE "ManualReviewRecord"');
    expect(migrationNormalized).toContain(
      'CREATE INDEX "AiReviewResult_taskId_createdAt_idx"'
    );
    expect(migrationNormalized).toContain(
      'CREATE INDEX "ManualReviewRecord_taskId_createdAt_idx"'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "AiReviewResult" ADD CONSTRAINT "AiReviewResult_taskId_fkey"'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "ManualReviewRecord" ADD CONSTRAINT "ManualReviewRecord_reviewerUserId_fkey"'
    );
  });
});
