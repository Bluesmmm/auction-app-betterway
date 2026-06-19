import { createHash } from "node:crypto";
import {
  Prisma,
  type AdminRole,
  type GovernanceControlScopeType,
  type GovernanceControlType,
  type PrismaClient
} from "@prisma/client";
import {
  SensitiveOperationType,
  type SensitiveOperationService
} from "../accounts/sensitive-operation.service.js";
import {
  GovernanceControlSensitiveTargetType,
  governanceControlChallengeTargetId
} from "./governance-control.service.js";

export const HIGH_RISK_GOVERNANCE_REVIEW_TTL_MS = 30 * 60 * 1000;

type AdminContext = {
  userId: string;
  role: AdminRole;
  mfaEnabled: boolean;
};

export type HighRiskGovernanceReviewActionType =
  | "governance_control_create"
  | "governance_control_lift";

export type HighRiskGovernanceReviewDecisionState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "withdrawn"
  | "invalidated";

export type HighRiskGovernanceReviewExecutionState =
  | "not_started"
  | "succeeded"
  | "failed";

export type HighRiskGovernanceReviewEventType =
  | "created"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "invalidated"
  | "execution_succeeded"
  | "execution_failed";

type HighRiskGovernanceReviewRequestRecord = {
  id: string;
  actionType: HighRiskGovernanceReviewActionType;
  decisionState: HighRiskGovernanceReviewDecisionState;
  executionState: HighRiskGovernanceReviewExecutionState;
  targetType: string;
  targetId: string;
  scopeType: GovernanceControlScopeType | null;
  scopeId: string | null;
  controlType: GovernanceControlType | null;
  sourcePreviewAuditLogId: string | null;
  initiatorUserId: string;
  reviewerUserId: string | null;
  idempotencyKey: string;
  requestHash: string;
  frozenPayloadJson: Prisma.JsonValue;
  evidenceJson: Prisma.JsonValue;
  decisionReason: string | null;
  executionErrorCode: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type HighRiskGovernanceReviewEventRecord = {
  id: string;
  requestId: string;
  eventType: HighRiskGovernanceReviewEventType;
  actorUserId: string | null;
  reason: string | null;
  errorCode: string | null;
  fromDecisionState: HighRiskGovernanceReviewDecisionState | null;
  toDecisionState: HighRiskGovernanceReviewDecisionState | null;
  fromExecutionState: HighRiskGovernanceReviewExecutionState | null;
  toExecutionState: HighRiskGovernanceReviewExecutionState | null;
  targetType: string;
  targetId: string;
  payloadSummaryJson: Prisma.JsonValue | null;
  createdAt: Date;
};

type HighRiskReviewDelegate = {
  findUnique(args: unknown): Promise<HighRiskGovernanceReviewRequestRecord | null>;
  findUniqueOrThrow(args: unknown): Promise<HighRiskGovernanceReviewRequestRecord>;
  findMany(args: unknown): Promise<HighRiskGovernanceReviewRequestRecord[]>;
  create(args: unknown): Promise<HighRiskGovernanceReviewRequestRecord>;
  update(args: unknown): Promise<HighRiskGovernanceReviewRequestRecord>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

type HighRiskReviewEventDelegate = {
  findMany(args: unknown): Promise<HighRiskGovernanceReviewEventRecord[]>;
  create(args: unknown): Promise<unknown>;
};

type HighRiskReviewDelegates = {
  highRiskGovernanceReviewRequest: HighRiskReviewDelegate;
  highRiskGovernanceReviewEvent: HighRiskReviewEventDelegate;
};

type HighRiskReviewTransactionClient = Prisma.TransactionClient &
  HighRiskReviewDelegates;

type HighRiskReviewPrismaClient = HighRiskReviewDelegates & {
  $transaction<T>(
    fn: (tx: HighRiskReviewTransactionClient) => Promise<T>
  ): Promise<T>;
};

export type HighRiskGovernanceReviewRow = {
  id: string;
  actionType: HighRiskGovernanceReviewActionType;
  decisionState: HighRiskGovernanceReviewDecisionState;
  executionState: HighRiskGovernanceReviewExecutionState;
  targetType: string;
  targetId: string;
  scopeType: GovernanceControlScopeType | null;
  scopeId: string | null;
  controlType: GovernanceControlType | null;
  sourcePreviewAuditLogId: string | null;
  initiatorUserId: string;
  reviewerUserId: string | null;
  idempotencyKey: string;
  requestHash: string;
  frozenPayloadJson: Prisma.JsonValue;
  evidenceJson: Prisma.JsonValue;
  decisionReason: string | null;
  executionErrorCode: string | null;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HighRiskGovernanceReviewEventRow = {
  id: string;
  requestId: string;
  eventType: HighRiskGovernanceReviewEventType;
  actorUserId: string | null;
  reason: string | null;
  errorCode: string | null;
  fromDecisionState: HighRiskGovernanceReviewDecisionState | null;
  toDecisionState: HighRiskGovernanceReviewDecisionState | null;
  fromExecutionState: HighRiskGovernanceReviewExecutionState | null;
  toExecutionState: HighRiskGovernanceReviewExecutionState | null;
  targetType: string;
  targetId: string;
  payloadSummaryJson: Prisma.JsonValue | null;
  createdAt: string;
};

export type HighRiskGovernanceReviewErrorCode =
  | "ADMIN_REQUIRED"
  | "MFA_REQUIRED"
  | "PLATFORM_ADMIN_REQUIRED"
  | "NO_ELIGIBLE_REVIEWER"
  | "SELF_REVIEW_FORBIDDEN"
  | "REVIEW_REQUEST_NOT_FOUND"
  | "REVIEW_REQUEST_NOT_PENDING"
  | "REASON_REQUIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "PENDING_REVIEW_ALREADY_EXISTS"
  | "PREVIEW_ALREADY_CONSUMED"
  | "GOVERNANCE_REVIEW_SCOPE_INVALID"
  | "SENSITIVE_CHALLENGE_REQUIRED"
  | "SENSITIVE_CHALLENGE_EXPIRED"
  | "SESSION_REVOKED"
  | "DEVICE_NOT_TRUSTED";

export type CreateHighRiskGovernanceReviewRequestResult =
  | {
      result: "accepted";
      review: HighRiskGovernanceReviewRow;
      replayed: boolean;
    }
  | {
      result: "rejected";
      errorCode: HighRiskGovernanceReviewErrorCode;
    };

export type HighRiskGovernanceReviewTransitionResult =
  | {
      result: "accepted";
      review: HighRiskGovernanceReviewRow;
      transitionApplied: boolean;
    }
  | {
      result: "rejected";
      errorCode: HighRiskGovernanceReviewErrorCode;
    };

export type HighRiskGovernanceReviewListResult =
  | {
      result: "accepted";
      reviews: HighRiskGovernanceReviewRow[];
    }
  | {
      result: "rejected";
      errorCode: HighRiskGovernanceReviewErrorCode;
    };

export type HighRiskGovernanceReviewDetailResult =
  | {
      result: "accepted";
      review: HighRiskGovernanceReviewRow;
      events: HighRiskGovernanceReviewEventRow[];
    }
  | {
      result: "rejected";
      errorCode: HighRiskGovernanceReviewErrorCode;
    };

export type HighRiskGovernanceReviewExpiryResult = {
  result: "accepted";
  scannedCount: number;
  expiredCount: number;
};

export type HighRiskGovernanceReviewExecutionResult =
  | {
      result: "succeeded";
      summary?: Prisma.InputJsonValue;
    }
  | {
      result: "invalidated";
      errorCode: string;
      summary?: Prisma.InputJsonValue;
    }
  | {
      result: "failed";
      errorCode: string;
      summary?: Prisma.InputJsonValue;
    };

type CreateReviewInput = {
  actorUserId: string;
  sessionId: string;
  challengeId?: string;
  actionType: HighRiskGovernanceReviewActionType;
  targetType: string;
  targetId: string;
  scopeType: GovernanceControlScopeType;
  scopeId?: string | null;
  controlType?: GovernanceControlType | null;
  sourcePreviewAuditLogId?: string | null;
  idempotencyKey: string;
  frozenPayloadJson: Prisma.InputJsonValue;
  evidenceJson: Prisma.InputJsonValue;
  now?: Date;
  expiresAt?: Date;
};

type ApproveReviewInput = {
  reviewRequestId: string;
  reviewerUserId: string;
  sessionId: string;
  challengeId?: string;
  now?: Date;
  execute: (input: {
    tx: Prisma.TransactionClient;
    review: HighRiskGovernanceReviewRow;
    now: Date;
  }) => Promise<HighRiskGovernanceReviewExecutionResult>;
};

type ReasonedTransitionInput = {
  reviewRequestId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
};

type ReviewerReasonedTransitionInput = ReasonedTransitionInput & {
  sessionId: string;
  challengeId?: string;
};

type SystemTransitionInput = {
  reviewRequestId: string;
  actorUserId?: string;
  reason?: string;
  errorCode?: string;
  now?: Date;
};

export class HighRiskGovernanceReviewService {
  private readonly reviewPrisma: HighRiskReviewPrismaClient;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sensitiveOperations?: SensitiveOperationService
  ) {
    this.reviewPrisma = prisma as unknown as HighRiskReviewPrismaClient;
  }

  async findReviewRequestByIdempotency(input: {
    initiatorUserId: string;
    actionType: HighRiskGovernanceReviewActionType;
    targetType: string;
    targetId: string;
    idempotencyKey?: string;
  }): Promise<HighRiskGovernanceReviewRow | null> {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      return null;
    }

    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        initiatorUserId_actionType_targetType_targetId_idempotencyKey: {
          initiatorUserId: input.initiatorUserId,
          actionType: input.actionType,
          targetType: input.targetType,
          targetId: input.targetId,
          idempotencyKey
        }
      }
    });
    return review ? toReviewRow(review) : null;
  }

  async listReviewRequests(input: {
    actorUserId: string;
    decisionState?: HighRiskGovernanceReviewDecisionState | "all";
    take?: number;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewListResult> {
    const context = await this.loadActiveAdminContext(input.actorUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }

    await this.expireDuePendingReviews({
      now: input.now
    });

    const decisionState = input.decisionState ?? "pending";
    const take = Math.max(1, Math.min(input.take ?? 50, 100));
    const reviews =
      await this.reviewPrisma.highRiskGovernanceReviewRequest.findMany({
        where:
          decisionState === "all"
            ? undefined
            : {
                decisionState
              },
        orderBy: [
          {
            createdAt: "desc"
          }
        ],
        take
      });

    return {
      result: "accepted",
      reviews: reviews.map(toReviewRow)
    };
  }

  async getReviewRequestDetail(input: {
    actorUserId: string;
    reviewRequestId: string;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewDetailResult> {
    const context = await this.loadActiveAdminContext(input.actorUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }

    await this.expireDuePendingReviews({
      reviewRequestId: input.reviewRequestId,
      now: input.now
    });

    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    const events = await this.reviewPrisma.highRiskGovernanceReviewEvent.findMany({
      where: {
        requestId: review.id
      },
      orderBy: [
        {
          createdAt: "asc"
        }
      ]
    });

    return {
      result: "accepted",
      review: toReviewRow(review),
      events: events.map(toReviewEventRow)
    };
  }

  async createReviewRequest(
    input: CreateReviewInput
  ): Promise<CreateHighRiskGovernanceReviewRequestResult> {
    const now = input.now ?? new Date();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const context = await this.loadActiveAdminContext(input.actorUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }
    if (!context) {
      return {
        result: "rejected",
        errorCode: "ADMIN_REQUIRED"
      };
    }

    const scope = normalizeGovernanceReviewScope(input);
    if (!scope) {
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_REVIEW_SCOPE_INVALID"
      };
    }

    const challenge = await this.authorizeGovernanceReviewChallenge({
      actorUserId: context.userId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      now
    });
    if (challenge.result === "rejected") {
      return challenge;
    }

    const eligibleReviewerUserIds = await this.listEligibleReviewerUserIds(
      context.userId
    );
    if (eligibleReviewerUserIds.length === 0) {
      return {
        result: "rejected",
        errorCode: "NO_ELIGIBLE_REVIEWER"
      };
    }

    const requestHash = createStableHash({
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      controlType: input.controlType ?? null,
      sourcePreviewAuditLogId: input.sourcePreviewAuditLogId ?? null,
      frozenPayloadJson: input.frozenPayloadJson,
      evidenceJson: input.evidenceJson
    });
    const expiresAt =
      input.expiresAt ?? new Date(now.getTime() + HIGH_RISK_GOVERNANCE_REVIEW_TTL_MS);

    try {
      return await this.reviewPrisma.$transaction(async (tx) => {
        const existing = await tx.highRiskGovernanceReviewRequest.findUnique({
          where: {
            initiatorUserId_actionType_targetType_targetId_idempotencyKey: {
              initiatorUserId: context.userId,
              actionType: input.actionType,
              targetType: input.targetType,
              targetId: input.targetId,
              idempotencyKey
            }
          }
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return {
              result: "rejected",
              errorCode: "IDEMPOTENCY_CONFLICT"
            };
          }
          return {
            result: "accepted",
            review: toReviewRow(existing),
            replayed: true
          };
        }

        if (input.sourcePreviewAuditLogId) {
          const consumedControl = await tx.governanceControl.findUnique({
            where: {
              previewAuditLogId: input.sourcePreviewAuditLogId
            },
            select: {
              id: true
            }
          });
          if (consumedControl) {
            return {
              result: "rejected",
              errorCode: "PREVIEW_ALREADY_CONSUMED"
            };
          }
        }

        const created = await tx.highRiskGovernanceReviewRequest.create({
          data: {
            actionType: input.actionType,
            decisionState: "pending",
            executionState: "not_started",
            targetType: input.targetType,
            targetId: input.targetId,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            controlType: input.controlType ?? null,
            sourcePreviewAuditLogId: input.sourcePreviewAuditLogId ?? null,
            initiatorUserId: context.userId,
            idempotencyKey,
            requestHash,
            frozenPayloadJson: input.frozenPayloadJson,
            evidenceJson: input.evidenceJson,
            expiresAt,
            createdAt: now,
            updatedAt: now
          }
        });

        await this.recordLifecycleEvent(tx, {
          review: created,
          eventType: "created",
          actorUserId: context.userId,
          toDecisionState: "pending",
          toExecutionState: "not_started",
          eligibleReviewerUserIds,
          now
        });

        return {
          result: "accepted",
          review: toReviewRow(created),
          replayed: false
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (input.sourcePreviewAuditLogId) {
          const consumedReview =
            await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
              where: {
                sourcePreviewAuditLogId: input.sourcePreviewAuditLogId
              },
              select: {
                id: true
              }
            });
          if (consumedReview) {
            return {
              result: "rejected",
              errorCode: "PREVIEW_ALREADY_CONSUMED"
            };
          }
        }
        return {
          result: "rejected",
          errorCode: "PENDING_REVIEW_ALREADY_EXISTS"
        };
      }
      throw error;
    }
  }

  async approveReviewRequest(
    input: ApproveReviewInput
  ): Promise<HighRiskGovernanceReviewTransitionResult> {
    const now = input.now ?? new Date();
    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }
    if (review.decisionState === "pending" && review.expiresAt.getTime() <= now.getTime()) {
      return this.expirePendingReview({
        reviewRequestId: review.id,
        reason: "review request expired before approval",
        now
      });
    }

    const context = await this.loadActiveAdminContext(input.reviewerUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }
    if (!context) {
      return {
        result: "rejected",
        errorCode: "ADMIN_REQUIRED"
      };
    }
    if (review.initiatorUserId === context.userId) {
      return {
        result: "rejected",
        errorCode: "SELF_REVIEW_FORBIDDEN"
      };
    }
    if (review.decisionState !== "pending") {
      return {
        result: "accepted",
        review: toReviewRow(review),
        transitionApplied: false
      };
    }

    const challenge = await this.authorizeGovernanceReviewChallenge({
      actorUserId: context.userId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      scopeType: review.scopeType,
      scopeId: review.scopeId,
      now
    });
    if (challenge.result === "rejected") {
      return challenge;
    }

    return this.reviewPrisma.$transaction(async (tx) => {
      const claim = await tx.highRiskGovernanceReviewRequest.updateMany({
        where: {
          id: review.id,
          decisionState: "pending",
          reviewerUserId: null,
          expiresAt: {
            gt: now
          }
        },
        data: {
          reviewerUserId: context.userId,
          updatedAt: now
        }
      });
      if (claim.count !== 1) {
        const current = await tx.highRiskGovernanceReviewRequest.findUnique({
          where: {
            id: review.id
          }
        });
        if (!current) {
          return {
            result: "rejected",
            errorCode: "REVIEW_REQUEST_NOT_FOUND"
          };
        }
        return {
          result: "accepted",
          review: toReviewRow(current),
          transitionApplied: false
        };
      }

      const claimed = await tx.highRiskGovernanceReviewRequest.findUniqueOrThrow({
        where: {
          id: review.id
        }
      });
      const execution = await input.execute({
        tx,
        review: toReviewRow(claimed),
        now
      });
      if (execution.result === "invalidated") {
        const invalidated = await tx.highRiskGovernanceReviewRequest.update({
          where: {
            id: review.id
          },
          data: {
            decisionState: "invalidated",
            executionState: "not_started",
            decidedAt: now,
            updatedAt: now
          }
        });
        await this.recordLifecycleEvent(tx, {
          review: invalidated,
          eventType: "invalidated",
          actorUserId: context.userId,
          errorCode: execution.errorCode,
          fromDecisionState: "pending",
          toDecisionState: "invalidated",
          fromExecutionState: "not_started",
          toExecutionState: "not_started",
          payloadSummaryJson: execution.summary,
          now
        });

        return {
          result: "accepted",
          review: toReviewRow(invalidated),
          transitionApplied: true
        };
      }

      const executionState: HighRiskGovernanceReviewExecutionState =
        execution.result === "succeeded" ? "succeeded" : "failed";
      const executionEvent: HighRiskGovernanceReviewEventType =
        execution.result === "succeeded" ? "execution_succeeded" : "execution_failed";
      const executionErrorCode =
        execution.result === "failed" ? execution.errorCode : null;

      const updated = await tx.highRiskGovernanceReviewRequest.update({
        where: {
          id: review.id
        },
        data: {
          decisionState: "approved",
          executionState,
          executionErrorCode,
          decidedAt: now,
          executedAt: now,
          updatedAt: now
        }
      });

      await this.recordLifecycleEvent(tx, {
        review: updated,
        eventType: "approved",
        actorUserId: context.userId,
        fromDecisionState: "pending",
        toDecisionState: "approved",
        fromExecutionState: "not_started",
        toExecutionState: "not_started",
        now
      });
      await this.recordLifecycleEvent(tx, {
        review: updated,
        eventType: executionEvent,
        actorUserId: context.userId,
        errorCode: executionErrorCode,
        fromDecisionState: "approved",
        toDecisionState: "approved",
        fromExecutionState: "not_started",
        toExecutionState: executionState,
        payloadSummaryJson: execution.summary,
        now
      });

      return {
        result: "accepted",
        review: toReviewRow(updated),
        transitionApplied: true
      };
    });
  }

  async rejectReviewRequest(
    input: ReviewerReasonedTransitionInput
  ): Promise<HighRiskGovernanceReviewTransitionResult> {
    const reason = input.reason.trim();
    if (!reason) {
      return {
        result: "rejected",
        errorCode: "REASON_REQUIRED"
      };
    }
    return this.reviewerDecisionTransition({
      ...input,
      reason,
      decisionState: "rejected",
      eventType: "rejected"
    });
  }

  async withdrawReviewRequest(
    input: ReasonedTransitionInput
  ): Promise<HighRiskGovernanceReviewTransitionResult> {
    const reason = input.reason.trim();
    if (!reason) {
      return {
        result: "rejected",
        errorCode: "REASON_REQUIRED"
      };
    }
    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }
    const context = await this.loadActiveAdminContext(input.actorUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }
    if (!context || review.initiatorUserId !== context.userId) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }
    return this.transitionPendingDecision({
      review,
      actorUserId: context.userId,
      decisionState: "withdrawn",
      eventType: "withdrawn",
      reason,
      now: input.now ?? new Date()
    });
  }

  async expirePendingReview(
    input: SystemTransitionInput
  ): Promise<HighRiskGovernanceReviewTransitionResult> {
    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }
    return this.transitionPendingDecision({
      review,
      actorUserId: input.actorUserId,
      decisionState: "expired",
      eventType: "expired",
      reason: input.reason,
      errorCode: input.errorCode,
      now: input.now ?? new Date()
    });
  }

  async expireDuePendingReviews(input: {
    now?: Date;
    limit?: number;
    reviewRequestId?: string;
  } = {}): Promise<HighRiskGovernanceReviewExpiryResult> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const reviews = await this.reviewPrisma.highRiskGovernanceReviewRequest.findMany({
      where: {
        decisionState: "pending",
        expiresAt: {
          lte: now
        },
        ...(input.reviewRequestId
          ? {
              id: input.reviewRequestId
            }
          : {})
      },
      orderBy: [
        {
          expiresAt: "asc"
        }
      ],
      take: limit
    });

    let expiredCount = 0;
    for (const review of reviews) {
      const expired = await this.transitionPendingDecision({
        review,
        decisionState: "expired",
        eventType: "expired",
        reason: "review request expired",
        now
      });
      if (expired.result === "accepted" && expired.transitionApplied) {
        expiredCount += 1;
      }
    }

    return {
      result: "accepted",
      scannedCount: reviews.length,
      expiredCount
    };
  }

  async invalidatePendingReview(
    input: SystemTransitionInput
  ): Promise<HighRiskGovernanceReviewTransitionResult> {
    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }
    return this.transitionPendingDecision({
      review,
      actorUserId: input.actorUserId,
      decisionState: "invalidated",
      eventType: "invalidated",
      reason: input.reason,
      errorCode: input.errorCode,
      now: input.now ?? new Date()
    });
  }

  private async reviewerDecisionTransition(input: ReviewerReasonedTransitionInput & {
    decisionState: "rejected";
    eventType: "rejected";
  }): Promise<HighRiskGovernanceReviewTransitionResult> {
    const now = input.now ?? new Date();
    const review = await this.reviewPrisma.highRiskGovernanceReviewRequest.findUnique({
      where: {
        id: input.reviewRequestId
      }
    });
    if (!review) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }
    if (review.decisionState === "pending" && review.expiresAt.getTime() <= now.getTime()) {
      return this.expirePendingReview({
        reviewRequestId: review.id,
        reason: "review request expired before rejection",
        now
      });
    }

    const context = await this.loadActiveAdminContext(input.actorUserId);
    const adminCheck = requirePlatformAdmin(context);
    if (adminCheck.result === "rejected") {
      return adminCheck;
    }
    if (!context) {
      return {
        result: "rejected",
        errorCode: "ADMIN_REQUIRED"
      };
    }
    if (review.initiatorUserId === context.userId) {
      return {
        result: "rejected",
        errorCode: "SELF_REVIEW_FORBIDDEN"
      };
    }
    if (review.decisionState !== "pending") {
      return {
        result: "accepted",
        review: toReviewRow(review),
        transitionApplied: false
      };
    }

    const challenge = await this.authorizeGovernanceReviewChallenge({
      actorUserId: context.userId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      scopeType: review.scopeType,
      scopeId: review.scopeId,
      now
    });
    if (challenge.result === "rejected") {
      return challenge;
    }

    return this.transitionPendingDecision({
      review,
      actorUserId: context.userId,
      reviewerUserId: context.userId,
      decisionState: input.decisionState,
      eventType: input.eventType,
      reason: input.reason,
      now
    });
  }

  private async transitionPendingDecision(input: {
    review: HighRiskGovernanceReviewRequestRecord;
    actorUserId?: string;
    reviewerUserId?: string;
    decisionState: Exclude<HighRiskGovernanceReviewDecisionState, "pending" | "approved">;
    eventType: Exclude<
      HighRiskGovernanceReviewEventType,
      "created" | "approved" | "execution_succeeded" | "execution_failed"
    >;
    reason?: string;
    errorCode?: string;
    now: Date;
  }): Promise<HighRiskGovernanceReviewTransitionResult> {
    return this.reviewPrisma.$transaction(async (tx) => {
      const transition = await tx.highRiskGovernanceReviewRequest.updateMany({
        where: {
          id: input.review.id,
          decisionState: "pending"
        },
        data: {
          decisionState: input.decisionState,
          reviewerUserId: input.reviewerUserId,
          decisionReason: input.reason ?? null,
          decidedAt: input.now,
          updatedAt: input.now
        }
      });
      if (transition.count !== 1) {
        const current = await tx.highRiskGovernanceReviewRequest.findUnique({
          where: {
            id: input.review.id
          }
        });
        if (!current) {
          return {
            result: "rejected",
            errorCode: "REVIEW_REQUEST_NOT_FOUND"
          };
        }
        return {
          result: "accepted",
          review: toReviewRow(current),
          transitionApplied: false
        };
      }

      const updated = await tx.highRiskGovernanceReviewRequest.findUniqueOrThrow({
        where: {
          id: input.review.id
        }
      });
      await this.recordLifecycleEvent(tx, {
        review: updated,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        reason: input.reason,
        errorCode: input.errorCode,
        fromDecisionState: "pending",
        toDecisionState: input.decisionState,
        fromExecutionState: "not_started",
        toExecutionState: "not_started",
        now: input.now
      });

      return {
        result: "accepted",
        review: toReviewRow(updated),
        transitionApplied: true
      };
    });
  }

  private async recordLifecycleEvent(
    tx: HighRiskReviewTransactionClient,
    input: {
      review: HighRiskGovernanceReviewRequestRecord;
      eventType: HighRiskGovernanceReviewEventType;
      actorUserId?: string;
      reason?: string;
      errorCode?: string | null;
      fromDecisionState?: HighRiskGovernanceReviewDecisionState;
      toDecisionState?: HighRiskGovernanceReviewDecisionState;
      fromExecutionState?: HighRiskGovernanceReviewExecutionState;
      toExecutionState?: HighRiskGovernanceReviewExecutionState;
      payloadSummaryJson?: Prisma.InputJsonValue;
      eligibleReviewerUserIds?: string[];
      now: Date;
    }
  ) {
    await tx.highRiskGovernanceReviewEvent.create({
      data: {
        requestId: input.review.id,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
        errorCode: input.errorCode ?? null,
        fromDecisionState: input.fromDecisionState ?? null,
        toDecisionState: input.toDecisionState ?? null,
        fromExecutionState: input.fromExecutionState ?? null,
        toExecutionState: input.toExecutionState ?? null,
        targetType: input.review.targetType,
        targetId: input.review.targetId,
        payloadSummaryJson: input.payloadSummaryJson ?? Prisma.JsonNull,
        createdAt: input.now
      }
    });
    await tx.outboxEvent.create({
      data: {
        eventType: `high_risk_governance_review.${input.eventType}`,
        targetType: "high_risk_governance_review_request",
        targetId: input.review.id,
        idempotencyKey: `high_risk_governance_review.${input.eventType}:${input.review.id}`,
        payloadJson: {
          reviewRequestId: input.review.id,
          actionType: input.review.actionType,
          decisionState: input.toDecisionState ?? input.review.decisionState,
          executionState: input.toExecutionState ?? input.review.executionState,
          targetType: input.review.targetType,
          targetId: input.review.targetId,
          scopeType: input.review.scopeType,
          scopeId: input.review.scopeId,
          controlType: input.review.controlType,
          initiatorUserId: input.review.initiatorUserId,
          reviewerUserId: input.review.reviewerUserId,
          eligibleReviewerUserIds: input.eligibleReviewerUserIds ?? [],
          actorUserId: input.actorUserId ?? null,
          reason: input.reason ?? null,
          errorCode: input.errorCode ?? null
        },
        availableAt: input.now,
        createdAt: input.now
      }
    });
  }

  private async authorizeGovernanceReviewChallenge(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    scopeType: GovernanceControlScopeType | null;
    scopeId: string | null;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | { result: "rejected"; errorCode: HighRiskGovernanceReviewErrorCode }
  > {
    if (!this.sensitiveOperations || !input.challengeId || !input.scopeType) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }
    const challenge = await this.sensitiveOperations.authorizeFreshChallenge({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      operationType: SensitiveOperationType.manageGovernanceControl,
      targetType: GovernanceControlSensitiveTargetType,
      targetId: governanceControlChallengeTargetId({
        scopeType: input.scopeType,
        scopeId: input.scopeId
      }),
      now: input.now
    });
    if (challenge.result === "accepted") {
      return challenge;
    }

    return {
      result: "rejected",
      errorCode: challenge.errorCode
    };
  }

  private async loadActiveAdminContext(userId: string): Promise<AdminContext | null> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId,
        status: "active",
        user: {
          status: "active"
        }
      },
      select: {
        userId: true,
        role: true,
        mfaEnabled: true
      }
    });
    return admin
      ? {
          userId: admin.userId,
          role: admin.role,
          mfaEnabled: admin.mfaEnabled
        }
      : null;
  }

  private async listEligibleReviewerUserIds(
    initiatorUserId: string
  ): Promise<string[]> {
    const admins = await this.prisma.adminProfile.findMany({
      where: {
        userId: {
          not: initiatorUserId
        },
        role: "platform_admin",
        status: "active",
        mfaEnabled: true,
        user: {
          status: "active"
        }
      },
      select: {
        userId: true
      }
    });
    return admins.map((admin) => admin.userId);
  }
}

