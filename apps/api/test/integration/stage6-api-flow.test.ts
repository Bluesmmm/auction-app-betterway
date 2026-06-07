import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import type { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { AuctionsController } from "../../src/auctions/auctions.controller.js";
import { TransactionAppealService } from "../../src/auctions/transaction-appeal.service.js";
import { TransactionDecisionService } from "../../src/auctions/transaction-decision.service.js";
import { FakeContentSafetyProvider } from "../../src/providers/fake-providers.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const tokens = new SessionTokenService("stage6-api-flow-test-key");
const sessions = new SessionService(prisma, tokens);
const decisions = new TransactionDecisionService(prisma);
const appeals = new TransactionAppealService(
  prisma,
  new FakeContentSafetyProvider(),
  "stage6-api-flow-appeal-grant-key"
);
const controller = new AuctionsController(
  decisions,
  appeals,
  sessions,
  tokens,
  {
    authorizeFreshChallenge: async () => ({
      result: "accepted",
      actorUserId: "unused",
      operationType: "confirm_transaction",
      targetType: "transaction",
      targetId: "unused",
      challengeId: "unused"
    })
  } as unknown as SensitiveOperationService
);

type ChildFixture = {
  childId: string;
  guardianUserId: string;
  guardianId: string;
  pointAccountId: string;
  accessToken: string;
};

type AdminFixture = {
  userId: string;
  accessToken: string;
};

type AppealTransactionFixture = {
  transactionId: string;
  communityId: string;
  buyer: ChildFixture;
  seller: ChildFixture;
};

type TransactionClosureFixture = AppealTransactionFixture & {
  pointHoldId: string;
  pointsAmount: number;
};

describe("Stage 6 controller API flow", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets scoped admins maintain delivery points and rejects cross-community admins", async () => {
    const community = await createCommunity("delivery_points");
    const scopedAdmin = await createActivityAdmin(
      "delivery_points_scoped",
      community.id
    );
    const otherCommunity = await createCommunity("delivery_points_other");
    const crossAdmin = await createActivityAdmin(
      "delivery_points_cross",
      otherCommunity.id
    );

    const created = await controller.createDeliveryPoint(
      community.id,
      {
        name: "校门口服务台",
        addressText: "一楼大厅服务台",
        availableTimeText: "周五 16:00-17:00"
      },
      bearer(scopedAdmin.accessToken)
    );

    expect(created).toMatchObject({
      result: "accepted",
      targetType: "delivery_point",
      latestStatus: "active",
      point: {
        communityId: community.id,
        name: "校门口服务台",
        status: "active"
      }
    });
    const pointId = String((created as { point: { id: string } }).point.id);

    await expect(
      controller.updateDeliveryPoint(
        pointId,
        {
          name: "跨社区不应能改"
        },
        bearer(crossAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });

    await expect(
      controller.updateDeliveryPoint(
        pointId,
        {
          availableTimeText: "周五 16:30-17:30"
        },
        bearer(scopedAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      point: {
        id: pointId,
        availableTimeText: "周五 16:30-17:30"
      }
    });

    await expect(
      controller.disableDeliveryPoint(
        pointId,
        {
          reason: "试点结束"
        },
        bearer(scopedAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      point: {
        id: pointId,
        status: "disabled"
      }
    });

    await expect(
      controller.listDeliveryPoints(community.id, bearer(scopedAdmin.accessToken))
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "delivery_points",
      points: [
        expect.objectContaining({
          id: pointId,
          status: "disabled"
        })
      ]
    });
    await expect(
      prisma.auditLog.count({
        where: {
          targetType: "delivery_point",
          targetId: pointId
        }
      })
    ).resolves.toBe(3);
    await expect(
      prisma.outboxEvent.count({
        where: {
          targetType: "delivery_point",
          targetId: pointId
        }
      })
    ).resolves.toBe(3);
  });

  it("lets guardians close transaction confirmation and delivery through bearer authenticated APIs", async () => {
    const fixture = await createTransactionClosureFixture("guardian_api_flow");
    const unrelatedGuardian = await createGuardian("guardian_api_flow_unrelated");

    await expect(
      controller.getTransactionDetail(
        fixture.transactionId,
        bearer(unrelatedGuardian.accessToken)
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "TRANSACTION_ACCESS_DENIED"
    });
    await expect(
      controller.getTransactionDetail(
        fixture.transactionId,
        bearer(fixture.seller.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction",
      targetId: fixture.transactionId,
      latestStatus: "pending_guardian_confirm",
      communityId: fixture.communityId,
      buyerChildId: fixture.buyer.childId,
      sellerChildId: fixture.seller.childId,
      deliveryRecord: null
    });

    await expect(
      controller.decideGuardianConfirmation(
        fixture.transactionId,
        {
          value: "confirmed",
          idempotencyKey: unique("buyer_confirm_before_seller"),
          challengeId: "challenge_buyer_first"
        },
        bearer(fixture.buyer.accessToken)
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "SELLER_DELIVERY_PROPOSAL_REQUIRED"
    });

    await expect(
      controller.decideGuardianConfirmation(
        fixture.transactionId,
        {
          value: "confirmed",
          deliveryMethod: "guardian_arranged",
          idempotencyKey: unique("seller_guardian_proposal"),
          challengeId: "challenge_seller_proposal"
        },
        bearer(fixture.seller.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction",
      targetId: fixture.transactionId,
      latestStatus: "pending_guardian_confirm",
      phase: "guardian_confirm",
      side: "seller",
      buyerConfirmed: false,
      sellerConfirmed: true
    });

    await expect(
      controller.decideGuardianConfirmation(
        fixture.transactionId,
        {
          value: "confirmed",
          idempotencyKey: unique("buyer_guardian_accept"),
          challengeId: "challenge_buyer_accept"
        },
        bearer(fixture.buyer.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "transaction",
      targetId: fixture.transactionId,
      latestStatus: "pending_delivery_confirm",
      phase: "guardian_confirm",
      side: "buyer",
      buyerConfirmed: true,
      sellerConfirmed: true
    });
    await expect(
      controller.getTransactionDetail(
        fixture.transactionId,
        bearer(fixture.buyer.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "pending_delivery_confirm",
      deliveryRecord: {
        deliveryMethod: "guardian_arranged",
        deliveryPointId: null,
        status: "pending",
        deliveryPoint: null
      },
      decisions: expect.arrayContaining([
        expect.objectContaining({
          phase: "guardian_confirm",
          side: "seller",
          childId: fixture.seller.childId,
          guardianRole: "primary"
        }),
        expect.objectContaining({
          phase: "guardian_confirm",
          side: "buyer",
          childId: fixture.buyer.childId,
          guardianRole: "primary"
        })
      ])
    });

    await expect(
      controller.decideDeliveryConfirmation(
        fixture.transactionId,
        {
          value: "confirmed",
          idempotencyKey: unique("buyer_delivery_confirm"),
          challengeId: "challenge_buyer_delivery"
        },
        bearer(fixture.buyer.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "pending_delivery_confirm",
      phase: "delivery_confirm",
      side: "buyer",
      buyerConfirmed: true,
      sellerConfirmed: false,
      transferredAmountPoints: 0
    });
    await expect(
      controller.decideDeliveryConfirmation(
        fixture.transactionId,
        {
          value: "confirmed",
          idempotencyKey: unique("seller_delivery_confirm"),
          challengeId: "challenge_seller_delivery"
        },
        bearer(fixture.seller.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "completed",
      phase: "delivery_confirm",
      side: "seller",
      buyerConfirmed: true,
      sellerConfirmed: true,
      transferredAmountPoints: fixture.pointsAmount
    });

    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "transferred"
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyer.pointAccountId
        },
        select: {
          frozenPoints: true,
          totalSpentPoints: true
        }
      })
    ).resolves.toEqual({
      frozenPoints: 0,
      totalSpentPoints: fixture.pointsAmount
    });
  });

  it("lets scoped admins resolve transaction disputes through bearer authenticated APIs", async () => {
    const releaseFixture = await createTransactionClosureFixture(
      "admin_release_dispute"
    );
    await markTransactionDisputed(releaseFixture.transactionId);
    const releaseAdmin = await createActivityAdmin(
      "admin_release_dispute_scoped",
      releaseFixture.communityId
    );
    const otherCommunity = await createCommunity("admin_dispute_other");
    const crossAdmin = await createActivityAdmin(
      "admin_release_dispute_cross",
      otherCommunity.id
    );

    await expect(
      controller.resolveTransactionDispute(
        releaseFixture.transactionId,
        {
          action: "release_to_buyer",
          reason: "跨社区管理员不应裁决",
          idempotencyKey: unique("cross_admin_release")
        },
        bearer(crossAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
    await expect(
      controller.resolveTransactionDispute(
        releaseFixture.transactionId,
        {
          action: "release_to_buyer",
          reason: "交付未完成，退回买家",
          idempotencyKey: unique("release_to_buyer")
        },
        bearer(releaseAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "cancelled",
      action: "release_to_buyer",
      releasedAmountPoints: releaseFixture.pointsAmount,
      transferredAmountPoints: 0
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: releaseFixture.buyer.pointAccountId
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 120,
      frozenPoints: 0
    });

    const transferFixture = await createTransactionClosureFixture(
      "admin_transfer_dispute"
    );
    await markTransactionDisputed(transferFixture.transactionId);
    const transferAdmin = await createActivityAdmin(
      "admin_transfer_dispute_scoped",
      transferFixture.communityId
    );
    await expect(
      controller.resolveTransactionDispute(
        transferFixture.transactionId,
        {
          action: "transfer_to_seller",
          reason: "证据支持卖方已完成交付",
          idempotencyKey: unique("transfer_to_seller")
        },
        bearer(transferAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "completed",
      action: "transfer_to_seller",
      releasedAmountPoints: 0,
      transferredAmountPoints: transferFixture.pointsAmount
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: transferFixture.seller.pointAccountId
        },
        select: {
          availablePoints: true,
          totalEarnedPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 100,
      totalEarnedPoints: 100
    });

    const platformReviewFixture = await createTransactionClosureFixture(
      "admin_keep_frozen_dispute"
    );
    await markTransactionDisputed(platformReviewFixture.transactionId);
    const platformReviewAdmin = await createActivityAdmin(
      "admin_keep_frozen_dispute_scoped",
      platformReviewFixture.communityId
    );
    await expect(
      controller.resolveTransactionDispute(
        platformReviewFixture.transactionId,
        {
          action: "keep_frozen_for_platform_review",
          reason: "证据不足，继续冻结进入平台复核",
          idempotencyKey: unique("keep_frozen")
        },
        bearer(platformReviewAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "platform_review",
      action: "keep_frozen_for_platform_review",
      releasedAmountPoints: 0,
      transferredAmountPoints: 0
    });
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: platformReviewFixture.pointHoldId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });
  });

  it("routes transaction appeals from guardians to scoped admins and platform review", async () => {
    const fixture = await createAppealTransactionFixture("appeal_api");
    const scopedAdmin = await createActivityAdmin(
      "appeal_api_scoped_admin",
      fixture.communityId
    );
    const otherCommunity = await createCommunity("appeal_api_other");
    const crossAdmin = await createActivityAdmin(
      "appeal_api_cross_admin",
      otherCommunity.id
    );
    const platformAdmin = await createPlatformAdmin("appeal_api_platform");
    const image = await createTempPrivateImage(
      fixture.buyer.guardianUserId,
      "appeal_api_image"
    );

    const created = await controller.createTransactionAppeal(
      fixture.transactionId,
      {
        reason: "约定交付点没有完成交接",
        attachmentMediaAssetIds: [image.id]
      },
      bearer(fixture.buyer.accessToken)
    );

    expect(created).toMatchObject({
      result: "accepted",
      targetType: "transaction_appeal",
      latestStatus: "pending_activity_admin",
      attachmentCount: 1
    });
    const appealId = String((created as { appealId: string }).appealId);
    const attachment = await prisma.appealAttachment.findFirstOrThrow({
      where: {
        appealId
      }
    });

    await expect(
      controller.listAppeals(
        fixture.communityId,
        undefined,
        bearer(scopedAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      appeals: [
        expect.objectContaining({
          id: appealId,
          status: "pending_activity_admin",
          attachmentCount: 1
        })
      ]
    });
    await expect(
      controller.getAppealDetail(appealId, bearer(crossAdmin.accessToken))
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
    await expect(
      controller.getAppealDetail(appealId, bearer(scopedAdmin.accessToken))
    ).resolves.toMatchObject({
      result: "accepted",
      appeal: {
        id: appealId,
        attachments: [
          expect.objectContaining({
            id: attachment.id,
            status: "accepted"
          })
        ]
      }
    });

    await expect(
      controller.reviewAppeal(
        appealId,
        {
          action: "escalate_platform",
          resolution: "附件需要平台复核"
        },
        bearer(scopedAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "escalated_platform",
      reviewedByUserId: scopedAdmin.userId
    });
    await expect(
      controller.listAppeals(
        undefined,
        "escalated_platform",
        bearer(platformAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetId: "platform",
      appeals: expect.arrayContaining([
        expect.objectContaining({
          id: appealId,
          status: "escalated_platform"
        })
      ])
    });
    await expect(
      controller.createAppealAttachmentGrant(
        attachment.id,
        {
          ttlSeconds: 300
        },
        bearer(crossAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "APPEAL_ACCESS_DENIED"
    });
    await expect(
      controller.reviewAppeal(
        appealId,
        {
          action: "platform_resolve",
          resolution: "平台确认维持冻结，转人工裁决"
        },
        bearer(platformAdmin.accessToken)
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "platform_resolved",
      reviewedByUserId: platformAdmin.userId
    });
  });
});

async function createCommunity(label: string) {
  const creator = await createGuardian(`${label}_creator`);

  return prisma.auctionCommunity.create({
    data: {
      name: `Stage6 ${label} ${unique("community")}`,
      creatorGuardianId: creator.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
}

async function createGuardian(label: string) {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId: user.id,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "2468",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-05T09:00:00.000Z"),
      status: "active"
    }
  });
  const session = await sessions.createSession({
    userId: user.id,
    deviceFingerprintHash: `device_${unique(label)}`,
    ipHash: `ip_${unique(label)}`,
    userAgentHash: `ua_${unique(label)}`,
    now: new Date()
  });
  if (session.result !== "accepted") {
    throw new Error("expected guardian session creation to succeed");
  }

  return {
    userId: user.id,
    guardianId: guardian.id,
    accessToken: session.accessToken
  };
}

async function createChildWithPrimaryGuardian(
  label: string,
  availablePoints = 500,
  frozenPoints = 0
): Promise<ChildFixture> {
  const guardian = await createGuardian(label);
  const totalPoints = availablePoints + frozenPoints;
  const child = await prisma.childProfile.create({
    data: {
      displayName: `Child ${label}`,
      gradeBand: "grade_3_4",
      status: "active",
      createdByGuardianId: guardian.guardianId,
      guardianLinks: {
        create: {
          guardianId: guardian.guardianId,
          role: "primary",
          status: "active",
          confirmedAt: new Date("2026-06-05T09:02:00.000Z")
        }
      },
      guardianSettings: {
        create: {
          canPublish: true,
          canBid: true,
          canUseGuardianArrangedDelivery: true
        }
      },
      pointAccount: {
        create: {
          availablePoints,
          frozenPoints,
          totalEarnedPoints: totalPoints,
          totalAwardedPoints: totalPoints
        }
      }
    },
    include: {
      pointAccount: true
    }
  });

  if (!child.pointAccount) {
    throw new Error("expected point account to be created");
  }
  await prisma.pointLedgerEntry.create({
    data: {
      accountId: child.pointAccount.id,
      childId: child.id,
      type: "initial_grant",
      amountPoints: totalPoints,
      availableAfter: totalPoints,
      frozenAfter: 0,
      relatedType: "child_profile",
      relatedId: child.id,
      idempotencyKey: unique(`${label}_initial_grant`),
      reason: "initial_child_points",
      createdByUserId: guardian.userId,
      createdAt: new Date("2026-06-05T09:01:00.000Z")
    }
  });

  return {
    childId: child.id,
    guardianUserId: guardian.userId,
    guardianId: guardian.guardianId,
    pointAccountId: child.pointAccount.id,
    accessToken: guardian.accessToken
  };
}

async function createTransactionClosureFixture(
  label: string
): Promise<TransactionClosureFixture> {
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`, 60, 0);
  const buyer = await createChildWithPrimaryGuardian(`${label}_buyer`, 80, 40);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Transaction API Community ${unique(label)}`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 40,
      minIncrementPoints: 5
    }
  });
  const auctionSession = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      status: "settled",
      startAt: new Date("2026-06-05T09:04:00.000Z"),
      endAt: new Date("2026-06-05T09:34:00.000Z"),
      startPoints: 40,
      minIncrementPoints: 5,
      idempotencyKey: unique(`${label}_auction`),
      currentPricePoints: 40,
      highestBidderChildId: buyer.childId,
      settledAt: new Date("2026-06-05T09:35:00.000Z")
    }
  });
  const bid = await prisma.bid.create({
    data: {
      auctionSessionId: auctionSession.id,
      bidderChildId: buyer.childId,
      amountPoints: 40,
      status: "active",
      idempotencyKey: unique(`${label}_bid`),
      createdAt: new Date("2026-06-05T09:10:00.000Z")
    }
  });
  await prisma.auctionSession.update({
    where: {
      id: auctionSession.id
    },
    data: {
      highestBidId: bid.id
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyer.pointAccountId,
      auctionSessionId: auctionSession.id,
      bidId: bid.id,
      amountPoints: 40,
      status: "active",
      createdAt: new Date("2026-06-05T09:10:00.000Z")
    }
  });
  await prisma.pointLedgerEntry.create({
    data: {
      accountId: buyer.pointAccountId,
      childId: buyer.childId,
      type: "hold",
      amountPoints: 40,
      availableAfter: 80,
      frozenAfter: 40,
      relatedType: "bid",
      relatedId: bid.id,
      idempotencyKey: unique(`${label}_hold_ledger`),
      reason: "auction_bid_hold",
      createdByUserId: buyer.guardianUserId,
      createdAt: new Date("2026-06-05T09:10:00.000Z")
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auctionSession.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 40,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2099-06-08T09:35:00.000Z"),
      deliveryConfirmDeadlineAt: null,
      createdAt: new Date("2026-06-05T09:35:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    communityId: community.id,
    pointHoldId: pointHold.id,
    pointsAmount: 40,
    buyer,
    seller
  };
}

async function createActivityAdmin(
  label: string,
  communityId: string
): Promise<AdminFixture> {
  const admin = await createAdminUser(label, "activity_admin");
  await prisma.adminCommunityScope.create({
    data: {
      adminProfileId: admin.adminProfileId,
      communityId,
      status: "active"
    }
  });

  return {
    userId: admin.userId,
    accessToken: admin.accessToken
  };
}

async function createPlatformAdmin(label: string): Promise<AdminFixture> {
  const admin = await createAdminUser(label, "platform_admin");

  return {
    userId: admin.userId,
    accessToken: admin.accessToken
  };
}

async function createAdminUser(
  label: string,
  role: "activity_admin" | "platform_admin"
) {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  const admin = await prisma.adminProfile.create({
    data: {
      userId: user.id,
      role,
      mfaEnabled: true,
      status: "active"
    }
  });
  const session = await sessions.createSession({
    userId: user.id,
    deviceFingerprintHash: `device_${unique(label)}`,
    ipHash: `ip_${unique(label)}`,
    userAgentHash: `ua_${unique(label)}`,
    now: new Date()
  });
  if (session.result !== "accepted") {
    throw new Error("expected admin session creation to succeed");
  }

  return {
    userId: user.id,
    adminProfileId: admin.id,
    accessToken: session.accessToken
  };
}

async function createAppealTransactionFixture(
  label: string
): Promise<AppealTransactionFixture> {
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`);
  const buyer = await createChildWithPrimaryGuardian(`${label}_buyer`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Appeal API Community ${unique(label)}`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 20,
      minIncrementPoints: 5
    }
  });
  const auctionSession = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      status: "settled",
      startAt: new Date("2026-06-05T09:04:00.000Z"),
      endAt: new Date("2026-06-05T09:34:00.000Z"),
      startPoints: 20,
      minIncrementPoints: 5,
      idempotencyKey: unique(`${label}_auction`),
      currentPricePoints: 50,
      highestBidderChildId: buyer.childId
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyer.pointAccountId,
      auctionSessionId: auctionSession.id,
      amountPoints: 50,
      status: "active"
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auctionSession.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 50,
      status: "pending_delivery_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-05T12:00:00.000Z"),
      deliveryConfirmDeadlineAt: new Date("2026-06-08T12:00:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    communityId: community.id,
    buyer,
    seller
  };
}

async function markTransactionDisputed(transactionId: string) {
  await prisma.transaction.update({
    where: {
      id: transactionId
    },
    data: {
      status: "disputed"
    }
  });
}

async function createTempPrivateImage(ownerUserId: string, label: string) {
  return prisma.mediaAsset.create({
    data: {
      ownerUserId,
      storageBucket: "stage6-appeals",
      storageKey: `${unique(label)}.jpg`,
      visibility: "temp_private",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      checksum: `sha256:${unique(label)}`
    }
  });
}

function bearer(accessToken: string) {
  return `Bearer ${accessToken}`;
}

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Stage 6 API flow tests require explicit DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Stage 6 API flow tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}
