import { Prisma } from "@prisma/client";
import type { BidStatus, PrismaClient, RiskRestrictionType } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { runCriticalTransaction } from "../prisma/critical-transaction.js";

type IdempotencyReservation<T> =
  | { result: "reserved"; id: string }
  | { result: "replay"; response: T }
  | { result: "conflict" };

type PlaceBidRejectedErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "AUCTION_NOT_FOUND"
  | "AUCTION_NOT_ACTIVE"
  | "AUCTION_ENDED"
  | "BIDDER_CHILD_REQUIRED"
  | "SELF_BID_FORBIDDEN"
  | "SAME_PRIMARY_GUARDIAN_FORBIDDEN"
  | "SAME_GUARDIAN_PHONE_FORBIDDEN"
  | "ALREADY_HIGHEST_BIDDER"
  | "BID_TOO_LOW"
  | "INSUFFICIENT_AVAILABLE_POINTS"
  | "POINT_ACCOUNT_NOT_FOUND"
  | "CHILD_NOT_ACTIVE"
  | "COMMUNITY_MEMBER_REQUIRED"
  | "GUARDIAN_CONTROL_DISABLED"
  | "MAX_BID_POINTS_EXCEEDED"
  | "GUARDIAN_DISPUTE_FROZEN"
  | "RISK_RESTRICTED";

type PlaceBidUnknownErrorCode = "TRANSACTION_RESULT_UNKNOWN";

export type PlaceBidResult =
  | {
      result: "accepted";
      bidId: string;
      auctionSessionId: string;
      bidderChildId: string;
      amountPoints: number;
      status: BidStatus;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode: PlaceBidRejectedErrorCode;
    }
  | {
      result: "unknown";
      errorCode: PlaceBidUnknownErrorCode;
      auctionSessionId: string;
      bidderChildId: string;
      idempotencyKey: string;
      refreshRequired: true;
      retryable: true;
    };

type WithdrawCurrentHighestBidRejectedErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "AUCTION_NOT_FOUND"
  | "AUCTION_NOT_ACTIVE"
  | "AUCTION_ENDED"
  | "BIDDER_CHILD_REQUIRED"
  | "CHILD_NOT_ACTIVE"
  | "POINT_ACCOUNT_NOT_FOUND"
  | "NO_ACTIVE_HIGHEST_BID"
  | "BID_NOT_CURRENT_HIGHEST"
  | "WITHDRAW_WINDOW_EXPIRED";

type WithdrawCurrentHighestBidUnknownErrorCode = "TRANSACTION_RESULT_UNKNOWN";

export type WithdrawCurrentHighestBidResult =
  | {
      result: "accepted";
      bidId: string;
      auctionSessionId: string;
      bidderChildId: string;
      releasedAmountPoints: number;
      status: BidStatus;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode: WithdrawCurrentHighestBidRejectedErrorCode;
    }
  | {
      result: "unknown";
      errorCode: WithdrawCurrentHighestBidUnknownErrorCode;
      auctionSessionId: string;
      bidderChildId: string;
      idempotencyKey: string;
      refreshRequired: true;
      retryable: true;
    };

type LockedAuctionSessionRow = {
  id: string;
  itemId: string;
  status: string;
  endAt: Date;
  startPoints: number;
  minIncrementPoints: number;
  currentPricePoints: number;
  highestBidId: string | null;
  highestBidderChildId: string | null;
  version: number;
};

type LockedPointAccountRow = {
  id: string;
  childId: string;
  availablePoints: number;
  frozenPoints: number;
};

type ActivePrimaryGuardianContext = {
  guardianId: string;
  userId: string;
  phoneHash: string;
};

type BidderContext = {
  childId: string;
  userId: string | null;
  status: string;
  primaryGuardians: ActivePrimaryGuardianContext[];
  membershipStatus: string | null;
  communityStatus: string | null;
  canBid: boolean;
  maxBidPoints: number | null;
  pointAccountId: string | null;
};

type SellerContext = {
  childId: string;
  primaryGuardians: ActivePrimaryGuardianContext[];
};

type CurrentHighestBidContext = {
  id: string;
  auctionSessionId: string;
  bidderChildId: string;
  amountPoints: number;
  status: string;
  createdAt: Date;
  pointHold: {
    id: string;
    accountId: string;
    auctionSessionId: string;
    amountPoints: number;
    status: string;
  } | null;
};

