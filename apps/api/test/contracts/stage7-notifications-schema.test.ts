import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260605000000_stage7_notifications/migration.sql",
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

describe("Stage 7 notification schema", () => {
  it("adds notification enums for type, priority, and delivery status", () => {
    const type = getBlock("enum", "NotificationType");
    expect(type).toContain("auction_bid_accepted");
    expect(type).toContain("auction_settled");
    expect(type).toContain("transaction_platform_review_required");

    const priority = getBlock("enum", "NotificationPriority");
    expect(priority).toContain("low");
    expect(priority).toContain("normal");
    expect(priority).toContain("high");
    expect(priority).toContain("urgent");

    const delivery = getBlock("enum", "NotificationDeliveryStatus");
    expect(delivery).toContain("pending");
    expect(delivery).toContain("sent");
    expect(delivery).toContain("failed");
    expect(delivery).toContain("suppressed");
  });

  it("defines persisted user-visible notifications", () => {
    const notification = getBlock("model", "Notification");
    const user = getBlock("model", "User");
    const child = getBlock("model", "ChildProfile");
    const outbox = getBlock("model", "OutboxEvent");

    expect(notification).toContain("recipientUserId String");
    expect(notification).toContain("recipientChildId String?");
    expect(notification).toContain("type NotificationType");
    expect(notification).toContain(
      "priority NotificationPriority @default(normal)"
    );
    expect(notification).toContain("mandatory Boolean @default(false)");
    expect(notification).toContain("relatedType String");
    expect(notification).toContain("relatedId String");
    expect(notification).toContain("eventId String?");
    expect(notification).toContain("targetVersion Int?");
    expect(notification).toContain(
      "deliveryStatus NotificationDeliveryStatus @default(pending)"
    );
    expect(notification).toContain("readAt DateTime?");
    expect(notification).toContain(
      "@@index([eventId, recipientUserId, recipientChildId, type])"
    );
    expect(user).toContain("notifications Notification[]");
    expect(child).toContain("notifications Notification[]");
    expect(outbox).toContain("notifications Notification[]");
  });

  it("defines notification preferences without requiring a preference UI", () => {
    const preference = getBlock("model", "NotificationPreference");
    const user = getBlock("model", "User");
    const child = getBlock("model", "ChildProfile");

    expect(preference).toContain("userId String");
    expect(preference).toContain("childId String?");
    expect(preference).toContain("eventType String");
    expect(preference).toContain("inAppEnabled Boolean @default(true)");
    expect(preference).toContain(
      "wechatSubscribeEnabled Boolean @default(false)"
    );
    expect(preference).toContain("childVisible Boolean @default(false)");
    expect(preference).toContain("@@unique([userId, childId, eventType])");
    expect(user).toContain("notificationPreferences NotificationPreference[]");
    expect(child).toContain(
      "notificationPreferences NotificationPreference[]"
    );
  });

  it("uses additive migration statements and nullable-child dedupe indexes", () => {
    expect(migrationNormalized).toContain('CREATE TYPE "NotificationType"');
    expect(migrationNormalized).toContain('CREATE TABLE "Notification"');
    expect(migrationNormalized).toContain(
      'CREATE TABLE "NotificationPreference"'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "Notification_outbox_recipient_child_type_key"'
    );
    expect(migrationNormalized).toContain(
      'COALESCE("recipientChildId", \'__none__\')'
    );
    expect(migrationNormalized).toContain(
      'CREATE UNIQUE INDEX "NotificationPreference_user_child_event_key"'
    );
    expect(migrationNormalized).not.toMatch(
      /DROP COLUMN|DROP TABLE|RENAME COLUMN|RENAME TO/i
    );
  });
});
