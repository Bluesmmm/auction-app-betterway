import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaAuctionSettlementRunner,
  processAuctionSettlementTrigger,
  scanOverdueAuctionSettlements
} from "../src/auction-settlement-worker.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const runner = new PrismaAuctionSettlementRunner(prisma);

type AuctionFixture = {
  auctionId: string;
  itemId: string;
  communityId: string;
  sellerChildId: string;
  buyerChildId: string | null;
  buyerPointAccountId: string | null;
  bidId: string | null;
  pointHoldId: string | null;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "Auction settlement worker tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Auction settlement worker tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("auction settlement worker", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("settles an ended auction with an active highest bid into a pending guardian-confirm transaction", async () => {
    const fixture = await createAuctionFixture("settled_highest", {
      withHighestBid: true,
      endAt: new Date("2026-06-03T12:30:00.000Z")
    });
    const now = new Date("2026-06-03T12:31:00.000Z");

    const result = await runner.settleAuction({
      auctionSessionId: fixture.auctionId,
      workerName: "stage5-settlement-worker",
      now
    });

    expect(result).toEqual({
      result: "settled",
      auctionSessionId: fixture.auctionId,
      transactionId: expect.any(String),
      buyerChildId: fixture.buyerChildId,
      sellerChildId: fixture.sellerChildId,
      pointHoldId: fixture.pointHoldId,
      pointsAmount: 40,
      guardianConfirmDeadlineAt: "2026-06-05T12:31:00.000Z",
      alreadyFinal: false
    });
    if (result.result !== "settled") {
      throw new Error(`expected settled, received ${result.result}`);
    }

    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: fixture.auctionId
        },
        select: {
          status: true,
          settledAt: true,
          settlementAttemptCount: true,
          lastSettlementError: true,
          version: true,
          highestBidId: true,
          highestBidderChildId: true,
          currentPricePoints: true
        }
      })
    ).resolves.toEqual({
      status: "settled",
      settledAt: now,
      settlementAttemptCount: 1,
      lastSettlementError: null,
      version: 2,
      highestBidId: fixture.bidId,
      highestBidderChildId: fixture.buyerChildId,
      currentPricePoints: 40
    });
    await expect(
      prisma.transaction.findUnique({
        where: {
          auctionSessionId: fixture.auctionId
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: result.transactionId,
        buyerChildId: fixture.buyerChildId,
        sellerChildId: fixture.sellerChildId,
        pointHoldId: fixture.pointHoldId,
        pointsAmount: 40,
        status: "pending_guardian_confirm",
        guardianConfirmDeadlineAt: new Date("2026-06-05T12:31:00.000Z"),
        deliveryConfirmDeadlineAt: null,
        createdAt: now
      })
    );
    await expect(
      prisma.pointHold.findUnique({
        where: {
          id: fixture.pointHoldId ?? ""
        },
        select: {
          status: true,
          transferredAt: true,
          releasedAt: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      transferredAt: null,
      releasedAt: null
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: fixture.buyerPointAccountId ?? ""
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 80,
      frozenPoints: 40
    });

    const outbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.settled",
        targetId: fixture.auctionId
      }
    });
    expect(outbox).toEqual(
      expect.objectContaining({
        eventType: "auction.settled",
        targetType: "auction_session",
        targetId: fixture.auctionId,
        payloadJson: expect.objectContaining({
          auctionSessionId: fixture.auctionId,
          transactionId: result.transactionId,
          buyerChildId: fixture.buyerChildId,
          sellerChildId: fixture.sellerChildId,
          pointHoldId: fixture.pointHoldId,
          pointsAmount: 40,
          guardianConfirmDeadlineAt: "2026-06-05T12:31:00.000Z",
          status: "settled"
        })
      })
    );
    await expect(
      prisma.auditLog.count({
        where: {
          action: "auction.settle",
          targetId: fixture.auctionId
        }
      })
    ).resolves.toBe(1);

    await expect(
      runner.settleAuction({
        auctionSessionId: fixture.auctionId,
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:32:00.000Z")
      })
    ).resolves.toEqual({
      ...result,
      alreadyFinal: true
    });
    await expect(
      prisma.transaction.count({
        where: {
          auctionSessionId: fixture.auctionId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.settled",
          targetId: fixture.auctionId
        }
      })
    ).resolves.toBe(1);
  });

  it("marks an ended auction without a highest bid as unsold idempotently", async () => {
    const fixture = await createAuctionFixture("unsold", {
      withHighestBid: false,
      endAt: new Date("2026-06-03T12:30:00.000Z")
    });
    const now = new Date("2026-06-03T12:31:00.000Z");

    const result = await runner.settleAuction({
      auctionSessionId: fixture.auctionId,
      workerName: "stage5-settlement-worker",
      now
    });

    expect(result).toEqual({
      result: "unsold",
      auctionSessionId: fixture.auctionId,
      alreadyFinal: false
    });
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: fixture.auctionId
        },
        select: {
          status: true,
          settledAt: true,
          settlementAttemptCount: true,
          version: true
        }
      })
    ).resolves.toEqual({
      status: "unsold",
      settledAt: now,
      settlementAttemptCount: 1,
      version: 2
    });
    await expect(
      prisma.outboxEvent.findFirst({
        where: {
          eventType: "auction.unsold",
          targetId: fixture.auctionId
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        eventType: "auction.unsold",
        targetType: "auction_session",
        payloadJson: expect.objectContaining({
          auctionSessionId: fixture.auctionId,
          itemId: fixture.itemId,
          communityId: fixture.communityId,
          sellerChildId: fixture.sellerChildId,
          status: "unsold"
        })
      })
    );

    await expect(
      runner.settleAuction({
        auctionSessionId: fixture.auctionId,
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:32:00.000Z")
      })
    ).resolves.toEqual({
      result: "unsold",
      auctionSessionId: fixture.auctionId,
      alreadyFinal: true
    });
    await expect(
      prisma.transaction.count({
        where: {
          auctionSessionId: fixture.auctionId
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.unsold",
          targetId: fixture.auctionId
        }
      })
    ).resolves.toBe(1);
  });

  it("skips auctions that have not reached the fixed end time", async () => {
    const fixture = await createAuctionFixture("not_due", {
      withHighestBid: true,
      endAt: new Date("2026-06-03T12:30:00.000Z")
    });

    await expect(
      runner.settleAuction({
        auctionSessionId: fixture.auctionId,
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:29:59.000Z")
      })
    ).resolves.toEqual({
      result: "skipped",
      auctionSessionId: fixture.auctionId,
      reason: "AUCTION_NOT_DUE",
      status: "active"
    });
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: fixture.auctionId
        },
        select: {
          status: true,
          settlementAttemptCount: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      settlementAttemptCount: 0
    });
  });

  it("scans overdue active auctions from PostgreSQL as the fallback path", async () => {
    const settled = await createAuctionFixture("scan_settled", {
      withHighestBid: true,
      endAt: new Date("2026-06-03T12:00:00.000Z")
    });
    const unsold = await createAuctionFixture("scan_unsold", {
      withHighestBid: false,
      endAt: new Date("2026-06-03T12:00:00.000Z")
    });
    const future = await createAuctionFixture("scan_future", {
      withHighestBid: true,
      endAt: new Date("2026-06-03T13:00:00.000Z")
    });

    const scanResult = await scanOverdueAuctionSettlements({
      prisma,
      runner,
      workerName: "stage5-settlement-worker",
      now: new Date("2026-06-03T12:00:30.000Z"),
      limit: 10
    });
    expect(scanResult.result).toBe("scanned");
    expect(scanResult.scannedCount).toBeGreaterThanOrEqual(2);
    expect(scanResult.settledCount).toBeGreaterThanOrEqual(1);
    expect(scanResult.unsoldCount).toBeGreaterThanOrEqual(1);
    expect(scanResult.retryableCount).toBe(0);
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: settled.auctionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "settled"
    });
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: unsold.auctionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "unsold"
    });
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: future.auctionId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });
  });

  it("passes delayed settlement trigger jobs through the same runner", async () => {
    const calls: unknown[] = [];

    const result = await processAuctionSettlementTrigger(
      {
        auctionSessionId: "auction_job_1",
        dueAt: "2026-06-03T12:30:00.000Z"
      },
      {
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:30:01.000Z"),
        runner: {
          async settleAuction(input) {
            calls.push(input);
            return {
              result: "unsold",
              auctionSessionId: input.auctionSessionId,
              alreadyFinal: false
            };
          }
        }
      }
    );

    expect(result).toEqual({
      result: "unsold",
      auctionSessionId: "auction_job_1",
      alreadyFinal: false
    });
    expect(calls).toEqual([
      {
        auctionSessionId: "auction_job_1",
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:30:01.000Z")
      }
    ]);
  });

  it("returns retryable unknown when settlement cannot acquire the auction row lock", async () => {
    const fixture = await createAuctionFixture("settlement_lock_timeout", {
      withHighestBid: true,
      endAt: new Date("2026-06-03T12:30:00.000Z")
    });
    const locker = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
    let releaseLock!: () => void;
    let signalLockReady!: () => void;
    const releaseLockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockReadyPromise = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });
    const holdingTransaction = locker.$transaction(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "AuctionSession"
          WHERE "id" = ${fixture.auctionId}
          FOR UPDATE
        `;
        signalLockReady();
        await releaseLockPromise;
      },
      {
        timeout: 10_000
      }
    );

    await lockReadyPromise;
    try {
      await expect(
        runner.settleAuction({
          auctionSessionId: fixture.auctionId,
          workerName: "stage5-settlement-worker",
          now: new Date("2026-06-03T12:31:00.000Z")
        })
      ).resolves.toEqual({
        result: "retryable",
        auctionSessionId: fixture.auctionId,
        errorCode: "TRANSACTION_RESULT_UNKNOWN",
        retryable: true,
        refreshRequired: true
      });
    } finally {
      releaseLock();
      await holdingTransaction;
      await locker.$disconnect();
    }

    await expect(
      prisma.transaction.count({
        where: {
          auctionSessionId: fixture.auctionId
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.settled",
          targetId: fixture.auctionId
        }
      })
    ).resolves.toBe(0);

    await expect(
      runner.settleAuction({
        auctionSessionId: fixture.auctionId,
        workerName: "stage5-settlement-worker",
        now: new Date("2026-06-03T12:31:10.000Z")
      })
    ).resolves.toEqual({
      result: "settled",
      auctionSessionId: fixture.auctionId,
      transactionId: expect.any(String),
      buyerChildId: fixture.buyerChildId,
      sellerChildId: fixture.sellerChildId,
      pointHoldId: fixture.pointHoldId,
      pointsAmount: 40,
      guardianConfirmDeadlineAt: "2026-06-05T12:31:10.000Z",
      alreadyFinal: false
    });
  });
});

async function createAuctionFixture(
  label: string,
  input: {
    withHighestBid: boolean;
    endAt: Date;
  }
): Promise<AuctionFixture> {
  const community = await createCommunity(label);
  const sellerChildId = await createChild(`${label}_seller`);
  const buyerChildId = input.withHighestBid
    ? await createChild(`${label}_buyer`)
    : null;
  const buyerPointAccount = buyerChildId
    ? await prisma.pointAccount.create({
        data: {
          childId: buyerChildId,
          availablePoints: 80,
          frozenPoints: 40,
          totalEarnedPoints: 120,
          totalAwardedPoints: 120
        }
      })
    : null;
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId,
      status: "listed",
      startPoints: 40,
      minIncrementPoints: 5
    }
  });
  const auction = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      idempotencyKey: `auction_settlement_fixture:${unique(label)}`,
      status: "active",
      startAt: new Date(input.endAt.getTime() - 90 * 60_000),
      endAt: input.endAt,
      startPoints: 40,
      minIncrementPoints: 5,
      createdAt: new Date(input.endAt.getTime() - 90 * 60_000)
    }
  });

  if (!buyerChildId || !buyerPointAccount) {
    return {
      auctionId: auction.id,
      itemId: item.id,
      communityId: community.id,
      sellerChildId,
      buyerChildId: null,
      buyerPointAccountId: null,
      bidId: null,
      pointHoldId: null
    };
  }

  const bid = await prisma.bid.create({
    data: {
      auctionSessionId: auction.id,
      bidderChildId: buyerChildId,
      amountPoints: 40,
      status: "active",
      idempotencyKey: `settlement_bid:${unique(label)}`,
      createdAt: new Date(input.endAt.getTime() - 60_000)
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyerPointAccount.id,
      auctionSessionId: auction.id,
      bidId: bid.id,
      amountPoints: 40,
      status: "active",
      createdAt: bid.createdAt
    }
  });
  await prisma.auctionSession.update({
    where: {
      id: auction.id
    },
    data: {
      currentPricePoints: 40,
      highestBidId: bid.id,
      highestBidderChildId: buyerChildId
    }
  });

  return {
    auctionId: auction.id,
    itemId: item.id,
    communityId: community.id,
    sellerChildId,
    buyerChildId,
    buyerPointAccountId: buyerPointAccount.id,
    bidId: bid.id,
    pointHoldId: pointHold.id
  };
}

async function createCommunity(label: string) {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId: user.id,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "7788",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-03T09:00:00.000Z"),
      status: "active"
    }
  });

  return prisma.auctionCommunity.create({
    data: {
      name: `Settlement Community ${unique(label)}`,
      creatorGuardianId: guardian.id,
      status: "active",
      defaultAuctionDurationMinutes: 90
    }
  });
}

async function createChild(label: string) {
  const child = await prisma.childProfile.create({
    data: {
      displayName: `Settlement Child ${unique(label)}`,
      gradeBand: "grade_3_4",
      status: "active"
    }
  });

  return child.id;
}
