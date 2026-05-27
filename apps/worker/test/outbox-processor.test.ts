import { describe, expect, it } from "vitest";
import { processOutboxNotification } from "../src/outbox-processor.js";

const payload = {
  outboxEventId: "outbox_1",
  eventType: "notification.auction_outbid",
  targetType: "auction_session",
  targetId: "auction_1",
  idempotencyKey: "outbox_notification_1",
  payloadJson: {
    recipientUserId: "user_1"
  }
};

describe("outbox notification processor", () => {
  it("derives notification delivery from outbox payloads without business mutation", async () => {
    const result = await processOutboxNotification(payload, {
      async send() {
        return {
          ok: true,
          providerMessageId: "provider_1",
          mutatesBusinessState: false
        };
      }
    });

    expect(result).toEqual({
      result: "sent",
      outboxEventId: "outbox_1",
      providerMessageId: "provider_1",
      mutatesBusinessState: false
    });
  });

  it("fails notification delivery without claiming business success", async () => {
    const result = await processOutboxNotification(payload, {
      async send() {
        return {
          ok: false,
          errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
          mutatesBusinessState: false
        };
      }
    });

    expect(result).toEqual({
      result: "failed",
      outboxEventId: "outbox_1",
      errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
      retryable: true,
      mutatesBusinessState: false
    });
  });
});
