-- Stage 7 notification facts and preferences.
CREATE TYPE "NotificationType" AS ENUM (
    'auction_bid_accepted',
    'auction_bid_outbid',
    'auction_bid_withdrawn',
    'auction_settled',
    'auction_unsold',
    'auction_cancelled',
    'transaction_guardian_confirmed',
    'transaction_cancelled',
    'transaction_completed',
    'transaction_disputed',
    'transaction_platform_review_required'
);

CREATE TYPE "NotificationPriority" AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);

CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
    'pending',
    'sent',
    'failed',
    'suppressed'
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientChildId" TEXT,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'normal',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "relatedType" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL,
    "eventId" TEXT,
    "targetVersion" INTEGER,
    "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childId" TEXT,
    "eventType" TEXT NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "wechatSubscribeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "childVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx"
    ON "Notification"("recipientUserId", "readAt", "createdAt");

CREATE INDEX "Notification_recipientUserId_recipientChildId_readAt_createdAt_idx"
    ON "Notification"("recipientUserId", "recipientChildId", "readAt", "createdAt");

CREATE INDEX "Notification_eventId_recipientUserId_recipientChildId_type_idx"
    ON "Notification"("eventId", "recipientUserId", "recipientChildId", "type");

CREATE INDEX "Notification_relatedType_relatedId_createdAt_idx"
    ON "Notification"("relatedType", "relatedId", "createdAt");

CREATE UNIQUE INDEX "Notification_outbox_recipient_child_type_key"
    ON "Notification"(
        "eventId",
        "recipientUserId",
        COALESCE("recipientChildId", '__none__'),
        "type"
    )
    WHERE "eventId" IS NOT NULL;

CREATE INDEX "NotificationPreference_userId_eventType_idx"
    ON "NotificationPreference"("userId", "eventType");

CREATE UNIQUE INDEX "NotificationPreference_userId_childId_eventType_key"
    ON "NotificationPreference"("userId", "childId", "eventType");

CREATE UNIQUE INDEX "NotificationPreference_user_child_event_key"
    ON "NotificationPreference"(
        "userId",
        COALESCE("childId", '__none__'),
        "eventType"
    );

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_recipientUserId_fkey"
    FOREIGN KEY ("recipientUserId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_recipientChildId_fkey"
    FOREIGN KEY ("recipientChildId")
    REFERENCES "ChildProfile"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_eventId_fkey"
    FOREIGN KEY ("eventId")
    REFERENCES "OutboxEvent"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_childId_fkey"
    FOREIGN KEY ("childId")
    REFERENCES "ChildProfile"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
