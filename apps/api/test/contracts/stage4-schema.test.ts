import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readdirSync("apps/api/prisma/migrations")
  .filter((entry) => entry.includes("stage4"))
  .sort()
  .map((entry) =>
    readFileSync(`apps/api/prisma/migrations/${entry}/migration.sql`, "utf8")
  )
  .join("\n");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const schemaNormalized = normalize(schema);
const migrationNormalized = normalize(migration);

describe("Stage 4 points ledger schema", () => {
  it("adds adjustment request and ledger check facts", () => {
    for (const model of [
      "PointAdjustmentRequest",
      "LedgerCheckRun",
      "LedgerCheckDiff"
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    for (const enumName of [
      "PointAdjustmentSource",
      "PointAdjustmentRequestType",
      "PointAdjustmentStatus",
      "LedgerCheckRunStatus",
      "LedgerCheckDiffType"
    ]) {
      expect(schema).toContain(`enum ${enumName}`);
    }
  });

  it("keeps point adjustment requests tied to child accounts and reviewers", () => {
    expect(schemaNormalized).toContain("source PointAdjustmentSource");
    expect(schemaNormalized).toContain("requestType PointAdjustmentRequestType");
    expect(schemaNormalized).toContain("requestedPoints Int");
    expect(schemaNormalized).toContain("requiresSecondReview Boolean @default(false)");
    expect(schemaNormalized).toContain("requestedBy User @relation");
    expect(schemaNormalized).toContain("reviewedBy User? @relation");
    expect(schemaNormalized).toContain("secondReviewedBy User? @relation");
    expect(schemaNormalized).toContain("ledgerEntry PointLedgerEntry?");
    expect(schemaNormalized).toContain("@@index([status, requiresSecondReview])");
    expect(schemaNormalized).toContain("@@index([childId, createdAt])");
    expect(schemaNormalized).toContain("@@index([batchKey])");
  });

  it("creates migration constraints for adjustment safety", () => {
    expect(migrationNormalized).toContain(
      'CREATE TABLE "PointAdjustmentRequest"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "PointAdjustmentRequest_idempotencyKey_key"'
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "PointAdjustmentRequest_requestedPoints_non_zero_check"'
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "PointAdjustmentRequest_reason_non_empty_check"'
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "PointAdjustmentRequest_reviewer_separation_check"'
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "PointAdjustmentRequest_status_review_fields_check"'
    );
  });

  it("records ledger check runs and diffs without mutating accounts", () => {
    expect(schemaNormalized).toContain("status LedgerCheckRunStatus");
    expect(schemaNormalized).toContain("checkedAccountCount Int @default(0)");
    expect(schemaNormalized).toContain("ledgerDiffCount Int @default(0)");
    expect(schemaNormalized).toContain("diffType LedgerCheckDiffType");
    expect(schemaNormalized).toContain("expectedAvailablePoints Int?");
    expect(schemaNormalized).toContain("actualAvailablePoints Int?");
    expect(schemaNormalized).toContain("run LedgerCheckRun @relation");
    expect(schemaNormalized).toContain("@@index([status, startedAt])");
    expect(schemaNormalized).toContain("@@index([runId, diffType])");
    expect(migrationNormalized).toContain('CREATE TABLE "LedgerCheckRun"');
    expect(migrationNormalized).toContain('CREATE TABLE "LedgerCheckDiff"');
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "LedgerCheckRun_counts_non_negative_check"'
    );
  });

  it("extends point accounts and ledger entries for stage4 totals and traceability", () => {
    expect(schemaNormalized).toContain("totalAwardedPoints Int @default(0)");
    expect(schemaNormalized).toContain("totalPenaltyPoints Int @default(0)");
    expect(schemaNormalized).toContain("adjustmentRequest PointAdjustmentRequest?");
    expect(migrationNormalized).toContain(
      'ALTER TABLE "PointAccount" ADD COLUMN "totalAwardedPoints"'
    );
    expect(migrationNormalized).toContain(
      'ADD COLUMN "totalPenaltyPoints" INTEGER NOT NULL DEFAULT 0'
    );
  });
});
