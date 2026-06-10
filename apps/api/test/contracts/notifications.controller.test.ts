import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { NotificationsController } from "../../src/notifications/notifications.controller.js";
import type { NotificationsService } from "../../src/notifications/notifications.service.js";

const tokens = new SessionTokenService("notifications-controller-test-key");

describe("NotificationsController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists notifications for the bearer actor without accepting a recipient user override", async () => {
    setServerTime("2026-06-09T10:00:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.listNotifications).mockResolvedValue({
      result: "accepted",
      nextCursor: null,
      notifications: [
        {
          id: "notification_1",
          type: "transaction_cancelled",
          priority: "high",
          mandatory: true,
          title: "交易已取消",
          body: "请打开交易详情查看最新状态。",
          relatedType: "transaction",
          relatedId: "txn_1",
          targetVersion: 4,
          actionType: "view_transaction",
          deliveryStatus: "sent",
          readAt: null,
          createdAt: "2026-06-09T09:59:00.000Z"
        }
      ]
    });

    await expect(
      controller.listNotifications(
        {
          recipientChildId: "child_1",
          unreadOnly: "true",
          limit: "10"
        },
        bearerToken("guardian_user_1", "session_1")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      serverTime: "2026-06-09T10:00:00.000Z",
      targetType: "notifications",
      targetId: "guardian_user_1",
      notifications: [
        expect.objectContaining({
          id: "notification_1",
          relatedType: "transaction",
          relatedId: "txn_1",
          actionType: "view_transaction",
          targetVersion: 4
        })
      ]
    });
    expect(notifications.listNotifications).toHaveBeenCalledWith({
      actorUserId: "guardian_user_1",
      recipientChildId: "child_1",
      unreadOnly: true,
      cursor: undefined,
      limit: 10
    });
  });

  it("counts unread notifications for the bearer actor", async () => {
    setServerTime("2026-06-09T10:05:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.countUnread).mockResolvedValue({
      result: "accepted",
      unreadCount: 3
    });

    await expect(
      controller.getUnreadCount(
        {
          recipientChildId: "child_2"
        },
        bearerToken("guardian_user_2", "session_2")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "notifications_unread_count",
      targetId: "guardian_user_2",
      unreadCount: 3
    });
    expect(notifications.countUnread).toHaveBeenCalledWith({
      actorUserId: "guardian_user_2",
      recipientChildId: "child_2"
    });
  });

  it("marks only the bearer actor's notification as read", async () => {
    setServerTime("2026-06-09T10:10:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.markRead).mockResolvedValue({
      result: "accepted",
      notificationId: "notification_2",
      readAt: "2026-06-09T10:10:00.000Z"
    });

    await expect(
      controller.markRead(
        "notification_2",
        bearerToken("guardian_user_3", "session_3")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "notification",
      targetId: "notification_2",
      latestStatus: "read",
      readAt: "2026-06-09T10:10:00.000Z"
    });
    expect(notifications.markRead).toHaveBeenCalledWith({
      actorUserId: "guardian_user_3",
      notificationId: "notification_2",
      now: new Date("2026-06-09T10:10:00.000Z")
    });
  });

  it("rejects marking another actor's missing notification as read", async () => {
    setServerTime("2026-06-09T10:15:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.markRead).mockResolvedValue({
      result: "rejected",
      errorCode: "NOTIFICATION_NOT_FOUND"
    });

    await expect(
      controller.markRead(
        "notification_3",
        bearerToken("guardian_user_4", "session_4")
      )
    ).resolves.toEqual({
      result: "rejected",
      serverTime: "2026-06-09T10:15:00.000Z",
      targetType: "notification",
      targetId: "notification_3",
      targetVersion: 1,
      latestStatus: "rejected",
      refreshRequired: false,
      errorCode: "NOTIFICATION_NOT_FOUND"
    });
  });

  it("marks all bearer actor notifications as read with optional child scope", async () => {
    setServerTime("2026-06-09T10:20:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.markAllRead).mockResolvedValue({
      result: "accepted",
      readCount: 2,
      readAt: "2026-06-09T10:20:00.000Z"
    });

    await expect(
      controller.markAllRead(
        {
          recipientChildId: "child_5"
        },
        bearerToken("guardian_user_5", "session_5")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "notifications",
      latestStatus: "read",
      readCount: 2
    });
    expect(notifications.markAllRead).toHaveBeenCalledWith({
      actorUserId: "guardian_user_5",
      recipientChildId: "child_5",
      now: new Date("2026-06-09T10:20:00.000Z")
    });
  });

  it("lists notification preferences for the bearer actor child scope", async () => {
    setServerTime("2026-06-09T10:25:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.listPreferences).mockResolvedValue({
      result: "accepted",
      preferences: [
        {
          id: "preference_1",
          userId: "guardian_user_6",
          childId: "child_6",
          eventType: "auction_bid_outbid",
          inAppEnabled: true,
          wechatSubscribeEnabled: false,
          childVisible: true,
          createdAt: "2026-06-09T09:00:00.000Z",
          updatedAt: "2026-06-09T09:30:00.000Z"
        }
      ]
    });

    await expect(
      controller.listPreferences(
        {
          recipientChildId: "child_6"
        },
        bearerToken("guardian_user_6", "session_6")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "notification_preferences",
      targetId: "guardian_user_6",
      preferences: [
        expect.objectContaining({
          eventType: "auction_bid_outbid",
          childVisible: true
        })
      ]
    });
    expect(notifications.listPreferences).toHaveBeenCalledWith({
      actorUserId: "guardian_user_6",
      childId: "child_6"
    });
  });

  it("updates notification preference without accepting a user override", async () => {
    setServerTime("2026-06-09T10:30:00.000Z");
    const { controller, notifications } = createController();
    vi.mocked(notifications.updatePreference).mockResolvedValue({
      result: "accepted",
      preference: {
        id: "preference_2",
        userId: "guardian_user_7",
        childId: "child_7",
        eventType: "auction_bid_outbid",
        inAppEnabled: false,
        wechatSubscribeEnabled: true,
        childVisible: false,
        createdAt: "2026-06-09T09:00:00.000Z",
        updatedAt: "2026-06-09T10:30:00.000Z"
      }
    });

    await expect(
      controller.updatePreference(
        "auction_bid_outbid",
        {
          recipientChildId: "child_7",
          inAppEnabled: false,
          wechatSubscribeEnabled: true
        },
        bearerToken("guardian_user_7", "session_7")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "notification_preference",
      targetId: "auction_bid_outbid",
      preference: expect.objectContaining({
        inAppEnabled: false,
        wechatSubscribeEnabled: true
      })
    });
    expect(notifications.updatePreference).toHaveBeenCalledWith({
      actorUserId: "guardian_user_7",
      eventType: "auction_bid_outbid",
      childId: "child_7",
      inAppEnabled: false,
      wechatSubscribeEnabled: true,
      childVisible: undefined,
      now: new Date("2026-06-09T10:30:00.000Z")
    });
  });
});

function createController() {
  const sessions = {
    assertActiveSession: vi.fn().mockResolvedValue({
      result: "accepted"
    })
  } as unknown as SessionService;
  const notifications = {
    listNotifications: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    listPreferences: vi.fn(),
    updatePreference: vi.fn()
  } as unknown as NotificationsService;

  return {
    controller: new NotificationsController(notifications, sessions, tokens),
    notifications
  };
}

function bearerToken(userId: string, sessionId: string) {
  const token = tokens.createAccessToken({
    userId,
    sessionId,
    expiresAt: new Date("2026-06-09T11:00:00.000Z")
  });
  return `Bearer ${token}`;
}

function setServerTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