function requirePlatformAdmin(
  context: AdminContext | null
):
  | { result: "accepted" }
  | { result: "rejected"; errorCode: HighRiskGovernanceReviewErrorCode } {
  if (!context) {
    return {
      result: "rejected",
      errorCode: "ADMIN_REQUIRED"
    };
  }
  if (!context.mfaEnabled) {
    return {
      result: "rejected",
      errorCode: "MFA_REQUIRED"
    };
  }
  if (context.role !== "platform_admin") {
    return {
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    };
  }
  return {
    result: "accepted"
  };
}

function normalizeGovernanceReviewScope(input: {
  scopeType: GovernanceControlScopeType;
  scopeId?: string | null;
}): { scopeType: GovernanceControlScopeType; scopeId: string | null } | null {
  if (input.scopeType === "platform") {
    return {
      scopeType: "platform",
      scopeId: null
    };
  }

  const scopeId = input.scopeId?.trim();
  if (!scopeId) {
    return null;
  }
  return {
    scopeType: "community",
    scopeId
  };
}

function toReviewRow(
  review: HighRiskGovernanceReviewRequestRecord
): HighRiskGovernanceReviewRow {
  return {
    id: review.id,
    actionType: review.actionType,
    decisionState: review.decisionState,
    executionState: review.executionState,
    targetType: review.targetType,
    targetId: review.targetId,
    scopeType: review.scopeType,
    scopeId: review.scopeId,
    controlType: review.controlType,
    sourcePreviewAuditLogId: review.sourcePreviewAuditLogId,
    initiatorUserId: review.initiatorUserId,
    reviewerUserId: review.reviewerUserId,
    idempotencyKey: review.idempotencyKey,
    requestHash: review.requestHash,
    frozenPayloadJson: review.frozenPayloadJson,
    evidenceJson: review.evidenceJson,
    decisionReason: review.decisionReason,
    executionErrorCode: review.executionErrorCode,
    expiresAt: review.expiresAt.toISOString(),
    decidedAt: review.decidedAt?.toISOString() ?? null,
    executedAt: review.executedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString()
  };
}

function toReviewEventRow(
  event: HighRiskGovernanceReviewEventRecord
): HighRiskGovernanceReviewEventRow {
  return {
    id: event.id,
    requestId: event.requestId,
    eventType: event.eventType,
    actorUserId: event.actorUserId,
    reason: event.reason,
    errorCode: event.errorCode,
    fromDecisionState: event.fromDecisionState,
    toDecisionState: event.toDecisionState,
    fromExecutionState: event.fromExecutionState,
    toExecutionState: event.toExecutionState,
    targetType: event.targetType,
    targetId: event.targetId,
    payloadSummaryJson: event.payloadSummaryJson,
    createdAt: event.createdAt.toISOString()
  };
}

function createStableHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
