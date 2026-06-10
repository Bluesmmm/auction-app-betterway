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
