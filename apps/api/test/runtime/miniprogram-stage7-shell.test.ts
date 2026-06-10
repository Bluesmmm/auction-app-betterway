import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("miniprogram stage7 notification shell", () => {
  it("registers the notifications and search pages", () => {
    const app = readFileSync("apps/miniprogram/app.json", "utf8");

    expect(app).toContain("pages/stage7/notifications/index");
    expect(app).toContain("pages/stage7/search/index");
    expect(app).toContain("pages/stage7/realtime/index");
  });

  it("builds stage7 notification helpers and keeps target refresh explicit", () => {
    const api = readFileSync("apps/miniprogram/src/stage7-api.ts", "utf8");
    const page = readFileSync(
      "apps/miniprogram/pages/stage7/notifications/index.ts",
      "utf8"
    );

    expect(api).toContain("/notifications");
    expect(api).toContain("/notifications/unread-count");
    expect(api).toContain("/read");
    expect(api).toContain("/notifications/read-all");
    expect(api).toContain("/notifications/preferences");
    expect(api).toContain("buildStage7NotificationListRequest");
    expect(api).toContain("buildStage7UnreadCountRequest");
    expect(api).toContain("buildStage7MarkNotificationReadRequest");
    expect(api).toContain("buildStage7MarkAllNotificationsReadRequest");
    expect(api).toContain("buildStage7NotificationPreferencesRequest");
    expect(api).toContain("buildStage7UpdateNotificationPreferenceRequest");
    expect(api).toContain("parseStage7NotificationTarget");
    expect(api).toContain("resolveStage7NotificationAction");
    expect(page).toContain("stage7NotificationsPage");
    expect(page).toContain("loadNotifications");
    expect(page).toContain("loadUnreadCount");
    expect(page).toContain("markNotificationRead");
    expect(page).toContain("markAllNotificationsRead");
    expect(page).toContain("loadPreferences");
    expect(page).toContain("updatePreference");
    expect(page).toContain("resolveNotificationTarget");
    expect(page).toContain("resolveNotificationAction");
    expect(page).not.toContain("latestStatus ===");
    expect(page).not.toContain("deliveryStatus ===");
  });

  it("builds stage7 search and favorite helpers without local visibility decisions", () => {
    const api = readFileSync("apps/miniprogram/src/stage7-api.ts", "utf8");
    const page = readFileSync(
      "apps/miniprogram/pages/stage7/search/index.ts",
      "utf8"
    );

    expect(api).toContain("/stage7/search");
    expect(api).toContain("/stage7/favorites/items");
    expect(api).toContain("/remove");
    expect(api).toContain("buildStage7SearchRequest");
    expect(api).toContain("buildStage7FavoriteListRequest");
    expect(api).toContain("buildStage7FavoriteItemRequest");
    expect(api).toContain("buildStage7RemoveFavoriteItemRequest");
    expect(page).toContain("stage7SearchPage");
    expect(page).toContain("searchCommunityContent");
    expect(page).toContain("loadFavoriteItems");
    expect(page).toContain("favoriteItem");
    expect(page).toContain("removeFavoriteItem");
    expect(page).not.toContain("visibilityStatus ===");
    expect(page).not.toContain("favoriteCount >");
    expect(page).not.toContain("bidCount >");
  });

  it("builds stage7 realtime helpers and reconnect compensation without local adjudication", () => {
    const api = readFileSync("apps/miniprogram/src/stage7-api.ts", "utf8");
    const page = readFileSync(
      "apps/miniprogram/pages/stage7/realtime/index.ts",
      "utf8"
    );

    expect(api).toContain("/stage7/realtime");
    expect(api).toContain("buildStage7RealtimeUrl");
    expect(api).toContain("buildStage7RealtimeSubscribeMessage");
    expect(api).toContain("parseStage7RealtimeServerFrame");
    expect(api).toContain("parseStage7RealtimeHint");
    expect(api).toContain("buildStage7RealtimeCompensationRequests");
    expect(api).toContain("buildStage7TransactionDetailCompensationRequest");
    expect(page).toContain("stage7RealtimePage");
    expect(page).toContain("connectRealtime");
    expect(page).toContain("subscribeRoom");
    expect(page).toContain("handleRealtimeMessage");
    expect(page).toContain("handleRealtimeHint");
    expect(page).toContain("markDisconnected");
    expect(page).toContain("buildReconnectRefreshRequests");
    expect(page).toContain("refreshRequired");
    expect(page).toContain("unreadDot");
    expect(page).not.toContain("currentPricePoints =");
    expect(page).not.toContain("latestStatus =");
    expect(page).not.toContain("pointsAmount =");
  });
});
