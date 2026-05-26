import { describe, expect, it } from "vitest";
import {
  AuctionSessionStatus,
  TransactionStatus,
  createIdempotencyFingerprint,
  writeAccepted,
  writeUnknown
} from "@auction/shared";

describe("shared implementation contracts", () => {
  it("keeps auction and transaction status machines separated", () => {
    expect(AuctionSessionStatus).toContain("settled");
    expect(AuctionSessionStatus).not.toContain("pending_guardian_confirm");
    expect(TransactionStatus).toContain("pending_guardian_confirm");
    expect(TransactionStatus).toContain("platform_review");
  });

  it("builds adjudicated write responses instead of bare success", () => {
    const response = writeAccepted({
      serverTime: "2026-05-26T12:00:00.000Z",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 3,
      latestStatus: "active"
    });

    expect(response.result).toBe("accepted");
    expect(response.refreshRequired).toBe(false);
    expect(response.targetVersion).toBe(3);
  });

  it("marks unknown write results as refresh required", () => {
    const response = writeUnknown({
      serverTime: "2026-05-26T12:00:00.000Z",
      targetType: "bid",
      targetId: "bid_1",
      targetVersion: 1,
      latestStatus: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN"
    });

    expect(response.result).toBe("unknown");
    expect(response.refreshRequired).toBe(true);
    expect(response.errorCode).toBe("TRANSACTION_RESULT_UNKNOWN");
  });

  it("rejects idempotency reuse when request hashes differ", () => {
    const first = createIdempotencyFingerprint({
      idempotencyKey: "same-key",
      actorId: "user_1",
      action: "bid.create",
      targetType: "auction_session",
      targetId: "auction_1",
      requestHash: "hash_a"
    });
    const second = createIdempotencyFingerprint({
      ...first,
      requestHash: "hash_b"
    });

    expect(first.conflictsWith(second)).toBe(true);
  });
});
