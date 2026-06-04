import type { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { QueueName } from "./queue-names.js";
import type { AuctionSettlementJobPayload } from "./auction-settlement-worker.js";
import {
  processOutboxNotification,
  type NotificationSender,
  type OutboxJobPayload
} from "./outbox-processor.js";
import type { RedisConnectionConfig } from "./worker-config.js";

export type ClaimedOutboxEvent = {
  id: string;
  eventType: string;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  payloadJson: unknown;
  attempts: number;
};

export type OutboxDispatchSummary = {
  result: "dispatched";
  claimedCount: number;
  sentCount: number;
  failedCount: number;
  settlementScheduledCount: number;
  notificationSentCount: number;
};

export type SettlementJobScheduler = {
  scheduleSettlement(input: {
    auctionSessionId: string;
    dueAt: Date;
    now: Date;
  }): Promise<{
    jobId: string;
    delayMs: number;
  }>;
};

export type PeriodicOutboxDispatcherHandle = {
  stop(): Promise<void>;
};

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_BASE_DELAY_MS = 30 * 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10 * 60 * 1000;

export class PrismaOutboxDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly input: {
      workerName: string;
      notificationSender: NotificationSender;
      settlementScheduler: SettlementJobScheduler;
      leaseMs?: number;
      retryBaseDelayMs?: number;
      maxRetryDelayMs?: number;
    }
  ) {}

  async dispatchAvailable(input: {
    now?: Date;
    limit?: number;
  } = {}): Promise<OutboxDispatchSummary> {
    const now = input.now ?? new Date();
    const claimed = await claimOutboxEvents(this.prisma, {
      workerName: this.input.workerName,
      now,
      limit: input.limit ?? 50,
      leaseMs: this.input.leaseMs ?? DEFAULT_LEASE_MS
    });
    const summary: OutboxDispatchSummary = {
      result: "dispatched",
      claimedCount: claimed.length,
      sentCount: 0,
      failedCount: 0,
      settlementScheduledCount: 0,
      notificationSentCount: 0
    };

    for (const event of claimed) {
      try {
        const result = await dispatchClaimedOutboxEvent(event, {
          notificationSender: this.input.notificationSender,
          settlementScheduler: this.input.settlementScheduler,
          now
        });
        await markOutboxEventSent(this.prisma, {
          outboxEventId: event.id,
          workerName: this.input.workerName
        });
        summary.sentCount += 1;
        if (result === "settlement_scheduled") {
          summary.settlementScheduledCount += 1;
        } else {
          summary.notificationSentCount += 1;
        }
      } catch (error) {
        await markOutboxEventFailed(this.prisma, {
          outboxEventId: event.id,
          workerName: this.input.workerName,
          now,
          attempts: event.attempts,
          retryBaseDelayMs:
            this.input.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
          maxRetryDelayMs:
            this.input.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
        });
        summary.failedCount += 1;
      }
    }

    return summary;
  }
}

