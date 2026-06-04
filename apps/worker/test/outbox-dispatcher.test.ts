import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  buildAuctionSettlementJobId,
  claimOutboxEvents,
  PrismaOutboxDispatcher
} from "../src/outbox-dispatcher.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

const targetPrefix = "outbox_dispatcher_test_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Outbox dispatcher tests require explicit DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Outbox dispatcher tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("outbox dispatcher", () => {
  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: {
        targetId: {
          startsWith: targetPrefix
        }
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("leases due pending events and expired processing events without taking future work", async () => {
    const now = new Date("2000-01-01T00:00:00.000Z");
    const due = await createOutboxEvent("claim_due", {
      availableAt: new Date("1999-12-31T23:59:59.000Z")
    });
    const future = await createOutboxEvent("claim_future", {
      availableAt: new Date("2000-01-01T00:00:01.000Z")
    });
    const expiredProcessing = await createOutboxEvent("claim_expired", {
      status: "processing",
      lockedAt: new Date("1999-12-31T23:58:00.000Z"),
      lockedBy: "stale-worker",
      availableAt: new Date("2000-01-01T00:01:00.000Z")
    });
    const activeProcessing = await createOutboxEvent("claim_active", {
      status: "processing",
      lockedAt: new Date("1999-12-31T23:59:30.000Z"),
      lockedBy: "active-worker",
      availableAt: new Date("1999-12-31T23:59:00.000Z")
    });

    const claimed = await claimOutboxEvents(prisma, {
      workerName: "outbox-dispatcher-a",
      now,
      limit: 10,
      leaseMs: 60_000
    });

    expect(claimed.map((event) => event.id)).toEqual(
      expect.arrayContaining([due.id, expiredProcessing.id])
    );
    expect(claimed.map((event) => event.id)).not.toContain(future.id);
    expect(claimed.map((event) => event.id)).not.toContain(activeProcessing.id);
    await expect(
      prisma.outboxEvent.findMany({
        where: {
          id: {
            in: [due.id, expiredProcessing.id]
          }
        },
        select: {
          id: true,
          status: true,
          lockedAt: true,
          lockedBy: true
        },
        orderBy: {
          id: "asc"
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: due.id,
          status: "processing",
          lockedAt: now,
          lockedBy: "outbox-dispatcher-a"
        }),
        expect.objectContaining({
          id: expiredProcessing.id,
          status: "processing",
          lockedAt: now,
          lockedBy: "outbox-dispatcher-a"
        })
      ])
    );
  });

  it("schedules a fixed-id settlement job from auction session creation outbox", async () => {
    const now = new Date("2000-01-01T00:00:00.000Z");
    const auctionSessionId = unique("auction_session");
    const event = await createOutboxEvent("session_created", {
      eventType: "auction.session_created",
      targetId: auctionSessionId,
      payloadJson: {
        auctionSessionId,
        endAt: "2000-01-01T00:01:00.000Z"
      },
      availableAt: new Date("1999-12-31T23:59:59.000Z")
    });
    const scheduled: unknown[] = [];
    const dispatcher = new PrismaOutboxDispatcher(prisma, {
      workerName: "outbox-dispatcher-b",
      notificationSender: {
        async send() {
          throw new Error("notification sender should not be called");
        }
      },
      settlementScheduler: {
        async scheduleSettlement(input) {
          scheduled.push(input);
          return {
            jobId: buildAuctionSettlementJobId(input.auctionSessionId),
            delayMs: input.dueAt.getTime() - input.now.getTime()
          };
        }
      }
    });

    await expect(
      dispatcher.dispatchAvailable({
        now,
        limit: 10
      })
    ).resolves.toEqual({
      result: "dispatched",
      claimedCount: 1,
      sentCount: 1,
      failedCount: 0,
      settlementScheduledCount: 1,
      notificationSentCount: 0
    });
    expect(scheduled).toEqual([
      {
        auctionSessionId,
        dueAt: new Date("2000-01-01T00:01:00.000Z"),
        now
      }
    ]);
    expect(buildAuctionSettlementJobId(auctionSessionId)).toBe(
      `auction-settlement:${auctionSessionId}`
    );
    await expect(
      prisma.outboxEvent.findUnique({
        where: {
          id: event.id
        },
        select: {
          status: true,
          attempts: true,
          lockedAt: true,
          lockedBy: true
        }
      })
    ).resolves.toEqual({
      status: "sent",
      attempts: 0,
      lockedAt: null,
      lockedBy: null
    });
  });

  it("marks failed notification delivery for retry and dispatches it after availableAt", async () => {
    const now = new Date("2000-01-01T00:00:00.000Z");
    const event = await createOutboxEvent("notification_retry", {
      eventType: "auction.bid_accepted",
      payloadJson: {
        auctionSessionId: unique("auction_session"),
        bidId: unique("bid")
      },
      availableAt: new Date("1999-12-31T23:59:59.000Z")
    });
    const failingDispatcher = new PrismaOutboxDispatcher(prisma, {
      workerName: "outbox-dispatcher-c",
      retryBaseDelayMs: 1000,
      maxRetryDelayMs: 10_000,
      notificationSender: {
        async send() {
          return {
            ok: false,
            errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
            mutatesBusinessState: false
          };
        }
      },
      settlementScheduler: {
        async scheduleSettlement() {
          throw new Error("settlement scheduler should not be called");
        }
      }
    });

    await expect(
      failingDispatcher.dispatchAvailable({
        now,
        limit: 10
      })
    ).resolves.toEqual({
      result: "dispatched",
      claimedCount: 1,
      sentCount: 0,
      failedCount: 1,
      settlementScheduledCount: 0,
      notificationSentCount: 0
    });
    await expect(
      prisma.outboxEvent.findUnique({
        where: {
          id: event.id
        },
        select: {
          status: true,
          attempts: true,
          availableAt: true,
          lockedAt: true,
          lockedBy: true
        }
      })
    ).resolves.toEqual({
      status: "failed",
      attempts: 1,
      availableAt: new Date("2000-01-01T00:00:01.000Z"),
      lockedAt: null,
      lockedBy: null
    });

    await expect(
      failingDispatcher.dispatchAvailable({
        now: new Date("2000-01-01T00:00:00.999Z"),
        limit: 10
      })
    ).resolves.toMatchObject({
      claimedCount: 0
    });

    const sentPayloads: unknown[] = [];
    const succeedingDispatcher = new PrismaOutboxDispatcher(prisma, {
      workerName: "outbox-dispatcher-c",
      retryBaseDelayMs: 1000,
      maxRetryDelayMs: 10_000,
      notificationSender: {
        async send(input) {
          sentPayloads.push(input);
          return {
            ok: true,
            providerMessageId: "provider-message-1",
            mutatesBusinessState: false
          };
        }
      },
      settlementScheduler: {
        async scheduleSettlement() {
          throw new Error("settlement scheduler should not be called");
        }
      }
    });
    await expect(
      succeedingDispatcher.dispatchAvailable({
        now: new Date("2000-01-01T00:00:01.000Z"),
        limit: 10
      })
    ).resolves.toEqual({
      result: "dispatched",
      claimedCount: 1,
      sentCount: 1,
      failedCount: 0,
      settlementScheduledCount: 0,
      notificationSentCount: 1
    });
    expect(sentPayloads).toHaveLength(1);
    await expect(
      prisma.outboxEvent.findUnique({
        where: {
          id: event.id
        },
        select: {
          status: true,
          attempts: true,
          lockedAt: true,
          lockedBy: true
        }
      })
    ).resolves.toEqual({
      status: "sent",
      attempts: 1,
      lockedAt: null,
      lockedBy: null
    });
  });
});

async function createOutboxEvent(
  label: string,
  input: {
    eventType?: string;
    targetId?: string;
    payloadJson?: Record<string, unknown>;
    status?: "pending" | "processing" | "failed";
    availableAt?: Date;
    lockedAt?: Date | null;
    lockedBy?: string | null;
  } = {}
) {
  const targetId = input.targetId ?? unique(label);
  return prisma.outboxEvent.create({
    data: {
      eventType: input.eventType ?? "notification.test",
      targetType: "auction_session",
      targetId,
      idempotencyKey: unique(`${label}_idempotency`),
      payloadJson: (input.payloadJson ?? {
        targetId
      }) as Prisma.InputJsonValue,
      status: input.status ?? "pending",
      availableAt: input.availableAt ?? new Date("1999-12-31T23:59:59.000Z"),
      lockedAt: input.lockedAt,
      lockedBy: input.lockedBy
    }
  });
}
