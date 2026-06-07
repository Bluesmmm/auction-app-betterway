import { afterEach, describe, expect, it, vi } from "vitest";
import { SensitiveOperationType } from "../../src/accounts/sensitive-operation.service.js";
import type { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import type { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { AuctionsController } from "../../src/auctions/auctions.controller.js";
import type { TransactionAppealService } from "../../src/auctions/transaction-appeal.service.js";
import type { TransactionDecisionService } from "../../src/auctions/transaction-decision.service.js";

const tokens = new SessionTokenService("auctions-controller-contract-test-key");

describe("AuctionsController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the actor from bearer auth when reading transaction detail", async () => {
    setServerTime("2026-06-05T10:00:00.000Z");
    const { controller, decisions } = createController();
    vi.mocked(decisions.getTransactionDetail).mockResolvedValue({
      result: "accepted",
      transactionId: "txn_1",
      auctionSessionId: "auction_1",
      communityId: "community_1",
      buyerChildId: "buyer_child_1",
      sellerChildId: "seller_child_1",
      pointHoldId: "hold_1",
      pointsAmount: 50,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: "2026-06-06T10:00:00.000Z",
      deliveryConfirmDeadlineAt: null,
      version: 3,
      deliveryRecord: null,
      decisions: []
    });

    await expect(
      controller.getTransactionDetail(
        "txn_1",
        bearerToken("guardian_user_1", "session_1")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      serverTime: "2026-06-05T10:00:00.000Z",
      targetType: "transaction",
      targetId: "txn_1",
      targetVersion: 3,
      latestStatus: "pending_guardian_confirm",
      refreshRequired: false,
      communityId: "community_1",
      pointsAmount: 50
    });
    expect(decisions.getTransactionDetail).toHaveBeenCalledWith({
      actorUserId: "guardian_user_1",
      transactionId: "txn_1"
    });
  });

  it("requires a fresh sensitive challenge before guardian confirmation", async () => {
    setServerTime("2026-06-05T10:05:00.000Z");
    const { controller, decisions, sensitiveOperations } = createController();
    vi.mocked(sensitiveOperations.authorizeFreshChallenge).mockResolvedValue({
      result: "accepted",
      actorUserId: "seller_user_1",
      operationType: SensitiveOperationType.confirmTransaction,
      targetType: "transaction",
      targetId: "txn_2",
      challengeId: "challenge_1"
    });
    vi.mocked(decisions.decideGuardianConfirmation).mockResolvedValue({
      result: "accepted",
      transactionId: "txn_2",
      phase: "guardian_confirm",
      value: "confirmed",
      side: "seller",
      status: "pending_guardian_confirm",
      decisionId: "decision_1",
      buyerConfirmed: false,
      sellerConfirmed: true,
      releasedAmountPoints: 0,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: null,
      idempotencyKey: "idem_1"
    });

    await expect(
      controller.decideGuardianConfirmation(
        "txn_2",
        {
          value: "confirmed",
          deliveryMethod: "guardian_arranged",
          idempotencyKey: "idem_1",
          challengeId: "challenge_1"
        },
        bearerToken("seller_user_1", "session_2")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction",
      targetId: "txn_2",
      latestStatus: "pending_guardian_confirm",
      side: "seller",
      idempotencyKey: "idem_1"
    });
    expect(sensitiveOperations.authorizeFreshChallenge).toHaveBeenCalledWith({
      actorUserId: "seller_user_1",
      sessionId: "session_2",
      operationType: SensitiveOperationType.confirmTransaction,
      targetType: "transaction",
      targetId: "txn_2",
      challengeId: "challenge_1",
      now: new Date("2026-06-05T10:05:00.000Z")
    });
    expect(decisions.decideGuardianConfirmation).toHaveBeenCalledWith({
      actorUserId: "seller_user_1",
      transactionId: "txn_2",
      value: "confirmed",
      deliveryMethod: "guardian_arranged",
      deliveryPointId: undefined,
      reason: undefined,
      idempotencyKey: "idem_1",
      now: new Date("2026-06-05T10:05:00.000Z")
    });
  });

  it("fails closed when delivery confirmation has no valid sensitive challenge", async () => {
    setServerTime("2026-06-05T10:10:00.000Z");
    const { controller, decisions, sensitiveOperations } = createController();
    vi.mocked(sensitiveOperations.authorizeFreshChallenge).mockResolvedValue({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await expect(
      controller.decideDeliveryConfirmation(
        "txn_3",
        {
          value: "confirmed",
          idempotencyKey: "idem_2"
        },
        bearerToken("buyer_user_1", "session_3")
      )
    ).resolves.toEqual({
      result: "rejected",
      serverTime: "2026-06-05T10:10:00.000Z",
      targetType: "transaction",
      targetId: "txn_3",
      targetVersion: 1,
      latestStatus: "rejected",
      refreshRequired: false,
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
    expect(decisions.decideDeliveryConfirmation).not.toHaveBeenCalled();
  });

  it("submits ordinary transaction appeals without sensitive challenge", async () => {
    setServerTime("2026-06-05T10:15:00.000Z");
    const { controller, appeals, sensitiveOperations } = createController();
    vi.mocked(appeals.createTransactionAppeal).mockResolvedValue({
      result: "accepted",
      appealId: "appeal_1",
      status: "pending_activity_admin",
      attachmentCount: 2,
      idempotencyKey: null
    });

    await expect(
      controller.createTransactionAppeal(
        "txn_4",
        {
          reason: "交付没有完成",
          attachmentMediaAssetIds: ["media_1", "media_2"]
        },
        bearerToken("guardian_user_2", "session_4")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction_appeal",
      targetId: "appeal_1",
      latestStatus: "pending_activity_admin",
      attachmentCount: 2
    });
    expect(sensitiveOperations.authorizeFreshChallenge).not.toHaveBeenCalled();
    expect(appeals.createTransactionAppeal).toHaveBeenCalledWith({
      actorUserId: "guardian_user_2",
      transactionId: "txn_4",
      reason: "交付没有完成",
      attachmentMediaAssetIds: ["media_1", "media_2"],
      now: new Date("2026-06-05T10:15:00.000Z")
    });
  });

  it("creates appeal attachment grants for the authenticated actor", async () => {
    setServerTime("2026-06-05T10:20:00.000Z");
    const { controller, appeals } = createController();
    vi.mocked(appeals.createAppealImageGrant).mockResolvedValue({
      result: "accepted",
      mediaAssetId: "media_3",
      purpose: "appeal",
      url: "https://private.example/grant",
      expiresAt: "2026-06-05T10:25:00.000Z",
      publicAccess: false
    });

    await expect(
      controller.createAppealAttachmentGrant(
        "attachment_1",
        {
          ttlSeconds: 300
        },
        bearerToken("activity_admin_user_1", "session_5")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "appeal_attachment_grant",
      targetId: "attachment_1",
      latestStatus: "active",
      purpose: "appeal",
      publicAccess: false
    });
    expect(appeals.createAppealImageGrant).toHaveBeenCalledWith({
      actorUserId: "activity_admin_user_1",
      appealAttachmentId: "attachment_1",
      ttlSeconds: 300,
      now: new Date("2026-06-05T10:20:00.000Z")
    });
  });

  it("derives the admin actor from bearer auth when resolving transaction disputes", async () => {
    setServerTime("2026-06-05T10:25:00.000Z");
    const { controller, decisions } = createController();
    vi.mocked(decisions.resolveTransactionDispute).mockResolvedValue({
      result: "accepted",
      transactionId: "txn_5",
      action: "transfer_to_seller",
      status: "completed",
      releasedAmountPoints: 0,
      transferredAmountPoints: 50,
      idempotencyKey: "idem_3"
    });

    await expect(
      controller.resolveTransactionDispute(
        "txn_5",
        {
          action: "transfer_to_seller",
          idempotencyKey: "idem_3",
          reason: "申诉证据支持卖方"
        },
        bearerToken("activity_admin_user_2", "session_6")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction",
      targetId: "txn_5",
      latestStatus: "completed",
      action: "transfer_to_seller",
      transferredAmountPoints: 50
    });
    expect(decisions.resolveTransactionDispute).toHaveBeenCalledWith({
      actorUserId: "activity_admin_user_2",
      transactionId: "txn_5",
      action: "transfer_to_seller",
      idempotencyKey: "idem_3",
      reason: "申诉证据支持卖方",
      now: new Date("2026-06-05T10:25:00.000Z")
    });
  });
});

function createController() {
  const decisions = {
    getTransactionDetail: vi.fn(),
    decideGuardianConfirmation: vi.fn(),
    decideDeliveryConfirmation: vi.fn(),
    resolveTransactionDispute: vi.fn()
  } as unknown as TransactionDecisionService;
  const appeals = {
    createTransactionAppeal: vi.fn(),
    createAppealImageGrant: vi.fn()
  } as unknown as TransactionAppealService;
  const sessions = {
    assertActiveSession: vi.fn(
      async (input: { userId: string; sessionId: string }) => ({
        result: "accepted" as const,
        userId: input.userId,
        sessionId: input.sessionId,
        expiresAt: "2099-01-01T00:00:00.000Z",
        lastSeenAt: null
      })
    )
  } as unknown as SessionService;
  const sensitiveOperations = {
    authorizeFreshChallenge: vi.fn()
  } as unknown as SensitiveOperationService;

  return {
    controller: new AuctionsController(
      decisions,
      appeals,
      sessions,
      tokens,
      sensitiveOperations
    ),
    decisions,
    appeals,
    sessions,
    sensitiveOperations
  };
}

function bearerToken(userId: string, sessionId: string) {
  const token = tokens.createAccessToken({
    userId,
    sessionId,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });

  return `Bearer ${token}`;
}

function setServerTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
