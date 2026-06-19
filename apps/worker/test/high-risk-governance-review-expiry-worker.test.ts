import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { scanExpiredHighRiskGovernanceReviews } from "../src/high-risk-governance-review-expiry-worker.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const highRiskPrisma = prisma as PrismaClient & {
  highRiskGovernanceReviewRequest: {
    create(args: unknown): Promise<{ id: string }>;
    findUnique(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  highRiskGovernanceReviewEvent: {
    count(args: unknown): Promise<number>;
    deleteMany(args: unknown): Promise<unknown>;
  };
};
const targetPrefix = "review_expiry_worker_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "High-risk governance review expiry worker tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "High-risk governance review expiry worker tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("high-risk governance review expiry worker", () => {
  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("expires due pending reviews and emits one lifecycle event plus outbox event", async () => {
    const initiator = await createUser("initiator");
    const dueReview = await createReview({
      initiatorUserId: initiator.id,
      expiresAt: new Date("2026-06-10T14:59:00.000Z")
    });
    await createReview({
      initiatorUserId: initiator.id,
      expiresAt: new Date("2026-06-10T15:10:00.000Z")
    });

    await expect(
      scanExpiredHighRiskGovernanceReviews({
        prisma,
        now: new Date("2026-06-10T15:00:00.000Z"),
        limit: 10
      })
    ).resolves.toEqual({
      result: "scanned",
      scannedCount: 1,
      expiredCount: 1
    });
    await expect(
      highRiskPrisma.highRiskGovernanceReviewRequest.findUnique({
        where: {
          id: dueReview.id
        },
        select: {
          decisionState: true,
          decisionReason: true,
          executionState: true
        }
      })
    ).resolves.toEqual({
      decisionState: "expired",
      decisionReason: "review request expired",
      executionState: "not_started"
    });
    await expect(
      highRiskPrisma.highRiskGovernanceReviewEvent.count({
        where: {
          requestId: dueReview.id,
          eventType: "expired"
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          targetId: dueReview.id,
          eventType: "high_risk_governance_review.expired"
        }
      })
    ).resolves.toBe(1);
  });

  it("keeps concurrent expiry scans first-writer-wins", async () => {
    const initiator = await createUser("race_initiator");
    const review = await createReview({
      initiatorUserId: initiator.id,
      expiresAt: new Date("2026-06-10T15:29:00.000Z")
    });

    const [first, second] = await Promise.all([
      scanExpiredHighRiskGovernanceReviews({
        prisma,
        now: new Date("2026-06-10T15:30:00.000Z")
      }),
      scanExpiredHighRiskGovernanceReviews({
        prisma,
        now: new Date("2026-06-10T15:30:00.000Z")
      })
    ]);

    expect(first.expiredCount + second.expiredCount).toBe(1);
    await expect(
      highRiskPrisma.highRiskGovernanceReviewEvent.count({
        where: {
          requestId: review.id,
          eventType: "expired"
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          targetId: review.id,
          eventType: "high_risk_governance_review.expired"
        }
      })
    ).resolves.toBe(1);
  });
});

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      id: unique(`${label}_user`),
      status: "active"
    }
  });
}

async function createReview(input: { initiatorUserId: string; expiresAt: Date }) {
  const id = unique("review");
  const community = await prisma.auctionCommunity.create({
    data: {
      id: unique("community"),
      name: "Review expiry worker community",
      creatorGuardianId: unique("guardian"),
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
  return highRiskPrisma.highRiskGovernanceReviewRequest.create({
    data: {
      id,
      actionType: "governance_control_create",
      decisionState: "pending",
      executionState: "not_started",
      targetType: "governance_control_scope",
      targetId: `${id}_target`,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      sourcePreviewAuditLogId: null,
      initiatorUserId: input.initiatorUserId,
      idempotencyKey: unique("idempotency"),
      requestHash: unique("hash"),
      frozenPayloadJson: {
        actionType: "governance_control_create"
      },
      evidenceJson: {
        source: "high-risk-governance-review-expiry-worker-test"
      },
      expiresAt: input.expiresAt,
      createdAt: new Date(input.expiresAt.getTime() - 30_000),
      updatedAt: new Date(input.expiresAt.getTime() - 30_000)
    }
  });
}

async function cleanup() {
  await highRiskPrisma.highRiskGovernanceReviewEvent.deleteMany({
    where: {
      OR: [
        {
          requestId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await highRiskPrisma.highRiskGovernanceReviewRequest.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          initiatorUserId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: [
        {
          targetId: {
            startsWith: targetPrefix
          }
        },
        {
          idempotencyKey: {
            startsWith: "high_risk_governance_review.expired:"
          },
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionCommunity.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
}
