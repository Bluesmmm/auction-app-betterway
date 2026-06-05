import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260604000000_stage6_transaction_delivery_appeals/migration.sql",
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

describe("Stage 6 transaction delivery and appeal schema", () => {
  it("adds delivery and appeal enums", () => {
    expect(getBlock("enum", "TransactionSide")).toContain("buyer");
    expect(getBlock("enum", "TransactionSide")).toContain("seller");
    expect(getBlock("enum", "DeliveryMethod")).toContain("designated_point");
    expect(getBlock("enum", "DeliveryMethod")).toContain("guardian_arranged");
    expect(getBlock("enum", "DeliveryMethod")).toContain("courier");
    expect(getBlock("enum", "DeliveryPointStatus")).toContain("active");
    expect(getBlock("enum", "DeliveryPointStatus")).toContain("disabled");
    expect(getBlock("enum", "DeliveryRecordStatus")).toContain("pending");
    expect(getBlock("enum", "AppealTargetType")).toContain("transaction");
    expect(getBlock("enum", "AppealStatus")).toContain(
      "pending_activity_admin"
    );
    expect(getBlock("enum", "AppealStatus")).toContain("escalated_platform");
    expect(getBlock("enum", "AppealAttachmentStatus")).toContain(
      "pending_scan"
    );
    expect(getBlock("enum", "AppealAttachmentStatus")).toContain("accepted");
  });

  it("keeps guardian decision evidence additive for historical rows", () => {
    const guardianDecision = getBlock("model", "GuardianDecision");

    expect(guardianDecision).toContain("side TransactionSide?");
    expect(guardianDecision).toContain("childId String?");
    expect(guardianDecision).toContain("guardianRole GuardianRole?");
    expect(guardianDecision).toContain("transactionVersion Int?");
    expect(guardianDecision).toContain("reason String?");
    expect(guardianDecision).toContain(
      "child ChildProfile? @relation(fields: [childId], references: [id])"
    );
    expect(guardianDecision).toContain(
      "@@index([transactionId, phase, side, effective])"
    );
  });

  it("defines delivery points and delivery records", () => {
    const deliveryPoint = getBlock("model", "DeliveryPoint");
    const deliveryRecord = getBlock("model", "DeliveryRecord");
    const community = getBlock("model", "AuctionCommunity");
    const transaction = getBlock("model", "Transaction");

    expect(deliveryPoint).toContain("communityId String");
    expect(deliveryPoint).toContain("status DeliveryPointStatus @default(active)");
    expect(deliveryPoint).toContain(
      "community AuctionCommunity @relation(fields: [communityId], references: [id])"
    );
    expect(deliveryPoint).toContain("@@index([communityId, status])");
    expect(deliveryRecord).toContain("transactionId String @unique");
    expect(deliveryRecord).toContain("deliveryMethod DeliveryMethod");
    expect(deliveryRecord).toContain("deliveryPointId String?");
    expect(deliveryRecord).toContain("status DeliveryRecordStatus @default(pending)");
    expect(deliveryRecord).toContain(
      "transaction Transaction @relation(fields: [transactionId], references: [id])"
    );
    expect(community).toContain("deliveryPoints DeliveryPoint[]");
    expect(transaction).toContain("deliveryRecord DeliveryRecord?");
  });

  it("defines transaction appeals and private image attachments", () => {
    const appeal = getBlock("model", "Appeal");
    const attachment = getBlock("model", "AppealAttachment");
    const mediaAsset = getBlock("model", "MediaAsset");
    const guardian = getBlock("model", "GuardianProfile");
    const community = getBlock("model", "AuctionCommunity");
    const transaction = getBlock("model", "Transaction");

    expect(appeal).toContain("targetType AppealTargetType");
    expect(appeal).toContain("targetId String");
    expect(appeal).toContain("transactionId String?");
    expect(appeal).toContain("submittedByGuardianId String");
    expect(appeal).toContain("status AppealStatus @default(pending_activity_admin)");
    expect(appeal).toContain("reason String");
    expect(appeal).toContain("resolution String?");
    expect(appeal).toContain("@@index([communityId, status])");
    expect(attachment).toContain("appealId String");
    expect(attachment).toContain("mediaAssetId String @unique");
    expect(attachment).toContain("status AppealAttachmentStatus @default(pending_scan)");
    expect(attachment).toContain("sortOrder Int");
    expect(attachment).toContain("riskLabelsJson Json?");
    expect(attachment).toContain("@@unique([appealId, sortOrder])");
    expect(mediaAsset).toContain("appealAttachment AppealAttachment?");
    expect(guardian).toContain("submittedAppeals Appeal[]");
    expect(community).toContain("appeals Appeal[]");
    expect(transaction).toContain("appeals Appeal[]");
  });

  it("uses additive migration statements without forcing legacy guardian decision evidence", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "DeliveryMethod"');
    expect(migrationNormalized).toContain('CREATE TABLE "DeliveryPoint"');
    expect(migrationNormalized).toContain('CREATE TABLE "DeliveryRecord"');
    expect(migrationNormalized).toContain('CREATE TABLE "Appeal"');
    expect(migrationNormalized).toContain('CREATE TABLE "AppealAttachment"');
    expect(migrationNormalized).toContain(
      'ALTER TABLE "GuardianDecision" ADD COLUMN "side"'
    );
    expect(migrationNormalized).not.toContain(
      'ALTER COLUMN "side" SET NOT NULL'
    );
    expect(migrationNormalized).not.toMatch(
      /DROP COLUMN|DROP TABLE|RENAME COLUMN|RENAME TO/i
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "AppealAttachment_sort_order_range_check"'
    );
    expect(migrationNormalized).toContain(
      'ADD CONSTRAINT "Appeal_transaction_target_check"'
    );
  });
});
