import type { Prisma, PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import { createHash } from "node:crypto";
import { runPeriodicTask } from "./periodic-task.js";
import { QueueName } from "./queue-names.js";
import type { RedisConnectionConfig } from "./worker-config.js";

export type AuctionSettlementJobPayload = {
  auctionSessionId: string;
  dueAt?: string;
};

export type AuctionSettlementResult =
  | {
      result: "settled";
      auctionSessionId: string;
      transactionId: string;
      buyerChildId: string;
      sellerChildId: string;
      pointHoldId: string;
      pointsAmount: number;
      guardianConfirmDeadlineAt: string;
      alreadyFinal: boolean;
    }
  | {
      result: "unsold";
      auctionSessionId: string;
      alreadyFinal: boolean;
    }
  | {
      result: "skipped";
      auctionSessionId: string;
      reason:
        | "AUCTION_NOT_FOUND"
        | "AUCTION_NOT_ACTIVE"
        | "AUCTION_NOT_DUE"
        | "SETTLED_TRANSACTION_NOT_FOUND";
      status?: string;
    }
  | {
      result: "retryable";
      auctionSessionId: string;
      errorCode: "TRANSACTION_RESULT_UNKNOWN";
      retryable: true;
      refreshRequired: true;
    };

export type AuctionSettlementRunnerInput = {
  auctionSessionId: string;
  workerName: string;
  now: Date;
};

export type AuctionSettlementRunner = {
  settleAuction(
    input: AuctionSettlementRunnerInput
  ): Promise<AuctionSettlementResult>;
};

export type AuctionSettlementScanResult = {
  result: "scanned";
  scannedCount: number;
  settledCount: number;
  unsoldCount: number;
  skippedCount: number;
  retryableCount: number;
};

export type PeriodicAuctionSettlementScannerHandle = {
  stop(): Promise<void>;
};

type LockedAuctionSessionRow = {
  id: string;
  itemId: string;
  status: string;
  endAt: Date;
  currentPricePoints: number;
  highestBidId: string | null;
  highestBidderChildId: string | null;
  version: number;
};

type CurrentHighestBidContext = {
  id: string;
  auctionSessionId: string;
  bidderChildId: string;
  amountPoints: number;
  status: string;
  pointHold: {
    id: string;
    accountId: string;
    auctionSessionId: string;
    amountPoints: number;
    status: string;
  } | null;
};

type LockedPointAccountRow = {
  id: string;
  childId: string;
  frozenPoints: number;
};

const GUARDIAN_CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000;

export class PrismaAuctionSettlementRunner implements AuctionSettlementRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async settleAuction(
    input: AuctionSettlementRunnerInput
  ): Promise<AuctionSettlementResult> {
    return runSettlementTransaction<AuctionSettlementResult>(
      this.prisma,
      async (tx) => {
        const auction = await lockAuctionSession(tx, input.auctionSessionId);
        if (!auction) {
          return {
            result: "skipped",
            auctionSessionId: input.auctionSessionId,
            reason: "AUCTION_NOT_FOUND"
          };
        }

        if (auction.status === "settled") {
          return loadFinalSettledResult(tx, auction.id);
        }

        if (auction.status === "unsold") {
          return {
            result: "unsold",
            auctionSessionId: auction.id,
            alreadyFinal: true
          };
        }

        if (auction.status !== "active") {
          return {
            result: "skipped",
            auctionSessionId: auction.id,
            reason: "AUCTION_NOT_ACTIVE",
            status: auction.status
          };
        }

        if (input.now < auction.endAt) {
          return {
            result: "skipped",
            auctionSessionId: auction.id,
            reason: "AUCTION_NOT_DUE",
            status: auction.status
          };
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
          throw new Error(`Auction ${auction.id} item is missing`);
        }

        const currentHighest =
          auction.highestBidId === null
            ? null
            : await loadCurrentHighestBid(tx, auction.highestBidId);
        assertSettlementHighestBidIsConsistent(auction, currentHighest);

        if (!currentHighest) {
          return markAuctionUnsold(tx, {
            auction,
            item,
            workerName: input.workerName,
            now: input.now
          });
        }

        return settleWinningAuction(tx, {
          auction,
          item,
          currentHighest,
          workerName: input.workerName,
          now: input.now
        });
      }
    ).catch((error: unknown) => {
      if (isTransientTransactionError(error)) {
        return {
          result: "retryable",
          auctionSessionId: input.auctionSessionId,
          errorCode: "TRANSACTION_RESULT_UNKNOWN",
          retryable: true,
          refreshRequired: true
        };
      }

      throw error;
    });
  }
}

export async function processAuctionSettlementTrigger(
  payload: AuctionSettlementJobPayload,
  input: {
    runner: AuctionSettlementRunner;
    workerName: string;
    now?: Date;
  }
): Promise<AuctionSettlementResult> {
  return input.runner.settleAuction({
    auctionSessionId: payload.auctionSessionId,
    workerName: input.workerName,
    now: input.now ?? new Date()
  });
}

