import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260603000000_stage5_auction_core/migration.sql",
  "utf8"
);

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const migrationNormalized = normalize(migration);

const getModelBlock = (modelName: string) => {
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start).toBeGreaterThanOrEqual(0);

  const remaining = schema.slice(start);
  const end = remaining.indexOf("\n}");
  expect(end).toBeGreaterThanOrEqual(0);

  return normalize(remaining.slice(0, end + 2));
};

const getMigrationStatement = (pattern: RegExp) => {
  const match = migrationNormalized.match(pattern);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
};

describe("Stage 5 auction core schema", () => {
  it("defines the Stage5 auction session fields and creator relation blocks", () => {
    const auctionSessionBlock = getModelBlock("AuctionSession");
    const userBlock = getModelBlock("User");

    expect(auctionSessionBlock).toContain("idempotencyKey String @unique");
    expect(auctionSessionBlock).toContain("createdByUserId String?");
    expect(auctionSessionBlock).toContain("createdAt DateTime @default(now())");
    expect(auctionSessionBlock).toContain("settledAt DateTime?");
    expect(auctionSessionBlock).toContain("cancelledAt DateTime?");
    expect(auctionSessionBlock).toContain("cancelReason String?");
    expect(auctionSessionBlock).toContain(
      "settlementAttemptCount Int @default(0)"
    );
    expect(auctionSessionBlock).toContain("lastSettlementError String?");
    expect(auctionSessionBlock).toContain("itemId String @unique");
    expect(auctionSessionBlock).toContain(
      'createdBy User? @relation("AuctionSessionCreatedBy", fields: [createdByUserId], references: [id])'
    );
    expect(auctionSessionBlock).toContain("@@index([status, endAt])");
    expect(auctionSessionBlock).toContain("@@index([itemId, status])");
    expect(userBlock).toContain(
      'createdAuctionSessions AuctionSession[] @relation("AuctionSessionCreatedBy")'
    );
  });

  it("defines bid invalidation timestamps inside Bid", () => {
    const bidBlock = getModelBlock("Bid");

    expect(bidBlock).toContain("withdrawnAt DateTime?");
    expect(bidBlock).toContain("outbidAt DateTime?");
    expect(bidBlock).toContain("invalidatedAt DateTime?");
  });

  it("keeps PointHold.bidId as a one-to-one unique relation inside PointHold", () => {
    const pointHoldBlock = getModelBlock("PointHold");

    expect(pointHoldBlock).toContain("bidId String? @unique");
  });

  it("backfills idempotency and createdAt without inventing legacy creators", () => {
    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ADD COLUMN "idempotencyKey" TEXT, ADD COLUMN "createdByUserId" TEXT, ADD COLUMN "createdAt" TIMESTAMP\(3\), ADD COLUMN "settledAt" TIMESTAMP\(3\), ADD COLUMN "cancelledAt" TIMESTAMP\(3\), ADD COLUMN "cancelReason" TEXT, ADD COLUMN "settlementAttemptCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastSettlementError" TEXT;/
      )
    ).toContain('ADD COLUMN "createdAt" TIMESTAMP(3)');

    expect(
      getMigrationStatement(
        /UPDATE "AuctionSession" SET "idempotencyKey" = CONCAT\('legacy-auction-session:', "id"\) WHERE "idempotencyKey" IS NULL;/
      )
    ).toContain('legacy-auction-session:');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ALTER COLUMN "idempotencyKey" SET NOT NULL;/
      )
    ).toContain('ALTER COLUMN "idempotencyKey" SET NOT NULL');

    expect(
      getMigrationStatement(
        /CREATE UNIQUE INDEX "AuctionSession_idempotencyKey_key" ON "AuctionSession"\("idempotencyKey"\);/
      )
    ).toContain('CREATE UNIQUE INDEX "AuctionSession_idempotencyKey_key"');

    expect(
      getMigrationStatement(
        /UPDATE "AuctionSession" SET "createdAt" = "startAt" WHERE "createdAt" IS NULL;/
      )
    ).toContain('"startAt"');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN "createdAt" SET NOT NULL;/
      )
    ).toContain('ALTER COLUMN "createdAt" SET NOT NULL');

    expect(migrationNormalized).not.toContain('JOIN "ChildProfile"');
    expect(migrationNormalized).not.toContain(
      'ALTER COLUMN "createdByUserId" SET NOT NULL'
    );
    expect(
      migrationNormalized.indexOf(
        'UPDATE "AuctionSession" SET "createdAt" = "startAt" WHERE "createdAt" IS NULL;'
      )
    ).toBeLessThan(
      migrationNormalized.indexOf(
        'ALTER TABLE "AuctionSession" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN "createdAt" SET NOT NULL;'
      )
    );
  });

  it("adds the duplicate item preflight gate before the itemId unique index", () => {
    expect(
      getMigrationStatement(
        /DO \$\$ BEGIN IF EXISTS \( SELECT 1 FROM "AuctionSession" GROUP BY "itemId" HAVING COUNT\(\*\) > 1 \) THEN RAISE EXCEPTION 'Stage5 requires one auction session per item before creating the unique index on AuctionSession\.itemId'; END IF; END \$\$;/
      )
    ).toContain('GROUP BY "itemId" HAVING COUNT(*) > 1');

    expect(
      getMigrationStatement(
        /CREATE UNIQUE INDEX "AuctionSession_itemId_key" ON "AuctionSession"\("itemId"\);/
      )
    ).toContain('CREATE UNIQUE INDEX "AuctionSession_itemId_key"');

    expect(
      migrationNormalized.indexOf(
        `DO $$ BEGIN IF EXISTS ( SELECT 1 FROM "AuctionSession" GROUP BY "itemId" HAVING COUNT(*) > 1 ) THEN RAISE EXCEPTION 'Stage5 requires one auction session per item before creating the unique index on AuctionSession.itemId'; END IF; END $$;`
      )
    ).toBeLessThan(
      migrationNormalized.indexOf(
        'CREATE UNIQUE INDEX "AuctionSession_itemId_key" ON "AuctionSession"("itemId");'
      )
    );
  });

  it("drops the legacy checks and adds the Stage5 exact-name constraints", () => {
    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" DROP CONSTRAINT "AuctionSession_points_and_version_check";/
      )
    ).toContain('"AuctionSession_points_and_version_check"');

    expect(
      getMigrationStatement(
        /ALTER TABLE "Bid" DROP CONSTRAINT "Bid_amount_positive_check";/
      )
    ).toContain('"Bid_amount_positive_check"');

    expect(
      getMigrationStatement(
        /ALTER TABLE "PointHold" DROP CONSTRAINT "PointHold_amount_positive_check";/
      )
    ).toContain('"PointHold_amount_positive_check"');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_start_points_positive_check" CHECK \("startPoints" > 0\);/
      )
    ).toContain('CHECK ("startPoints" > 0)');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_min_increment_positive_check" CHECK \("minIncrementPoints" > 0\);/
      )
    ).toContain('CHECK ("minIncrementPoints" > 0)');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_current_price_non_negative_check" CHECK \("currentPricePoints" >= 0\);/
      )
    ).toContain('CHECK ("currentPricePoints" >= 0)');

    expect(
      getMigrationStatement(
        /ALTER TABLE "AuctionSession" ADD CONSTRAINT "AuctionSession_version_positive_check" CHECK \("version" > 0\);/
      )
    ).toContain('CHECK ("version" > 0)');

    expect(
      getMigrationStatement(
        /ALTER TABLE "Bid" ADD CONSTRAINT "Bid_amount_points_positive_check" CHECK \("amountPoints" > 0\);/
      )
    ).toContain('CHECK ("amountPoints" > 0)');

    expect(
      getMigrationStatement(
        /ALTER TABLE "PointHold" ADD CONSTRAINT "PointHold_amount_points_positive_check" CHECK \("amountPoints" > 0\);/
      )
    ).toContain('CHECK ("amountPoints" > 0)');
  });
});
