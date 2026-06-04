import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { TransactionDecisionService } from "../../src/auctions/transaction-decision.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const decisions = new TransactionDecisionService(prisma);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = {
  childId: string;
  guardianUserId: string;
  guardianId: string;
  pointAccountId: string;
};

type TransactionFixture = {
  transactionId: string;
  auctionSessionId: string;
  communityId: string;
  pointHoldId: string;
  buyer: ChildFixture;
  seller: ChildFixture;
  pointsAmount: number;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TransactionDecisionService integration tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "TransactionDecisionService integration tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("TransactionDecisionService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("moves to delivery confirmation only after both primary guardians confirm the transaction", async () => {
    const fixture = await createTransactionFixture("guardian_both_confirm");
    const buyerNow = new Date("2026-06-04T10:00:00.000Z");
    const sellerNow = new Date("2026-06-04T10:05:00.000Z");

    const buyerDecision = await decisions.decideGuardianConfirmation({
      actorUserId: fixture.buyer.guardianUserId,
      transactionId: fixture.transactionId,
      value: "confirmed",
      idempotencyKey: unique("buyer_guardian_confirm"),
      now: buyerNow
    });
    const sellerDecision = await decisions.decideGuardianConfirmation({
      actorUserId: fixture.seller.guardianUserId,
      transactionId: fixture.transactionId,
      value: "confirmed",
      idempotencyKey: unique("seller_guardian_confirm"),
      now: sellerNow
    });

    expect(buyerDecision).toEqual({
      result: "accepted",
      transactionId: fixture.transactionId,
      phase: "guardian_confirm",
      value: "confirmed",
      side: "buyer",
      status: "pending_guardian_confirm",
      decisionId: expect.any(String),
      buyerConfirmed: true,
      sellerConfirmed: false,
      releasedAmountPoints: 0,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: null,
      idempotencyKey: expect.any(String)
    });
    expect(sellerDecision).toEqual({
      result: "accepted",
      transactionId: fixture.transactionId,
      phase: "guardian_confirm",
      value: "confirmed",
      side: "seller",
      status: "pending_delivery_confirm",
      decisionId: expect.any(String),
      buyerConfirmed: true,
      sellerConfirmed: true,
      releasedAmountPoints: 0,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: "2026-06-07T10:05:00.000Z",
      idempotencyKey: expect.any(String)
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: fixture.transactionId
        },
        select: {
          status: true,
          deliveryConfirmDeadlineAt: true,
          version: true
        }
      })
    ).resolves.toEqual({
      status: "pending_delivery_confirm",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T10:05:00.000Z"),
      version: 2
    });
    await expect(
      prisma.guardianDecision.count({
        where: {
          transactionId: fixture.transactionId,
          phase: "guardian_confirm",
          effective: true
        }
      })
    ).resolves.toBe(2);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.guardian_confirmed",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("cancels the transaction and releases the buyer hold when either primary guardian rejects", async () => {
    const fixture = await createTransactionFixture("guardian_reject");
    const now = new Date("2026-06-04T11:00:00.000Z");
    const idempotencyKey = unique("seller_guardian_reject");

    const result = await decisions.decideGuardianConfirmation({
      actorUserId: fixture.seller.guardianUserId,
      transactionId: fixture.transactionId,
      value: "rejected",
      idempotencyKey,
      now
    });
    const replay = await decisions.decideGuardianConfirmation({
      actorUserId: fixture.seller.guardianUserId,
      transactionId: fixture.transactionId,
      value: "rejected",
      idempotencyKey,
      now: new Date("2026-06-04T11:01:00.000Z")
    });

    expect(result).toEqual({
      result: "accepted",
      transactionId: fixture.transactionId,
      phase: "guardian_confirm",
      value: "rejected",
      side: "seller",
      status: "cancelled",
      decisionId: expect.any(String),
      buyerConfirmed: false,
      sellerConfirmed: false,
      releasedAmountPoints: fixture.pointsAmount,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: null,
      idempotencyKey
    });
    expect(replay).toEqual(result);
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true,
          releasedAt: true,
          transferredAt: true
        }
      })
    ).resolves.toEqual({
      status: "released",
      releasedAt: now,
      transferredAt: null
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyer.pointAccountId
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
    await expect(
      prisma.pointLedgerEntry.findFirst({
        where: {
          relatedType: "transaction",
          relatedId: fixture.transactionId,
          reason: "transaction_guardian_reject_release"
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: fixture.buyer.pointAccountId,
        childId: fixture.buyer.childId,
        type: "release",
        amountPoints: fixture.pointsAmount,
        availableAfter: 120,
        frozenAfter: 0,
        createdByUserId: fixture.seller.guardianUserId,
        createdAt: now
      })
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.cancelled",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("transfers buyer frozen points to seller available points after both delivery confirmations", async () => {
    const fixture = await createTransactionFixture("delivery_complete", {
      status: "pending_delivery_confirm",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T12:00:00.000Z")
    });
    const buyerNow = new Date("2026-06-04T12:00:00.000Z");
    const sellerNow = new Date("2026-06-04T12:10:00.000Z");

    const buyerDecision = await decisions.decideDeliveryConfirmation({
      actorUserId: fixture.buyer.guardianUserId,
      transactionId: fixture.transactionId,
      value: "confirmed",
      idempotencyKey: unique("buyer_delivery_confirm"),
      now: buyerNow
    });
    const sellerDecision = await decisions.decideDeliveryConfirmation({
      actorUserId: fixture.seller.guardianUserId,
      transactionId: fixture.transactionId,
      value: "confirmed",
      idempotencyKey: unique("seller_delivery_confirm"),
      now: sellerNow
    });

    expect(buyerDecision).toMatchObject({
      result: "accepted",
      phase: "delivery_confirm",
      side: "buyer",
      status: "pending_delivery_confirm",
      buyerConfirmed: true,
      sellerConfirmed: false,
      transferredAmountPoints: 0
    });
    expect(sellerDecision).toMatchObject({
      result: "accepted",
      phase: "delivery_confirm",
      side: "seller",
      status: "completed",
      buyerConfirmed: true,
      sellerConfirmed: true,
      transferredAmountPoints: fixture.pointsAmount
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: fixture.transactionId
        },
        select: {
          status: true,
          version: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      version: 2
    });
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true,
          releasedAt: true,
          transferredAt: true
        }
      })
    ).resolves.toEqual({
      status: "transferred",
      releasedAt: null,
      transferredAt: sellerNow
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyer.pointAccountId
        },
        select: {
          availablePoints: true,
          frozenPoints: true,
          totalSpentPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 80,
      frozenPoints: 0,
      totalSpentPoints: fixture.pointsAmount
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.seller.pointAccountId
        },
        select: {
          availablePoints: true,
          frozenPoints: true,
          totalEarnedPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 60 + fixture.pointsAmount,
      frozenPoints: 0,
      totalEarnedPoints: 60 + fixture.pointsAmount
    });
    await expect(
      prisma.pointLedgerEntry.findMany({
        where: {
          relatedType: "transaction",
          relatedId: fixture.transactionId,
          reason: {
            in: [
              "transaction_delivery_complete_transfer_out",
              "transaction_delivery_complete_transfer_in"
            ]
          }
        },
        orderBy: {
          type: "asc"
        },
        select: {
          accountId: true,
          childId: true,
          type: true,
          amountPoints: true,
          availableAfter: true,
          frozenAfter: true,
          reason: true,
          createdByUserId: true,
          createdAt: true
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          accountId: fixture.buyer.pointAccountId,
          childId: fixture.buyer.childId,
          type: "transfer_out",
          amountPoints: fixture.pointsAmount,
          availableAfter: 80,
          frozenAfter: 0,
          reason: "transaction_delivery_complete_transfer_out",
          createdByUserId: fixture.seller.guardianUserId,
          createdAt: sellerNow
        },
        {
          accountId: fixture.seller.pointAccountId,
          childId: fixture.seller.childId,
          type: "transfer_in",
          amountPoints: fixture.pointsAmount,
          availableAfter: 60 + fixture.pointsAmount,
          frozenAfter: 0,
          reason: "transaction_delivery_complete_transfer_in",
          createdByUserId: fixture.seller.guardianUserId,
          createdAt: sellerNow
        }
      ])
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.completed",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("marks delivery as disputed without releasing or transferring points when a primary guardian rejects delivery", async () => {
    const fixture = await createTransactionFixture("delivery_disputed", {
      status: "pending_delivery_confirm",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T13:00:00.000Z")
    });
    const now = new Date("2026-06-04T13:00:00.000Z");

    await expect(
      decisions.decideDeliveryConfirmation({
        actorUserId: fixture.buyer.guardianUserId,
        transactionId: fixture.transactionId,
        value: "rejected",
        idempotencyKey: unique("buyer_delivery_reject"),
        now
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transactionId: fixture.transactionId,
      phase: "delivery_confirm",
      value: "rejected",
      side: "buyer",
      status: "disputed",
      releasedAmountPoints: 0,
      transferredAmountPoints: 0
    });
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true,
          releasedAt: true,
          transferredAt: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      releasedAt: null,
      transferredAt: null
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyer.pointAccountId
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 80,
      frozenPoints: fixture.pointsAmount
    });
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.disputed",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("allows a scoped admin to release disputed transaction points back to the buyer", async () => {
    const fixture = await createTransactionFixture("admin_release", {
      status: "disputed",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T13:00:00.000Z")
    });
    const admin = await createActivityAdmin("admin_release", fixture.communityId);
    const now = new Date("2026-06-04T14:00:00.000Z");
    const idempotencyKey = unique("admin_release_key");

    const result = await decisions.resolveTransactionDispute({
      actorUserId: admin.userId,
      transactionId: fixture.transactionId,
      action: "release_to_buyer",
      reason: "seller_no_show",
      idempotencyKey,
      now
    });
    const replay = await decisions.resolveTransactionDispute({
      actorUserId: admin.userId,
      transactionId: fixture.transactionId,
      action: "release_to_buyer",
      reason: "seller_no_show",
      idempotencyKey,
      now: new Date("2026-06-04T14:01:00.000Z")
    });

    expect(result).toEqual({
      result: "accepted",
      transactionId: fixture.transactionId,
      action: "release_to_buyer",
      status: "cancelled",
      releasedAmountPoints: fixture.pointsAmount,
      transferredAmountPoints: 0,
      idempotencyKey
    });
    expect(replay).toEqual(result);
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true,
          releasedAt: true,
          transferredAt: true
        }
      })
    ).resolves.toEqual({
      status: "released",
      releasedAt: now,
      transferredAt: null
    });
    await expect(
      prisma.pointLedgerEntry.findFirst({
        where: {
          relatedType: "transaction",
          relatedId: fixture.transactionId,
          reason: "transaction_admin_release_to_buyer"
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: fixture.buyer.pointAccountId,
        childId: fixture.buyer.childId,
        type: "release",
        amountPoints: fixture.pointsAmount,
        availableAfter: 120,
        frozenAfter: 0,
        createdByUserId: admin.userId,
        createdAt: now
      })
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.cancelled",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("allows a scoped admin to transfer platform-review frozen points to the seller", async () => {
    const fixture = await createTransactionFixture("admin_transfer", {
      status: "platform_review",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T13:00:00.000Z")
    });
    const admin = await createActivityAdmin("admin_transfer", fixture.communityId);
    const now = new Date("2026-06-04T15:00:00.000Z");

    await expect(
      decisions.resolveTransactionDispute({
        actorUserId: admin.userId,
        transactionId: fixture.transactionId,
        action: "transfer_to_seller",
        reason: "delivery_confirmed_by_admin",
        idempotencyKey: unique("admin_transfer_key"),
        now
      })
    ).resolves.toEqual({
      result: "accepted",
      transactionId: fixture.transactionId,
      action: "transfer_to_seller",
      status: "completed",
      releasedAmountPoints: 0,
      transferredAmountPoints: fixture.pointsAmount,
      idempotencyKey: expect.any(String)
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.seller.pointAccountId
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
    await expect(
      prisma.pointLedgerEntry.findMany({
        where: {
          relatedType: "transaction",
          relatedId: fixture.transactionId,
          reason: {
            in: [
              "transaction_admin_transfer_to_seller_out",
              "transaction_admin_transfer_to_seller_in"
            ]
          }
        },
        select: {
          type: true,
          reason: true,
          createdByUserId: true,
          createdAt: true
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          type: "transfer_out",
          reason: "transaction_admin_transfer_to_seller_out",
          createdByUserId: admin.userId,
          createdAt: now
        },
        {
          type: "transfer_in",
          reason: "transaction_admin_transfer_to_seller_in",
          createdByUserId: admin.userId,
          createdAt: now
        }
      ])
    );
  });

  it("allows a scoped admin to keep disputed points frozen for platform review", async () => {
    const fixture = await createTransactionFixture("admin_keep_frozen", {
      status: "disputed",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T13:00:00.000Z")
    });
    const admin = await createActivityAdmin(
      "admin_keep_frozen",
      fixture.communityId
    );

    await expect(
      decisions.resolveTransactionDispute({
        actorUserId: admin.userId,
        transactionId: fixture.transactionId,
        action: "keep_frozen_for_platform_review",
        reason: "needs_platform_review",
        idempotencyKey: unique("admin_keep_frozen_key"),
        now: new Date("2026-06-04T16:00:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transactionId: fixture.transactionId,
      action: "keep_frozen_for_platform_review",
      status: "platform_review",
      releasedAmountPoints: 0,
      transferredAmountPoints: 0
    });
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId
        },
        select: {
          status: true,
          releasedAt: true,
          transferredAt: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      releasedAt: null,
      transferredAt: null
    });
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.platform_review_required",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("rejects dispute resolution from non-admin actors without changing points", async () => {
    const fixture = await createTransactionFixture("admin_reject_outsider", {
      status: "disputed",
      deliveryConfirmDeadlineAt: new Date("2026-06-07T13:00:00.000Z")
    });
    const outsider = await createGuardian("admin_reject_outsider");

    await expect(
      decisions.resolveTransactionDispute({
        actorUserId: outsider.userId,
        transactionId: fixture.transactionId,
        action: "release_to_buyer",
        reason: "outsider_attempt",
        idempotencyKey: unique("admin_reject_outsider_key"),
        now: new Date("2026-06-04T17:00:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: fixture.transactionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "disputed"
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyer.pointAccountId
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 80,
      frozenPoints: fixture.pointsAmount
    });
  });
});

async function createTransactionFixture(
  label: string,
  input: {
    status?:
      | "pending_guardian_confirm"
      | "pending_delivery_confirm"
      | "disputed"
      | "platform_review";
    deliveryConfirmDeadlineAt?: Date | null;
  } = {}
): Promise<TransactionFixture> {
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`, 60, 0);
  const buyer = await createChildWithPrimaryGuardian(`${label}_buyer`, 80, 40);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Transaction Community ${unique(label)}`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 90
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
  const auction = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      idempotencyKey: unique(`${label}_auction`),
      status: "settled",
      startAt: new Date("2026-06-04T09:00:00.000Z"),
      endAt: new Date("2026-06-04T09:30:00.000Z"),
      startPoints: 40,
      minIncrementPoints: 5,
      currentPricePoints: 40,
      highestBidderChildId: buyer.childId,
      settledAt: new Date("2026-06-04T09:31:00.000Z")
    }
  });
  const bid = await prisma.bid.create({
    data: {
      auctionSessionId: auction.id,
      bidderChildId: buyer.childId,
      amountPoints: 40,
      status: "active",
      idempotencyKey: unique(`${label}_bid`),
      createdAt: new Date("2026-06-04T09:10:00.000Z")
    }
  });
  await prisma.auctionSession.update({
    where: {
      id: auction.id
    },
    data: {
      highestBidId: bid.id
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyer.pointAccountId,
      auctionSessionId: auction.id,
      bidId: bid.id,
      amountPoints: 40,
      status: "active",
      createdAt: new Date("2026-06-04T09:10:00.000Z")
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
      createdAt: new Date("2026-06-04T09:10:00.000Z")
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auction.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 40,
      status: input.status ?? "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-06T09:31:00.000Z"),
      deliveryConfirmDeadlineAt: input.deliveryConfirmDeadlineAt ?? null,
      createdAt: new Date("2026-06-04T09:31:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    auctionSessionId: auction.id,
    communityId: community.id,
    pointHoldId: pointHold.id,
    buyer,
    seller,
    pointsAmount: 40
  };
}

async function createChildWithPrimaryGuardian(
  label: string,
  availablePoints: number,
  frozenPoints: number
): Promise<ChildFixture> {
  const guardian = await createGuardian(label);
  const child = await prisma.childProfile.create({
    data: {
      displayName: `Transaction Child ${unique(label)}`,
      gradeBand: "grade_3_4",
      status: "active",
      createdByGuardianId: guardian.guardianId
    }
  });
  await prisma.guardianChildLink.create({
    data: {
      guardianId: guardian.guardianId,
      childId: child.id,
      role: "primary",
      status: "active",
      confirmedAt: new Date("2026-06-04T08:00:00.000Z")
    }
  });
  const totalPoints = availablePoints + frozenPoints;
  const account = await prisma.pointAccount.create({
    data: {
      childId: child.id,
      availablePoints,
      frozenPoints,
      totalEarnedPoints: totalPoints,
      totalAwardedPoints: totalPoints
    }
  });
  await prisma.pointLedgerEntry.create({
    data: {
      accountId: account.id,
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
      createdAt: new Date("2026-06-04T08:01:00.000Z")
    }
  });

  return {
    childId: child.id,
    guardianUserId: guardian.userId,
    guardianId: guardian.guardianId,
    pointAccountId: account.id
  };
}

async function createGuardian(label: string): Promise<GuardianFixture> {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  await prisma.wechatIdentity.create({
    data: {
      userId: user.id,
      openid: `mock_openid_${unique(label)}`
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId: user.id,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "1234",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-04T08:00:00.000Z"),
      status: "active"
    }
  });

  return {
    userId: user.id,
    guardianId: guardian.id
  };
}

async function createActivityAdmin(label: string, communityId: string) {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  await prisma.wechatIdentity.create({
    data: {
      userId: user.id,
      openid: `mock_openid_${unique(label)}`
    }
  });
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId: user.id,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    }
  });
  await prisma.adminCommunityScope.create({
    data: {
      adminProfileId: adminProfile.id,
      communityId,
      status: "active"
    }
  });

  return {
    userId: user.id,
    adminProfileId: adminProfile.id
  };
}