export function createAuctionSettlementTriggerWorker(input: {
  connection: RedisConnectionConfig;
  concurrency: number;
  workerName: string;
  runner: AuctionSettlementRunner;
}) {
  return new Worker<AuctionSettlementJobPayload, AuctionSettlementResult>(
    QueueName.auctionSettlementTriggers,
    async (job: Job<AuctionSettlementJobPayload>) => {
      const result = await processAuctionSettlementTrigger(job.data, {
        runner: input.runner,
        workerName: input.workerName
      });
      if (result.result === "retryable") {
        throw new Error(result.errorCode);
      }

      return result;
    },
    {
      connection: input.connection,
      concurrency: input.concurrency
    }
  );
}

export async function scanOverdueAuctionSettlements(input: {
  prisma: PrismaClient;
  runner: AuctionSettlementRunner;
  workerName: string;
  now?: Date;
  limit?: number;
}): Promise<AuctionSettlementScanResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const auctions = await input.prisma.auctionSession.findMany({
    where: {
      status: "active",
      endAt: {
        lte: now
      }
    },
    select: {
      id: true
    },
    orderBy: [{ endAt: "asc" }, { id: "asc" }],
    take: limit
  });

  const counts = {
    settledCount: 0,
    unsoldCount: 0,
    skippedCount: 0,
    retryableCount: 0
  };

  for (const auction of auctions) {
    const result = await input.runner.settleAuction({
      auctionSessionId: auction.id,
      workerName: input.workerName,
      now
    });

    switch (result.result) {
      case "settled":
        counts.settledCount += 1;
        break;
      case "unsold":
        counts.unsoldCount += 1;
        break;
      case "skipped":
        counts.skippedCount += 1;
        break;
      case "retryable":
        counts.retryableCount += 1;
        break;
    }
  }

  return {
    result: "scanned",
    scannedCount: auctions.length,
    ...counts
  };
}

export function startPeriodicAuctionSettlementScanner(input: {
  prisma: PrismaClient;
  runner: AuctionSettlementRunner;
  workerName: string;
  intervalMs: number;
  limit?: number;
}): PeriodicAuctionSettlementScannerHandle {
  const interval = setInterval(() => {
    runPeriodicTask({
      taskName: "auction_settlement_scan",
      run: () =>
        scanOverdueAuctionSettlements({
          prisma: input.prisma,
          runner: input.runner,
          workerName: input.workerName,
          limit: input.limit
        })
    });
  }, input.intervalMs);

  return {
    async stop() {
      clearInterval(interval);
    }
  };
}

async function markAuctionUnsold(
  tx: Prisma.TransactionClient,
  input: {
    auction: LockedAuctionSessionRow;
    item: {
      id: string;
      communityId: string;
      sellerChildId: string;
    };
    workerName: string;
    now: Date;
  }
): Promise<Extract<AuctionSettlementResult, { result: "unsold" }>> {
  await tx.auctionSession.update({
    where: {
      id: input.auction.id
    },
    data: {
      status: "unsold",
      settledAt: input.now,
      settlementAttemptCount: {
        increment: 1
      },
      lastSettlementError: null,
      version: {
        increment: 1
      }
    }
  });

  await tx.auditLog.create({
    data: {
      actorUserId: null,
      action: "auction.unsold",
      targetType: "auction_session",
      targetId: input.auction.id,
      afterJson: {
        auctionSessionId: input.auction.id,
        itemId: input.item.id,
        communityId: input.item.communityId,
        sellerChildId: input.item.sellerChildId,
        workerName: input.workerName,
        status: "unsold"
      },
      createdAt: input.now
    }
  });

  await tx.outboxEvent.create({
    data: {
      eventType: "auction.unsold",
      targetType: "auction_session",
      targetId: input.auction.id,
      idempotencyKey: buildUnsoldOutboxIdempotencyKey(input.auction.id),
      payloadJson: {
        auctionSessionId: input.auction.id,
        itemId: input.item.id,
        communityId: input.item.communityId,
        sellerChildId: input.item.sellerChildId,
        status: "unsold"
      },
      availableAt: input.now
    }
  });

  return {
    result: "unsold",
    auctionSessionId: input.auction.id,
    alreadyFinal: false
  };
}

