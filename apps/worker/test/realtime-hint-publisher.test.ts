import { describe, expect, it, vi } from "vitest";
import {
  buildRealtimeHintFromOutboxEvent,
  RedisRealtimeHintPublisher,
  STAGE7_REALTIME_CHANNEL
} from "../src/realtime-hint-publisher.js";

describe("realtime hint publisher", () => {
  it("normalizes outbox events into refresh-only realtime hints", async () => {
    await expect(
      buildRealtimeHintFromOutboxEvent(
        {
          id: "outbox_1",
          eventType: "auction.bid_accepted",
          targetType: "bid",
          targetId: "bid_1",
          payloadJson: {
            auctionSessionId: "auction_1"
          }
        },
        {
          now: new Date("2026-06-10T01:00:00.000Z"),
          loadTargetVersion: vi.fn().mockResolvedValue(7)
        }
      )
    ).resolves.toEqual({
      kind: "stage7_realtime_hint",
      eventId: "outbox_1",
      serverTime: "2026-06-10T01:00:00.000Z",
      eventType: "auction.bid_accepted",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 7,
      refreshRequired: true
    });
  });

  it("publishes hints to the shared redis channel without mutating business state", async () => {
    const publish = vi.fn().mockResolvedValue(3);
    const publisher = new RedisRealtimeHintPublisher({
      publish
    });
    const event = {
      kind: "stage7_realtime_hint" as const,
      eventId: "outbox_2",
      serverTime: "2026-06-10T01:00:00.000Z",
      eventType: "transaction.completed",
      targetType: "transaction" as const,
      targetId: "transaction_1",
      targetVersion: 4,
      refreshRequired: true as const
    };

    await expect(publisher.publish(event)).resolves.toEqual({
      ok: true,
      mutatesBusinessState: false
    });
    expect(publish).toHaveBeenCalledWith(
      STAGE7_REALTIME_CHANNEL,
      JSON.stringify(event)
    );
  });

  it("turns redis errors into non-business-state publish failures", async () => {
    const publisher = new RedisRealtimeHintPublisher({
      publish: vi.fn().mockRejectedValue(new Error("redis unavailable"))
    });

    await expect(
      publisher.publish({
        kind: "stage7_realtime_hint",
        eventId: "outbox_3",
        serverTime: "2026-06-10T01:00:00.000Z",
        eventType: "auction.cancelled",
        targetType: "auction_session",
        targetId: "auction_2",
        targetVersion: 5,
        refreshRequired: true
      })
    ).resolves.toEqual({
      ok: false,
      errorCode: "REALTIME_HINT_PUBLISH_FAILED",
      mutatesBusinessState: false
    });
  });
});
