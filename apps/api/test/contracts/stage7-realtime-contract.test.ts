import {
  isNewerRealtimeHint,
  parseRealtimeHintEvent,
  realtimeRoomId
} from "@auction/shared";
import { describe, expect, it } from "vitest";

describe("Stage 7 realtime shared contract", () => {
  it("requires hint frames to include event identity, target, version, and refresh intent", () => {
    const event = parseRealtimeHintEvent({
      kind: "stage7_realtime_hint",
      eventId: "outbox_1",
      serverTime: "2026-06-10T01:00:00.000Z",
      eventType: "auction.bid_outbid",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 3,
      refreshRequired: true
    });

    expect(event).toEqual({
      kind: "stage7_realtime_hint",
      eventId: "outbox_1",
      serverTime: "2026-06-10T01:00:00.000Z",
      eventType: "auction.bid_outbid",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 3,
      refreshRequired: true
    });
    expect(parseRealtimeHintEvent({ eventId: "outbox_1" })).toBeNull();
    expect(
      parseRealtimeHintEvent({
        kind: "stage7_realtime_hint",
        eventId: "outbox_1",
        serverTime: "not-a-date",
        eventType: "auction.bid_outbid",
        targetType: "auction_session",
        targetId: "auction_1",
        targetVersion: 3,
        refreshRequired: true
      })
    ).toBeNull();
  });

  it("builds deterministic room ids and suppresses stale target versions", () => {
    expect(
      realtimeRoomId({
        kind: "auction",
        childId: "child_1",
        auctionSessionId: "auction_1"
      })
    ).toBe("auction:child_1:auction_1");
    expect(
      realtimeRoomId({
        kind: "notifications"
      })
    ).toBe("notifications:__user__");
    expect(isNewerRealtimeHint({ targetVersion: 4 }, 3)).toBe(true);
    expect(isNewerRealtimeHint({ targetVersion: 4 }, 4)).toBe(false);
    expect(isNewerRealtimeHint({ targetVersion: 4 }, 5)).toBe(false);
  });
});