const WITHDRAW_CURRENT_HIGHEST_BID_WINDOW_MS = 60_000;

export class BiddingService {
  constructor(private readonly prisma: PrismaClient) {}

  async placeBid(input: {
    actorUserId: string;
    auctionSessionId: string;
    bidderChildId: string;
    amountPoints: number;
    idempotencyKey: string;
    now?: Date;
  }): Promise<PlaceBidResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const unknownResult: PlaceBidResult = {
      result: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN",
      auctionSessionId: input.auctionSessionId,
      bidderChildId: input.bidderChildId,
      idempotencyKey,
      refreshRequired: true,
      retryable: true
    };
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      auctionSessionId: input.auctionSessionId,
      bidderChildId: input.bidderChildId,
      amountPoints: input.amountPoints
    });
    const idempotencyTargetId = buildIdempotencyTargetId(
      input.auctionSessionId,
      input.bidderChildId
    );

    return runCriticalTransaction<PlaceBidResult>(this.prisma, async (tx) => {
      const idempotency = await reserveIdempotencyRecord<PlaceBidResult>(tx, {
        key: idempotencyKey,
        actorUserId: input.actorUserId,
        action: "bid.create",
        targetType: "bid",
        targetId: idempotencyTargetId,
        requestHash
      });

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const auction = await lockAuctionSession(tx, input.auctionSessionId);
      if (!auction) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "AUCTION_NOT_FOUND"
        });
      }

      if (auction.status !== "active") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "AUCTION_NOT_ACTIVE"
        });
      }

      if (now >= auction.endAt) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "AUCTION_ENDED"
        });
      }

      const item = await tx.item.findUnique({
        where: {
          id: auction.itemId
        },
        select: {
          id: true,
          communityId: true,
          sellerChildId: true
        }
      });
      if (!item) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "AUCTION_NOT_FOUND"
        });
      }

      if (item.sellerChildId === input.bidderChildId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "SELF_BID_FORBIDDEN"
        });
      }

      const [bidder, seller] = await Promise.all([
        loadBidderContext(tx, input.bidderChildId, item.communityId),
        loadSellerContext(tx, item.sellerChildId)
      ]);

      if (!bidder || bidder.primaryGuardians.length === 0) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "BIDDER_CHILD_REQUIRED"
        });
      }

      if (bidder.status !== "active") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "CHILD_NOT_ACTIVE"
        });
      }

      if (
        input.actorUserId !== bidder.userId &&
        !bidder.primaryGuardians.some(
          (guardian) => guardian.userId === input.actorUserId
        )
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "BIDDER_CHILD_REQUIRED"
        });
      }

      if (
        bidder.membershipStatus !== "active" ||
        bidder.communityStatus !== "active"
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "COMMUNITY_MEMBER_REQUIRED"
        });
      }

      if (!bidder.canBid) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GUARDIAN_CONTROL_DISABLED"
        });
      }

      if (
        bidder.maxBidPoints !== null &&
        input.amountPoints > bidder.maxBidPoints
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "MAX_BID_POINTS_EXCEEDED"
        });
      }

      if (await hasFrozenGuardianDispute(tx, input.bidderChildId)) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GUARDIAN_DISPUTE_FROZEN"
        });
      }

      if (
        await hasActiveBidRestriction(tx, {
          actorUserId: input.actorUserId,
          childId: input.bidderChildId,
          primaryGuardianIds: bidder.primaryGuardians.map(
            (guardian) => guardian.guardianId
          ),
          primaryGuardianUserIds: bidder.primaryGuardians.map(
            (guardian) => guardian.userId
          ),
          communityId: item.communityId,
          now
        })
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "RISK_RESTRICTED"
        });
      }

      if (!bidder.pointAccountId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "POINT_ACCOUNT_NOT_FOUND"
        });
      }

      const bidderPrimaryGuardianIds = new Set(
        bidder.primaryGuardians.map((guardian) => guardian.guardianId)
      );
      if (
        seller?.primaryGuardians.some((guardian) =>
          bidderPrimaryGuardianIds.has(guardian.guardianId)
        )
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "SAME_PRIMARY_GUARDIAN_FORBIDDEN"
        });
      }

      const bidderPrimaryGuardianPhoneHashes = new Set(
        bidder.primaryGuardians.map((guardian) => guardian.phoneHash)
      );
      if (
        seller?.primaryGuardians.some((guardian) =>
          bidderPrimaryGuardianPhoneHashes.has(guardian.phoneHash)
        )
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "SAME_GUARDIAN_PHONE_FORBIDDEN"
        });
      }

      const currentHighest =
        auction.highestBidId === null
          ? null
          : await loadCurrentHighestBid(tx, auction.highestBidId);
      assertCurrentHighestBidIsConsistent(auction, currentHighest);

      if (currentHighest?.bidderChildId === input.bidderChildId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "ALREADY_HIGHEST_BIDDER"
        });
      }

      const minimumRequiredPoints = currentHighest
        ? auction.currentPricePoints + auction.minIncrementPoints
        : auction.startPoints;
      if (
        !Number.isInteger(input.amountPoints) ||
        input.amountPoints < minimumRequiredPoints
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "BID_TOO_LOW"
        });
      }

      const lockedAccounts = await lockPointAccounts(
        tx,
        [
          bidder.pointAccountId,
          currentHighest?.pointHold?.accountId ?? null
        ].filter((value): value is string => Boolean(value))
      );
      const lockedAccountsById = new Map(
        lockedAccounts.map((account) => [account.id, account])
      );
      const bidderAccount = lockedAccountsById.get(bidder.pointAccountId);
      if (!bidderAccount) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "POINT_ACCOUNT_NOT_FOUND"
        });
      }

      if (bidderAccount.availablePoints < input.amountPoints) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "INSUFFICIENT_AVAILABLE_POINTS"
        });
      }

      const previousHighestAccount = currentHighest?.pointHold
        ? lockedAccountsById.get(currentHighest.pointHold.accountId) ?? null
        : null;
      if (currentHighest && !previousHighestAccount) {
        throw new Error(
          `Auction ${auction.id} previous highest point account is missing`
        );
      }
      if (
        currentHighest?.pointHold &&
        previousHighestAccount &&
        (previousHighestAccount.childId !== currentHighest.bidderChildId ||
          previousHighestAccount.frozenPoints <
            currentHighest.pointHold.amountPoints)
      ) {
        throw new Error(
          `Auction ${auction.id} previous highest point account is inconsistent`
        );
      }

      const persistedBidIdempotencyKey = buildPersistedBidIdempotencyKey({
        actorUserId: input.actorUserId,
        auctionSessionId: input.auctionSessionId,
        bidderChildId: input.bidderChildId,
        idempotencyKey
      });
      const bid = await tx.bid.create({
        data: {
          auctionSessionId: auction.id,
          bidderChildId: input.bidderChildId,
          amountPoints: input.amountPoints,
          status: "active",
          idempotencyKey: persistedBidIdempotencyKey,
          createdAt: now
        }
      });

      const bidderAvailableAfter =
        bidderAccount.availablePoints - input.amountPoints;
      const bidderFrozenAfter = bidderAccount.frozenPoints + input.amountPoints;
      await tx.pointAccount.update({
        where: {
          id: bidderAccount.id
        },
        data: {
          availablePoints: bidderAvailableAfter,
          frozenPoints: bidderFrozenAfter
        }
      });

      if (currentHighest && currentHighest.pointHold && previousHighestAccount) {
        await tx.bid.update({
          where: {
            id: currentHighest.id
          },
          data: {
            status: "outbid",
            outbidAt: now
          }
        });

        await tx.pointHold.update({
          where: {
            id: currentHighest.pointHold.id
          },
          data: {
            status: "released",
            releasedAt: now
          }
        });
      }

      const pointHold = await tx.pointHold.create({
        data: {
          accountId: bidderAccount.id,
          auctionSessionId: auction.id,
          bidId: bid.id,
          amountPoints: input.amountPoints,
          status: "active",
          createdAt: now
        }
      });

      await tx.pointLedgerEntry.create({
        data: {
          accountId: bidderAccount.id,
          childId: input.bidderChildId,
          type: "hold",
          amountPoints: input.amountPoints,
          availableAfter: bidderAvailableAfter,
          frozenAfter: bidderFrozenAfter,
          relatedType: "bid",
          relatedId: bid.id,
          idempotencyKey: `bid:${bid.id}:hold`,
          reason: "auction_bid_hold",
          createdByUserId: input.actorUserId,
          createdAt: now
        }
      });

      if (currentHighest && currentHighest.pointHold && previousHighestAccount) {
        const previousAvailableAfter =
          previousHighestAccount.availablePoints +
          currentHighest.pointHold.amountPoints;
        const previousFrozenAfter =
          previousHighestAccount.frozenPoints -
          currentHighest.pointHold.amountPoints;

        await tx.pointAccount.update({
          where: {
            id: previousHighestAccount.id
          },
          data: {
            availablePoints: previousAvailableAfter,
            frozenPoints: previousFrozenAfter
          }
        });

        await tx.pointLedgerEntry.create({
          data: {
            accountId: previousHighestAccount.id,
            childId: currentHighest.bidderChildId,
            type: "release",
            amountPoints: currentHighest.pointHold.amountPoints,
            availableAfter: previousAvailableAfter,
            frozenAfter: previousFrozenAfter,
            relatedType: "bid",
            relatedId: currentHighest.id,
            idempotencyKey: `bid:${currentHighest.id}:release`,
            reason: "auction_bid_outbid_release",
            createdByUserId: input.actorUserId,
            createdAt: now
          }
        });
      }

      await tx.auctionSession.update({
        where: {
          id: auction.id
        },
        data: {
          currentPricePoints: input.amountPoints,
          highestBidId: bid.id,
          highestBidderChildId: input.bidderChildId,
          version: {
            increment: 1
          }
        }
      });

      const response: PlaceBidResult = {
        result: "accepted",
        bidId: bid.id,
        auctionSessionId: auction.id,
        bidderChildId: input.bidderChildId,
        amountPoints: input.amountPoints,
        status: bid.status,
        idempotencyKey
      };

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "bid.create",
          targetType: "bid",
          targetId: bid.id,
          afterJson: {
            auctionSessionId: auction.id,
            itemId: item.id,
            communityId: item.communityId,
            bidderChildId: input.bidderChildId,
            amountPoints: input.amountPoints,
            holdId: pointHold.id,
            previousHighestBidId: currentHighest?.id ?? null,
            previousHighestBidderChildId: currentHighest?.bidderChildId ?? null,
            bidIdempotencyKey: persistedBidIdempotencyKey,
            clientIdempotencyKeyHash: createStableHash({ idempotencyKey })
          }
        }
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "auction.bid_accepted",
          targetType: "bid",
          targetId: bid.id,
          idempotencyKey: buildAcceptedOutboxIdempotencyKey(bid.id),
          payloadJson: {
            auctionSessionId: auction.id,
            bidId: bid.id,
            bidderChildId: input.bidderChildId,
            amountPoints: input.amountPoints,
            currentPricePoints: input.amountPoints,
            previousHighestBidId: currentHighest?.id ?? null,
            previousHighestBidderChildId: currentHighest?.bidderChildId ?? null
          },
          availableAt: now
        }
      });

      if (currentHighest) {
        await tx.outboxEvent.create({
          data: {
            eventType: "auction.bid_outbid",
            targetType: "bid",
            targetId: currentHighest.id,
            idempotencyKey: buildOutbidOutboxIdempotencyKey(
              currentHighest.id,
              bid.id
            ),
            payloadJson: {
              auctionSessionId: auction.id,
              outbidBidId: currentHighest.id,
              outbidBidderChildId: currentHighest.bidderChildId,
              newBidId: bid.id,
              newBidderChildId: input.bidderChildId,
              releasedAmountPoints: currentHighest.pointHold?.amountPoints ?? 0
            },
            availableAt: now
          }
        });
      }

      return completeIdempotency(tx, idempotency.id, response);
    }).catch((error: unknown) => {
      if (isTransientTransactionError(error)) {
        return unknownResult;
      }

      throw error;
    });
  }

  async withdrawCurrentHighestBid(input: {
    actorUserId: string;
    auctionSessionId: string;
    bidderChildId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<WithdrawCurrentHighestBidResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const unknownResult: WithdrawCurrentHighestBidResult = {
      result: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN",
      auctionSessionId: input.auctionSessionId,
      bidderChildId: input.bidderChildId,
      idempotencyKey,
      refreshRequired: true,
      retryable: true
    };
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      auctionSessionId: input.auctionSessionId,
      bidderChildId: input.bidderChildId
    });
    const idempotencyTargetId = buildIdempotencyTargetId(
      input.auctionSessionId,
      input.bidderChildId
    );

    return runCriticalTransaction<WithdrawCurrentHighestBidResult>(
      this.prisma,
      async (tx) => {
        const idempotency =
          await reserveIdempotencyRecord<WithdrawCurrentHighestBidResult>(tx, {
            key: idempotencyKey,
            actorUserId: input.actorUserId,
            action: "bid.withdraw",
            targetType: "bid",
            targetId: idempotencyTargetId,
            requestHash
          });

        if (idempotency.result === "conflict") {
          return {
            result: "rejected",
            errorCode: "IDEMPOTENCY_CONFLICT"
          };
        }

        if (idempotency.result === "replay") {
          return idempotency.response;
        }

        const auction = await lockAuctionSession(tx, input.auctionSessionId);
        if (!auction) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "AUCTION_NOT_FOUND"
          });
        }

        if (auction.status !== "active") {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "AUCTION_NOT_ACTIVE"
          });
        }

        if (now >= auction.endAt) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "AUCTION_ENDED"
          });
        }

        const currentHighest =
          auction.highestBidId === null
            ? null
            : await loadCurrentHighestBid(tx, auction.highestBidId);
        assertCurrentHighestBidIsConsistent(auction, currentHighest);

        if (!currentHighest) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "NO_ACTIVE_HIGHEST_BID"
          });
        }

        if (currentHighest.bidderChildId !== input.bidderChildId) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "BID_NOT_CURRENT_HIGHEST"
          });
        }

        const currentHighestPointHold = currentHighest.pointHold;
        if (!currentHighestPointHold) {
          throw new Error(
            `Auction ${auction.id} highest bid state is inconsistent`
          );
        }

        if (
          now.getTime() - currentHighest.createdAt.getTime() >
          WITHDRAW_CURRENT_HIGHEST_BID_WINDOW_MS
        ) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "WITHDRAW_WINDOW_EXPIRED"
          });
        }

        const item = await tx.item.findUnique({
          where: {
            id: auction.itemId
          },
          select: {
            id: true,
            communityId: true
          }
        });
        if (!item) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "AUCTION_NOT_FOUND"
          });
        }

        const bidder = await loadBidderContext(
          tx,
          input.bidderChildId,
          item.communityId
        );
        if (!bidder || bidder.primaryGuardians.length === 0) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "BIDDER_CHILD_REQUIRED"
          });
        }

        if (bidder.status !== "active") {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "CHILD_NOT_ACTIVE"
          });
        }

        if (
          input.actorUserId !== bidder.userId &&
          !bidder.primaryGuardians.some(
            (guardian) => guardian.userId === input.actorUserId
          )
        ) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "BIDDER_CHILD_REQUIRED"
          });
        }

        if (!bidder.pointAccountId) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "POINT_ACCOUNT_NOT_FOUND"
          });
        }

        const lockedAccounts = await lockPointAccounts(tx, [
          currentHighestPointHold.accountId
        ]);
        const bidderAccount = lockedAccounts[0] ?? null;
        if (!bidderAccount) {
          return completeIdempotency(tx, idempotency.id, {
            result: "rejected",
            errorCode: "POINT_ACCOUNT_NOT_FOUND"
          });
        }

        if (
          bidderAccount.id !== bidder.pointAccountId ||
          bidderAccount.childId !== currentHighest.bidderChildId ||
          bidderAccount.frozenPoints < currentHighestPointHold.amountPoints
        ) {
          throw new Error(
            `Auction ${auction.id} current highest point account is inconsistent`
          );
        }

        await tx.bid.update({
          where: {
            id: currentHighest.id
          },
          data: {
            status: "withdrawn",
            withdrawnAt: now
          }
        });

        await tx.pointHold.update({
          where: {
            id: currentHighestPointHold.id
          },
          data: {
            status: "released",
            releasedAt: now
          }
        });

        const availableAfter =
          bidderAccount.availablePoints + currentHighestPointHold.amountPoints;
        const frozenAfter =
          bidderAccount.frozenPoints - currentHighestPointHold.amountPoints;
        await tx.pointAccount.update({
          where: {
            id: bidderAccount.id
          },
          data: {
            availablePoints: availableAfter,
            frozenPoints: frozenAfter
          }
        });

        await tx.pointLedgerEntry.create({
          data: {
            accountId: bidderAccount.id,
            childId: currentHighest.bidderChildId,
            type: "release",
            amountPoints: currentHighestPointHold.amountPoints,
            availableAfter,
            frozenAfter,
            relatedType: "bid",
            relatedId: currentHighest.id,
            idempotencyKey: buildWithdrawReleaseLedgerIdempotencyKey(
              currentHighest.id
            ),
            reason: "auction_bid_withdraw_release",
            createdByUserId: input.actorUserId,
            createdAt: now
          }
        });

        await tx.auctionSession.update({
          where: {
            id: auction.id
          },
          data: {
            currentPricePoints: 0,
            highestBidId: null,
            highestBidderChildId: null,
            version: {
              increment: 1
            }
          }
        });

        const response: WithdrawCurrentHighestBidResult = {
          result: "accepted",
          bidId: currentHighest.id,
          auctionSessionId: auction.id,
          bidderChildId: currentHighest.bidderChildId,
          releasedAmountPoints: currentHighestPointHold.amountPoints,
          status: "withdrawn",
          idempotencyKey
        };

        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            action: "bid.withdraw",
            targetType: "bid",
            targetId: currentHighest.id,
            beforeJson: {
              auctionSessionId: auction.id,
              bidderChildId: currentHighest.bidderChildId,
              amountPoints: currentHighest.amountPoints,
              status: currentHighest.status,
              holdId: currentHighestPointHold.id
            },
            afterJson: {
              auctionSessionId: auction.id,
              itemId: item.id,
              bidderChildId: currentHighest.bidderChildId,
              releasedAmountPoints: currentHighestPointHold.amountPoints,
              currentPricePoints: 0,
              highestBidId: null,
              highestBidderChildId: null,
              clientIdempotencyKeyHash: createStableHash({ idempotencyKey })
            },
            createdAt: now
          }
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "auction.bid_withdrawn",
            targetType: "bid",
            targetId: currentHighest.id,
            idempotencyKey: buildWithdrawnOutboxIdempotencyKey(
              currentHighest.id
            ),
            payloadJson: {
              auctionSessionId: auction.id,
              bidId: currentHighest.id,
              bidderChildId: currentHighest.bidderChildId,
              releasedAmountPoints: currentHighestPointHold.amountPoints,
              currentPricePoints: 0,
              highestBidId: null,
              highestBidderChildId: null
            },
            availableAt: now
          }
        });

        return completeIdempotency(tx, idempotency.id, response);
      }
    ).catch((error: unknown) => {
      if (isTransientTransactionError(error)) {
        return unknownResult;
      }

      throw error;
    });
  }
}