async function settleWinningAuction(
  tx: Prisma.TransactionClient,
  input: {
    auction: LockedAuctionSessionRow;
    item: {
      id: string;
      communityId: string;
      sellerChildId: string;
    };
    currentHighest: CurrentHighestBidContext;
    workerName: string;
    now: Date;
  }
): Promise<Extract<AuctionSettlementResult, { result: "settled" }>> {
  const currentHighestPointHold = input.currentHighest.pointHold;
  if (!currentHighestPointHold) {
    throw new Error(
      `Auction ${input.auction.id} highest bid state is inconsistent`
    );
  }

  const account = await lockPointAccount(tx, currentHighestPointHold.accountId);
  if (
    !account ||
    account.childId !== input.currentHighest.bidderChildId ||
    account.frozenPoints < currentHighestPointHold.amountPoints
  ) {
    throw new Error(
      `Auction ${input.auction.id} highest bid point account is inconsistent`
    );
  }

  const guardianConfirmDeadlineAt = new Date(
    input.now.getTime() + GUARDIAN_CONFIRM_WINDOW_MS
  );
  const transaction = await tx.transaction.create({
    data: {
      auctionSessionId: input.auction.id,
      buyerChildId: input.currentHighest.bidderChildId,
      sellerChildId: input.item.sellerChildId,
      pointHoldId: currentHighestPointHold.id,
      pointsAmount: currentHighestPointHold.amountPoints,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt,
      createdAt: input.now
    }
  });

  await tx.auctionSession.update({
    where: {
      id: input.auction.id
    },
    data: {
      status: "settled",
      settledAt: input.now,
      settlementAttemptCount: {
        increment: 1
      },
      lastSettlementError: null,
      version: {
        increment: 1
      }
    }
  });

  await tx.auditLog.create({
    data: {
      actorUserId: null,
      action: "auction.settle",
      targetType: "auction_session",
      targetId: input.auction.id,
      afterJson: {
        auctionSessionId: input.auction.id,
        itemId: input.item.id,
        communityId: input.item.communityId,
        bidId: input.currentHighest.id,
        transactionId: transaction.id,
        buyerChildId: transaction.buyerChildId,
        sellerChildId: transaction.sellerChildId,
        pointHoldId: transaction.pointHoldId,
        pointsAmount: transaction.pointsAmount,
        guardianConfirmDeadlineAt: guardianConfirmDeadlineAt.toISOString(),
        workerName: input.workerName,
        status: "settled"
      },
      createdAt: input.now
    }
  });

  await tx.outboxEvent.create({
    data: {
      eventType: "auction.settled",
      targetType: "auction_session",
      targetId: input.auction.id,
      idempotencyKey: buildSettledOutboxIdempotencyKey(input.auction.id),
      payloadJson: {
        auctionSessionId: input.auction.id,
        itemId: input.item.id,
        communityId: input.item.communityId,
        bidId: input.currentHighest.id,
        transactionId: transaction.id,
        buyerChildId: transaction.buyerChildId,
        sellerChildId: transaction.sellerChildId,
        pointHoldId: transaction.pointHoldId,
        pointsAmount: transaction.pointsAmount,
        guardianConfirmDeadlineAt: guardianConfirmDeadlineAt.toISOString(),
        status: "settled"
      },
      availableAt: input.now
    }
  });

  return {
    result: "settled",
    auctionSessionId: input.auction.id,
    transactionId: transaction.id,
    buyerChildId: transaction.buyerChildId,
    sellerChildId: transaction.sellerChildId,
    pointHoldId: transaction.pointHoldId,
    pointsAmount: transaction.pointsAmount,
    guardianConfirmDeadlineAt: guardianConfirmDeadlineAt.toISOString(),
    alreadyFinal: false
  };
}

async function loadFinalSettledResult(
  tx: Prisma.TransactionClient,
  auctionSessionId: string
): Promise<AuctionSettlementResult> {
  const transaction = await tx.transaction.findUnique({
    where: {
      auctionSessionId
    }
  });
  if (!transaction) {
    return {
      result: "skipped",
      auctionSessionId,
      reason: "SETTLED_TRANSACTION_NOT_FOUND",
      status: "settled"
    };
  }

  return {
    result: "settled",
    auctionSessionId,
    transactionId: transaction.id,
    buyerChildId: transaction.buyerChildId,
    sellerChildId: transaction.sellerChildId,
    pointHoldId: transaction.pointHoldId,
    pointsAmount: transaction.pointsAmount,
    guardianConfirmDeadlineAt:
      transaction.guardianConfirmDeadlineAt.toISOString(),
    alreadyFinal: true
  };
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

async function lockPointAccount(
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedPointAccountRow | null> {
  const rows = await tx.$queryRaw<LockedPointAccountRow[]>`
    SELECT
      "id",
      "childId",
      "frozenPoints"
    FROM "PointAccount"
    WHERE "id" = ${accountId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

function assertSettlementHighestBidIsConsistent(
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

async function runSettlementTransaction<T>(
  prisma: Pick<PrismaClient, "$transaction">,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3000ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");

      return operation(tx);
    },
    {
      maxWait: 3000,
      timeout: 7000
    }
  );
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

function buildSettledOutboxIdempotencyKey(auctionSessionId: string) {
  return `auction.settled:${createStableHash({ auctionSessionId })}`;
}

function buildUnsoldOutboxIdempotencyKey(auctionSessionId: string) {
  return `auction.unsold:${createStableHash({ auctionSessionId })}`;
}

function createStableHash(value: Record<string, string | number>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
