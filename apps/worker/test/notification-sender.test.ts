import { Prisma, PrismaClient, type TransactionStatus } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaNotificationSender } from "../src/notification-sender.js";
import type { RealtimeHintEvent } from "../src/realtime-hint-publisher.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

const targetPrefix = "notification_sender_test_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Notification sender tests require explicit DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Notification sender tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("PrismaNotificationSender", () => {
  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists layered auction settlement notifications and sends parent subscriptions once", async () => {
    const fixture = await createTransactionFixture("settled", {
      transactionStatus: "pending_guardian_confirm"
    });
    await enableWechatPreference({
      userId: fixture.buyer.guardianUserId,
      childId: fixture.buyer.childId,
      eventType: "auction_settled"
    });
    await enableWechatPreference({
      userId: fixture.seller.guardianUserId,
      childId: fixture.seller.childId,
      eventType: "auction_settled"
    });
    const event = await createOutboxEvent("settled", {
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: fixture.auctionSessionId,
      payloadJson: {
        auctionSessionId: fixture.auctionSessionId,
        itemId: fixture.itemId,
        communityId: fixture.communityId,
        transactionId: fixture.transactionId,
        buyerChildId: fixture.buyer.childId,
        sellerChildId: fixture.seller.childId,
        pointsAmount: 40,
        status: "settled"
      }
    });
    const subscriptionPayloads: unknown[] = [];
    const sender = new PrismaNotificationSender(prisma, {
      async send(input) {
        subscriptionPayloads.push(input);
        return {
          ok: true,
          providerMessageId: `provider_${input.recipientUserId}`,
          mutatesBusinessState: false
        };
      }
    });

    await expect(
      sender.send({
        outboxEventId: event.id,
        eventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        idempotencyKey: event.idempotencyKey,
        payloadJson: event.payloadJson as Record<string, unknown>
      })
    ).resolves.toMatchObject({
      ok: true,
      mutatesBusinessState: false
    });

    const notifications = await prisma.notification.findMany({
      where: {
        eventId: event.id
      },
      orderBy: [{ recipientUserId: "asc" }, { priority: "asc" }]
    });
    expect(notifications).toHaveLength(4);
    expect(
      notifications.map((notification) => ({
        recipientUserId: notification.recipientUserId,
        recipientChildId: notification.recipientChildId,
        priority: notification.priority,
        mandatory: notification.mandatory,
        deliveryStatus: notification.deliveryStatus,
        actionType: notification.actionType,
        title: notification.title,
        body: notification.body
      }))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientUserId: fixture.buyer.childUserId,
          recipientChildId: fixture.buyer.childId,
          priority: "low",
          mandatory: false,
          deliveryStatus: "suppressed",
          actionType: "view_transaction",
          title: "拍卖已结束"
        }),
        expect.objectContaining({
          recipientUserId: fixture.seller.childUserId,
          recipientChildId: fixture.seller.childId,
          priority: "low",
          mandatory: false,
          deliveryStatus: "suppressed",
          actionType: "view_transaction",
          title: "拍卖已结束"
        }),
        expect.objectContaining({
          recipientUserId: fixture.buyer.guardianUserId,
          recipientChildId: fixture.buyer.childId,
          priority: "high",
          mandatory: true,
          deliveryStatus: "sent",
          actionType: "view_transaction",
          title: "有成交需要确认"
        }),
        expect.objectContaining({
          recipientUserId: fixture.seller.guardianUserId,
          recipientChildId: fixture.seller.childId,
          priority: "high",
          mandatory: true,
          deliveryStatus: "sent",
          actionType: "view_transaction",
          title: "有成交需要确认"
        })
      ])
    );
    expect(JSON.stringify(notifications)).not.toContain("Buyer Child");
    expect(JSON.stringify(notifications)).not.toContain("Seller Child");
    expect(subscriptionPayloads).toHaveLength(2);

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });
    await expect(
      prisma.notification.count({
        where: {
          eventId: event.id
        }
      })
    ).resolves.toBe(4);
    expect(subscriptionPayloads).toHaveLength(2);
  });

  it("keeps external subscriptions suppressed unless WeChat subscription is enabled", async () => {
    const fixture = await createTransactionFixture("subscription_default", {
      transactionStatus: "pending_guardian_confirm"
    });
    const event = await createOutboxEvent("subscription_default", {
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: fixture.auctionSessionId,
      payloadJson: {
        auctionSessionId: fixture.auctionSessionId,
        transactionId: fixture.transactionId
      }
    });
    const subscriptionPayloads: unknown[] = [];
    const sender = new PrismaNotificationSender(prisma, {
      async send(input) {
        subscriptionPayloads.push(input);
        return {
          ok: true,
          providerMessageId: `provider_${input.recipientUserId}`,
          mutatesBusinessState: false
        };
      }
    });

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.findMany({
        where: {
          eventId: event.id,
          recipientChildId: {
            not: null
          },
          priority: "high"
        },
        select: {
          recipientUserId: true,
          deliveryStatus: true
        },
        orderBy: {
          recipientUserId: "asc"
        }
      })
    ).resolves.toEqual([
      {
        recipientUserId: fixture.buyer.guardianUserId,
        deliveryStatus: "suppressed"
      },
      {
        recipientUserId: fixture.seller.guardianUserId,
        deliveryStatus: "suppressed"
      }
    ]);
    expect(subscriptionPayloads).toHaveLength(0);
  });

  it("falls back to user-level subscription preferences for child-scoped notifications", async () => {
    const fixture = await createTransactionFixture("subscription_user_level", {
      transactionStatus: "pending_guardian_confirm"
    });
    await enableWechatPreference({
      userId: fixture.buyer.guardianUserId,
      childId: null,
      eventType: "auction_settled"
    });
    const event = await createOutboxEvent("subscription_user_level", {
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: fixture.auctionSessionId,
      payloadJson: {
        auctionSessionId: fixture.auctionSessionId,
        transactionId: fixture.transactionId
      }
    });
    const subscriptionPayloads: unknown[] = [];
    const sender = new PrismaNotificationSender(prisma, {
      async send(input) {
        subscriptionPayloads.push(input);
        return {
          ok: true,
          providerMessageId: `provider_${input.recipientUserId}`,
          mutatesBusinessState: false
        };
      }
    });

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.findMany({
        where: {
          eventId: event.id,
          recipientUserId: {
            in: [fixture.buyer.guardianUserId, fixture.seller.guardianUserId]
          }
        },
        select: {
          recipientUserId: true,
          deliveryStatus: true
        },
        orderBy: {
          recipientUserId: "asc"
        }
      })
    ).resolves.toEqual([
      {
        recipientUserId: fixture.buyer.guardianUserId,
        deliveryStatus: "sent"
      },
      {
        recipientUserId: fixture.seller.guardianUserId,
        deliveryStatus: "suppressed"
      }
    ]);
    expect(subscriptionPayloads).toEqual([
      expect.objectContaining({
        recipientUserId: fixture.buyer.guardianUserId,
        templateKey: "auction_settled"
      })
    ]);
  });

  it("does not send transaction notifications when the source status has moved on", async () => {
    const fixture = await createTransactionFixture("stale_transaction_status", {
      transactionStatus: "completed"
    });
    const event = await createOutboxEvent("stale_transaction_status", {
      eventType: "transaction.platform_review_required",
      targetType: "transaction",
      targetId: fixture.transactionId,
      payloadJson: {
        transactionId: fixture.transactionId,
        status: "platform_review"
      }
    });
    const sender = new PrismaNotificationSender(prisma);

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.count({
        where: {
          eventId: event.id
        }
      })
    ).resolves.toBe(0);
  });

  it("publishes notification realtime hints per affected recipient", async () => {
    const fixture = await createTransactionFixture("notification_realtime", {
      transactionStatus: "pending_guardian_confirm"
    });
    const event = await createOutboxEvent("notification_realtime", {
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: fixture.auctionSessionId,
      payloadJson: {
        auctionSessionId: fixture.auctionSessionId,
        transactionId: fixture.transactionId
      }
    });
    const realtimeEvents: RealtimeHintEvent[] = [];
    const sender = new PrismaNotificationSender(prisma, undefined, {
      async publish(realtimeEvent) {
        realtimeEvents.push(realtimeEvent);
        return {
          ok: true,
          mutatesBusinessState: false
        };
      }
    });

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    expect(realtimeEvents).toHaveLength(4);
    expect(realtimeEvents).toEqual(
      expect.arrayContaining(
        [
          fixture.buyer.childUserId,
          fixture.seller.childUserId,
          fixture.buyer.guardianUserId,
          fixture.seller.guardianUserId
        ].map((recipientUserId) =>
          expect.objectContaining({
            eventId: event.id,
            eventType: "notifications.updated",
            targetType: "notifications",
            targetId: recipientUserId,
            targetVersion: 1,
            refreshRequired: true
          })
        )
      )
    );
  });

  it("suppresses child and parent notifications when the child is no longer an active community member", async () => {
    const fixture = await createTransactionFixture("removed_member");
    await prisma.communityMember.update({
      where: {
        communityId_childId: {
          communityId: fixture.communityId,
          childId: fixture.buyer.childId
        }
      },
      data: {
        status: "removed"
      }
    });
    const event = await createOutboxEvent("bid_accepted_removed", {
      eventType: "auction.bid_accepted",
      targetType: "bid",
      targetId: unique("bid"),
      payloadJson: {
        auctionSessionId: fixture.auctionSessionId,
        bidderChildId: fixture.buyer.childId,
        amountPoints: 40
      }
    });
    const sender = new PrismaNotificationSender(prisma);

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.count({
        where: {
          eventId: event.id
        }
      })
    ).resolves.toBe(0);
  });

  it("routes platform review notifications to scoped activity admins and platform admins", async () => {
    const fixture = await createTransactionFixture("platform_review");
    const event = await createOutboxEvent("platform_review", {
      eventType: "transaction.platform_review_required",
      targetType: "transaction",
      targetId: fixture.transactionId,
      payloadJson: {
        transactionId: fixture.transactionId,
        buyerChildId: fixture.buyer.childId,
        sellerChildId: fixture.seller.childId,
        status: "platform_review"
      }
    });
    const sender = new PrismaNotificationSender(prisma);

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.findMany({
        where: {
          eventId: event.id,
          recipientChildId: null
        },
        select: {
          recipientUserId: true,
          type: true,
          priority: true,
          mandatory: true,
          actionType: true,
          title: true
        },
        orderBy: {
          recipientUserId: "asc"
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          recipientUserId: fixture.activityAdminUserId,
          type: "transaction_platform_review_required",
          priority: "urgent",
          mandatory: true,
          actionType: "view_transaction",
          title: "有交易需要平台复核"
        },
        {
          recipientUserId: fixture.platformAdminUserId,
          type: "transaction_platform_review_required",
          priority: "urgent",
          mandatory: true,
          actionType: "view_transaction",
          title: "有交易需要平台复核"
        }
      ])
    );
  });

  it("routes high-risk governance review pending notifications only to eligible platform reviewers", async () => {
    const fixture = await createHighRiskGovernanceReviewNotificationFixture(
      "high_risk_pending",
      {
        decisionState: "pending",
        executionState: "not_started"
      }
    );
    const event = await createOutboxEvent("high_risk_pending", {
      eventType: "high_risk_governance_review.created",
      targetType: "high_risk_governance_review_request",
      targetId: fixture.reviewRequestId,
      payloadJson: {
        reviewRequestId: fixture.reviewRequestId,
        eligibleReviewerUserIds: [
          fixture.initiatorUserId,
          fixture.reviewerUserId,
          fixture.institutionAdminUserId,
          fixture.guardianUserId,
          fixture.childUserId
        ]
      }
    });
    const sender = new PrismaNotificationSender(prisma);

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    const notifications = await prisma.notification.findMany({
      where: {
        relatedType: "high_risk_governance_review_request",
        relatedId: fixture.reviewRequestId
      },
      select: {
        recipientUserId: true,
        recipientChildId: true,
        type: true,
        priority: true,
        mandatory: true,
        actionType: true,
        title: true,
        deliveryStatus: true
      },
      orderBy: {
        recipientUserId: "asc"
      }
    });
    expect(notifications).toEqual(
      expect.arrayContaining([
        {
          recipientUserId: fixture.reviewerUserId,
          recipientChildId: null,
          type: "high_risk_governance_review_pending",
          priority: "urgent",
          mandatory: true,
          actionType: "view_high_risk_governance_review",
          title: "有高风险治理复核待处理",
          deliveryStatus: "suppressed"
        }
      ])
    );
    expect(
      notifications.every((notification) =>
        expect.objectContaining({
          recipientChildId: null,
          type: "high_risk_governance_review_pending",
          actionType: "view_high_risk_governance_review"
        }).asymmetricMatch(notification)
      )
    ).toBe(true);
    expect(
      notifications.some(
        (notification) => notification.recipientUserId === fixture.reviewerUserId
      )
    ).toBe(true);
    for (const blockedRecipient of [
      fixture.initiatorUserId,
      fixture.guardianUserId,
      fixture.childUserId,
      fixture.institutionAdminUserId
    ]) {
      expect(
        notifications.some(
          (notification) => notification.recipientUserId === blockedRecipient
        )
      ).toBe(false);
    }
  });

  it("routes high-risk governance review terminal result notifications to the initiator", async () => {
    const cases = [
      {
        label: "review_rejected",
        eventType: "high_risk_governance_review.rejected",
        decisionState: "rejected",
        executionState: "not_started",
        title: "高风险治理复核已拒绝"
      },
      {
        label: "review_withdrawn",
        eventType: "high_risk_governance_review.withdrawn",
        decisionState: "withdrawn",
        executionState: "not_started",
        title: "高风险治理复核已撤回"
      },
      {
        label: "review_expired",
        eventType: "high_risk_governance_review.expired",
        decisionState: "expired",
        executionState: "not_started",
        title: "高风险治理复核已过期"
      },
      {
        label: "review_invalidated",
        eventType: "high_risk_governance_review.invalidated",
        decisionState: "invalidated",
        executionState: "not_started",
        title: "高风险治理复核已失效"
      },
      {
        label: "review_execution_succeeded",
        eventType: "high_risk_governance_review.execution_succeeded",
        decisionState: "approved",
        executionState: "succeeded",
        title: "高风险治理复核已批准"
      },
      {
        label: "review_execution_failed",
        eventType: "high_risk_governance_review.execution_failed",
        decisionState: "approved",
        executionState: "failed",
        title: "高风险治理复核执行失败"
      }
    ] as const;
    const sender = new PrismaNotificationSender(prisma);

    for (const item of cases) {
      const fixture = await createHighRiskGovernanceReviewNotificationFixture(
        item.label,
        {
          decisionState: item.decisionState,
          executionState: item.executionState
        }
      );
      const event = await createOutboxEvent(item.label, {
        eventType: item.eventType,
        targetType: "high_risk_governance_review_request",
        targetId: fixture.reviewRequestId,
        payloadJson: {
          reviewRequestId: fixture.reviewRequestId
        }
      });

      await sender.send({
        outboxEventId: event.id,
        eventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        idempotencyKey: event.idempotencyKey,
        payloadJson: event.payloadJson as Record<string, unknown>
      });

      await expect(
        prisma.notification.findMany({
          where: {
            relatedType: "high_risk_governance_review_request",
            relatedId: fixture.reviewRequestId,
            recipientUserId: fixture.initiatorUserId
          },
          select: {
            recipientUserId: true,
            recipientChildId: true,
            type: true,
            priority: true,
            mandatory: true,
            actionType: true,
            title: true
          }
        })
      ).resolves.toEqual([
        {
          recipientUserId: fixture.initiatorUserId,
          recipientChildId: null,
          type: "high_risk_governance_review_result",
          priority:
            item.eventType === "high_risk_governance_review.execution_failed"
              ? "urgent"
              : "high",
          mandatory: true,
          actionType: "view_high_risk_governance_review",
          title: item.title
        }
      ]);
    }
  });

  it("records high-risk governance review notification delivery failure without changing request state", async () => {
    const fixture = await createHighRiskGovernanceReviewNotificationFixture(
      "high_risk_delivery_failure",
      {
        decisionState: "approved",
        executionState: "failed"
      }
    );
    await enableWechatPreference({
      userId: fixture.initiatorUserId,
      childId: null,
      eventType: "high_risk_governance_review_result"
    });
    const event = await createOutboxEvent("high_risk_delivery_failure", {
      eventType: "high_risk_governance_review.execution_failed",
      targetType: "high_risk_governance_review_request",
      targetId: fixture.reviewRequestId,
      payloadJson: {
        reviewRequestId: fixture.reviewRequestId
      }
    });
    const sender = new PrismaNotificationSender(prisma, {
      async send() {
        return {
          ok: false,
          errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
          mutatesBusinessState: false
        };
      }
    });

    await sender.send({
      outboxEventId: event.id,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payloadJson: event.payloadJson as Record<string, unknown>
    });

    await expect(
      prisma.notification.findMany({
        where: {
          relatedType: "high_risk_governance_review_request",
          relatedId: fixture.reviewRequestId,
          recipientUserId: fixture.initiatorUserId
        },
        select: {
          recipientUserId: true,
          deliveryStatus: true
        }
      })
    ).resolves.toEqual([
      {
        recipientUserId: fixture.initiatorUserId,
        deliveryStatus: "failed"
      }
    ]);
    await expect(
      prisma.highRiskGovernanceReviewRequest.findUnique({
        where: {
          id: fixture.reviewRequestId
        },
        select: {
          decisionState: true,
          executionState: true
        }
      })
    ).resolves.toEqual({
      decisionState: "approved",
      executionState: "failed"
    });
  });
});

