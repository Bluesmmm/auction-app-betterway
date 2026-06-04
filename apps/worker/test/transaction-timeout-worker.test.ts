import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaTransactionTimeoutRunner,
  scanOverdueTransactionTimeouts
} from "../src/transaction-timeout-worker.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const runner = new PrismaTransactionTimeoutRunner(prisma);

type ChildFixture = {
  childId: string;
  guardianId: string;
  guardianUserId: string;
  pointAccountId: string;
};

type TransactionFixture = {
  transactionId: string;
  auctionSessionId: string;
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
      "Transaction timeout worker tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Transaction timeout worker tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("transaction timeout worker", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cancels overdue guardian-confirm transactions and releases the buyer hold idempotently", async () => {
    const fixture = await createTransactionFixture("guardian_timeout", {
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-04T10:00:00.000Z")
    });
    const now = new Date("2026-06-04T10:00:01.000Z");

    const first = await runner.processTransactionTimeout({
      transactionId: fixture.transactionId,
      workerName: "stage5-timeout-worker",
      now
    });
    const second = await runner.processTransactionTimeout({
      transactionId: fixture.transactionId,
      workerName: "stage5-timeout-worker",
      now: new Date("2026-06-04T10:00:02.000Z")
    });

    expect(first).toEqual({
      result: "guardian_confirm_timeout_cancelled",
      transactionId: fixture.transactionId,
      releasedAmountPoints: fixture.pointsAmount
    });
    expect(second).toEqual({
      result: "skipped",
      transactionId: fixture.transactionId,
      reason: "TRANSACTION_NOT_TIMEOUT_ELIGIBLE",
      status: "cancelled"
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
      status: "cancelled",
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
      prisma.pointLedgerEntry.count({
        where: {
          relatedType: "transaction",
          relatedId: fixture.transactionId,
          reason: "transaction_guardian_timeout_release"
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "transaction.cancelled",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("moves overdue delivery-confirm transactions to platform review without releasing the active hold", async () => {
    const fixture = await createTransactionFixture("delivery_timeout", {
      status: "pending_delivery_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-04T10:00:00.000Z"),
      deliveryConfirmDeadlineAt: new Date("2026-06-07T10:00:00.000Z")
    });

    await expect(
      runner.processTransactionTimeout({
        transactionId: fixture.transactionId,
        workerName: "stage5-timeout-worker",
        now: new Date("2026-06-07T10:00:01.000Z")
      })
    ).resolves.toEqual({
      result: "delivery_confirm_timeout_platform_review",
      transactionId: fixture.transactionId
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
      status: "platform_review",
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
          eventType: "transaction.platform_review_required",
          targetId: fixture.transactionId
        }
      })
    ).resolves.toBe(1);
  });

  it("scans due transaction timeouts without touching future transactions", async () => {
    const guardianDue = await createTransactionFixture("scan_guardian_due", {
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-04T10:00:00.000Z")
    });
    const deliveryDue = await createTransactionFixture("scan_delivery_due", {
      status: "pending_delivery_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-04T10:00:00.000Z"),
      deliveryConfirmDeadlineAt: new Date("2026-06-07T10:00:00.000Z")
    });
    const future = await createTransactionFixture("scan_future", {
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-07T10:10:00.000Z")
    });

    const result = await scanOverdueTransactionTimeouts({
      prisma,
      runner,
      workerName: "stage5-timeout-worker",
      now: new Date("2026-06-07T10:00:01.000Z"),
      limit: 10
    });

    expect(result.result).toBe("scanned");
    expect(result.guardianTimeoutCancelledCount).toBeGreaterThanOrEqual(1);
    expect(result.deliveryTimeoutPlatformReviewCount).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: guardianDue.transactionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "cancelled"
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: deliveryDue.transactionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "platform_review"
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          id: future.transactionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "pending_guardian_confirm"
    });
  });
});

async function createTransactionFixture(
  label: string,
  input: {
    status: "pending_guardian_confirm" | "pending_delivery_confirm";
    guardianConfirmDeadlineAt: Date;
    deliveryConfirmDeadlineAt?: Date | null;
  }
): Promise<TransactionFixture> {
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`, 60, 0);
  const buyer = await createChildWithPrimaryGuardian(`${label}_buyer`, 80, 40);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Timeout Community ${unique(label)}`,
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
      status: input.status,
      guardianConfirmDeadlineAt: input.guardianConfirmDeadlineAt,
      deliveryConfirmDeadlineAt: input.deliveryConfirmDeadlineAt ?? null,
      createdAt: new Date("2026-06-04T09:31:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    auctionSessionId: auction.id,
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
      displayName: `Timeout Child ${unique(label)}`,
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

async function createGuardian(label: string) {
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
