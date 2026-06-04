import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

export type TransactionTimeoutResult =
  | {
      result: "guardian_confirm_timeout_cancelled";
      transactionId: string;
      releasedAmountPoints: number;
    }
  | {
      result: "delivery_confirm_timeout_platform_review";
      transactionId: string;
    }
  | {
      result: "skipped";
      transactionId: string;
      reason:
        | "TRANSACTION_NOT_FOUND"
        | "TRANSACTION_NOT_DUE"
        | "TRANSACTION_NOT_TIMEOUT_ELIGIBLE";
      status?: string;
    };

export type TransactionTimeoutScanResult = {
  result: "scanned";
  scannedCount: number;
  guardianTimeoutCancelledCount: number;
  deliveryTimeoutPlatformReviewCount: number;
  skippedCount: number;
};

export type PeriodicTransactionTimeoutScannerHandle = {
  stop(): Promise<void>;
};

type LockedTransactionRow = {
  id: string;
  auctionSessionId: string;
  buyerChildId: string;
  sellerChildId: string;
  pointHoldId: string;
  pointsAmount: number;
  status: string;
  guardianConfirmDeadlineAt: Date;
  deliveryConfirmDeadlineAt: Date | null;
};

type PointHoldRow = {
  id: string;
  accountId: string;
  amountPoints: number;
  status: string;
};

type LockedPointAccountRow = {
  id: string;
  childId: string;
  availablePoints: number;
  frozenPoints: number;
};

export class PrismaTransactionTimeoutRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async processTransactionTimeout(input: {
    transactionId: string;
    workerName: string;
    now: Date;
  }): Promise<TransactionTimeoutResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3000ms'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");

        const transaction = await lockTransaction(tx, input.transactionId);
        if (!transaction) {
          return {
            result: "skipped",
            transactionId: input.transactionId,
            reason: "TRANSACTION_NOT_FOUND"
          };
        }

        if (transaction.status === "pending_guardian_confirm") {
          if (input.now <= transaction.guardianConfirmDeadlineAt) {
            return {
              result: "skipped",
              transactionId: transaction.id,
              reason: "TRANSACTION_NOT_DUE",
              status: transaction.status
            };
          }

          return cancelGuardianTimeoutTransaction(tx, {
            transaction,
            workerName: input.workerName,
            now: input.now
          });
        }

        if (transaction.status === "pending_delivery_confirm") {
          if (
            !transaction.deliveryConfirmDeadlineAt ||
            input.now <= transaction.deliveryConfirmDeadlineAt
          ) {
            return {
              result: "skipped",
              transactionId: transaction.id,
              reason: "TRANSACTION_NOT_DUE",
              status: transaction.status
            };
          }

          return markDeliveryTimeoutForPlatformReview(tx, {
            transaction,
            workerName: input.workerName,
            now: input.now
          });
        }

        return {
          result: "skipped",
          transactionId: transaction.id,
          reason: "TRANSACTION_NOT_TIMEOUT_ELIGIBLE",
          status: transaction.status
        };
      },
      {
        maxWait: 3000,
        timeout: 7000
      }
    );
  }
}

export async function scanOverdueTransactionTimeouts(input: {
  prisma: PrismaClient;
  runner: PrismaTransactionTimeoutRunner;
  workerName: string;
  now?: Date;
  limit?: number;
}): Promise<TransactionTimeoutScanResult> {
  const now = input.now ?? new Date();
  const transactions = await input.prisma.transaction.findMany({
    where: {
      OR: [
        {
          status: "pending_guardian_confirm",
          guardianConfirmDeadlineAt: {
            lt: now
          }
        },
        {
          status: "pending_delivery_confirm",
          deliveryConfirmDeadlineAt: {
            lt: now
          }
        }
      ]
    },
    select: {
      id: true
    },
    orderBy: [{ guardianConfirmDeadlineAt: "asc" }, { id: "asc" }],
    take: input.limit ?? 50
  });
  const counts = {
    guardianTimeoutCancelledCount: 0,
    deliveryTimeoutPlatformReviewCount: 0,
    skippedCount: 0
  };

  for (const transaction of transactions) {
    const result = await input.runner.processTransactionTimeout({
      transactionId: transaction.id,
      workerName: input.workerName,
      now
    });
    switch (result.result) {
      case "guardian_confirm_timeout_cancelled":
        counts.guardianTimeoutCancelledCount += 1;
        break;
      case "delivery_confirm_timeout_platform_review":
        counts.deliveryTimeoutPlatformReviewCount += 1;
        break;
      case "skipped":
        counts.skippedCount += 1;
        break;
    }
  }

  return {
    result: "scanned",
    scannedCount: transactions.length,
    ...counts
  };
}

export function startPeriodicTransactionTimeoutScanner(input: {
  prisma: PrismaClient;
  runner: PrismaTransactionTimeoutRunner;
  workerName: string;
  intervalMs: number;
  limit?: number;
}): PeriodicTransactionTimeoutScannerHandle {
  const interval = setInterval(() => {
    void scanOverdueTransactionTimeouts({
      prisma: input.prisma,
      runner: input.runner,
      workerName: input.workerName,
      limit: input.limit
    });
  }, input.intervalMs);

  return {
    async stop() {
      clearInterval(interval);
    }
  };
}

async function cancelGuardianTimeoutTransaction(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    workerName: string;
    now: Date;
  }
): Promise<
  Extract<TransactionTimeoutResult, { result: "guardian_confirm_timeout_cancelled" }>