async function reserveIdempotencyRecord<T>(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  }
): Promise<IdempotencyReservation<T>> {
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IdempotencyRecord" (
      "id",
      "key",
      "actorUserId",
      "action",
      "targetType",
      "targetId",
      "requestHash",
      "status"
    )
    VALUES (
      ${randomUUID()},
      ${input.key},
      ${input.actorUserId},
      ${input.action},
      ${input.targetType},
      ${input.targetId},
      ${input.requestHash},
      'processing'
    )
    ON CONFLICT ("key", "actorUserId", "action", "targetType", "targetId")
    DO NOTHING
    RETURNING "id"
  `;

  if (inserted[0]) {
    return {
      result: "reserved",
      id: inserted[0].id
    };
  }

  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      key_actorUserId_action_targetType_targetId: {
        key: input.key,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId
      }
    },
    select: {
      requestHash: true,
      status: true,
      responseJson: true
    }
  });

  if (!existing || existing.requestHash !== input.requestHash) {
    return {
      result: "conflict"
    };
  }

  if (existing.status === "completed" && existing.responseJson) {
    return {
      result: "replay",
      response: existing.responseJson as T
    };
  }

  return {
    result: "conflict"
  };
}

async function completeIdempotency<T>(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: T
): Promise<T> {
  await tx.idempotencyRecord.update({
    where: {
      id: idempotencyRecordId
    },
    data: {
      status: "completed",
      responseJson: response as Prisma.InputJsonValue
    }
  });

  return response;
}

async function lockAuctionSession(
  tx: Prisma.TransactionClient,
  auctionSessionId: string
): Promise<LockedAuctionSessionRow | null> {
  const rows = await tx.$queryRaw<LockedAuctionSessionRow[]>`
    SELECT
      "id",
      "itemId",
      "status",
      "endAt",
      "startPoints",
      "minIncrementPoints",
      "currentPricePoints",
      "highestBidId",
      "highestBidderChildId",
      "version"
    FROM "AuctionSession"
    WHERE "id" = ${auctionSessionId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function loadBidderContext(
  tx: Prisma.TransactionClient,
  childId: string,
  communityId: string
): Promise<BidderContext | null> {
  const child = await tx.childProfile.findUnique({
    where: {
      id: childId
    },
    select: {
      id: true,
      userId: true,
      status: true,
      guardianSettings: {
        select: {
          canBid: true,
          maxBidPoints: true
        }
      },
      pointAccount: {
        select: {
          id: true
        }
      },
      guardianLinks: {
        where: {
          role: "primary",
          status: "active",
          guardian: {
            status: "active"
          }
        },
        select: {
          guardianId: true,
          guardian: {
            select: {
              userId: true,
              phoneHash: true
            }
          }
        }
      },
      memberships: {
        where: {
          communityId
        },
        select: {
          status: true,
          community: {
            select: {
              status: true
            }
          }
        },
        take: 1
      }
    }
  });

  if (!child) {
    return null;
  }

  const membership = child.memberships[0];

  return {
    childId: child.id,
    userId: child.userId,
    status: child.status,
    primaryGuardians: child.guardianLinks.map((link) => ({
      guardianId: link.guardianId,
      userId: link.guardian.userId,
      phoneHash: link.guardian.phoneHash
    })),
    membershipStatus: membership?.status ?? null,
    communityStatus: membership?.community.status ?? null,
    canBid: child.guardianSettings?.canBid ?? false,
    maxBidPoints: child.guardianSettings?.maxBidPoints ?? null,
    pointAccountId: child.pointAccount?.id ?? null
  };
}

async function loadSellerContext(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<SellerContext | null> {
  const child = await tx.childProfile.findUnique({
    where: {
      id: childId
    },
    select: {
      id: true,
      guardianLinks: {
        where: {
          role: "primary",
          status: "active",
          guardian: {
            status: "active"
          }
        },
        select: {
          guardianId: true,
          guardian: {
            select: {
              userId: true,
              phoneHash: true
            }
          }
        }
      }
    }
  });

  if (!child) {
    return null;
  }

  return {
    childId: child.id,
    primaryGuardians: child.guardianLinks.map((link) => ({
      guardianId: link.guardianId,
      userId: link.guardian.userId,
      phoneHash: link.guardian.phoneHash
    }))
  };
}

async function loadCurrentHighestBid(
  tx: Prisma.TransactionClient,
  bidId: string
): Promise<CurrentHighestBidContext | null> {
  return tx.bid.findUnique({
    where: {
      id: bidId
    },
    select: {
      id: true,
      auctionSessionId: true,
      bidderChildId: true,
      amountPoints: true,
      status: true,
      createdAt: true,
      pointHold: {
        select: {
          id: true,
          accountId: true,
          auctionSessionId: true,
          amountPoints: true,
          status: true
        }
      }
    }
  });
}

async function lockPointAccounts(
  tx: Prisma.TransactionClient,
  accountIds: string[]
): Promise<LockedPointAccountRow[]> {
  if (accountIds.length === 0) {
    return [];
  }

  const sortedAccountIds = [...new Set(accountIds)].sort();
  return tx.$queryRaw<LockedPointAccountRow[]>(Prisma.sql`
    SELECT
      "id",
      "childId",
      "availablePoints",
      "frozenPoints"
    FROM "PointAccount"
    WHERE "id" IN (${Prisma.join(sortedAccountIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

async function hasFrozenGuardianDispute(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<boolean> {
  return Boolean(
    await tx.guardianDispute.findFirst({
      where: {
        childId,
        status: {
          in: ["pending_platform_review", "frozen"]
        }
      },
      select: {
        id: true
      }
    })
  );
}

async function hasActiveBidRestriction(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    childId: string;
    primaryGuardianIds: string[];
    primaryGuardianUserIds: string[];
    communityId: string;
    now: Date;
  }
): Promise<boolean> {
  const filters: Prisma.RiskRestrictionWhereInput[] = [
    {
      scope: "child",
      targetId: input.childId
    },
    {
      scope: "community",
      targetId: input.communityId
    },
    {
      scope: "community_member",
      childId: input.childId,
      communityId: input.communityId
    }
  ];

  for (const guardianId of new Set(input.primaryGuardianIds)) {
    filters.push({
      scope: "guardian",
      targetId: guardianId
    });
  }

  const primaryGuardianUserIds = new Set(input.primaryGuardianUserIds);
  for (const userId of primaryGuardianUserIds) {
    filters.push({
      scope: "user",
      targetId: userId
    });
  }

  if (!primaryGuardianUserIds.has(input.actorUserId)) {
    filters.push({
      scope: "user",
      targetId: input.actorUserId
    });
  }

  const restriction = await tx.riskRestriction.findFirst({
    where: {
      status: "active",
      type: {
        in: bidRestrictionTypes()
      },
      startsAt: {
        lte: input.now
      },
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }]
        },
        {
          OR: filters
        }
      ]
    },
    select: {
      id: true
    }
  });

  return Boolean(restriction);
}

function bidRestrictionTypes(): RiskRestrictionType[] {
  return ["no_bid", "suspended"];
}

function assertCurrentHighestBidIsConsistent(
  auction: LockedAuctionSessionRow,
  currentHighest: CurrentHighestBidContext | null
) {
  if (!auction.highestBidId) {
    if (
      auction.highestBidderChildId !== null ||
      auction.currentPricePoints !== 0 ||
      currentHighest !== null
    ) {
      throw new Error(`Auction ${auction.id} highest bid state is inconsistent`);
    }

    return;
  }

  if (
    !currentHighest ||
    currentHighest.auctionSessionId !== auction.id ||
    auction.highestBidderChildId !== currentHighest.bidderChildId ||
    currentHighest.status !== "active" ||
    !currentHighest.pointHold ||
    currentHighest.pointHold.auctionSessionId !== auction.id ||
    currentHighest.pointHold.status !== "active" ||
    currentHighest.amountPoints !== auction.currentPricePoints ||
    currentHighest.pointHold.amountPoints !== currentHighest.amountPoints
  ) {
    throw new Error(`Auction ${auction.id} highest bid state is inconsistent`);
  }
}

function isTransientTransactionError(error: unknown) {
  const prismaCode = getStringProperty(error, "code");
  if (prismaCode === "P2034") {
    return true;
  }

  const meta = getObjectProperty(error, "meta");
  const databaseCode = getStringProperty(meta, "code");
  if (databaseCode && ["40001", "40P01", "55P03"].includes(databaseCode)) {
    return true;
  }

  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const normalizedMessage = message.toLowerCase();
  if (
    prismaCode === "P2028" &&
    (normalizedMessage.includes("transaction already closed") ||
      normalizedMessage.includes("statement timeout") ||
      normalizedMessage.includes("lock timeout"))
  ) {
    return true;
  }

  return [
    "could not serialize",
    "deadlock detected",
    "lock timeout"
  ].some((pattern) => normalizedMessage.includes(pattern));
}

function getObjectProperty(value: unknown, property: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const propertyValue = record[property];
  return propertyValue && typeof propertyValue === "object"
    ? propertyValue
    : null;
}

function getStringProperty(value: unknown, property: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return typeof record[property] === "string" ? record[property] : null;
}

function buildIdempotencyTargetId(
  auctionSessionId: string,
  bidderChildId: string
) {
  return `${auctionSessionId}:${bidderChildId}`;
}

function buildPersistedBidIdempotencyKey(input: {
  actorUserId: string;
  auctionSessionId: string;
  bidderChildId: string;
  idempotencyKey: string;
}) {
  return `bid.create:${createStableHash(input)}`;
}

function buildAcceptedOutboxIdempotencyKey(bidId: string) {
  return `auction.bid_accepted:${createStableHash({ bidId })}`;
}

function buildOutbidOutboxIdempotencyKey(oldBidId: string, newBidId: string) {
  return `auction.bid_outbid:${createStableHash({ oldBidId, newBidId })}`;
}

function buildWithdrawReleaseLedgerIdempotencyKey(bidId: string) {
  return `bid:${bidId}:withdraw_release`;
}

function buildWithdrawnOutboxIdempotencyKey(bidId: string) {
  return `auction.bid_withdrawn:${createStableHash({ bidId })}`;
}

function createStableHash(value: Record<string, string | number>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
