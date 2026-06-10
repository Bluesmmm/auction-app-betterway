import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { NotificationsController } from "../../src/notifications/notifications.controller.js";
import { NotificationsService } from "../../src/notifications/notifications.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const tokens = new SessionTokenService("stage7-notifications-api-flow-key");
const sessions = new SessionService(prisma, tokens);
const notifications = new NotificationsService(prisma);
const controller = new NotificationsController(
  notifications,
  sessions,
  tokens
);
const targetPrefix = "stage7_notifications_api_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

describe("Stage 7 notifications API flow", () => {
  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists, counts, and marks only the authenticated user's notifications", async () => {
    const user = await prisma.user.create({
      data: {
        id: unique("user"),
        status: "active"
      }
    });
    const otherUser = await prisma.user.create({
      data: {
        id: unique("other_user"),
        status: "active"
      }
    });
    const grant = await sessions.createSession({
      userId: user.id,
      deviceFingerprintHash: unique("device"),
      ipHash: unique("ip"),
      userAgentHash: unique("ua"),
      now: new Date()
    });
    if (grant.result !== "accepted") {
      throw new Error("session fixture failed");
    }
    const notification = await prisma.notification.create({
      data: {
        id: unique("notification"),
        recipientUserId: user.id,
        type: "transaction_cancelled",
        priority: "high",
        mandatory: true,
        title: "交易已取消",
        body: "请打开交易详情查看最新状态。",
        relatedType: "transaction",
        relatedId: unique("transaction"),
        targetVersion: 2,
        deliveryStatus: "sent"
      }
    });
    await prisma.notification.create({
      data: {
        id: unique("other_notification"),
        recipientUserId: otherUser.id,
        type: "transaction_cancelled",
        priority: "high",
        mandatory: true,
        title: "其他用户通知",
        body: "这条通知不能被当前用户读取。",
        relatedType: "transaction",
        relatedId: unique("other_transaction"),
        targetVersion: 1,
        deliveryStatus: "sent"
      }
    });
    const auth = `Bearer ${grant.accessToken}`;

    await expect(controller.listNotifications({}, auth)).resolves.toMatchObject({
      result: "accepted",
      notifications: [
        expect.objectContaining({
          id: notification.id,
          relatedType: "transaction",
          targetVersion: 2,
          readAt: null
        })
      ]
    });
    await expect(controller.getUnreadCount({}, auth)).resolves.toMatchObject({
      result: "accepted",
      unreadCount: 1
    });
    await expect(controller.markRead(notification.id, auth)).resolves.toMatchObject({
      result: "accepted",
      targetId: notification.id,
      latestStatus: "read"
    });
    await expect(controller.getUnreadCount({}, auth)).resolves.toMatchObject({
      result: "accepted",
      unreadCount: 0
    });
  });
});

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Stage 7 notifications API tests require DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Stage 7 notifications API tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

async function cleanup() {
  await prisma.notification.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.userSession.deleteMany({
    where: {
      userId: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.trustedDevice.deleteMany({
    where: {
      userId: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
}