> {
  const pointHold = await lockPointHold(tx, input.transaction.pointHoldId);
  if (!pointHold || pointHold.status !== "active") {
    throw new Error(`Transaction ${input.transaction.id} point hold is missing`);
  }

  const account = await lockPointAccount(tx, pointHold.accountId);
  if (
    !account ||
    account.childId !== input.transaction.buyerChildId ||
    account.frozenPoints < pointHold.amountPoints
  ) {
    throw new Error(
      `Transaction ${input.transaction.id} buyer point account is inconsistent`
    );
  }

  const availableAfter = account.availablePoints + pointHold.amountPoints;
  const frozenAfter = account.frozenPoints - pointHold.amountPoints;
  await tx.pointHold.update({
    where: {
      id: pointHold.id
    },
    data: {
      status: "released",
      releasedAt: input.now
    }
  });
  await tx.pointAccount.update({
    where: {
      id: account.id
    },
    data: {
      availablePoints: availableAfter,
      frozenPoints: frozenAfter
    }
  });
  await tx.pointLedgerEntry.create({
    data: {
      accountId: account.id,
      childId: input.transaction.buyerChildId,
      type: "release",
      amountPoints: pointHold.amountPoints,
      availableAfter,
      frozenAfter,
      relatedType: "transaction",
      relatedId: input.transaction.id,
      idempotencyKey: `transaction:${input.transaction.id}:guardian_timeout_release`,
      reason: "transaction_guardian_timeout_release",
      createdByUserId: null,
      createdAt: input.now
    }
  });
  await tx.transaction.update({
    where: {
      id: input.transaction.id
    },
    data: {
      status: "cancelled",
      version: {
        increment: 1
      }
    }
  });
  await writeTransactionAuditAndOutbox(tx, {
    action: "transaction.guardian_confirm_timeout",
    eventType: "transaction.cancelled",
    transaction: input.transaction,
    status: "cancelled",
    workerName: input.workerName,
    now: input.now,
    payload: {
      reason: "guardian_confirm_timeout",
      releasedAmountPoints: pointHold.amountPoints
    }
  });

  return {
    result: "guardian_confirm_timeout_cancelled",
    transactionId: input.transaction.id,
    releasedAmountPoints: pointHold.amountPoints
  };
}

async function markDeliveryTimeoutForPlatformReview(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    workerName: string;
    now: Date;
  }
): Promise<
  Extract<TransactionTimeoutResult, { result: "delivery_confirm_timeout_platform_review" }>
> {
  await tx.transaction.update({
    where: {
      id: input.transaction.id
    },
    data: {
      status: "platform_review",
      version: {
        increment: 1
      }
    }
  });
  await writeTransactionAuditAndOutbox(tx, {
    action: "transaction.delivery_confirm_timeout",
    eventType: "transaction.platform_review_required",
    transaction: input.transaction,
    status: "platform_review",
    workerName: input.workerName,
    now: input.now,
    payload: {
      reason: "delivery_confirm_timeout"
    }
  });

  return {
    result: "delivery_confirm_timeout_platform_review",
    transactionId: input.transaction.id
  };
}

async function lockTransaction(
  tx: Prisma.TransactionClient,
  transactionId: string
): Promise<LockedTransactionRow | null> {
  const rows = await tx.$queryRaw<LockedTransactionRow[]>`
    SELECT
      "id",
      "auctionSessionId",
      "buyerChildId",
      "sellerChildId",
      "pointHoldId",
      "pointsAmount",
      "status",
      "guardianConfirmDeadlineAt",
      "deliveryConfirmDeadlineAt"
    FROM "Transaction"
    WHERE "id" = ${transactionId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockPointHold(
  tx: Prisma.TransactionClient,
  pointHoldId: string
): Promise<PointHoldRow | null> {
  const rows = await tx.$queryRaw<PointHoldRow[]>`
    SELECT
      "id",
      "accountId",
      "amountPoints",
      "status"
    FROM "PointHold"
    WHERE "id" = ${pointHoldId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockPointAccount(
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedPointAccountRow | null> {
  const rows = await tx.$queryRaw<LockedPointAccountRow[]>`
    SELECT
      "id",
      "childId",
      "availablePoints",
      "frozenPoints"
    FROM "PointAccount"
    WHERE "id" = ${accountId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function writeTransactionAuditAndOutbox(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    eventType: string;
    transaction: LockedTransactionRow;
    status: string;
    workerName: string;
    now: Date;
    payload: Record<string, unknown>;
  }
) {
  const payload = {
    transactionId: input.transaction.id,
    auctionSessionId: input.transaction.auctionSessionId,
    buyerChildId: input.transaction.buyerChildId,
    sellerChildId: input.transaction.sellerChildId,
    pointHoldId: input.transaction.pointHoldId,
    pointsAmount: input.transaction.pointsAmount,
    status: input.status,
    workerName: input.workerName,
    ...input.payload
  };

  await tx.auditLog.create({
    data: {
      actorUserId: null,
      action: input.action,
      targetType: "transaction",
      targetId: input.transaction.id,
      afterJson: payload,
      createdAt: input.now
    }
  });
  await tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      targetType: "transaction",
      targetId: input.transaction.id,
      idempotencyKey: buildOutboxIdempotencyKey(
        input.eventType,
        input.transaction.id
      ),
      payloadJson: payload,
      availableAt: input.now
    }
  });
}

function buildOutboxIdempotencyKey(eventType: string, transactionId: string) {
  return `${eventType}:${createHash("sha256")
    .update(JSON.stringify({ transactionId }))
    .digest("hex")}`;
}
