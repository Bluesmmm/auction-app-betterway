import { describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../../src/config/app-config.service.js";
import { RealtimeGatewayService } from "../../src/realtime/realtime-gateway.service.js";
import type { RealtimePermissionService } from "../../src/realtime/realtime-permission.service.js";
import type { SessionService } from "../../src/accounts/session.service.js";
import type { SessionTokenService } from "../../src/accounts/session-token.service.js";

describe("RealtimeGatewayService", () => {
  it("subscribes authorized rooms and forwards only newer deduped hints", async () => {
    const sent: unknown[] = [];
    const gateway = createGateway({
      authorizeRoom: vi.fn().mockResolvedValue({ result: "accepted" })
    });
    const connectionId = gateway.registerConnection("user_1", {
      readyState: 1,
      send(data) {
        sent.push(JSON.parse(data));
      },
      close() {}
    });

    await gateway.handleSubscribe(connectionId, {
      requestId: "req_1",
      room: {
        kind: "auction",
        childId: "child_1",
        auctionSessionId: "auction_1"
      },
      knownTargetVersion: 3
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "event_old",
      serverTime: "2026-06-10T01:00:00.000Z",
      eventType: "auction.bid_outbid",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 3,
      refreshRequired: true
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "event_new",
      serverTime: "2026-06-10T01:00:01.000Z",
      eventType: "auction.bid_outbid",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 4,
      refreshRequired: true
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "event_new",
      serverTime: "2026-06-10T01:00:01.000Z",
      eventType: "auction.bid_outbid",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 4,
      refreshRequired: true
    });

    expect(sent).toEqual([
      {
        type: "subscribed",
        requestId: "req_1",
        roomId: "auction:child_1:auction_1",
        refreshRequired: true
      },
      {
        type: "hint",
        event: expect.objectContaining({
          eventId: "event_new",
          targetVersion: 4,
          refreshRequired: true
        }),
        refreshRequired: true
      }
    ]);
  });

  it("rejects unauthorized rooms and revokes subscriptions when permission is lost", async () => {
    const sent: unknown[] = [];
    const permissions = {
      authorizeRoom: vi
        .fn()
        .mockResolvedValueOnce({ result: "accepted" })
        .mockResolvedValueOnce({
          result: "rejected",
          errorCode: "REALTIME_ROOM_FORBIDDEN"
        })
        .mockResolvedValueOnce({
          result: "rejected",
          errorCode: "REALTIME_ROOM_FORBIDDEN"
        })
    };
    const gateway = createGateway(permissions);
    const connectionId = gateway.registerConnection("user_2", {
      readyState: 1,
      send(data) {
        sent.push(JSON.parse(data));
      },
      close() {}
    });

    await gateway.handleSubscribe(connectionId, {
      requestId: "req_2",
      room: {
        kind: "auction",
        childId: "child_2",
        auctionSessionId: "auction_2"
      }
    });
    await gateway.handleSubscribe(connectionId, {
      requestId: "req_3",
      room: {
        kind: "auction",
        childId: "child_2",
        auctionSessionId: "auction_3"
      }
    });
    await gateway.pruneUnauthorizedSubscriptions();

    expect(sent).toEqual([
      {
        type: "subscribed",
        requestId: "req_2",
        roomId: "auction:child_2:auction_2",
        refreshRequired: true
      },
      {
        type: "rejected",
        requestId: "req_3",
        errorCode: "REALTIME_ROOM_FORBIDDEN",
        refreshRequired: true
      },
      {
        type: "subscription_revoked",
        roomId: "auction:child_2:auction_2",
        reason: "PERMISSION_REVOKED",
        refreshRequired: true
      }
    ]);
  });

  it("forwards notification hints only to the targeted actor", async () => {
    const userOneSent: unknown[] = [];
    const userTwoSent: unknown[] = [];
    const gateway = createGateway({
      authorizeRoom: vi.fn().mockResolvedValue({ result: "accepted" })
    });
    const userOneConnectionId = gateway.registerConnection("user_1", {
      readyState: 1,
      send(data) {
        userOneSent.push(JSON.parse(data));
      },
      close() {}
    });
    const userTwoConnectionId = gateway.registerConnection("user_2", {
      readyState: 1,
      send(data) {
        userTwoSent.push(JSON.parse(data));
      },
      close() {}
    });

    await gateway.handleSubscribe(userOneConnectionId, {
      requestId: "req_user_1",
      room: {
        kind: "notifications"
      }
    });
    await gateway.handleSubscribe(userTwoConnectionId, {
      requestId: "req_user_2",
      room: {
        kind: "notifications"
      }
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "event_notifications",
      serverTime: "2026-06-10T01:00:02.000Z",
      eventType: "notifications.updated",
      targetType: "notifications",
      targetId: "user_1",
      targetVersion: 1,
      refreshRequired: true
    });

    expect(userOneSent).toEqual([
      {
        type: "subscribed",
        requestId: "req_user_1",
        roomId: "notifications:__user__",
        refreshRequired: true
      },
      {
        type: "hint",
        event: expect.objectContaining({
          eventId: "event_notifications",
          targetType: "notifications",
          targetId: "user_1"
        }),
        refreshRequired: true
      }
    ]);
    expect(userTwoSent).toEqual([
      {
        type: "subscribed",
        requestId: "req_user_2",
        roomId: "notifications:__user__",
        refreshRequired: true
      }
    ]);
  });

  it("does not dedupe notification and business hints with the same outbox event id", async () => {
    const sent: unknown[] = [];
    const gateway = createGateway({
      authorizeRoom: vi.fn().mockResolvedValue({ result: "accepted" })
    });
    const connectionId = gateway.registerConnection("user_1", {
      readyState: 1,
      send(data) {
        sent.push(JSON.parse(data));
      },
      close() {}
    });

    await gateway.handleSubscribe(connectionId, {
      requestId: "req_auction",
      room: {
        kind: "auction",
        childId: "child_1",
        auctionSessionId: "auction_1"
      }
    });
    await gateway.handleSubscribe(connectionId, {
      requestId: "req_notifications",
      room: {
        kind: "notifications"
      }
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "shared_event",
      serverTime: "2026-06-10T01:00:03.000Z",
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 4,
      refreshRequired: true
    });
    await gateway.publishHint({
      kind: "stage7_realtime_hint",
      eventId: "shared_event",
      serverTime: "2026-06-10T01:00:03.000Z",
      eventType: "notifications.updated",
      targetType: "notifications",
      targetId: "user_1",
      targetVersion: 2,
      refreshRequired: true
    });

    expect(sent).toEqual([
      expect.objectContaining({
        type: "subscribed",
        requestId: "req_auction"
      }),
      expect.objectContaining({
        type: "subscribed",
        requestId: "req_notifications"
      }),
      {
        type: "hint",
        event: expect.objectContaining({
          eventId: "shared_event",
          targetType: "auction_session",
          targetId: "auction_1"
        }),
        refreshRequired: true
      },
      {
        type: "hint",
        event: expect.objectContaining({
          eventId: "shared_event",
          targetType: "notifications",
          targetId: "user_1"
        }),
        refreshRequired: true
      }
    ]);
  });
});

function createGateway(permissions: {
  authorizeRoom: RealtimePermissionService["authorizeRoom"];
}) {
  return new RealtimeGatewayService(
    permissions as RealtimePermissionService,
    {} as SessionTokenService,
    {} as SessionService,
    {
      redisUrl: "redis://localhost:6379"
    } as AppConfigService
  );
}