export async function claimOutboxEvents(
  prisma: Pick<PrismaClient, "$transaction">,
  input: {
    workerName: string;
    now: Date;
    limit: number;
    leaseMs?: number;
  }
): Promise<ClaimedOutboxEvent[]> {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseExpiredBefore = new Date(input.now.getTime() - leaseMs);

  return prisma.$transaction(async (tx) =>
    tx.$queryRaw<ClaimedOutboxEvent[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE (
          "status" IN ('pending', 'failed')
          AND "availableAt" <= ${input.now}
        ) OR (
          "status" = 'processing'
          AND "lockedAt" IS NOT NULL
          AND "lockedAt" < ${leaseExpiredBefore}
        )
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxEvent" AS outbox
      SET
        "status" = 'processing',
        "lockedAt" = ${input.now},
        "lockedBy" = ${input.workerName}
      FROM candidate
      WHERE outbox."id" = candidate."id"
      RETURNING
        outbox."id",
        outbox."eventType",
        outbox."targetType",
        outbox."targetId",
        outbox."idempotencyKey",
        outbox."payloadJson",
        outbox."attempts"
    `
  );
}

export function createBullMqAuctionSettlementScheduler(input: {
  connection: RedisConnectionConfig;
}): SettlementJobScheduler & { close(): Promise<void> } {
  const queue = new Queue<AuctionSettlementJobPayload>(
    QueueName.auctionSettlementTriggers,
    {
      connection: input.connection
    }
  );

  return {
    async scheduleSettlement(scheduleInput) {
      const delayMs = Math.max(
        0,
        scheduleInput.dueAt.getTime() - scheduleInput.now.getTime()
      );
      const jobId = buildAuctionSettlementJobId(
        scheduleInput.auctionSessionId
      );
      await queue.add(
        "settle-auction",
        {
          auctionSessionId: scheduleInput.auctionSessionId,
          dueAt: scheduleInput.dueAt.toISOString()
        },
        {
          jobId,
          delay: delayMs,
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 1000
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      );

      return {
        jobId,
        delayMs
      };
    },
    async close() {
      await queue.close();
    }
  };
}

export function startPeriodicOutboxDispatcher(input: {
  dispatcher: PrismaOutboxDispatcher;
  intervalMs: number;
  limit?: number;
}): PeriodicOutboxDispatcherHandle {
  let running = false;
  const interval = setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void input.dispatcher
      .dispatchAvailable({
        limit: input.limit
      })
      .finally(() => {
        running = false;
      });
  }, input.intervalMs);

  return {
    async stop() {
      clearInterval(interval);
    }
  };
}

export function buildAuctionSettlementJobId(auctionSessionId: string) {
  return `auction-settlement:${auctionSessionId}`;
}

async function dispatchClaimedOutboxEvent(
  event: ClaimedOutboxEvent,
  input: {
    notificationSender: NotificationSender;
    settlementScheduler: SettlementJobScheduler;
    now: Date;
  }
): Promise<"settlement_scheduled" | "notification_sent"> {
  const payloadJson = asPayloadRecord(event.payloadJson);
  if (event.eventType === "auction.session_created") {
    const auctionSessionId = expectString(
      payloadJson.auctionSessionId,
      "auctionSessionId"
    );
    const endAt = new Date(expectString(payloadJson.endAt, "endAt"));
    if (Number.isNaN(endAt.getTime())) {
      throw new Error("OUTBOX_INVALID_AUCTION_END_AT");
    }

    await input.settlementScheduler.scheduleSettlement({
      auctionSessionId,
      dueAt: endAt,
      now: input.now
    });

    return "settlement_scheduled";
  }

  const notificationPayload: OutboxJobPayload = {
    outboxEventId: event.id,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    idempotencyKey: event.idempotencyKey,
    payloadJson
  };
  const result = await processOutboxNotification(
    notificationPayload,
    input.notificationSender
  );
  if (result.result === "failed") {
    throw new Error(result.errorCode);
  }

  return "notification_sent";
}

async function markOutboxEventSent(
  prisma: Pick<PrismaClient, "outboxEvent">,
  input: {
    outboxEventId: string;
    workerName: string;
  }
) {
  await prisma.outboxEvent.updateMany({
    where: {
      id: input.outboxEventId,
      status: "processing",
      lockedBy: input.workerName
    },
    data: {
      status: "sent",
      lockedAt: null,
      lockedBy: null
    }
  });
}

async function markOutboxEventFailed(
  prisma: Pick<PrismaClient, "outboxEvent">,
  input: {
    outboxEventId: string;
    workerName: string;
    now: Date;
    attempts: number;
    retryBaseDelayMs: number;
    maxRetryDelayMs: number;
  }
) {
  const retryDelayMs = calculateRetryDelayMs({
    attempts: input.attempts + 1,
    retryBaseDelayMs: input.retryBaseDelayMs,
    maxRetryDelayMs: input.maxRetryDelayMs
  });

  await prisma.outboxEvent.updateMany({
    where: {
      id: input.outboxEventId,
      status: "processing",
      lockedBy: input.workerName
    },
    data: {
      status: "failed",
      attempts: {
        increment: 1
      },
      availableAt: new Date(input.now.getTime() + retryDelayMs),
      lockedAt: null,
      lockedBy: null
    }
  });
}

function calculateRetryDelayMs(input: {
  attempts: number;
  retryBaseDelayMs: number;
  maxRetryDelayMs: number;
}) {
  const multiplier = 2 ** Math.max(0, input.attempts - 1);
  return Math.min(
    input.maxRetryDelayMs,
    input.retryBaseDelayMs * multiplier
  );
}

function asPayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OUTBOX_INVALID_PAYLOAD");
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value) {
    throw new Error(`OUTBOX_INVALID_${fieldName.toUpperCase()}`);
  }

  return value;
}
