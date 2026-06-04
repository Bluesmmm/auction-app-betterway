import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { AppConfigService } from "../../src/config/app-config.service.js";
import {
  FakeSensitiveOperationVerificationProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";
import { PointLedgerService } from "../../src/points/point-ledger.service.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const sessions = new SessionService(
  prisma,
  new SessionTokenService("stage4-point-ledger-test-signing-key")
);
const onboarding = new OnboardingService(
  prisma,
  new FakeWechatAuthProvider(),
  sessions
);
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => "246810"
);
const points = new PointLedgerService(
  prisma,
  sensitiveOperations,
  new AppConfigService({
    POINT_ADJUSTMENT_SINGLE_REVIEW_LIMIT: "50"
  })
);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("PointLedgerService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("limits child point summary and ledger entry reads to the primary guardian or platform admin", async () => {
    const fixture = await createChildFixture("read_permissions");
    const secondary = await createGuardian("read_permissions_secondary");
    const outsider = await createGuardian("read_permissions_outsider");
    const admin = await createPlatformAdmin("read_permissions_admin");
    await prisma.guardianChildLink.create({
      data: {
        guardianId: secondary.guardianId,
        childId: fixture.childId,
        role: "secondary",
        status: "active",
        confirmedAt: new Date("2026-06-02T14:05:00.000Z")
      }
    });

    await expect(
      points.getChildPointSummary({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId
      })
    ).resolves.toEqual({
      result: "accepted",
      childId: fixture.childId,
      availablePoints: 100,
      frozenPoints: 0,
      totalEarnedPoints: 100,
      totalSpentPoints: 0,
      totalAwardedPoints: 100,
      totalPenaltyPoints: 0
    });
    await expect(
      points.listChildLedgerEntries({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId
      })
    ).resolves.toEqual({
      result: "accepted",
      childId: fixture.childId,
      entries: [
        expect.objectContaining({
          type: "initial_grant",
          amountPoints: 100,
          availableAfter: 100,
          frozenAfter: 0,
          relatedType: "child_profile",
          relatedId: fixture.childId,
          reason: "initial_child_points"
        })
      ]
    });
    await expect(
      points.getChildPointSummary({
        actorUserId: secondary.userId,
        childId: fixture.childId
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "POINT_ACCOUNT_ACCESS_DENIED"
    });
    await expect(
      points.listChildLedgerEntries({
        actorUserId: outsider.userId,
        childId: fixture.childId
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "POINT_ACCOUNT_ACCESS_DENIED"
    });
    await expect(
      points.getChildPointSummary({
        actorUserId: admin.userId,
        childId: fixture.childId
      })
    ).resolves.toMatchObject({
      result: "accepted",
      childId: fixture.childId,
      availablePoints: 100
    });
  });

  it("limits global point adjustment queues to active MFA platform admins", async () => {
    const fixture = await createChildFixture("queue_permissions");
    const outsider = await createGuardian("queue_permissions_outsider");
    const admin = await createPlatformAdmin("queue_permissions_admin");
    const created = await points.createGuardianAdjustmentRequest({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      requestType: "activity_reward",
      requestedPoints: 20,
      reason: "queue visibility fixture",
      idempotencyKey: unique("queue_permissions_request"),
      now: new Date("2026-06-02T14:08:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error(`expected guardian request: ${created.errorCode}`);
    }

    await expect(
      points.listAdjustmentRequests({
        platformAdminUserId: outsider.userId
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });
    await expect(
      points.listAdjustmentRequests({
        platformAdminUserId: admin.userId,
        limit: 100
      })
    ).resolves.toMatchObject({
      result: "accepted",
      requests: expect.arrayContaining([
        expect.objectContaining({
          id: created.requestId,
          childId: fixture.childId,
          status: "pending_review"
        })
      ])
    });
  });

  it("summarizes points, holds, transaction review, outbox exceptions, and ledger health for platform admins", async () => {
    const fixture = await createOperationsDashboardFixture();
    const outsider = await createGuardian("dashboard_outsider");
    const admin = await createPlatformAdmin("dashboard_admin");
    const dashboardNow = new Date("2026-06-04T10:00:00.000Z");

    await expect(
      points.getOperationsDashboard({
        platformAdminUserId: outsider.userId,
        now: dashboardNow
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    const dashboard = await points.getOperationsDashboard({
      platformAdminUserId: admin.userId,
      now: dashboardNow
    });

    expect(dashboard).toMatchObject({
      result: "accepted",
      generatedAt: dashboardNow.toISOString(),
      totals: {
        accountCount: expect.any(Number),
        availablePoints: expect.any(Number),
        frozenPoints: expect.any(Number),
        totalEarnedPoints: expect.any(Number),
        totalSpentPoints: expect.any(Number),
        totalAwardedPoints: expect.any(Number),
        totalPenaltyPoints: expect.any(Number)
      },
      holds: {
        activeCount: expect.any(Number),
        activeAmountPoints: expect.any(Number)
      },
      transactions: {
        platformReviewCount: expect.any(Number)
      },
      latestLedgerCheckRun: {
        id: fixture.ledgerCheckRunId,
        status: "failed",
        ledgerDiffCount: 1
      }
    });

    if (dashboard.result !== "accepted") {
      throw new Error(`expected dashboard: ${dashboard.errorCode}`);
    }

    expect(dashboard.totals.accountCount).toBeGreaterThanOrEqual(2);
    expect(dashboard.totals.availablePoints).toBeGreaterThanOrEqual(70);
    expect(dashboard.totals.frozenPoints).toBeGreaterThanOrEqual(30);
    expect(dashboard.holds.activeCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.holds.activeAmountPoints).toBeGreaterThanOrEqual(30);
    expect(dashboard.transactions.platformReviewCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.reviewTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.transactionId,
          status: "platform_review",
          pointsAmount: 30,
          communityId: fixture.communityId
        })
      ])
    );
    expect(dashboard.activeHolds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.holdId,
          childId: fixture.buyerChildId,
          amountPoints: 30,
          auctionSessionId: fixture.auctionSessionId
        })
      ])
    );
    expect(dashboard.outboxExceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.outboxEventId,
          status: "failed",
          eventType: "transaction.platform_review_required"
        })
      ])
    );
    expect(dashboard.recentLedgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.ledgerEntryId,
          childId: fixture.buyerChildId,
          reason: "auction_bid_hold"
        })
      ])
    );
  });

  it("lets only the active primary guardian create a point adjustment request", async () => {
    const fixture = await createChildFixture("guardian_request");
    const secondary = await createGuardian("guardian_request_secondary");
    await prisma.guardianChildLink.create({
      data: {
        guardianId: secondary.guardianId,
        childId: fixture.childId,
        role: "secondary",
        status: "active",
        confirmedAt: new Date("2026-06-02T14:10:00.000Z")
      }
    });

    await expect(
      points.createGuardianAdjustmentRequest({
        actorUserId: secondary.userId,
        childId: fixture.childId,
        requestType: "activity_reward",
        requestedPoints: 20,
        reason: "helped with the class activity",
        idempotencyKey: unique("secondary_request"),
        now: new Date("2026-06-02T14:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PRIMARY_GUARDIAN_REQUIRED"
    });

    const accepted = await points.createGuardianAdjustmentRequest({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      requestType: "activity_reward",
      requestedPoints: 20,
      reason: "helped with the class activity",
      idempotencyKey: unique("primary_request"),
      now: new Date("2026-06-02T14:12:00.000Z")
    });

    expect(accepted).toEqual({
      result: "accepted",
      requestId: expect.any(String),
      status: "pending_review",
      requiresSecondReview: false
    });
  });

  it("approves a small admin award with one platform admin and one immutable ledger entry", async () => {
    const fixture = await createChildFixture("small_award");
    const admin = await createPlatformAdmin("small_award_admin");
    const created = await points.createAdminAdjustmentRequest({
      platformAdminUserId: admin.userId,
      childId: fixture.childId,
      requestType: "admin_award",
      requestedPoints: 25,
      reason: "pilot activity award",
      idempotencyKey: unique("small_award_create"),
      now: new Date("2026-06-02T15:00:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error(`expected admin request: ${created.errorCode}`);
    }

    const challengeId = await createPassedAdjustPointsChallenge(
      admin,
      created.requestId,
      new Date("2026-06-02T15:00:30.000Z")
    );
    const approved = await points.reviewAdjustmentRequest({
      platformAdminUserId: admin.userId,
      sessionId: admin.sessionId,
      requestId: created.requestId,
      decision: "approve",
      reviewReason: "evidence checked",
      challengeId,
      idempotencyKey: unique("small_award_approve"),
      now: new Date("2026-06-02T15:01:00.000Z")
    });
    const replay = await points.reviewAdjustmentRequest({
      platformAdminUserId: admin.userId,
      sessionId: admin.sessionId,
      requestId: created.requestId,
      decision: "approve",
      reviewReason: "evidence checked",
      challengeId,
      idempotencyKey: approved.result === "accepted" ? approved.idempotencyKey : "",
      now: new Date("2026-06-02T15:01:30.000Z")
    });

    expect(approved).toEqual({
      result: "accepted",
      requestId: created.requestId,
      status: "approved",
      ledgerEntryId: expect.any(String),
      availablePoints: 125,
      idempotencyKey: expect.any(String)
    });
    expect(replay).toEqual(approved);
    await expect(
      prisma.pointLedgerEntry.count({
        where: {
          relatedType: "point_adjustment_request",
          relatedId: created.requestId
        }
      })
    ).resolves.toBe(1);
  });

  it("requires a second platform admin for large adjustments", async () => {
    const fixture = await createChildFixture("large_award");
    const firstAdmin = await createPlatformAdmin("large_award_first");
    const secondAdmin = await createPlatformAdmin("large_award_second");
    const created = await points.createAdminAdjustmentRequest({
      platformAdminUserId: firstAdmin.userId,
      childId: fixture.childId,
      requestType: "admin_award",
      requestedPoints: 75,
      reason: "large pilot award",
      idempotencyKey: unique("large_award_create"),
      now: new Date("2026-06-02T15:10:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error(`expected large request: ${created.errorCode}`);
    }

    const firstChallengeId = await createPassedAdjustPointsChallenge(
      firstAdmin,
      created.requestId,
      new Date("2026-06-02T15:10:30.000Z")
    );
    await expect(
      points.reviewAdjustmentRequest({
        platformAdminUserId: firstAdmin.userId,
        sessionId: firstAdmin.sessionId,
        requestId: created.requestId,
        decision: "approve",
        reviewReason: "needs second review",
        challengeId: firstChallengeId,
        idempotencyKey: unique("large_award_first_review"),
        now: new Date("2026-06-02T15:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      requestId: created.requestId,
      status: "pending_second_review",
      ledgerEntryId: null,
      idempotencyKey: expect.any(String)
    });

    await expect(
      points.secondReviewAdjustmentRequest({
        platformAdminUserId: firstAdmin.userId,
        sessionId: firstAdmin.sessionId,
        requestId: created.requestId,
        decision: "approve",
        reviewReason: "same admin should not pass",
        challengeId: firstChallengeId,
        idempotencyKey: unique("large_award_same_admin_second"),
        now: new Date("2026-06-02T15:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SECOND_REVIEWER_REQUIRED"
    });

    const secondChallengeId = await createPassedAdjustPointsChallenge(
      secondAdmin,
      created.requestId,
      new Date("2026-06-02T15:12:30.000Z")
    );
    await expect(
      points.secondReviewAdjustmentRequest({
        platformAdminUserId: secondAdmin.userId,
        sessionId: secondAdmin.sessionId,
        requestId: created.requestId,
        decision: "approve",
        reviewReason: "second review complete",
        challengeId: secondChallengeId,
        idempotencyKey: unique("large_award_second_review"),
        now: new Date("2026-06-02T15:13:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      requestId: created.requestId,
      status: "approved",
      ledgerEntryId: expect.any(String),
      availablePoints: 175,
      idempotencyKey: expect.any(String)
    });
  });

  it("rejects admin penalties that would make available points negative", async () => {
    const fixture = await createChildFixture("negative_penalty");
    const admin = await createPlatformAdmin("negative_penalty_admin");
    await prisma.pointAccount.update({
      where: {
        childId: fixture.childId
      },
      data: {
        availablePoints: 10
      }
    });
    const created = await points.createAdminAdjustmentRequest({
      platformAdminUserId: admin.userId,
      childId: fixture.childId,
      requestType: "admin_penalty",
      requestedPoints: -25,
      reason: "invalid penalty",
      idempotencyKey: unique("negative_penalty_create"),
      now: new Date("2026-06-02T15:20:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error(`expected penalty request: ${created.errorCode}`);
    }

    const challengeId = await createPassedAdjustPointsChallenge(
      admin,
      created.requestId,
      new Date("2026-06-02T15:20:30.000Z")
    );
    await expect(
      points.reviewAdjustmentRequest({
        platformAdminUserId: admin.userId,
        sessionId: admin.sessionId,
        requestId: created.requestId,
        decision: "approve",
        reviewReason: "should fail balance check",
        challengeId,
        idempotencyKey: unique("negative_penalty_approve"),
        now: new Date("2026-06-02T15:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "INSUFFICIENT_AVAILABLE_POINTS"
    });
    await prisma.pointAccount.update({
      where: {
        childId: fixture.childId
      },
      data: {
        availablePoints: 100
      }
    });
  });
});

async function createChildFixture(label: string) {
  const guardian = await createGuardian(`${label}_primary`);
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardian.userId,
    guardianId: guardian.guardianId,
    displayName: `Stage4 Child ${unique(label)}`,
    gradeBand: "grade_3_4",
    idempotencyKey: unique(`${label}_child`),
    now: new Date("2026-06-02T14:00:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error(`expected child creation: ${child.errorCode}`);
  }

  return {
    guardianUserId: guardian.userId,
    guardianId: guardian.guardianId,
    childId: child.childId
  };
}

async function createOperationsDashboardFixture() {
  const buyer = await createChildFixture("dashboard_buyer");
  const seller = await createChildFixture("dashboard_seller");
  const fixtureCreatedAt = new Date(
    Date.now() + 79 * 365 * 24 * 60 * 60 * 1000
  );
  const buyerAccount = await prisma.pointAccount.findUniqueOrThrow({
    where: { childId: buyer.childId }
  });
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Dashboard Community ${unique("dashboard_community")}`,
      creatorGuardianId: buyer.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 10,
      minIncrementPoints: 5
    }
  });
  const auctionSession = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      idempotencyKey: unique("dashboard_auction"),
      status: "settled",
      startAt: new Date("2026-06-04T08:00:00.000Z"),
      endAt: new Date("2026-06-04T09:00:00.000Z"),
      startPoints: 10,
      minIncrementPoints: 5,
      currentPricePoints: 30,
      highestBidderChildId: buyer.childId
    }
  });
  const bid = await prisma.bid.create({
    data: {
      auctionSessionId: auctionSession.id,
      bidderChildId: buyer.childId,
      amountPoints: 30,
      status: "active",
      idempotencyKey: unique("dashboard_bid")
    }
  });
  const hold = await prisma.pointHold.create({
    data: {
      accountId: buyerAccount.id,
      auctionSessionId: auctionSession.id,
      bidId: bid.id,
      amountPoints: 30,
      status: "active",
      createdAt: fixtureCreatedAt
    }
  });
  await prisma.auctionSession.update({
    where: { id: auctionSession.id },
    data: { highestBidId: bid.id }
  });
  await prisma.pointAccount.update({
    where: { id: buyerAccount.id },
    data: {
      availablePoints: 70,
      frozenPoints: 30
    }
  });
  const ledgerEntry = await prisma.pointLedgerEntry.create({
    data: {
      accountId: buyerAccount.id,
      childId: buyer.childId,
      type: "hold",
      amountPoints: 30,
      availableAfter: 70,
      frozenAfter: 30,
      relatedType: "auction",
      relatedId: auctionSession.id,
      idempotencyKey: unique("dashboard_ledger"),
      reason: "auction_bid_hold",
      createdAt: new Date(fixtureCreatedAt.getTime() + 1000)
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auctionSession.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: hold.id,
      pointsAmount: 30,
      status: "platform_review",
      guardianConfirmDeadlineAt: new Date("2026-06-04T09:10:00.000Z"),
      deliveryConfirmDeadlineAt: new Date("2026-06-04T09:40:00.000Z"),
      createdAt: new Date(fixtureCreatedAt.getTime() + 2000)
    }
  });
  const outboxEvent = await prisma.outboxEvent.create({
    data: {
      eventType: "transaction.platform_review_required",
      targetType: "transaction",
      targetId: transaction.id,
      idempotencyKey: unique("dashboard_outbox"),
      payloadJson: {
        transactionId: transaction.id,
        reason: "dashboard_fixture"
      },
      status: "failed",
      attempts: 3,
      availableAt: new Date("2026-06-04T09:45:00.000Z"),
      createdAt: new Date(fixtureCreatedAt.getTime() + 3000)
    }
  });
  const ledgerCheckStartedAt = new Date(
    Date.now() + 80 * 365 * 24 * 60 * 60 * 1000
  );
  const ledgerCheckRun = await prisma.ledgerCheckRun.create({
    data: {
      status: "failed",
      checkedAccountCount: 2,
      ledgerDiffCount: 1,
      negativeReplayCount: 0,
      orphanLedgerCount: 0,
      startedAt: ledgerCheckStartedAt,
      finishedAt: new Date(ledgerCheckStartedAt.getTime() + 2000),
      workerName: "dashboard-fixture",
      failureReason: "fixture diff",
      idempotencyKey: unique("dashboard_ledger_check")
    }
  });

  return {
    buyerChildId: buyer.childId,
    communityId: community.id,
    auctionSessionId: auctionSession.id,
    holdId: hold.id,
    ledgerEntryId: ledgerEntry.id,
    transactionId: transaction.id,
    outboxEventId: outboxEvent.id,
    ledgerCheckRunId: ledgerCheckRun.id
  };
}

async function createGuardian(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-06-02T13:50:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "1357",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-06-02T13:51:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

async function createPlatformAdmin(label: string) {
  const token = unique(label);
  const user = await prisma.user.create({
    data: {
      status: "active",
      adminProfile: {
        create: {
          role: "platform_admin",
          mfaEnabled: true,
          status: "active"
        }
      }
    }
  });
  const session = await sessions.createSession({
    userId: user.id,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-06-02T13:52:00.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected platform admin session");
  }

  return {
    userId: user.id,
    sessionId: session.sessionId
  };
}

async function createPassedAdjustPointsChallenge(
  admin: { userId: string; sessionId: string },
  requestId: string,
  now: Date
) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: admin.userId,
    sessionId: admin.sessionId,
    operationType: SensitiveOperationType.adjustPoints,
    targetType: "point_adjustment_request",
    targetId: requestId,
    now
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected challenge creation: ${challenge.errorCode}`);
  }

  const passed = await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: admin.userId,
    sessionId: admin.sessionId,
    verificationCode: "246810",
    now: new Date(now.getTime() + 30_000)
  });

  if (passed.result !== "accepted") {
    throw new Error(`expected challenge pass: ${passed.errorCode}`);
  }

  return challenge.challengeId;
}