async function createTransactionFixture(
  label: string,
  input: {
    transactionStatus?: TransactionStatus;
  } = {}
) {
  const buyer = await createChildWithGuardian(`${label}_buyer`);
  const seller = await createChildWithGuardian(`${label}_seller`);
  const community = await prisma.auctionCommunity.create({
    data: {
      id: unique(`${label}_community`),
      name: `${label} community`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
  await prisma.communityMember.createMany({
    data: [buyer, seller].map((child) => ({
      id: unique(`${label}_member_${child.childId}`),
      communityId: community.id,
      childId: child.childId,
      status: "active",
      joinedAt: new Date("2026-06-09T08:00:00.000Z")
    }))
  });
  const activityAdminUser = await createUser(`${label}_activity_admin_user`);
  const activityAdmin = await prisma.adminProfile.create({
    data: {
      id: unique(`${label}_activity_admin`),
      userId: activityAdminUser.id,
      role: "activity_admin",
      status: "active",
      mfaEnabled: true
    }
  });
  await prisma.adminCommunityScope.create({
    data: {
      id: unique(`${label}_scope`),
      adminProfileId: activityAdmin.id,
      communityId: community.id,
      status: "active"
    }
  });
  const platformAdminUser = await createUser(`${label}_platform_admin_user`);
  await prisma.adminProfile.create({
    data: {
      id: unique(`${label}_platform_admin`),
      userId: platformAdminUser.id,
      role: "platform_admin",
      status: "active",
      mfaEnabled: true
    }
  });
  const item = await prisma.item.create({
    data: {
      id: unique(`${label}_item`),
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 10,
      minIncrementPoints: 5
    }
  });
  const auction = await prisma.auctionSession.create({
    data: {
      id: unique(`${label}_auction`),
      itemId: item.id,
      idempotencyKey: unique(`${label}_auction_idem`),
      status: "settled",
      startAt: new Date("2026-06-09T08:00:00.000Z"),
      endAt: new Date("2026-06-09T09:00:00.000Z"),
      startPoints: 10,
      minIncrementPoints: 5,
      currentPricePoints: 40,
      version: 2
    }
  });
  const pointAccount = await prisma.pointAccount.create({
    data: {
      id: unique(`${label}_account`),
      childId: buyer.childId,
      availablePoints: 60,
      frozenPoints: 40
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      id: unique(`${label}_hold`),
      accountId: pointAccount.id,
      auctionSessionId: auction.id,
      amountPoints: 40,
      status: "active"
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      id: unique(`${label}_transaction`),
      auctionSessionId: auction.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 40,
      status: input.transactionStatus ?? "platform_review",
      guardianConfirmDeadlineAt: new Date("2026-06-11T09:00:00.000Z"),
      version: 3
    }
  });

  return {
    communityId: community.id,
    itemId: item.id,
    auctionSessionId: auction.id,
    transactionId: transaction.id,
    buyer,
    seller,
    activityAdminUserId: activityAdminUser.id,
    platformAdminUserId: platformAdminUser.id
  };
}

async function enableWechatPreference(input: {
  userId: string;
  childId: string | null;
  eventType: string;
}) {
  await prisma.notificationPreference.create({
    data: {
      id: unique(`preference_${input.userId}_${input.eventType}`),
      userId: input.userId,
      childId: input.childId,
      eventType: input.eventType,
      inAppEnabled: true,
      wechatSubscribeEnabled: true
    }
  });
}

async function createHighRiskGovernanceReviewNotificationFixture(
  label: string,
  input: {
    decisionState:
      | "pending"
      | "approved"
      | "rejected"
      | "expired"
      | "withdrawn"
      | "invalidated";
    executionState: "not_started" | "succeeded" | "failed";
  }
) {
  const initiator = await createAdminUser(`${label}_initiator`, "platform_admin");
  const reviewer = await createAdminUser(`${label}_reviewer`, "platform_admin");
  const institution = await createAdminUser(
    `${label}_institution_admin`,
    "institution_admin"
  );
  const child = await createChildWithGuardian(`${label}_child_non_admin`);
  const review = await prisma.highRiskGovernanceReviewRequest.create({
    data: {
      id: unique(`${label}_review`),
      actionType: "governance_control_create",
      decisionState: input.decisionState,
      executionState: input.executionState,
      targetType: "governance_control",
      targetId: unique(`${label}_control_target`),
      scopeType: "platform",
      scopeId: null,
      controlType: "pause_settlement",
      initiatorUserId: initiator.userId,
      reviewerUserId: input.decisionState === "pending" ? null : reviewer.userId,
      idempotencyKey: unique(`${label}_idem`),
      requestHash: unique(`${label}_hash`),
      frozenPayloadJson: {
        scopeType: "platform",
        controlType: "pause_settlement"
      },
      evidenceJson: {
        source: "notification-sender-test"
      },
      decisionReason:
        input.decisionState === "rejected" ||
        input.decisionState === "withdrawn"
          ? "terminal result notification test"
          : null,
      executionErrorCode:
        input.executionState === "failed" ? "EXECUTION_FAILED" : null,
      expiresAt: new Date("2026-06-09T10:30:00.000Z"),
      decidedAt:
        input.decisionState === "pending"
          ? null
          : new Date("2026-06-09T10:10:00.000Z"),
      executedAt:
        input.executionState === "not_started"
          ? null
          : new Date("2026-06-09T10:10:00.000Z"),
      createdAt: new Date("2026-06-09T10:00:00.000Z"),
      updatedAt: new Date("2026-06-09T10:10:00.000Z")
    }
  });

  return {
    reviewRequestId: review.id,
    initiatorUserId: initiator.userId,
    reviewerUserId: reviewer.userId,
    institutionAdminUserId: institution.userId,
    guardianUserId: child.guardianUserId,
    childUserId: child.childUserId
  };
}

async function createAdminUser(
  label: string,
  role: "activity_admin" | "platform_admin" | "institution_admin"
) {
  const user = await createUser(`${label}_user`);
  const admin = await prisma.adminProfile.create({
    data: {
      id: unique(`${label}_admin`),
      userId: user.id,
      role,
      status: "active",
      mfaEnabled: true
    }
  });

  return {
    userId: user.id,
    adminProfileId: admin.id
  };
}

async function createChildWithGuardian(label: string) {
  const guardianUser = await createUser(`${label}_guardian_user`);
  const guardian = await prisma.guardianProfile.create({
    data: {
      id: unique(`${label}_guardian`),
      userId: guardianUser.id,
      phoneHash: unique(`${label}_phone_hash`),
      phoneLast4: "1234",
      consentVersion: "v1",
      consentedAt: new Date("2026-06-09T08:00:00.000Z"),
      status: "active"
    }
  });
  const childUser = await createUser(`${label}_child_user`);
  const child = await prisma.childProfile.create({
    data: {
      id: unique(`${label}_child`),
      userId: childUser.id,
      displayName: `${label} Child`,
      gradeBand: "3-4",
      status: "active",
      createdByGuardianId: guardian.id
    }
  });
  await prisma.guardianChildLink.create({
    data: {
      id: unique(`${label}_link`),
      guardianId: guardian.id,
      childId: child.id,
      role: "primary",
      status: "active",
      confirmedAt: new Date("2026-06-09T08:00:00.000Z")
    }
  });

  return {
    guardianUserId: guardianUser.id,
    guardianId: guardian.id,
    childUserId: childUser.id,
    childId: child.id
  };
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      id: unique(label),
      status: "active"
    }
  });
}

async function createOutboxEvent(
  label: string,
  input: {
    eventType: string;
    targetType: string;
    targetId: string;
    payloadJson: Record<string, unknown>;
  }
) {
  return prisma.outboxEvent.create({
    data: {
      id: unique(`${label}_outbox`),
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      idempotencyKey: unique(`${label}_outbox_idem`),
      payloadJson: input.payloadJson as Prisma.InputJsonValue,
      status: "pending",
      availableAt: new Date("2026-06-09T10:00:00.000Z")
    }
  });
}

async function cleanup() {
  await prisma.notificationPreference.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          userId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.notification.deleteMany({
    where: {
      OR: [
        {
          recipientUserId: {
            startsWith: targetPrefix
          }
        },
        {
          relatedId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.outboxEvent.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.highRiskGovernanceReviewRequest.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.transaction.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.pointHold.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.pointAccount.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionSession.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.item.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.adminCommunityScope.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.communityMember.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionCommunity.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.adminProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.guardianChildLink.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.childProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.guardianProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
}
