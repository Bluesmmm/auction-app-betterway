import type {
  AuctionSessionStatus,
  ChildStatus,
  CommunityMemberStatus,
  GuardianStatus
} from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  BiddingService,
  type PlaceBidResult,
  type WithdrawCurrentHighestBidResult
} from "../../src/auctions/bidding.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const bidding = new BiddingService(prisma);

type GuardianFixture = {
  userId: string;
  guardianId: string;
  phoneHash: string;
};

type ParticipantFixture = {
  childId: string;
  childUserId: string | null;
  guardianId: string;
  guardianUserId: string;
  pointAccountId: string | null;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "BiddingService integration tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "BiddingService integration tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("BiddingService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts the first valid bid, freezes the full amount, and updates auction state", async () => {
    const community = await createCommunity("first_valid_bid");
    const seller = await createParticipant("first_valid_seller", {
      communityId: community.id,
      availablePoints: 80
    });
    const bidder = await createParticipant("first_valid_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("first_valid_bid", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const now = new Date("2026-06-03T10:00:00.000Z");
    const idempotencyKey = unique("first_valid_bid");

    const result = await bidding.placeBid({
      actorUserId: bidder.childUserId ?? bidder.guardianUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 40,
      idempotencyKey,
      now
    });

    expect(result).toEqual({
      result: "accepted",
      bidId: expect.any(String),
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 40,
      status: "active",
      idempotencyKey
    });

    const accepted = expectAccepted(result);
    const persistedBid = await prisma.bid.findUnique({
      where: {
        id: accepted.bidId
      },
      include: {
        pointHold: true
      }
    });
    expect(persistedBid).toEqual(
      expect.objectContaining({
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        status: "active",
        idempotencyKey: expect.stringMatching(/^bid\.create:/),
        createdAt: now,
        pointHold: expect.objectContaining({
          auctionSessionId: auction.id,
          accountId: bidder.pointAccountId,
          amountPoints: 40,
          status: "active",
          releasedAt: null
        })
      })
    );
    expect(persistedBid?.idempotencyKey).not.toContain(idempotencyKey);

    const holdLedger = await prisma.pointLedgerEntry.findUnique({
      where: {
        idempotencyKey: `bid:${accepted.bidId}:hold`
      }
    });
    expect(holdLedger).toEqual(
      expect.objectContaining({
        accountId: bidder.pointAccountId,
        childId: bidder.childId,
        type: "hold",
        amountPoints: 40,
        availableAfter: 80,
        frozenAfter: 40,
        relatedType: "bid",
        relatedId: accepted.bidId,
        createdByUserId: bidder.childUserId,
        createdAt: now
      })
    );

    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: bidder.pointAccountId ?? ""
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

    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true,
          version: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 40,
      highestBidId: accepted.bidId,
      highestBidderChildId: bidder.childId,
      version: 2
    });

    await expect(
      prisma.outboxEvent.findFirst({
        where: {
          eventType: "auction.bid_accepted",
          targetId: accepted.bidId
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        eventType: "auction.bid_accepted",
        targetType: "bid",
        targetId: accepted.bidId,
        payloadJson: expect.objectContaining({
          auctionSessionId: auction.id,
          bidId: accepted.bidId,
          bidderChildId: bidder.childId,
          amountPoints: 40
        })
      })
    );

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "bid.create",
        targetType: "bid",
        targetId: accepted.bidId
      }
    });
    expect(audit).toEqual(
      expect.objectContaining({
        actorUserId: bidder.childUserId,
        afterJson: expect.objectContaining({
          bidIdempotencyKey: persistedBid?.idempotencyKey,
          clientIdempotencyKeyHash: expect.any(String)
        })
      })
    );
    expect(JSON.stringify(audit?.afterJson)).not.toContain(idempotencyKey);

    const acceptedOutbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.bid_accepted",
        targetId: accepted.bidId
      }
    });
    expect(JSON.stringify(acceptedOutbox?.payloadJson)).not.toContain(
      idempotencyKey
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_accepted",
          targetId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
  });

  it("accepts an outbid, freezes the new highest amount, releases the old hold, and writes outbox facts", async () => {
    const community = await createCommunity("outbid_flow");
    const seller = await createParticipant("outbid_seller", {
      communityId: community.id,
      availablePoints: 60
    });
    const firstBidder = await createParticipant("outbid_first_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const secondBidder = await createParticipant("outbid_second_bidder", {
      communityId: community.id,
      availablePoints: 150
    });
    const { auction } = await createAuction("outbid_flow", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });

    const first = expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("outbid_first"),
        now: new Date("2026-06-03T10:10:00.000Z")
      })
    );
    const outbidAt = new Date("2026-06-03T10:12:00.000Z");

    const second = await bidding.placeBid({
      actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
      auctionSessionId: auction.id,
      bidderChildId: secondBidder.childId,
      amountPoints: 45,
      idempotencyKey: unique("outbid_second"),
      now: outbidAt
    });

    expect(second).toEqual({
      result: "accepted",
      bidId: expect.any(String),
      auctionSessionId: auction.id,
      bidderChildId: secondBidder.childId,
      amountPoints: 45,
      status: "active",
      idempotencyKey: expect.any(String)
    });

    const accepted = expectAccepted(second);
    await expect(
      prisma.bid.findUnique({
        where: {
          id: first.bidId
        },
        select: {
          status: true,
          outbidAt: true
        }
      })
    ).resolves.toEqual({
      status: "outbid",
      outbidAt
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: accepted.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        bidderChildId: secondBidder.childId,
        amountPoints: 45,
        status: "active",
        pointHold: expect.objectContaining({
          accountId: secondBidder.pointAccountId,
          amountPoints: 45,
          status: "active"
        })
      })
    );

    await expect(
      prisma.pointHold.findUnique({
        where: {
          bidId: first.bidId
        },
        select: {
          status: true,
          releasedAt: true
        }
      })
    ).resolves.toEqual({
      status: "released",
      releasedAt: outbidAt
    });

    await expect(
      prisma.pointLedgerEntry.findUnique({
        where: {
          idempotencyKey: `bid:${first.bidId}:release`
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: firstBidder.pointAccountId,
        childId: firstBidder.childId,
        type: "release",
        amountPoints: 40,
        availableAfter: 120,
        frozenAfter: 0,
        relatedType: "bid",
        relatedId: first.bidId,
        createdAt: outbidAt
      })
    );
    await expect(
      prisma.pointLedgerEntry.findUnique({
        where: {
          idempotencyKey: `bid:${accepted.bidId}:hold`
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: secondBidder.pointAccountId,
        childId: secondBidder.childId,
        type: "hold",
        amountPoints: 45,
        availableAfter: 105,
        frozenAfter: 45,
        relatedId: accepted.bidId,
        createdAt: outbidAt
      })
    );

    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: firstBidder.pointAccountId ?? ""
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
      prisma.pointAccount.findUnique({
        where: {
          id: secondBidder.pointAccountId ?? ""
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      })
    ).resolves.toEqual({
      availablePoints: 105,
      frozenPoints: 45
    });

    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true,
          version: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 45,
      highestBidId: accepted.bidId,
      highestBidderChildId: secondBidder.childId,
      version: 3
    });

    const acceptedEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.bid_accepted",
        targetId: accepted.bidId
      }
    });
    expect(acceptedEvent).toEqual(
      expect.objectContaining({
        eventType: "auction.bid_accepted",
        targetType: "bid",
        targetId: accepted.bidId
      })
    );

    const outbidEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.bid_outbid",
        targetId: first.bidId
      }
    });
    expect(outbidEvent).toEqual(
      expect.objectContaining({
        eventType: "auction.bid_outbid",
        targetType: "bid",
        targetId: first.bidId,
        payloadJson: expect.objectContaining({
          auctionSessionId: auction.id,
          outbidBidId: first.bidId,
          newBidId: accepted.bidId
        })
      })
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_accepted",
          targetId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_outbid",
          targetId: first.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "bid.create",
          targetType: "bid",
          targetId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
  });

  it("withdraws the current highest bid inside the window, releases points, and clears the auction highest state", async () => {
    const community = await createCommunity("withdraw_current");
    const seller = await createParticipant("withdraw_current_seller", {
      communityId: community.id,
      availablePoints: 80
    });
    const bidder = await createParticipant("withdraw_current_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_current", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const actorUserId = bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_current_bid"),
        now: new Date("2026-06-03T10:13:00.000Z")
      })
    );
    const withdrawAt = new Date("2026-06-03T10:13:45.000Z");
    const idempotencyKey = unique("withdraw_current_key");

    const result = await bidding.withdrawCurrentHighestBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      now: withdrawAt
    });

    expect(result).toEqual({
      result: "accepted",
      bidId: bid.bidId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      releasedAmountPoints: 40,
      status: "withdrawn",
      idempotencyKey
    });
    const withdrawn = expectWithdrawn(result);

    await expect(
      prisma.bid.findUnique({
        where: {
          id: withdrawn.bidId
        },
        select: {
          status: true,
          withdrawnAt: true
        }
      })
    ).resolves.toEqual({
      status: "withdrawn",
      withdrawnAt: withdrawAt
    });
    await expect(
      prisma.pointHold.findUnique({
        where: {
          bidId: withdrawn.bidId
        },
        select: {
          status: true,
          releasedAt: true
        }
      })
    ).resolves.toEqual({
      status: "released",
      releasedAt: withdrawAt
    });
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: bidder.pointAccountId ?? ""
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
      prisma.pointLedgerEntry.findUnique({
        where: {
          idempotencyKey: `bid:${withdrawn.bidId}:withdraw_release`
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: bidder.pointAccountId,
        childId: bidder.childId,
        type: "release",
        amountPoints: 40,
        availableAfter: 120,
        frozenAfter: 0,
        relatedType: "bid",
        relatedId: withdrawn.bidId,
        reason: "auction_bid_withdraw_release",
        createdByUserId: actorUserId,
        createdAt: withdrawAt
      })
    );
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true,
          version: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 0,
      highestBidId: null,
      highestBidderChildId: null,
      version: 3
    });

    const withdrawnOutbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.bid_withdrawn",
        targetId: withdrawn.bidId
      }
    });
    expect(withdrawnOutbox).toEqual(
      expect.objectContaining({
        eventType: "auction.bid_withdrawn",
        targetType: "bid",
        targetId: withdrawn.bidId,
        payloadJson: expect.objectContaining({
          auctionSessionId: auction.id,
          bidId: withdrawn.bidId,
          bidderChildId: bidder.childId,
          releasedAmountPoints: 40,
          currentPricePoints: 0,
          highestBidId: null,
          highestBidderChildId: null
        })
      })
    );
    expect(JSON.stringify(withdrawnOutbox?.payloadJson)).not.toContain(
      idempotencyKey
    );
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_withdrawn",
          targetId: withdrawn.bidId
        }
      })
    ).resolves.toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "bid.withdraw",
        targetType: "bid",
        targetId: withdrawn.bidId
      }
    });
    expect(audit).toEqual(
      expect.objectContaining({
        actorUserId,
        afterJson: expect.objectContaining({
          clientIdempotencyKeyHash: expect.any(String),
          releasedAmountPoints: 40,
          highestBidId: null,
          highestBidderChildId: null
        })
      })
    );
    expect(JSON.stringify(audit?.afterJson)).not.toContain(idempotencyKey);
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.withdraw",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: result
    });
  });

  it("does not reactivate an outbid bid after the current highest withdraws", async () => {
    const community = await createCommunity("withdraw_no_reactivate");
    const seller = await createParticipant("withdraw_no_reactivate_seller", {
      communityId: community.id
    });
    const firstBidder = await createParticipant(
      "withdraw_no_reactivate_first_bidder",
      {
        communityId: community.id,
        availablePoints: 120
      }
    );
    const secondBidder = await createParticipant(
      "withdraw_no_reactivate_second_bidder",
      {
        communityId: community.id,
        availablePoints: 140
      }
    );
    const thirdBidder = await createParticipant(
      "withdraw_no_reactivate_third_bidder",
      {
        communityId: community.id,
        availablePoints: 160
      }
    );
    const { auction } = await createAuction("withdraw_no_reactivate", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const first = expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_no_reactivate_first"),
        now: new Date("2026-06-03T10:24:00.000Z")
      })
    );
    const second = expectAccepted(
      await bidding.placeBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        amountPoints: 45,
        idempotencyKey: unique("withdraw_no_reactivate_second"),
        now: new Date("2026-06-03T10:24:20.000Z")
      })
    );

    expectWithdrawn(
      await bidding.withdrawCurrentHighestBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        idempotencyKey: unique("withdraw_no_reactivate_second_withdraw"),
        now: new Date("2026-06-03T10:25:00.000Z")
      })
    );

    await expect(
      prisma.bid.findUnique({
        where: {
          id: first.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "outbid",
        pointHold: expect.objectContaining({
          status: "released",
          releasedAt: new Date("2026-06-03T10:24:20.000Z")
        })
      })
    );
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 0,
      highestBidId: null,
      highestBidderChildId: null
    });
    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        idempotencyKey: unique("withdraw_no_reactivate_first_withdraw"),
        now: new Date("2026-06-03T10:25:10.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "NO_ACTIVE_HIGHEST_BID"
    });

    const third = expectAccepted(
      await bidding.placeBid({
        actorUserId: thirdBidder.childUserId ?? thirdBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: thirdBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_no_reactivate_third"),
        now: new Date("2026-06-03T10:25:20.000Z")
      })
    );
    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 40,
      highestBidId: third.bidId,
      highestBidderChildId: thirdBidder.childId
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: second.bidId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "withdrawn"
    });
  });

  it("rejects withdrawal from a historical outbid bidder while another bid is highest", async () => {
    const community = await createCommunity("withdraw_historical_outbid");
    const seller = await createParticipant("withdraw_historical_outbid_seller", {
      communityId: community.id
    });
    const firstBidder = await createParticipant(
      "withdraw_historical_outbid_first_bidder",
      {
        communityId: community.id,
        availablePoints: 120
      }
    );
    const secondBidder = await createParticipant(
      "withdraw_historical_outbid_second_bidder",
      {
        communityId: community.id,
        availablePoints: 140
      }
    );
    const { auction } = await createAuction("withdraw_historical_outbid", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const first = expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_historical_outbid_first"),
        now: new Date("2026-06-03T10:26:00.000Z")
      })
    );
    const second = expectAccepted(
      await bidding.placeBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        amountPoints: 45,
        idempotencyKey: unique("withdraw_historical_outbid_second"),
        now: new Date("2026-06-03T10:26:20.000Z")
      })
    );
    const beforeCounts = await countGlobalSideEffects();

    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        idempotencyKey: unique("withdraw_historical_outbid_first_withdraw"),
        now: new Date("2026-06-03T10:26:40.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "BID_NOT_CURRENT_HIGHEST"
    });

    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: auction.id
        },
        select: {
          currentPricePoints: true,
          highestBidId: true,
          highestBidderChildId: true
        }
      })
    ).resolves.toEqual({
      currentPricePoints: 45,
      highestBidId: second.bidId,
      highestBidderChildId: secondBidder.childId
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: first.bidId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "outbid"
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: second.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        pointHold: expect.objectContaining({
          status: "active"
        })
      })
    );
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("accepts current highest withdrawal exactly at the 60-second boundary", async () => {
    const community = await createCommunity("withdraw_boundary");
    const seller = await createParticipant("withdraw_boundary_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_boundary_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_boundary", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bidAt = new Date("2026-06-03T10:26:50.000Z");
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_boundary_bid"),
        now: bidAt
      })
    );
    const withdrawAt = new Date("2026-06-03T10:27:50.000Z");
    const idempotencyKey = unique("withdraw_boundary_key");

    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey,
        now: withdrawAt
      })
    ).resolves.toEqual({
      result: "accepted",
      bidId: bid.bidId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      releasedAmountPoints: 40,
      status: "withdrawn",
      idempotencyKey
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        select: {
          status: true,
          withdrawnAt: true
        }
      })
    ).resolves.toEqual({
      status: "withdrawn",
      withdrawnAt: withdrawAt
    });
  });

  it("rejects withdrawal when the actor cannot represent the current highest bidder child", async () => {
    const community = await createCommunity("withdraw_wrong_actor");
    const seller = await createParticipant("withdraw_wrong_actor_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_wrong_actor_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const outsiderUserId = await createUser("withdraw_wrong_actor_outsider");
    const { auction } = await createAuction("withdraw_wrong_actor", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_wrong_actor_bid"),
        now: new Date("2026-06-03T10:26:55.000Z")
      })
    );
    const beforeCounts = await countGlobalSideEffects();

    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId: outsiderUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey: unique("withdraw_wrong_actor_key"),
        now: new Date("2026-06-03T10:27:25.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "BIDDER_CHILD_REQUIRED"
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        pointHold: expect.objectContaining({
          status: "active"
        })
      })
    );
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("rejects withdrawal if the current highest bidder child is no longer active", async () => {
    const community = await createCommunity("withdraw_inactive_child");
    const seller = await createParticipant("withdraw_inactive_child_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_inactive_child_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_inactive_child", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_inactive_child_bid"),
        now: new Date("2026-06-03T10:27:00.000Z")
      })
    );
    await prisma.childProfile.update({
      where: {
        id: bidder.childId
      },
      data: {
        status: "restricted"
      }
    });
    const beforeCounts = await countGlobalSideEffects();

    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey: unique("withdraw_inactive_child_key"),
        now: new Date("2026-06-03T10:27:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "CHILD_NOT_ACTIVE"
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        pointHold: expect.objectContaining({
          status: "active",
          releasedAt: null
        })
      })
    );
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: bidder.pointAccountId ?? ""
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
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("rejects withdraw idempotency conflicts when the existing request hash differs", async () => {
    const community = await createCommunity("withdraw_conflict");
    const seller = await createParticipant("withdraw_conflict_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_conflict_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_conflict", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_conflict_bid"),
        now: new Date("2026-06-03T10:27:10.000Z")
      })
    );
    const idempotencyKey = unique("withdraw_conflict_key");
    await prisma.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        actorUserId,
        action: "bid.withdraw",
        targetType: "bid",
        targetId: `${auction.id}:${bidder.childId}`,
        requestHash: `different_${unique("withdraw_conflict_hash")}`,
        status: "completed",
        responseJson: {
          result: "rejected",
          errorCode: "NO_ACTIVE_HIGHEST_BID"
        }
      }
    });
    const beforeCounts = await countGlobalSideEffects();

    await expect(
      bidding.withdrawCurrentHighestBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey,
        now: new Date("2026-06-03T10:27:40.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "IDEMPOTENCY_CONFLICT"
    });
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("rejects current highest withdrawal after the short window without releasing points", async () => {
    const community = await createCommunity("withdraw_window_expired");
    const seller = await createParticipant("withdraw_window_expired_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_window_expired_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_window_expired", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_window_expired_bid"),
        now: new Date("2026-06-03T10:27:00.000Z")
      })
    );
    const idempotencyKey = unique("withdraw_window_expired_key");
    const beforeCounts = await countGlobalSideEffects();

    const first = await bidding.withdrawCurrentHighestBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      now: new Date("2026-06-03T10:28:01.000Z")
    });
    const replay = await bidding.withdrawCurrentHighestBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      now: new Date("2026-06-03T10:28:10.000Z")
    });

    expect(first).toEqual({
      result: "rejected",
      errorCode: "WITHDRAW_WINDOW_EXPIRED"
    });
    expect(replay).toEqual(first);
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        withdrawnAt: null,
        pointHold: expect.objectContaining({
          status: "active",
          releasedAt: null
        })
      })
    );
    await expect(
      prisma.pointAccount.findUnique({
        where: {
          id: bidder.pointAccountId ?? ""
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
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.withdraw",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: first
    });
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_withdrawn",
          targetId: bid.bidId
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "bid.withdraw",
          targetId: bid.bidId
        }
      })
    ).resolves.toBe(0);
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("replays accepted current highest withdrawals without duplicate side effects", async () => {
    const community = await createCommunity("withdraw_replay");
    const seller = await createParticipant("withdraw_replay_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_replay_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_replay", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_replay_bid"),
        now: new Date("2026-06-03T10:29:00.000Z")
      })
    );
    const idempotencyKey = unique("withdraw_replay_key");
    const first = await bidding.withdrawCurrentHighestBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      now: new Date("2026-06-03T10:29:30.000Z")
    });
    const replay = await bidding.withdrawCurrentHighestBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      now: new Date("2026-06-03T10:29:50.000Z")
    });

    expect(replay).toEqual(first);
    expectWithdrawn(first);
    await expect(
      prisma.pointLedgerEntry.count({
        where: {
          idempotencyKey: `bid:${bid.bidId}:withdraw_release`
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_withdrawn",
          targetId: bid.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "bid.withdraw",
          targetType: "bid",
          targetId: bid.bidId
        }
      })
    ).resolves.toBe(1);
  });

  it("returns an unknown refresh-required result when withdrawal waits too long for the auction row lock", async () => {
    const community = await createCommunity("withdraw_lock_timeout");
    const seller = await createParticipant("withdraw_lock_timeout_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("withdraw_lock_timeout_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("withdraw_lock_timeout", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const bid = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("withdraw_lock_timeout_bid"),
        now: new Date("2026-06-03T10:30:00.000Z")
      })
    );
    const idempotencyKey = unique("withdraw_lock_timeout_key");
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
          WHERE "id" = ${auction.id}
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
    const beforeTimeoutSideEffects = await countGlobalSideEffects();
    let result: WithdrawCurrentHighestBidResult;
    try {
      result = await bidding.withdrawCurrentHighestBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey,
        now: new Date("2026-06-03T10:30:30.000Z")
      });
    } finally {
      releaseLock();
      await holdingTransaction;
      await locker.$disconnect();
    }

    expect(result).toEqual({
      result: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN",
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      refreshRequired: true,
      retryable: true
    });
    await expect(
      prisma.idempotencyRecord.count({
        where: {
          key: idempotencyKey,
          actorUserId,
          action: "bid.withdraw",
          targetType: "bid",
          targetId: `${auction.id}:${bidder.childId}`
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.bid.findUnique({
        where: {
          id: bid.bidId
        },
        include: {
          pointHold: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        pointHold: expect.objectContaining({
          status: "active"
        })
      })
    );
    await expect(countGlobalSideEffects()).resolves.toEqual(
      beforeTimeoutSideEffects
    );

    const retry = expectWithdrawn(
      await bidding.withdrawCurrentHighestBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        idempotencyKey,
        now: new Date("2026-06-03T10:30:45.000Z")
      })
    );
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.withdraw",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: {
        result: "accepted",
        bidId: retry.bidId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        releasedAmountPoints: 40,
        status: "withdrawn",
        idempotencyKey
      }
    });
  });

  it("fails fast when the current highest bid and hold amounts drift", async () => {
    const community = await createCommunity("highest_drift");
    const seller = await createParticipant("highest_drift_seller", {
      communityId: community.id
    });
    const firstBidder = await createParticipant("highest_drift_first_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const secondBidder = await createParticipant("highest_drift_second_bidder", {
      communityId: community.id,
      availablePoints: 140
    });
    const { auction } = await createAuction("highest_drift", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const first = expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("highest_drift_first"),
        now: new Date("2026-06-03T10:14:00.000Z")
      })
    );
    await prisma.auctionSession.update({
      where: {
        id: auction.id
      },
      data: {
        currentPricePoints: 41
      }
    });

    await expect(
      bidding.placeBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        amountPoints: 46,
        idempotencyKey: unique("highest_drift_second"),
        now: new Date("2026-06-03T10:14:30.000Z")
      })
    ).rejects.toThrow(`Auction ${auction.id} highest bid state is inconsistent`);
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          id: {
            not: first.bidId
          }
        }
      })
    ).resolves.toBe(0);
  });

  it("fails fast when the current highest bidder pointer drifts", async () => {
    const community = await createCommunity("highest_bidder_drift");
    const seller = await createParticipant("highest_bidder_drift_seller", {
      communityId: community.id
    });
    const firstBidder = await createParticipant(
      "highest_bidder_drift_first_bidder",
      {
        communityId: community.id,
        availablePoints: 120
      }
    );
    const secondBidder = await createParticipant(
      "highest_bidder_drift_second_bidder",
      {
        communityId: community.id,
        availablePoints: 140
      }
    );
    const { auction } = await createAuction("highest_bidder_drift", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });
    const first = expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("highest_bidder_drift_first"),
        now: new Date("2026-06-03T10:14:40.000Z")
      })
    );
    await prisma.auctionSession.update({
      where: {
        id: auction.id
      },
      data: {
        highestBidderChildId: secondBidder.childId
      }
    });

    const beforeCounts = await countGlobalSideEffects();
    await expect(
      bidding.placeBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        amountPoints: 45,
        idempotencyKey: unique("highest_bidder_drift_second"),
        now: new Date("2026-06-03T10:14:50.000Z")
      })
    ).rejects.toThrow(`Auction ${auction.id} highest bid state is inconsistent`);
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          id: {
            not: first.bidId
          }
        }
      })
    ).resolves.toBe(0);
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("fails fast when highestBidId points to another auction", async () => {
    const community = await createCommunity("highest_cross_auction");
    const sellerA = await createParticipant("highest_cross_auction_seller_a", {
      communityId: community.id
    });
    const sellerB = await createParticipant("highest_cross_auction_seller_b", {
      communityId: community.id
    });
    const sharedBidder = await createParticipant(
      "highest_cross_auction_shared_bidder",
      {
        communityId: community.id,
        availablePoints: 160
      }
    );
    const challenger = await createParticipant(
      "highest_cross_auction_challenger",
      {
        communityId: community.id,
        availablePoints: 160
      }
    );
    const { auction: sourceAuction } = await createAuction(
      "highest_cross_auction_source",
      {
        communityId: community.id,
        sellerChildId: sellerA.childId,
        startPoints: 40,
        minIncrementPoints: 5
      }
    );
    const { auction: targetAuction } = await createAuction(
      "highest_cross_auction_target",
      {
        communityId: community.id,
        sellerChildId: sellerB.childId,
        startPoints: 40,
        minIncrementPoints: 5
      }
    );
    const sourceBid = expectAccepted(
      await bidding.placeBid({
        actorUserId: sharedBidder.childUserId ?? sharedBidder.guardianUserId,
        auctionSessionId: sourceAuction.id,
        bidderChildId: sharedBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("highest_cross_auction_source_bid"),
        now: new Date("2026-06-03T10:14:55.000Z")
      })
    );
    await prisma.auctionSession.update({
      where: {
        id: targetAuction.id
      },
      data: {
        currentPricePoints: 40,
        highestBidId: sourceBid.bidId,
        highestBidderChildId: sharedBidder.childId
      }
    });

    const beforeCounts = await countGlobalSideEffects();
    await expect(
      bidding.placeBid({
        actorUserId: challenger.childUserId ?? challenger.guardianUserId,
        auctionSessionId: targetAuction.id,
        bidderChildId: challenger.childId,
        amountPoints: 45,
        idempotencyKey: unique("highest_cross_auction_challenge"),
        now: new Date("2026-06-03T10:14:58.000Z")
      })
    ).rejects.toThrow(
      `Auction ${targetAuction.id} highest bid state is inconsistent`
    );
    await expect(
      prisma.bid.findUnique({
        where: {
          id: sourceBid.bidId
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: targetAuction.id
        }
      })
    ).resolves.toBe(0);
    await expect(countGlobalSideEffects()).resolves.toEqual(beforeCounts);
  });

  it("replays the original accepted bid response and does not duplicate side effects", async () => {
    const community = await createCommunity("bid_replay");
    const seller = await createParticipant("bid_replay_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("bid_replay_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("bid_replay", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const idempotencyKey = unique("bid_replay_key");
    const first = await bidding.placeBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 40,
      idempotencyKey,
      now: new Date("2026-06-03T10:15:00.000Z")
    });

    const replay = await bidding.placeBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 40,
      idempotencyKey,
      now: new Date("2026-06-03T10:16:00.000Z")
    });

    expect(replay).toEqual(first);
    const accepted = expectAccepted(first);
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          bidderChildId: bidder.childId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.pointHold.count({
        where: {
          bidId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.bid_accepted",
          targetId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "bid.create",
          targetType: "bid",
          targetId: accepted.bidId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.create",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: first
    });
  });

  it("rejects same-key different-request bid attempts as idempotency conflicts", async () => {
    const community = await createCommunity("bid_conflict");
    const seller = await createParticipant("bid_conflict_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("bid_conflict_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("bid_conflict", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const idempotencyKey = unique("bid_conflict_key");
    expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey,
        now: new Date("2026-06-03T10:17:00.000Z")
      })
    );

    await expect(
      bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 45,
        idempotencyKey,
        now: new Date("2026-06-03T10:18:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "IDEMPOTENCY_CONFLICT"
    });
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          bidderChildId: bidder.childId
        }
      })
    ).resolves.toBe(1);
  });

  it("completes and replays business rejections for the same idempotency key", async () => {
    const community = await createCommunity("bid_rejected_replay");
    const seller = await createParticipant("bid_rejected_replay_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("bid_rejected_replay_bidder", {
      communityId: community.id
    });
    const { auction } = await createAuction("bid_rejected_replay", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const idempotencyKey = unique("bid_rejected_replay_key");
    const first = await bidding.placeBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 39,
      idempotencyKey,
      now: new Date("2026-06-03T10:19:00.000Z")
    });
    const replay = await bidding.placeBid({
      actorUserId,
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      amountPoints: 39,
      idempotencyKey,
      now: new Date("2026-06-03T10:20:00.000Z")
    });

    expect(first).toEqual({
      result: "rejected",
      errorCode: "BID_TOO_LOW"
    });
    expect(replay).toEqual(first);
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.create",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: first
    });
  });

  it("returns stable results instead of throwing when the same bid key is used concurrently", async () => {
    const community = await createCommunity("bid_concurrent_same_key");
    const seller = await createParticipant("bid_concurrent_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("bid_concurrent_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("bid_concurrent_same_key", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const idempotencyKey = unique("bid_concurrent_key");
    const now = new Date("2026-06-03T10:21:00.000Z");

    const attempts = await Promise.allSettled([
      bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey,
        now
      }),
      bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey,
        now
      })
    ]);

    expect(attempts.every((attempt) => attempt.status === "fulfilled")).toBe(
      true
    );
    const results = attempts.map((attempt) => {
      if (attempt.status === "rejected") {
        throw attempt.reason;
      }

      return attempt.value;
    });
    expect(
      results.every(
        (result) =>
          result.result === "accepted" ||
          result.errorCode === "IDEMPOTENCY_CONFLICT"
      )
    ).toBe(true);
    const accepted = results.filter((result) => result.result === "accepted");
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(
      new Set(
        accepted.map((result) => (result.result === "accepted" ? result.bidId : ""))
      ).size
    ).toBe(1);
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          bidderChildId: bidder.childId
        }
      })
    ).resolves.toBe(1);
  });

  it("returns an unknown refresh-required result when auction row lock wait times out", async () => {
    const community = await createCommunity("bid_lock_timeout");
    const seller = await createParticipant("bid_lock_timeout_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("bid_lock_timeout_bidder", {
      communityId: community.id,
      availablePoints: 120
    });
    const { auction } = await createAuction("bid_lock_timeout", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });
    const actorUserId = bidder.childUserId ?? bidder.guardianUserId;
    const idempotencyKey = unique("bid_lock_timeout_key");
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
          WHERE "id" = ${auction.id}
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
    const beforeTimeoutSideEffects = await countGlobalSideEffects();
    let result: PlaceBidResult;
    try {
      result = await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey,
        now: new Date("2026-06-03T10:22:00.000Z")
      });
    } finally {
      releaseLock();
      await holdingTransaction;
      await locker.$disconnect();
    }

    expect(result).toEqual({
      result: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN",
      auctionSessionId: auction.id,
      bidderChildId: bidder.childId,
      idempotencyKey,
      refreshRequired: true,
      retryable: true
    });
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id
        }
      })
    ).resolves.toBe(0);
    await expect(
      prisma.idempotencyRecord.count({
        where: {
          key: idempotencyKey,
          actorUserId,
          action: "bid.create",
          targetType: "bid",
          targetId: `${auction.id}:${bidder.childId}`
        }
      })
    ).resolves.toBe(0);
    await expect(countGlobalSideEffects()).resolves.toEqual(
      beforeTimeoutSideEffects
    );

    const retry = expectAccepted(
      await bidding.placeBid({
        actorUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey,
        now: new Date("2026-06-03T10:22:10.000Z")
      })
    );
    await expect(
      prisma.bid.count({
        where: {
          auctionSessionId: auction.id,
          bidderChildId: bidder.childId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId,
            action: "bid.create",
            targetType: "bid",
            targetId: `${auction.id}:${bidder.childId}`
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: {
        result: "accepted",
        bidId: retry.bidId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        status: "active",
        idempotencyKey
      }
    });
  });

  it("rejects the current highest bidder from bidding again", async () => {
    const community = await createCommunity("already_highest");
    const seller = await createParticipant("already_highest_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("already_highest_bidder", {
      communityId: community.id,
      availablePoints: 150
    });
    const { auction } = await createAuction("already_highest", {
      communityId: community.id,
      sellerChildId: seller.childId
    });

    expectAccepted(
      await bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("already_highest_first"),
        now: new Date("2026-06-03T10:20:00.000Z")
      })
    );

    await expect(
      bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 50,
        idempotencyKey: unique("already_highest_second"),
        now: new Date("2026-06-03T10:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ALREADY_HIGHEST_BIDDER"
    });
  });

  it("rejects bids below the start price and below the current price plus increment", async () => {
    const community = await createCommunity("bid_too_low");
    const seller = await createParticipant("bid_too_low_seller", {
      communityId: community.id
    });
    const firstBidder = await createParticipant("bid_too_low_first_bidder", {
      communityId: community.id
    });
    const secondBidder = await createParticipant("bid_too_low_second_bidder", {
      communityId: community.id
    });
    const { auction } = await createAuction("bid_too_low", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40,
      minIncrementPoints: 5
    });

    await expect(
      bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 39,
        idempotencyKey: unique("bid_too_low_start"),
        now: new Date("2026-06-03T10:30:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "BID_TOO_LOW"
    });

    expectAccepted(
      await bidding.placeBid({
        actorUserId: firstBidder.childUserId ?? firstBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: firstBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("bid_too_low_first"),
        now: new Date("2026-06-03T10:31:00.000Z")
      })
    );

    await expect(
      bidding.placeBid({
        actorUserId: secondBidder.childUserId ?? secondBidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: secondBidder.childId,
        amountPoints: 44,
        idempotencyKey: unique("bid_too_low_increment"),
        now: new Date("2026-06-03T10:32:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "BID_TOO_LOW"
    });
  });

  it("rejects insufficient available points", async () => {
    const community = await createCommunity("insufficient_points");
    const seller = await createParticipant("insufficient_points_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("insufficient_points_bidder", {
      communityId: community.id,
      availablePoints: 39
    });
    const { auction } = await createAuction("insufficient_points", {
      communityId: community.id,
      sellerChildId: seller.childId,
      startPoints: 40
    });

    await expect(
      bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("insufficient_points_bid"),
        now: new Date("2026-06-03T10:40:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "INSUFFICIENT_AVAILABLE_POINTS"
    });
  });

  it("rejects self bid, same primary guardian, and same primary guardian phone hash", async () => {
    const selfCommunity = await createCommunity("self_bid");
    const selfSeller = await createParticipant("self_bid_seller", {
      communityId: selfCommunity.id,
      availablePoints: 100
    });
    const { auction: selfAuction } = await createAuction("self_bid", {
      communityId: selfCommunity.id,
      sellerChildId: selfSeller.childId
    });
    await expect(
      bidding.placeBid({
        actorUserId: selfSeller.childUserId ?? selfSeller.guardianUserId,
        auctionSessionId: selfAuction.id,
        bidderChildId: selfSeller.childId,
        amountPoints: 40,
        idempotencyKey: unique("self_bid_attempt"),
        now: new Date("2026-06-03T10:50:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SELF_BID_FORBIDDEN"
    });

    const sameGuardian = await createGuardian("same_primary_guardian_shared");
    const sameGuardianCommunity = await createCommunity(
      "same_primary_guardian_community"
    );
    const sameGuardianSeller = await createParticipant("same_primary_seller", {
      communityId: sameGuardianCommunity.id,
      guardian: sameGuardian
    });
    const sameGuardianBidder = await createParticipant("same_primary_bidder", {
      communityId: sameGuardianCommunity.id,
      guardian: sameGuardian
    });
    const { auction: sameGuardianAuction } = await createAuction(
      "same_primary_guardian",
      {
        communityId: sameGuardianCommunity.id,
        sellerChildId: sameGuardianSeller.childId
      }
    );
    await expect(
      bidding.placeBid({
        actorUserId:
          sameGuardianBidder.childUserId ?? sameGuardianBidder.guardianUserId,
        auctionSessionId: sameGuardianAuction.id,
        bidderChildId: sameGuardianBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("same_primary_guardian_attempt"),
        now: new Date("2026-06-03T10:51:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SAME_PRIMARY_GUARDIAN_FORBIDDEN"
    });

    const sharedPhoneHash = `phone_hash_${unique("same_phone_hash")}`;
    const samePhoneCommunity = await createCommunity("same_phone_hash_community");
    const samePhoneSeller = await createParticipant("same_phone_hash_seller", {
      communityId: samePhoneCommunity.id,
      phoneHash: sharedPhoneHash
    });
    const samePhoneBidder = await createParticipant("same_phone_hash_bidder", {
      communityId: samePhoneCommunity.id,
      phoneHash: sharedPhoneHash
    });
    const { auction: samePhoneAuction } = await createAuction("same_phone_hash", {
      communityId: samePhoneCommunity.id,
      sellerChildId: samePhoneSeller.childId
    });
    await expect(
      bidding.placeBid({
        actorUserId: samePhoneBidder.childUserId ?? samePhoneBidder.guardianUserId,
        auctionSessionId: samePhoneAuction.id,
        bidderChildId: samePhoneBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("same_phone_hash_attempt"),
        now: new Date("2026-06-03T10:52:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SAME_GUARDIAN_PHONE_FORBIDDEN"
    });
  });

  it("rejects child participation guard failures", async () => {
    const inactiveCommunity = await createCommunity("inactive_child");
    const inactiveSeller = await createParticipant("inactive_child_seller", {
      communityId: inactiveCommunity.id
    });
    const inactiveBidder = await createParticipant("inactive_child_bidder", {
      communityId: inactiveCommunity.id,
      childStatus: "restricted"
    });
    const { auction: inactiveAuction } = await createAuction("inactive_child", {
      communityId: inactiveCommunity.id,
      sellerChildId: inactiveSeller.childId
    });
    await expect(
      bidding.placeBid({
        actorUserId: inactiveBidder.childUserId ?? inactiveBidder.guardianUserId,
        auctionSessionId: inactiveAuction.id,
        bidderChildId: inactiveBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("inactive_child_bid"),
        now: new Date("2026-06-03T11:00:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "CHILD_NOT_ACTIVE"
    });

    const membershipCommunity = await createCommunity("inactive_membership");
    const membershipSeller = await createParticipant("inactive_membership_seller", {
      communityId: membershipCommunity.id
    });
    const membershipBidder = await createParticipant("inactive_membership_bidder", {
      communityId: membershipCommunity.id,
      membershipStatus: "removed"
    });
    const { auction: membershipAuction } = await createAuction(
      "inactive_membership",
      {
        communityId: membershipCommunity.id,
        sellerChildId: membershipSeller.childId
      }
    );
    await expect(
      bidding.placeBid({
        actorUserId:
          membershipBidder.childUserId ?? membershipBidder.guardianUserId,
        auctionSessionId: membershipAuction.id,
        bidderChildId: membershipBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("inactive_membership_bid"),
        now: new Date("2026-06-03T11:01:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_REQUIRED"
    });

    const disabledCommunity = await createCommunity("guardian_control_disabled");
    const disabledSeller = await createParticipant("guardian_control_seller", {
      communityId: disabledCommunity.id
    });
    const disabledBidder = await createParticipant("guardian_control_bidder", {
      communityId: disabledCommunity.id,
      canBid: false
    });
    const { auction: disabledAuction } = await createAuction(
      "guardian_control_disabled",
      {
        communityId: disabledCommunity.id,
        sellerChildId: disabledSeller.childId
      }
    );
    await expect(
      bidding.placeBid({
        actorUserId: disabledBidder.childUserId ?? disabledBidder.guardianUserId,
        auctionSessionId: disabledAuction.id,
        bidderChildId: disabledBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("guardian_control_disabled_bid"),
        now: new Date("2026-06-03T11:02:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_CONTROL_DISABLED"
    });

    const maxBidCommunity = await createCommunity("max_bid_exceeded");
    const maxBidSeller = await createParticipant("max_bid_exceeded_seller", {
      communityId: maxBidCommunity.id
    });
    const maxBidBidder = await createParticipant("max_bid_exceeded_bidder", {
      communityId: maxBidCommunity.id,
      maxBidPoints: 35
    });
    const { auction: maxBidAuction } = await createAuction("max_bid_exceeded", {
      communityId: maxBidCommunity.id,
      sellerChildId: maxBidSeller.childId
    });
    await expect(
      bidding.placeBid({
        actorUserId: maxBidBidder.childUserId ?? maxBidBidder.guardianUserId,
        auctionSessionId: maxBidAuction.id,
        bidderChildId: maxBidBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("max_bid_exceeded_bid"),
        now: new Date("2026-06-03T11:03:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "MAX_BID_POINTS_EXCEEDED"
    });

    const disputeCommunity = await createCommunity("guardian_dispute");
    const disputeSeller = await createParticipant("guardian_dispute_seller", {
      communityId: disputeCommunity.id
    });
    const disputeBidder = await createParticipant("guardian_dispute_bidder", {
      communityId: disputeCommunity.id
    });
    await prisma.guardianDispute.create({
      data: {
        childId: disputeBidder.childId,
        submittingGuardianId: disputeBidder.guardianId,
        type: "guardian_change",
        status: "pending_platform_review"
      }
    });
    const { auction: disputeAuction } = await createAuction("guardian_dispute", {
      communityId: disputeCommunity.id,
      sellerChildId: disputeSeller.childId
    });
    await expect(
      bidding.placeBid({
        actorUserId: disputeBidder.childUserId ?? disputeBidder.guardianUserId,
        auctionSessionId: disputeAuction.id,
        bidderChildId: disputeBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("guardian_dispute_bid"),
        now: new Date("2026-06-03T11:04:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });
  });

  it.each(["no_bid", "suspended"] as const)(
    "rejects active %s risk restrictions",
    async (restrictionType) => {
      const community = await createCommunity(`risk_${restrictionType}`);
      const seller = await createParticipant(`risk_${restrictionType}_seller`, {
        communityId: community.id
      });
      const bidder = await createParticipant(`risk_${restrictionType}_bidder`, {
        communityId: community.id
      });
      await prisma.riskRestriction.create({
        data: {
          type: restrictionType,
          scope: "child",
          targetId: bidder.childId,
          childId: bidder.childId,
          status: "active",
          reason: `risk_${restrictionType}`,
          startsAt: new Date("2026-06-03T11:05:00.000Z")
        }
      });
      const { auction } = await createAuction(`risk_${restrictionType}`, {
        communityId: community.id,
        sellerChildId: seller.childId
      });

      await expect(
        bidding.placeBid({
          actorUserId: bidder.childUserId ?? bidder.guardianUserId,
          auctionSessionId: auction.id,
          bidderChildId: bidder.childId,
          amountPoints: 40,
          idempotencyKey: unique(`risk_${restrictionType}_bid`),
          now: new Date("2026-06-03T11:06:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "RISK_RESTRICTED"
      });
    }
  );

  it("rejects missing idempotency, outsider actors, missing point accounts, and invalid auction states", async () => {
    const community = await createCommunity("boundary_rejections");
    const seller = await createParticipant("boundary_rejections_seller", {
      communityId: community.id
    });
    const bidder = await createParticipant("boundary_rejections_bidder", {
      communityId: community.id
    });
    const outsiderUserId = await createUser("boundary_rejections_outsider");
    const { auction } = await createAuction("boundary_rejections", {
      communityId: community.id,
      sellerChildId: seller.childId
    });

    await expect(
      bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: "   ",
        now: new Date("2026-06-03T11:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "IDEMPOTENCY_KEY_REQUIRED"
    });

    await expect(
      bidding.placeBid({
        actorUserId: bidder.childUserId ?? bidder.guardianUserId,
        auctionSessionId: `missing_${unique("auction")}`,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("missing_auction"),
        now: new Date("2026-06-03T11:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "AUCTION_NOT_FOUND"
    });

    await expect(
      bidding.placeBid({
        actorUserId: outsiderUserId,
        auctionSessionId: auction.id,
        bidderChildId: bidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("outsider_actor"),
        now: new Date("2026-06-03T11:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "BIDDER_CHILD_REQUIRED"
    });

    const noPointAccountCommunity = await createCommunity("missing_point_account");
    const noPointAccountSeller = await createParticipant("missing_point_seller", {
      communityId: noPointAccountCommunity.id
    });
    const noPointAccountBidder = await createParticipant("missing_point_bidder", {
      communityId: noPointAccountCommunity.id,
      withPointAccount: false
    });
    const { auction: noPointAccountAuction } = await createAuction(
      "missing_point_account",
      {
        communityId: noPointAccountCommunity.id,
        sellerChildId: noPointAccountSeller.childId
      }
    );
    await expect(
      bidding.placeBid({
        actorUserId:
          noPointAccountBidder.childUserId ??
          noPointAccountBidder.guardianUserId,
        auctionSessionId: noPointAccountAuction.id,
        bidderChildId: noPointAccountBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("missing_point_account_bid"),
        now: new Date("2026-06-03T11:13:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "POINT_ACCOUNT_NOT_FOUND"
    });

    const inactiveAuctionCommunity = await createCommunity("inactive_auction");
    const inactiveAuctionSeller = await createParticipant("inactive_auction_seller", {
      communityId: inactiveAuctionCommunity.id
    });
    const inactiveAuctionBidder = await createParticipant("inactive_auction_bidder", {
      communityId: inactiveAuctionCommunity.id
    });
    const { auction: inactiveAuction } = await createAuction("inactive_auction", {
      communityId: inactiveAuctionCommunity.id,
      sellerChildId: inactiveAuctionSeller.childId,
      status: "cancelled"
    });
    await expect(
      bidding.placeBid({
        actorUserId:
          inactiveAuctionBidder.childUserId ??
          inactiveAuctionBidder.guardianUserId,
        auctionSessionId: inactiveAuction.id,
        bidderChildId: inactiveAuctionBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("inactive_auction_bid"),
        now: new Date("2026-06-03T11:14:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "AUCTION_NOT_ACTIVE"
    });

    const endedCommunity = await createCommunity("ended_auction");
    const endedSeller = await createParticipant("ended_auction_seller", {
      communityId: endedCommunity.id
    });
    const endedBidder = await createParticipant("ended_auction_bidder", {
      communityId: endedCommunity.id
    });
    const { auction: endedAuction } = await createAuction("ended_auction", {
      communityId: endedCommunity.id,
      sellerChildId: endedSeller.childId,
      endAt: new Date("2026-06-03T11:14:59.000Z")
    });
    await expect(
      bidding.placeBid({
        actorUserId: endedBidder.childUserId ?? endedBidder.guardianUserId,
        auctionSessionId: endedAuction.id,
        bidderChildId: endedBidder.childId,
        amountPoints: 40,
        idempotencyKey: unique("ended_auction_bid"),
        now: new Date("2026-06-03T11:15:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "AUCTION_ENDED"
    });
  });
});

function expectAccepted(
  result: PlaceBidResult
): Extract<PlaceBidResult, { result: "accepted" }> {
  if (result.result !== "accepted") {
    throw new Error(`expected accepted bid, received ${result.errorCode}`);
  }

  return result;
}

function expectWithdrawn(
  result: WithdrawCurrentHighestBidResult
): Extract<WithdrawCurrentHighestBidResult, { result: "accepted" }> {
  if (result.result !== "accepted") {
    throw new Error(`expected withdrawn bid, received ${result.errorCode}`);
  }

  return result;
}

async function countGlobalSideEffects() {
  const [ledgerEntries, auditLogs, outboxEvents] = await Promise.all([
    prisma.pointLedgerEntry.count(),
    prisma.auditLog.count(),
    prisma.outboxEvent.count()
  ]);

  return {
    ledgerEntries,
    auditLogs,
    outboxEvents
  };
}

async function createUser(label: string) {
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

  return user.id;
}

async function createGuardian(
  label: string,
  input?: {
    phoneHash?: string;
    status?: GuardianStatus;
  }
): Promise<GuardianFixture> {
  const userId = await createUser(`${label}_guardian`);
  const phoneHash = input?.phoneHash ?? `phone_hash_${unique(label)}`;
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId,
      phoneHash,
      phoneLast4: "5566",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-03T09:00:00.000Z"),
      status: input?.status ?? "active"
    }
  });

  return {
    userId,
    guardianId: guardian.id,
    phoneHash
  };
}

async function createParticipant(
  label: string,
  input: {
    communityId: string;
    guardian?: GuardianFixture;
    phoneHash?: string;
    childStatus?: ChildStatus;
    membershipStatus?: CommunityMemberStatus;
    canBid?: boolean;
    maxBidPoints?: number | null;
    availablePoints?: number;
    withPointAccount?: boolean;
    withChildUser?: boolean;
  }
): Promise<ParticipantFixture> {
  const guardian =
    input.guardian ??
    (await createGuardian(label, {
      phoneHash: input.phoneHash
    }));
  const childUserId =
    input.withChildUser === false ? null : await createUser(`${label}_child`);
  const child = await prisma.childProfile.create({
    data: {
      userId: childUserId,
      displayName: `Child ${unique(label)}`,
      gradeBand: "grade_3_4",
      status: input.childStatus ?? "active"
    }
  });

  await prisma.guardianChildLink.create({
    data: {
      guardianId: guardian.guardianId,
      childId: child.id,
      role: "primary",
      status: "active",
      confirmedAt: new Date("2026-06-03T09:01:00.000Z")
    }
  });

  await prisma.childGuardianSettings.create({
    data: {
      childId: child.id,
      canPublish: true,
      canBid: input.canBid ?? true,
      maxBidPoints: input.maxBidPoints ?? null
    }
  });

  await prisma.communityMember.create({
    data: {
      communityId: input.communityId,
      childId: child.id,
      status: input.membershipStatus ?? "active",
      guardianConfirmedAt: new Date("2026-06-03T09:02:00.000Z"),
      adminReviewedAt: new Date("2026-06-03T09:03:00.000Z"),
      joinedAt:
        (input.membershipStatus ?? "active") === "active"
          ? new Date("2026-06-03T09:04:00.000Z")
          : null
    }
  });

  let pointAccountId: string | null = null;
  if (input.withPointAccount !== false) {
    const availablePoints = input.availablePoints ?? 200;
    const account = await prisma.pointAccount.create({
      data: {
        childId: child.id,
        availablePoints,
        frozenPoints: 0,
        totalEarnedPoints: availablePoints,
        totalAwardedPoints: availablePoints
      }
    });
    pointAccountId = account.id;
  }

  return {
    childId: child.id,
    childUserId,
    guardianId: guardian.guardianId,
    guardianUserId: guardian.userId,
    pointAccountId
  };
}

async function createCommunity(label: string) {
  const creator = await createGuardian(`${label}_creator`);
  return prisma.auctionCommunity.create({
    data: {
      name: `Auction Community ${unique(label)}`,
      creatorGuardianId: creator.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 90
    }
  });
}

async function createAuction(
  label: string,
  input: {
    communityId: string;
    sellerChildId: string;
    startPoints?: number;
    minIncrementPoints?: number;
    status?: AuctionSessionStatus;
    startAt?: Date;
    endAt?: Date;
  }
) {
  const item = await prisma.item.create({
    data: {
      communityId: input.communityId,
      sellerChildId: input.sellerChildId,
      status: "listed",
      startPoints: input.startPoints ?? 40,
      minIncrementPoints: input.minIncrementPoints ?? 5
    }
  });

  const auction = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      idempotencyKey: `auction_session_fixture:${unique(label)}`,
      status: input.status ?? "active",
      startAt: input.startAt ?? new Date("2026-06-03T09:30:00.000Z"),
      endAt: input.endAt ?? new Date("2026-06-03T12:30:00.000Z"),
      startPoints: item.startPoints,
      minIncrementPoints: item.minIncrementPoints,
      createdAt: new Date("2026-06-03T09:30:00.000Z")
    }
  });

  return {
    item,
    auction
  };
}
