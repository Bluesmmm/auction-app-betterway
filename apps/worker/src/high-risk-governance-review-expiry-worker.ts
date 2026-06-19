import { Prisma, type PrismaClient } from "@prisma/client";
import { runPeriodicTask } from "./periodic-task.js";

export type HighRiskGovernanceReviewExpiryScanResult = {
  result: "scanned";
  scannedCount: number;
  expiredCount: number;
};

export type PeriodicHighRiskGovernanceReviewExpiryScannerHandle = {
  stop(): Promise<void>;
};

type HighRiskReviewRequestRecord = {
  id: string;
  actionType: string;
  decisionState: string;
  executionState: string;
  targetType: string;
  targetId: string;
  scopeType: string | null;
  scopeId: string | null;
  controlType: string | null;
  initiatorUserId: string;
  reviewerUserId: string | null;
  expiresAt: Date;
};

type HighRiskReviewDelegate = {
  findMany(args: unknown): Promise<HighRiskReviewRequestRecord[]>;
  findUniqueOrThrow(args: unknown): Promise<HighRiskReviewRequestRecord>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

type HighRiskReviewEventDelegate = {
  create(args: unknown): Promise<unknown>;
};

type HighRiskReviewPrismaClient = PrismaClient & {
  highRiskGovernanceReviewRequest: HighRiskReviewDelegate;
  highRiskGovernanceReviewEvent: HighRiskReviewEventDelegate;
};

type HighRiskReviewTransactionClient = Prisma.TransactionClient & {
  highRiskGovernanceReviewRequest: HighRiskReviewDelegate;
  highRiskGovernanceReviewEvent: HighRiskReviewEventDelegate;
};

export async function scanExpiredHighRiskGovernanceReviews(input: {
  prisma: PrismaClient;
  now?: Date;
  limit?: number;
}): Promise<HighRiskGovernanceReviewExpiryScanResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const prisma = input.prisma as HighRiskReviewPrismaClient;
  const reviews = await prisma.highRiskGovernanceReviewRequest.findMany({
    where: {
      decisionState: "pending",
      expiresAt: {
        lte: now
      }
    },
    orderBy: [
      {
        expiresAt: "asc"
      },
      {
        id: "asc"
      }
    ],
    take: limit
  });

  let expiredCount = 0;
  for (const review of reviews) {
    const expired = await expirePendingReview(prisma, {
      review,
      now
    });
    if (expired) {
      expiredCount += 1;
    }
  }

  return {
    result: "scanned",
    scannedCount: reviews.length,
    expiredCount
  };
}

export function startPeriodicHighRiskGovernanceReviewExpiryScanner(input: {
  prisma: PrismaClient;
  intervalMs: number;
  limit?: number;
}): PeriodicHighRiskGovernanceReviewExpiryScannerHandle {
  const interval = setInterval(() => {
    runPeriodicTask({
      taskName: "high_risk_governance_review_expiry_scan",
      run: () =>
        scanExpiredHighRiskGovernanceReviews({
          prisma: input.prisma,
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

async function expirePendingReview(
  prisma: HighRiskReviewPrismaClient,
  input: {
    review: HighRiskReviewRequestRecord;
    now: Date;
  }
) {
  return prisma.$transaction(async (tx) => {
    const highRiskTx = tx as HighRiskReviewTransactionClient;
    const transition =
      await highRiskTx.highRiskGovernanceReviewRequest.updateMany({
        where: {
          id: input.review.id,
          decisionState: "pending",
          expiresAt: {
            lte: input.now
          }
        },
        data: {
          decisionState: "expired",
          decisionReason: "review request expired",
          decidedAt: input.now,
          updatedAt: input.now
        }
      });
    if (transition.count !== 1) {
      return false;
    }

    const updated =
      await highRiskTx.highRiskGovernanceReviewRequest.findUniqueOrThrow({
        where: {
          id: input.review.id
        }
      });
    await highRiskTx.highRiskGovernanceReviewEvent.create({
      data: {
        requestId: updated.id,
        eventType: "expired",
        actorUserId: null,
        reason: "review request expired",
        errorCode: null,
        fromDecisionState: "pending",
        toDecisionState: "expired",
        fromExecutionState: "not_started",
        toExecutionState: "not_started",
        targetType: updated.targetType,
        targetId: updated.targetId,
        payloadSummaryJson: Prisma.JsonNull,
        createdAt: input.now
      }
    });
    await highRiskTx.outboxEvent.create({
      data: {
        eventType: "high_risk_governance_review.expired",
        targetType: "high_risk_governance_review_request",
        targetId: updated.id,
        idempotencyKey: `high_risk_governance_review.expired:${updated.id}`,
        payloadJson: {
          reviewRequestId: updated.id,
          actionType: updated.actionType,
          decisionState: "expired",
          executionState: updated.executionState,
          targetType: updated.targetType,
          targetId: updated.targetId,
          scopeType: updated.scopeType,
          scopeId: updated.scopeId,
          controlType: updated.controlType,
          initiatorUserId: updated.initiatorUserId,
          reviewerUserId: updated.reviewerUserId,
          actorUserId: null,
          reason: "review request expired",
          errorCode: null
        },
        availableAt: input.now,
        createdAt: input.now
      }
    });

    return true;
  });
}
