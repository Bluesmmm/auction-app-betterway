import {
  Prisma,
  type AdminRole,
  type GovernanceControl,
  type GovernanceControlScopeType,
  type GovernanceControlType,
  type PrismaClient
} from "@prisma/client";
import {
  SensitiveOperationType,
  type SensitiveOperationService
} from "../accounts/sensitive-operation.service.js";
import {
  HighRiskAdminOperation,
  type HighRiskAdminOperation as HighRiskAdminOperationValue
} from "../admin-security/admin-security.service.js";
import {
  GovernanceControlSensitiveTargetType,
  governanceControlChallengeTargetId
} from "./governance-control.service.js";
import {
  type HighRiskGovernanceReviewActionType,
  type HighRiskGovernanceReviewDecisionState,
  type HighRiskGovernanceReviewDetailResult,
  type HighRiskGovernanceReviewExecutionResult,
  type HighRiskGovernanceReviewListResult,
  type HighRiskGovernanceReviewRow,
  type HighRiskGovernanceReviewService,
  type HighRiskGovernanceReviewTransitionResult
} from "./high-risk-governance-review.service.js";

export type Stage8AdminOperation = HighRiskAdminOperationValue;

export type Stage8GovernanceOverviewResult =
  | {
      result: "accepted";
      adminScope: {
        role: AdminRole;
        platformWide: boolean;
        communityIds: string[];
        mfaEnabled: boolean;
      };
      queueSummary: {
        pendingCommunityRequests: number;
        pendingMemberReviews: number;
        contentReviewTasks: number;
        pendingAppeals: number;
        platformAppeals: number;
        unreadHighPriorityNotifications: number;
      };
      systemSummary: {
        pendingOutboxEvents: number;
        failedOutboxEvents: number;
        latestLedgerCheck:
          | {
              id: string;
              status: string;
              ledgerDiffCount: number;
              startedAt: string;
              finishedAt: string | null;
            }
          | null;
      };
      pilotMetrics: {
        activeCommunities: number;
        activeMembers: number;
        activeAuctions: number;
        pendingGuardianTransactions: number;
      };
      recentAuditLogs: Array<{
        id: string;
        action: string;
        targetType: string;
        targetId: string;
        reason: string | null;
        createdAt: string;
      }>;
    }
  | {
      result: "rejected";
      errorCode:
        | "ADMIN_REQUIRED"
        | "COMMUNITY_ADMIN_SCOPE_REQUIRED"
        | "COMMUNITY_SCOPE_FORBIDDEN";
    };

export type Stage8AdminOperationPreviewResult =
  | {
      result: "accepted";
      previewId: string;
      operation: Stage8AdminOperation;
      targetType: string;
      targetId: string;
      communityId: string | null;
      impactSummary: Stage8ImpactSummary;
      confirmationRequired: true;
      expiresAt: string;
      mutatesBusinessState: false;
    }
  | {
      result: "rejected";
      errorCode:
        | "ADMIN_REQUIRED"
        | "MFA_REQUIRED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "COMMUNITY_ADMIN_SCOPE_REQUIRED"
        | "COMMUNITY_SCOPE_FORBIDDEN"
        | "TARGET_NOT_FOUND"
        | "OPERATION_NOT_SUPPORTED";
    };

export type Stage8ImpactSummary = {
  operation: Stage8AdminOperation;
  targetType: string;
  targetId: string;
  communityId: string | null;
  counts: Record<string, number>;
  warnings: string[];
};

export type Stage8GovernanceControlImpactSummary = {
  scopeType: GovernanceControlScopeType;
  scopeId: string | null;
  controlType: GovernanceControlType;
  counts: {
    activeAuctionCount: number;
    activeHoldCount: number;
    pendingTransactionCount: number;
    manualReviewTaskCount: number;
  };
  blockedActions: string[];
  warnings: string[];
};

export type Stage8GovernanceControlPreviewResult =
  | {
      result: "accepted";
      previewId: string;
      scopeType: GovernanceControlScopeType;
      scopeId: string | null;
      controlType: GovernanceControlType;
      impactSummary: Stage8GovernanceControlImpactSummary;
      confirmationRequired: true;
      expiresAt: string;
      mutatesBusinessState: false;
    }
  | {
      result: "rejected";
      errorCode: Stage8GovernanceControlErrorCode;
    };

export type Stage8GovernanceControlMutationResult =
  | {
      result: "accepted";
      control: Stage8GovernanceControlRow;
    }
  | {
      result: "pending_review";
      review: HighRiskGovernanceReviewRow;
    }
  | {
      result: "rejected";
      errorCode: Stage8GovernanceControlErrorCode;
    };

export type Stage8GovernanceControlListResult =
  | {
      result: "accepted";
      controls: Stage8GovernanceControlRow[];
    }
  | {
      result: "rejected";
      errorCode: Stage8GovernanceControlErrorCode;
    };

export type Stage8GovernanceControlRow = {
  id: string;
  scopeType: GovernanceControlScopeType;
  scopeId: string | null;
  controlType: GovernanceControlType;
  status: string;
  effective: boolean;
  reason: string;
  createdByUserId: string;
  liftedByUserId: string | null;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftReason: string | null;
  previewAuditLogId: string;
};

export type Stage8GovernanceControlErrorCode =
  | "ADMIN_REQUIRED"
  | "MFA_REQUIRED"
  | "PLATFORM_ADMIN_REQUIRED"
  | "COMMUNITY_ADMIN_SCOPE_REQUIRED"
  | "COMMUNITY_SCOPE_FORBIDDEN"
  | "CONTROL_TYPE_FORBIDDEN"
  | "GOVERNANCE_CONTROL_SCOPE_INVALID"
  | "GOVERNANCE_CONTROL_ALREADY_ACTIVE"
  | "GOVERNANCE_CONTROL_NOT_FOUND"
  | "GOVERNANCE_CONTROL_NOT_ACTIVE"
  | "PREVIEW_REQUIRED"
  | "PREVIEW_NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_SCOPE_MISMATCH"
  | "PREVIEW_ALREADY_CONSUMED"
  | "REASON_REQUIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "PENDING_REVIEW_ALREADY_EXISTS"
  | "NO_ELIGIBLE_REVIEWER"
  | "GOVERNANCE_CONTROL_ENDS_AT_INVALID"
  | "SENSITIVE_CHALLENGE_REQUIRED"
  | "SENSITIVE_CHALLENGE_EXPIRED"
  | "SESSION_REVOKED"
  | "DEVICE_NOT_TRUSTED";

type AdminContext = {
  userId: string;
  adminProfileId: string;
  role: AdminRole;
  mfaEnabled: boolean;
  communityIds: string[];
};

type ValidatedGovernanceControlPreview = {
  result: "accepted";
  evidenceJson: Prisma.InputJsonValue;
  expiresAt: Date;
};

const platformOnlyOperations = new Set<Stage8AdminOperation>([
  HighRiskAdminOperation.exportChildData,
  HighRiskAdminOperation.adjustPoints,
  HighRiskAdminOperation.pauseCommunity
]);

export class Stage8GovernanceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sensitiveOperations?: SensitiveOperationService,
    private readonly highRiskGovernanceReview?: HighRiskGovernanceReviewService
  ) {}

  async getGovernanceOverview(input: {
    actorUserId: string;
    communityId?: string;
  }): Promise<Stage8GovernanceOverviewResult> {
    const context = await this.loadAdminContext(input.actorUserId);
    if (!context) {
      return {
        result: "rejected",
        errorCode: "ADMIN_REQUIRED"
      };
    }

    const scope = resolveCommunityScope(context, input.communityId);
    if (scope.result === "rejected") {
      return scope;
    }

    const communityWhere = communityWhereForScope(scope.communityIds);
    const platformWide = context.role === "platform_admin" && !input.communityId;
    const [
      pendingCommunityRequests,
      pendingMemberReviews,
      contentReviewTasks,
      pendingAppeals,
      platformAppeals,
      unreadHighPriorityNotifications,
      pendingOutboxEvents,
      failedOutboxEvents,
      latestLedgerCheck,
      activeCommunities,
      activeMembers,
      activeAuctions,
      pendingGuardianTransactions,
      recentAuditLogs
    ] = await Promise.all([
      platformWide
        ? this.prisma.communityCreationRequest.count({
            where: {
              status: "pending_review"
            }
          })
        : 0,
      this.prisma.communityMember.count({
        where: {
          status: "pending_admin",
          ...(communityWhere ? { communityId: communityWhere } : {})
        }
      }),
      platformWide
        ? this.prisma.moderationTask.count({
            where: {
              status: {
                in: ["pending", "processing", "needs_manual_review", "escalated"]
              }
            }
          })
        : 0,
      this.prisma.appeal.count({
        where: {
          status: "pending_activity_admin",
          ...(communityWhere ? { communityId: communityWhere } : {})
        }
      }),
      this.prisma.appeal.count({
        where: {
          status: "escalated_platform",
          ...(communityWhere ? { communityId: communityWhere } : {})
        }
      }),
      this.prisma.notification.count({
        where: {
          recipientUserId: context.userId,
          readAt: null,
          priority: {
            in: ["high", "urgent"]
          }
        }
      }),
      platformWide
        ? this.prisma.outboxEvent.count({
            where: {
              status: {
                in: ["pending", "processing"]
              }
            }
          })
        : 0,
      platformWide
        ? this.prisma.outboxEvent.count({
            where: {
              status: "failed"
            }
          })
        : 0,
      this.prisma.ledgerCheckRun.findFirst({
        orderBy: {
          startedAt: "desc"
        },
        select: {
          id: true,
          status: true,
          ledgerDiffCount: true,
          startedAt: true,
          finishedAt: true
        }
      }),
      this.prisma.auctionCommunity.count({
        where: {
          status: "active",
          ...(scope.communityIds.length
            ? {
                id: {
                  in: scope.communityIds
                }
              }
            : {})
        }
      }),
      this.prisma.communityMember.count({
        where: {
          status: "active",
          ...(communityWhere ? { communityId: communityWhere } : {})
        }
      }),
      this.prisma.auctionSession.count({
        where: {
          status: "active",
          ...(communityWhere
            ? {
                item: {
                  communityId: communityWhere
                }
              }
            : {})
        }
      }),
      this.prisma.transaction.count({
        where: {
          status: "pending_guardian_confirm",
          ...(communityWhere
            ? {
                auctionSession: {
                  item: {
                    communityId: communityWhere
                  }
                }
              }
            : {})
        }
      }),
      this.prisma.auditLog.findMany({
        where:
          context.role === "platform_admin"
            ? undefined
            : {
                OR: [
                  {
                    actorUserId: context.userId
                  },
                  {
                    targetType: "auction_community",
                    targetId: {
                      in: scope.communityIds
                    }
                  }
                ]
              },
        orderBy: {
          createdAt: "desc"
        },
        take: 5,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          reason: true,
          createdAt: true
        }
      })
    ]);

    return {
      result: "accepted",
      adminScope: {
        role: context.role,
        platformWide,
        communityIds: scope.communityIds,
        mfaEnabled: context.mfaEnabled
      },
      queueSummary: {
        pendingCommunityRequests,
        pendingMemberReviews,
        contentReviewTasks,
        pendingAppeals,
        platformAppeals,
        unreadHighPriorityNotifications
      },
      systemSummary: {
        pendingOutboxEvents,
        failedOutboxEvents,
        latestLedgerCheck: latestLedgerCheck
          ? {
              id: latestLedgerCheck.id,
              status: latestLedgerCheck.status,
              ledgerDiffCount: latestLedgerCheck.ledgerDiffCount,
              startedAt: latestLedgerCheck.startedAt.toISOString(),
              finishedAt: latestLedgerCheck.finishedAt?.toISOString() ?? null
            }
          : null
      },
      pilotMetrics: {
        activeCommunities,
        activeMembers,
        activeAuctions,
        pendingGuardianTransactions
      },
      recentAuditLogs: recentAuditLogs.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }

  async createAdminOperationPreview(input: {
    actorUserId: string;
    operation: Stage8AdminOperation;
    targetType: string;
    targetId: string;
    communityId?: string;
    reason?: string;
    now?: Date;
  }): Promise<Stage8AdminOperationPreviewResult> {
    const context = await this.loadAdminContext(input.actorUserId);
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
    if (
      platformOnlyOperations.has(input.operation) &&
      context.role !== "platform_admin"
    ) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const communityId = await this.resolveTargetCommunityId(input);
    if (communityId === "TARGET_NOT_FOUND") {
      return {
        result: "rejected",
        errorCode: "TARGET_NOT_FOUND"
      };
    }
    const scope = resolveCommunityScope(context, communityId ?? input.communityId);
    if (scope.result === "rejected") {
      return scope;
    }

    const impactSummary = await this.buildImpactSummary({
      operation: input.operation,
      targetType: input.targetType,
      targetId: input.targetId,
      communityId: communityId ?? input.communityId ?? null
    });
    if (!impactSummary) {
      return {
        result: "rejected",
        errorCode: "OPERATION_NOT_SUPPORTED"
      };
    }

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    const audit = await this.prisma.auditLog.create({
      data: {
        actorUserId: context.userId,
        action: "stage8.admin_operation_preview",
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason ?? null,
        beforeJson: Prisma.JsonNull,
        afterJson: {
          operation: input.operation,
          communityId: impactSummary.communityId,
          impactSummary,
          confirmationRequired: true,
          expiresAt: expiresAt.toISOString(),
          mutatesBusinessState: false
        } as Prisma.InputJsonValue,
        createdAt: now
      }
    });

    return {
      result: "accepted",
      previewId: audit.id,
      operation: input.operation,
      targetType: input.targetType,
      targetId: input.targetId,
      communityId: impactSummary.communityId,
      impactSummary,
      confirmationRequired: true,
      expiresAt: expiresAt.toISOString(),
      mutatesBusinessState: false
    };
  }

  async listGovernanceControls(input: {
    actorUserId: string;
    communityId?: string;
    now?: Date;
  }): Promise<Stage8GovernanceControlListResult> {
    const now = input.now ?? new Date();
    const context = await this.loadAdminContext(input.actorUserId);
    if (!context) {
      return {
        result: "rejected",
        errorCode: "ADMIN_REQUIRED"
      };
    }

    const scope = resolveCommunityScope(context, input.communityId);
    if (scope.result === "rejected") {
      return scope;
    }

    const controls = await this.prisma.governanceControl.findMany({
      where:
        context.role === "platform_admin" && !input.communityId
          ? undefined
          : {
              OR: [
                ...scope.communityIds.map((communityId) => ({
                  scopeType: "community" as const,
                  scopeId: communityId
                }))
              ]
            },
      orderBy: {
        createdAt: "desc"
      },
      take: 50
    });

    return {
      result: "accepted",
      controls: controls.map((control) => toGovernanceControlRow(control, now))
    };
  }

  async createGovernanceControlPreview(input: {
    actorUserId: string;
    scopeType: GovernanceControlScopeType;
    scopeId?: string | null;
    controlType: GovernanceControlType;
    reason?: string;
    now?: Date;
  }): Promise<Stage8GovernanceControlPreviewResult> {
    const now = input.now ?? new Date();
    const context = await this.loadAdminContext(input.actorUserId);
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

    const normalized = normalizeGovernanceControlScope(input);
    if (!normalized) {
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_SCOPE_INVALID"
      };
    }

    const authorization = await this.authorizeGovernanceControlManagement({
      context,
      ...normalized,
      controlType: input.controlType
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const impactSummary = await this.buildGovernanceControlImpact({
      ...normalized,
      controlType: input.controlType
    });
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    const audit = await this.prisma.auditLog.create({
      data: {
        actorUserId: context.userId,
        action: "stage8.governance_control_preview",
        targetType: GovernanceControlSensitiveTargetType,
        targetId: governanceControlChallengeTargetId(normalized),
        reason: input.reason ?? null,
        beforeJson: Prisma.JsonNull,
        afterJson: {
          scopeType: normalized.scopeType,
          scopeId: normalized.scopeId,
          controlType: input.controlType,
          impactSummary,
          confirmationRequired: true,
          expiresAt: expiresAt.toISOString(),
          mutatesBusinessState: false
        } as Prisma.InputJsonValue,
        createdAt: now
      }
    });

    return {
      result: "accepted",
      previewId: audit.id,
      scopeType: normalized.scopeType,
      scopeId: normalized.scopeId,
      controlType: input.controlType,
      impactSummary,
      confirmationRequired: true,
      expiresAt: expiresAt.toISOString(),
      mutatesBusinessState: false
    };
  }

  async createGovernanceControl(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    idempotencyKey?: string;
    previewId?: string;
    scopeType: GovernanceControlScopeType;
    scopeId?: string | null;
    controlType: GovernanceControlType;
    reason?: string;
    endsAt?: Date | null;
    now?: Date;
  }): Promise<Stage8GovernanceControlMutationResult> {
    const now = input.now ?? new Date();
    if (
      input.endsAt &&
      (!Number.isFinite(input.endsAt.getTime()) ||
        input.endsAt.getTime() <= now.getTime())
    ) {
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_ENDS_AT_INVALID"
      };
    }

    const context = await this.loadAdminContext(input.actorUserId);
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

    const normalized = normalizeGovernanceControlScope(input);
    if (!normalized) {
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_SCOPE_INVALID"
      };
    }

    const authorization = await this.authorizeGovernanceControlManagement({
      context,
      ...normalized,
      controlType: input.controlType
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const reason = input.reason?.trim();
    const replayedReview =
      input.controlType === "pause_settlement"
        ? await this.replayExistingGovernanceControlReview({
            actorUserId: context.userId,
            actionType: "governance_control_create",
            targetType: GovernanceControlSensitiveTargetType,
            targetId: governanceControlChallengeTargetId(normalized),
            idempotencyKey: input.idempotencyKey,
            expectedFrozenPayloadJson: governanceControlCreateReplayPayload({
              ...normalized,
              controlType: input.controlType,
              previewId: input.previewId,
              reason,
              endsAt: input.endsAt
            }),
            now
          })
        : null;
    if (replayedReview) {
      return replayedReview;
    }

    if (!reason) {
      return {
        result: "rejected",
        errorCode: "REASON_REQUIRED"
      };
    }
    if (!input.previewId) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_REQUIRED"
      };
    }
    const previewId = input.previewId;

    const preview = await this.validateGovernanceControlPreview({
      actorUserId: context.userId,
      previewId,
      ...normalized,
      controlType: input.controlType,
      now
    });
    if (preview.result === "rejected") {
      return preview;
    }

    if (this.shouldRouteGovernanceControlReview(input.controlType)) {
      const pending = await this.createGovernanceControlReviewRequest({
        actorUserId: context.userId,
        sessionId: input.sessionId,
        challengeId: input.challengeId,
        idempotencyKey: input.idempotencyKey,
        previewId,
        reason,
        endsAt: input.endsAt ?? null,
        scopeType: normalized.scopeType,
        scopeId: normalized.scopeId,
        controlType: input.controlType,
        preview,
        now
      });
      return pending;
    }

    const challenge = await this.authorizeGovernanceControlChallenge({
      actorUserId: context.userId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      ...normalized,
      now
    });
    if (challenge.result === "rejected") {
      return challenge;
    }

    try {
      const control = await this.prisma.$transaction(async (tx) => {
        await expireElapsedGovernanceControls(tx, {
          scopeType: normalized.scopeType,
          scopeId: normalized.scopeId,
          controlType: input.controlType,
          now
        });

        const existing = await tx.governanceControl.findFirst({
          where: {
            scopeType: normalized.scopeType,
            scopeId: normalized.scopeId,
            controlType: input.controlType,
            status: "active"
          },
          select: {
            id: true
          }
        });
        if (existing) {
          throw new GovernanceControlAlreadyActiveError();
        }

        const created = await tx.governanceControl.create({
          data: {
            scopeType: normalized.scopeType,
            scopeId: normalized.scopeId,
            controlType: input.controlType,
            reason,
            previewAuditLogId: previewId,
            createdByUserId: context.userId,
            startsAt: now,
            endsAt: input.endsAt ?? null
          }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: context.userId,
            action: "stage8.governance_control.create",
            targetType: "governance_control",
            targetId: created.id,
            reason,
            beforeJson: Prisma.JsonNull,
            afterJson: {
              controlId: created.id,
              previewAuditLogId: previewId,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
              controlType: created.controlType,
              status: created.status,
              startsAt: created.startsAt.toISOString(),
              endsAt: created.endsAt?.toISOString() ?? null
            } as Prisma.InputJsonValue,
            createdAt: now
          }
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "governance_control.created",
            targetType: "governance_control",
            targetId: created.id,
            idempotencyKey: `governance_control.created:${created.id}`,
            payloadJson: {
              controlId: created.id,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
              controlType: created.controlType,
              status: created.status,
              createdByUserId: context.userId,
              startsAt: created.startsAt.toISOString(),
              endsAt: created.endsAt?.toISOString() ?? null
            },
            availableAt: now
          }
        });

        return created;
      });

      return {
        result: "accepted",
        control: toGovernanceControlRow(control, now)
      };
    } catch (error) {
      if (error instanceof GovernanceControlAlreadyActiveError) {
        return {
          result: "rejected",
          errorCode: "GOVERNANCE_CONTROL_ALREADY_ACTIVE"
        };
      }
      if (isUniqueConstraintError(error)) {
        const consumed = await this.prisma.governanceControl.findUnique({
          where: {
            previewAuditLogId: previewId
          },
          select: {
            id: true
          }
        });
        return {
          result: "rejected",
          errorCode: consumed
            ? "PREVIEW_ALREADY_CONSUMED"
            : "GOVERNANCE_CONTROL_ALREADY_ACTIVE"
        };
      }
      throw error;
    }
  }

  async liftGovernanceControl(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    idempotencyKey?: string;
    controlId: string;
    reason?: string;
    now?: Date;
  }): Promise<Stage8GovernanceControlMutationResult> {
    const now = input.now ?? new Date();

    const context = await this.loadAdminContext(input.actorUserId);
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

    const existing = await this.prisma.governanceControl.findUnique({
      where: {
        id: input.controlId
      }
    });
    if (!existing) {
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_NOT_FOUND"
      };
    }

    const authorization = await this.authorizeGovernanceControlManagement({
      context,
      scopeType: existing.scopeType,
      scopeId: existing.scopeId,
      controlType: existing.controlType
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const reason = input.reason?.trim();
    const replayedReview =
      existing.controlType === "pause_settlement"
        ? await this.replayExistingGovernanceControlReview({
            actorUserId: context.userId,
            actionType: "governance_control_lift",
            targetType: "governance_control",
            targetId: existing.id,
            idempotencyKey: input.idempotencyKey,
            expectedFrozenPayloadJson: governanceControlLiftReplayPayload({
              control: existing,
              reason
            }),
            now
          })
        : null;
    if (replayedReview) {
      return replayedReview;
    }

    if (!reason) {
      return {
        result: "rejected",
        errorCode: "REASON_REQUIRED"
      };
    }

    if (
      existing.status !== "active" ||
      (existing.endsAt && existing.endsAt.getTime() <= now.getTime())
    ) {
      if (existing.status === "active") {
        await this.prisma.governanceControl.updateMany({
          where: {
            id: existing.id,
            status: "active",
            endsAt: {
              lte: now
            }
          },
          data: {
            status: "expired"
          }
        });
      }
      return {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
      };
    }

    if (this.shouldRouteGovernanceControlReview(existing.controlType)) {
      return this.createGovernanceControlLiftReviewRequest({
        actorUserId: context.userId,
        sessionId: input.sessionId,
        challengeId: input.challengeId,
        idempotencyKey: input.idempotencyKey,
        control: existing,
        reason,
        now
      });
    }

    const challenge = await this.authorizeGovernanceControlChallenge({
      actorUserId: context.userId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      scopeType: existing.scopeType,
      scopeId: existing.scopeId,
      now
    });
    if (challenge.result === "rejected") {
      return challenge;
    }

    try {
      const lifted = await this.prisma.$transaction(async (tx) => {
        const transition = await tx.governanceControl.updateMany({
          where: {
            id: existing.id,
            status: "active",
            OR: [
              {
                endsAt: null
              },
              {
                endsAt: {
                  gt: now
                }
              }
            ]
          },
          data: {
            status: "lifted",
            liftedByUserId: context.userId,
            liftedAt: now,
            liftReason: reason
          }
        });
        if (transition.count !== 1) {
          throw new GovernanceControlNotActiveError();
        }

        const updated = await tx.governanceControl.findUniqueOrThrow({
          where: {
            id: existing.id
          }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: context.userId,
            action: "stage8.governance_control.lift",
            targetType: "governance_control",
            targetId: updated.id,
            reason,
            beforeJson: {
              status: existing.status
            },
            afterJson: {
              controlId: updated.id,
              scopeType: updated.scopeType,
              scopeId: updated.scopeId,
              controlType: updated.controlType,
              status: updated.status,
              liftedByUserId: context.userId,
              liftedAt: now.toISOString()
            } as Prisma.InputJsonValue,
            createdAt: now
          }
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "governance_control.lifted",
            targetType: "governance_control",
            targetId: updated.id,
            idempotencyKey: `governance_control.lifted:${updated.id}`,
            payloadJson: {
              controlId: updated.id,
              scopeType: updated.scopeType,
              scopeId: updated.scopeId,
              controlType: updated.controlType,
              status: updated.status,
              liftedByUserId: context.userId,
              liftedAt: now.toISOString()
            },
            availableAt: now
          }
        });

        return updated;
      });

      return {
        result: "accepted",
        control: toGovernanceControlRow(lifted, now)
      };
    } catch (error) {
      if (error instanceof GovernanceControlNotActiveError) {
        return {
          result: "rejected",
          errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
        };
      }
      throw error;
    }
  }

  async approveGovernanceControlReview(input: {
    reviewRequestId: string;
    reviewerUserId: string;
    sessionId: string;
    challengeId?: string;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewTransitionResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    if (!isStage8HighRiskGovernanceReviewRouteEnabled()) {
      const context = await this.loadAdminContext(input.reviewerUserId);
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

      return this.highRiskGovernanceReview.invalidatePendingReview({
        reviewRequestId: input.reviewRequestId,
        actorUserId: context.userId,
        reason: "high-risk governance review route disabled before execution",
        errorCode: "ROUTING_DISABLED",
        now: input.now
      });
    }

    return this.highRiskGovernanceReview.approveReviewRequest({
      reviewRequestId: input.reviewRequestId,
      reviewerUserId: input.reviewerUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      now: input.now,
      execute: ({ tx, review, now }) =>
        this.executeGovernanceControlReview({
          tx,
          review,
          now
        })
    });
  }

  async listHighRiskGovernanceReviews(input: {
    actorUserId: string;
    decisionState?: HighRiskGovernanceReviewDecisionState | "all";
    now?: Date;
  }): Promise<HighRiskGovernanceReviewListResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    return this.highRiskGovernanceReview.listReviewRequests(input);
  }

  async getHighRiskGovernanceReviewDetail(input: {
    actorUserId: string;
    reviewRequestId: string;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewDetailResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    return this.highRiskGovernanceReview.getReviewRequestDetail(input);
  }

  async rejectGovernanceControlReview(input: {
    reviewRequestId: string;
    reviewerUserId: string;
    sessionId: string;
    challengeId?: string;
    reason: string;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewTransitionResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    return this.highRiskGovernanceReview.rejectReviewRequest({
      reviewRequestId: input.reviewRequestId,
      actorUserId: input.reviewerUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      reason: input.reason,
      now: input.now
    });
  }

  async withdrawGovernanceControlReview(input: {
    reviewRequestId: string;
    actorUserId: string;
    reason: string;
    now?: Date;
  }): Promise<HighRiskGovernanceReviewTransitionResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "REVIEW_REQUEST_NOT_FOUND"
      };
    }

    return this.highRiskGovernanceReview.withdrawReviewRequest(input);
  }

  private async createGovernanceControlReviewRequest(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    idempotencyKey?: string;
    previewId: string;
    reason: string;
    endsAt: Date | null;
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    controlType: GovernanceControlType;
    preview: ValidatedGovernanceControlPreview;
    now: Date;
  }): Promise<Stage8GovernanceControlMutationResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "PENDING_REVIEW_ALREADY_EXISTS"
      };
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const frozenPayloadJson = {
      actionType: "governance_control_create",
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      controlType: input.controlType,
      previewId: input.previewId,
      reason: input.reason,
      endsAt: input.endsAt?.toISOString() ?? null,
      initiatorUserId: input.actorUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId ?? null
    } as Prisma.InputJsonValue;

    const review = await this.highRiskGovernanceReview.createReviewRequest({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      actionType: "governance_control_create",
      targetType: GovernanceControlSensitiveTargetType,
      targetId: governanceControlChallengeTargetId(input),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      controlType: input.controlType,
      sourcePreviewAuditLogId: input.previewId,
      idempotencyKey,
      frozenPayloadJson,
      evidenceJson: input.preview.evidenceJson,
      now: input.now
    });

    if (review.result === "rejected") {
      return {
        result: "rejected",
        errorCode: review.errorCode as Stage8GovernanceControlErrorCode
      };
    }

    return {
      result: "pending_review",
      review: review.review
    };
  }

  private async createGovernanceControlLiftReviewRequest(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    idempotencyKey?: string;
    control: GovernanceControl;
    reason: string;
    now: Date;
  }): Promise<Stage8GovernanceControlMutationResult> {
    if (!this.highRiskGovernanceReview) {
      return {
        result: "rejected",
        errorCode: "PENDING_REVIEW_ALREADY_EXISTS"
      };
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const frozenPayloadJson = {
      actionType: "governance_control_lift",
      controlId: input.control.id,
      scopeType: input.control.scopeType,
      scopeId: input.control.scopeId,
      controlType: input.control.controlType,
      reason: input.reason,
      initiatorUserId: input.actorUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId ?? null
    } as Prisma.InputJsonValue;
    const evidenceJson = {
      controlId: input.control.id,
      scopeType: input.control.scopeType,
      scopeId: input.control.scopeId,
      controlType: input.control.controlType,
      status: input.control.status,
      startsAt: input.control.startsAt.toISOString(),
      endsAt: input.control.endsAt?.toISOString() ?? null,
      createdByUserId: input.control.createdByUserId,
      previewAuditLogId: input.control.previewAuditLogId
    } as Prisma.InputJsonValue;

    const review = await this.highRiskGovernanceReview.createReviewRequest({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      actionType: "governance_control_lift",
      targetType: "governance_control",
      targetId: input.control.id,
      scopeType: input.control.scopeType,
      scopeId: input.control.scopeId,
      controlType: input.control.controlType,
      idempotencyKey,
      frozenPayloadJson,
      evidenceJson,
      now: input.now
    });

    if (review.result === "rejected") {
      return {
        result: "rejected",
        errorCode: review.errorCode as Stage8GovernanceControlErrorCode
      };
    }

    return {
      result: "pending_review",
      review: review.review
    };
  }

  private async executeGovernanceControlReview(input: {
    tx: Prisma.TransactionClient;
    review: HighRiskGovernanceReviewRow;
    now: Date;
  }): Promise<HighRiskGovernanceReviewExecutionResult> {
    switch (input.review.actionType) {
      case "governance_control_create":
        return executeGovernanceControlCreateReview(input.tx, input.review, input.now);
      case "governance_control_lift":
        return executeGovernanceControlLiftReview(input.tx, input.review, input.now);
      default:
        return {
          result: "invalidated",
          errorCode: "REVIEW_ACTION_UNSUPPORTED"
        };
    }
  }

  private async replayExistingGovernanceControlReview(input: {
    actorUserId: string;
    actionType: HighRiskGovernanceReviewActionType;
    targetType: string;
    targetId: string;
    idempotencyKey?: string;
    expectedFrozenPayloadJson?: Record<string, unknown>;
    now: Date;
  }): Promise<Stage8GovernanceControlMutationResult | null> {
    if (!this.highRiskGovernanceReview) {
      return null;
    }

    const review =
      await this.highRiskGovernanceReview.findReviewRequestByIdempotency({
        initiatorUserId: input.actorUserId,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        idempotencyKey: input.idempotencyKey
      });
    if (!review) {
      return null;
    }

    if (
      input.expectedFrozenPayloadJson &&
      !jsonObjectContains(review.frozenPayloadJson, input.expectedFrozenPayloadJson)
    ) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_CONFLICT"
      };
    }

    if (
      review.decisionState === "pending" &&
      review.executionState === "not_started" &&
      !isStage8HighRiskGovernanceReviewRouteEnabled()
    ) {
      const invalidated = await this.highRiskGovernanceReview.invalidatePendingReview({
        reviewRequestId: review.id,
        actorUserId: input.actorUserId,
        reason: "high-risk governance review route disabled before execution",
        errorCode: "ROUTING_DISABLED",
        now: input.now
      });
      if (invalidated.result === "accepted") {
        return {
          result: "pending_review",
          review: invalidated.review
        };
      }
    }

    return {
      result: "pending_review",
      review
    };
  }

  private shouldRouteGovernanceControlReview(controlType: GovernanceControlType) {
    return (
      controlType === "pause_settlement" &&
      Boolean(this.highRiskGovernanceReview) &&
      isStage8HighRiskGovernanceReviewRouteEnabled()
    );
  }

  private async loadAdminContext(userId: string): Promise<AdminContext | null> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId,
        status: "active",
        user: {
          status: "active"
        }
      },
      select: {
        id: true,
        userId: true,
        role: true,
        mfaEnabled: true,
        communityScopes: {
          where: {
            status: "active"
          },
          select: {
            communityId: true
          }
        }
      }
    });
    if (!admin) {
      return null;
    }

    return {
      userId: admin.userId,
      adminProfileId: admin.id,
      role: admin.role,
      mfaEnabled: admin.mfaEnabled,
      communityIds: admin.communityScopes.map((scope) => scope.communityId)
    };
  }

  private async authorizeGovernanceControlManagement(input: {
    context: AdminContext;
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    controlType: GovernanceControlType;
  }): Promise<
    | { result: "accepted" }
    | { result: "rejected"; errorCode: Stage8GovernanceControlErrorCode }
  > {
    if (input.scopeType === "community") {
      const community = await this.prisma.auctionCommunity.findUnique({
        where: {
          id: input.scopeId ?? ""
        },
        select: {
          id: true
        }
      });
      if (!community) {
        return {
          result: "rejected",
          errorCode: "GOVERNANCE_CONTROL_SCOPE_INVALID"
        };
      }
    }

    if (input.context.role === "platform_admin") {
      return {
        result: "accepted"
      };
    }

    if (
      input.scopeType !== "community" ||
      !input.scopeId ||
      !input.context.communityIds.includes(input.scopeId)
    ) {
      return {
        result: "rejected",
        errorCode:
          input.scopeType === "platform"
            ? "PLATFORM_ADMIN_REQUIRED"
            : "COMMUNITY_SCOPE_FORBIDDEN"
      };
    }

    if (input.controlType === "pause_settlement") {
      return {
        result: "rejected",
        errorCode: "CONTROL_TYPE_FORBIDDEN"
      };
    }

    if (input.context.role !== "activity_admin") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_ADMIN_SCOPE_REQUIRED"
      };
    }

    return {
      result: "accepted"
    };
  }

  private async authorizeGovernanceControlChallenge(input: {
    actorUserId: string;
    sessionId: string;
    challengeId?: string;
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | { result: "rejected"; errorCode: Stage8GovernanceControlErrorCode }
  > {
    if (!this.sensitiveOperations || !input.challengeId) {
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
      targetId: governanceControlChallengeTargetId(input),
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

  private async validateGovernanceControlPreview(input: {
    actorUserId: string;
    previewId: string;
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    controlType: GovernanceControlType;
    now: Date;
  }): Promise<
    | ValidatedGovernanceControlPreview
    | { result: "rejected"; errorCode: Stage8GovernanceControlErrorCode }
  > {
    const consumed = await this.prisma.governanceControl.findUnique({
      where: {
        previewAuditLogId: input.previewId
      },
      select: {
        id: true
      }
    });
    if (consumed) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_ALREADY_CONSUMED"
      };
    }

    const preview = await this.prisma.auditLog.findUnique({
      where: {
        id: input.previewId
      },
      select: {
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        afterJson: true
      }
    });
    if (
      !preview ||
      preview.action !== "stage8.governance_control_preview" ||
      preview.targetType !== GovernanceControlSensitiveTargetType ||
      preview.targetId !== governanceControlChallengeTargetId(input)
    ) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_NOT_FOUND"
      };
    }
    if (preview.actorUserId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_SCOPE_MISMATCH"
      };
    }

    const payload = asRecord(preview.afterJson);
    if (
      payload?.scopeType !== input.scopeType ||
      (payload.scopeId ?? null) !== input.scopeId ||
      payload.controlType !== input.controlType ||
      payload.mutatesBusinessState !== false
    ) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_SCOPE_MISMATCH"
      };
    }

    const expiresAt =
      typeof payload.expiresAt === "string" ? new Date(payload.expiresAt) : null;
    if (!expiresAt || expiresAt.getTime() <= input.now.getTime()) {
      return {
        result: "rejected",
        errorCode: "PREVIEW_EXPIRED"
      };
    }

    return {
      result: "accepted",
      expiresAt,
      evidenceJson: {
        sourcePreviewAuditLogId: input.previewId,
        previewActorUserId: preview.actorUserId,
        previewExpiresAt: expiresAt.toISOString(),
        previewAfterJson: payload
      } as Prisma.InputJsonValue
    };
  }

  private async buildGovernanceControlImpact(input: {
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    controlType: GovernanceControlType;
  }): Promise<Stage8GovernanceControlImpactSummary> {
    const auctionCommunityWhere =
      input.scopeType === "community" && input.scopeId
        ? {
            item: {
              communityId: input.scopeId
            }
          }
        : {};
    const [
      activeAuctionCount,
      activeHoldCount,
      pendingTransactionCount,
      manualReviewTaskCount
    ] = await Promise.all([
      this.prisma.auctionSession.count({
        where: {
          status: "active",
          ...auctionCommunityWhere
        }
      }),
      this.prisma.pointHold.count({
        where: {
          status: "active",
          auctionSession: auctionCommunityWhere
        }
      }),
      this.prisma.transaction.count({
        where: {
          status: {
            in: ["pending_guardian_confirm", "pending_delivery_confirm"]
          },
          auctionSession: auctionCommunityWhere
        }
      }),
      this.countManualReviewTasksForScope(input)
    ]);

    return {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      controlType: input.controlType,
      counts: {
        activeAuctionCount,
        activeHoldCount,
        pendingTransactionCount,
        manualReviewTaskCount
      },
      blockedActions: blockedActionsForControl(input.controlType),
      warnings: warningsForGovernanceControl(input.controlType)
    };
  }

  private async countManualReviewTasksForScope(input: {
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
  }) {
    if (input.scopeType === "platform") {
      return this.prisma.moderationTask.count({
        where: {
          status: {
            in: ["pending", "processing", "needs_manual_review", "escalated"]
          }
        }
      });
    }

    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "ModerationTask" mt
      JOIN "ContentVersion" cv ON cv."id" = mt."contentVersionId"
      LEFT JOIN "Item" i
        ON cv."targetType" = 'item' AND i."id" = cv."targetId"
      LEFT JOIN "WantedPost" wp
        ON cv."targetType" = 'wanted_request' AND wp."id" = cv."targetId"
      LEFT JOIN "WantedResponse" wr
        ON cv."targetType" = 'wanted_response' AND wr."id" = cv."targetId"
      LEFT JOIN "WantedPost" parent_wp
        ON parent_wp."id" = wr."wantedPostId"
      WHERE mt."status" IN ('pending', 'processing', 'needs_manual_review', 'escalated')
        AND COALESCE(i."communityId", wp."communityId", parent_wp."communityId") = ${input.scopeId}
    `;

    return Number(rows[0]?.count ?? 0);
  }

  private async resolveTargetCommunityId(input: {
    targetType: string;
    targetId: string;
    communityId?: string;
  }): Promise<string | null | "TARGET_NOT_FOUND"> {
    if (input.targetType === "auction_community") {
      const community = await this.prisma.auctionCommunity.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          id: true
        }
      });
      if (!community || (input.communityId && input.communityId !== community.id)) {
        return "TARGET_NOT_FOUND";
      }
      return input.targetId;
    }
    if (input.targetType === "item") {
      const item = await this.prisma.item.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          communityId: true
        }
      });
      if (!item || (input.communityId && input.communityId !== item.communityId)) {
        return "TARGET_NOT_FOUND";
      }
      return item.communityId;
    }
    if (input.targetType === "auction_session") {
      const auction = await this.prisma.auctionSession.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          item: {
            select: {
              communityId: true
            }
          }
        }
      });
      if (
        !auction ||
        (input.communityId && input.communityId !== auction.item.communityId)
      ) {
        return "TARGET_NOT_FOUND";
      }
      return auction.item.communityId;
    }
    if (input.targetType === "wanted_post") {
      const post = await this.prisma.wantedPost.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          communityId: true
        }
      });
      if (!post || (input.communityId && input.communityId !== post.communityId)) {
        return "TARGET_NOT_FOUND";
      }
      return post.communityId;
    }
    if (input.targetType === "appeal") {
      const appeal = await this.prisma.appeal.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          communityId: true
        }
      });
      if (
        !appeal ||
        (input.communityId && input.communityId !== appeal.communityId)
      ) {
        return "TARGET_NOT_FOUND";
      }
      return appeal.communityId;
    }
    if (input.targetType === "child") {
      const child = await this.prisma.childProfile.findUnique({
        where: {
          id: input.targetId
        },
        select: {
          id: true
        }
      });
      return child ? input.communityId ?? null : "TARGET_NOT_FOUND";
    }

    return "TARGET_NOT_FOUND";
  }

  private async buildImpactSummary(input: {
    operation: Stage8AdminOperation;
    targetType: string;
    targetId: string;
    communityId: string | null;
  }): Promise<Stage8ImpactSummary | null> {
    switch (input.operation) {
      case HighRiskAdminOperation.forceDelist:
        if (input.targetType !== "item" && input.targetType !== "wanted_post") {
          return null;
        }
        return {
          ...input,
          counts:
            input.targetType === "item"
              ? await this.itemImpact(input.targetId)
              : await this.wantedPostImpact(input.targetId),
          warnings: ["Preview only; forced delist execution is not in Stage 8 round 1."]
        };
      case HighRiskAdminOperation.adjustAuctionEndTime:
        if (input.targetType !== "auction_session") {
          return null;
        }
        return {
          ...input,
          counts: await this.auctionImpact(input.targetId),
          warnings: [
            "Preview only; auction end-time mutation still requires a confirm path."
          ]
        };
      case HighRiskAdminOperation.pauseCommunity:
        if (input.targetType !== "auction_community" || !input.communityId) {
          return null;
        }
        return {
          ...input,
          counts: await this.communityPauseImpact(input.communityId),
          warnings: [
            "Preview only; pause execution and settlement closure strategy are later Stage 8 work."
          ]
        };
      case HighRiskAdminOperation.exportChildData:
        if (input.targetType !== "child") {
          return null;
        }
        return {
          ...input,
          counts: await this.childExportImpact(input.targetId),
          warnings: [
            "Preview only; export file generation, expiry, and access logging are later Stage 8 work."
          ]
        };
      case HighRiskAdminOperation.adjustPoints:
        if (input.targetType !== "child") {
          return null;
        }
        return {
          ...input,
          counts: await this.pointAdjustmentImpact(input.targetId),
          warnings: [
            "Preview only; point adjustment execution remains behind review workflows."
          ]
        };
      default:
        return null;
    }
  }

  private async itemImpact(itemId: string) {
    const auction = await this.prisma.auctionSession.findUnique({
      where: {
        itemId
      },
      select: {
        id: true,
        status: true
      }
    });
    const [activeBids, activeHolds, favorites] = await Promise.all([
      auction
        ? this.prisma.bid.count({
            where: {
              auctionSessionId: auction.id,
              status: "active"
            }
          })
        : 0,
      auction
        ? this.prisma.pointHold.count({
            where: {
              auctionSessionId: auction.id,
              status: "active"
            }
          })
        : 0,
      this.prisma.itemFavorite.count({
        where: {
          itemId,
          status: "active"
        }
      })
    ]);

    return {
      activeAuctionCount: auction?.status === "active" ? 1 : 0,
      activeBidCount: activeBids,
      activeHoldCount: activeHolds,
      activeFavoriteCount: favorites
    };
  }

  private async wantedPostImpact(wantedPostId: string) {
    const responses = await this.prisma.wantedResponse.count({
      where: {
        wantedPostId,
        status: "submitted"
      }
    });
    return {
      submittedResponseCount: responses
    };
  }

  private async auctionImpact(auctionSessionId: string) {
    const [activeBids, activeHolds] = await Promise.all([
      this.prisma.bid.count({
        where: {
          auctionSessionId,
          status: "active"
        }
      }),
      this.prisma.pointHold.count({
        where: {
          auctionSessionId,
          status: "active"
        }
      })
    ]);
    return {
      activeBidCount: activeBids,
      activeHoldCount: activeHolds
    };
  }

  private async communityPauseImpact(communityId: string) {
    const [activeAuctions, activeHolds, pendingTransactions, pendingMembers] =
      await Promise.all([
        this.prisma.auctionSession.count({
          where: {
            status: "active",
            item: {
              communityId
            }
          }
        }),
        this.prisma.pointHold.count({
          where: {
            status: "active",
            auctionSession: {
              item: {
                communityId
              }
            }
          }
        }),
        this.prisma.transaction.count({
          where: {
            status: {
              in: ["pending_guardian_confirm", "pending_delivery_confirm"]
            },
            auctionSession: {
              item: {
                communityId
              }
            }
          }
        }),
        this.prisma.communityMember.count({
          where: {
            communityId,
            status: "pending_admin"
          }
        })
      ]);

    return {
      activeAuctionCount: activeAuctions,
      activeHoldCount: activeHolds,
      pendingTransactionCount: pendingTransactions,
      pendingMemberReviewCount: pendingMembers
    };
  }

  private async childExportImpact(childId: string) {
    const [notifications, favorites, ledgerEntries] = await Promise.all([
      this.prisma.notification.count({
        where: {
          recipientChildId: childId
        }
      }),
      this.prisma.itemFavorite.count({
        where: {
          childId
        }
      }),
      this.prisma.pointLedgerEntry.count({
        where: {
          childId
        }
      })
    ]);
    return {
      notificationCount: notifications,
      favoriteCount: favorites,
      pointLedgerEntryCount: ledgerEntries
    };
  }

  private async pointAdjustmentImpact(childId: string) {
    const [account, activeHolds] = await Promise.all([
      this.prisma.pointAccount.findUnique({
        where: {
          childId
        },
        select: {
          availablePoints: true,
          frozenPoints: true
        }
      }),
      this.prisma.pointHold.count({
        where: {
          status: "active",
          account: {
            childId
          }
        }
      })
    ]);
    return {
      pointAccountCount: account ? 1 : 0,
      availablePoints: account?.availablePoints ?? 0,
      frozenPoints: account?.frozenPoints ?? 0,
      activeHoldCount: activeHolds
    };
  }
}

function resolveCommunityScope(
  context: AdminContext,
  requestedCommunityId?: string | null
):
  | {
      result: "accepted";
      communityIds: string[];
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_ADMIN_SCOPE_REQUIRED"
        | "COMMUNITY_SCOPE_FORBIDDEN";
    } {
  if (context.role === "platform_admin") {
    return {
      result: "accepted",
      communityIds: requestedCommunityId ? [requestedCommunityId] : []
    };
  }

  if (!context.communityIds.length) {
    return {
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_SCOPE_REQUIRED"
    };
  }

  if (requestedCommunityId && !context.communityIds.includes(requestedCommunityId)) {
    return {
      result: "rejected",
      errorCode: "COMMUNITY_SCOPE_FORBIDDEN"
    };
  }

  return {
    result: "accepted",
    communityIds: requestedCommunityId ? [requestedCommunityId] : context.communityIds
  };
}

function communityWhereForScope(communityIds: string[]) {
  return communityIds.length ? { in: communityIds } : undefined;
}

function normalizeGovernanceControlScope(input: {
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

async function expireElapsedGovernanceControls(
  tx: Prisma.TransactionClient,
  input: {
    scopeType: GovernanceControlScopeType;
    scopeId: string | null;
    controlType: GovernanceControlType;
    now: Date;
  }
) {
  await tx.governanceControl.updateMany({
    where: {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      controlType: input.controlType,
      status: "active",
      endsAt: {
        lte: input.now
      }
    },
    data: {
      status: "expired"
    }
  });
}

async function executeGovernanceControlCreateReview(
  tx: Prisma.TransactionClient,
  review: HighRiskGovernanceReviewRow,
  now: Date
): Promise<HighRiskGovernanceReviewExecutionResult> {
  const payload = asRecord(review.frozenPayloadJson);
  const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
  const previewId =
    typeof payload?.previewId === "string" ? payload.previewId : review.sourcePreviewAuditLogId;
  const endsAt = parseFrozenOptionalDate(payload?.endsAt);
  if (
    !reason ||
    !previewId ||
    !review.scopeType ||
    !review.controlType ||
    endsAt.result === "invalid" ||
    (endsAt.value && endsAt.value.getTime() <= now.getTime())
  ) {
    return {
      result: "invalidated",
      errorCode: "FROZEN_PAYLOAD_INVALID"
    };
  }

  await expireElapsedGovernanceControls(tx, {
    scopeType: review.scopeType,
    scopeId: review.scopeId,
    controlType: review.controlType,
    now
  });

  const existing = await tx.governanceControl.findFirst({
    where: {
      scopeType: review.scopeType,
      scopeId: review.scopeId,
      controlType: review.controlType,
      status: "active"
    },
    select: {
      id: true
    }
  });
  if (existing) {
    return {
      result: "invalidated",
      errorCode: "GOVERNANCE_CONTROL_ALREADY_ACTIVE",
      summary: {
        existingControlId: existing.id
      }
    };
  }

  try {
    const created = await tx.governanceControl.create({
      data: {
        scopeType: review.scopeType,
        scopeId: review.scopeId,
        controlType: review.controlType,
        reason,
        previewAuditLogId: previewId,
        createdByUserId: review.initiatorUserId,
        startsAt: now,
        endsAt: endsAt.value
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: review.initiatorUserId,
        action: "stage8.governance_control.create",
        targetType: "governance_control",
        targetId: created.id,
        reason,
        beforeJson: Prisma.JsonNull,
        afterJson: {
          controlId: created.id,
          reviewRequestId: review.id,
          previewAuditLogId: previewId,
          scopeType: created.scopeType,
          scopeId: created.scopeId,
          controlType: created.controlType,
          status: created.status,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt?.toISOString() ?? null
        } as Prisma.InputJsonValue,
        createdAt: now
      }
    });
    await tx.outboxEvent.create({
      data: {
        eventType: "governance_control.created",
        targetType: "governance_control",
        targetId: created.id,
        idempotencyKey: `governance_control.created:${created.id}`,
        payloadJson: {
          controlId: created.id,
          reviewRequestId: review.id,
          scopeType: created.scopeType,
          scopeId: created.scopeId,
          controlType: created.controlType,
          status: created.status,
          createdByUserId: review.initiatorUserId,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt?.toISOString() ?? null
        },
        availableAt: now
      }
    });

    return {
      result: "succeeded",
      summary: {
        controlId: created.id,
        status: created.status
      }
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        result: "invalidated",
        errorCode: "PREVIEW_ALREADY_CONSUMED"
      };
    }
    throw error;
  }
}

async function executeGovernanceControlLiftReview(
  tx: Prisma.TransactionClient,
  review: HighRiskGovernanceReviewRow,
  now: Date
): Promise<HighRiskGovernanceReviewExecutionResult> {
  const payload = asRecord(review.frozenPayloadJson);
  const controlId =
    typeof payload?.controlId === "string" ? payload.controlId : review.targetId;
  const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
  if (!controlId || !reason) {
    return {
      result: "invalidated",
      errorCode: "FROZEN_PAYLOAD_INVALID"
    };
  }

  const current = await tx.governanceControl.findUnique({
    where: {
      id: controlId
    }
  });
  if (
    !current ||
    current.status !== "active" ||
    (current.endsAt && current.endsAt.getTime() <= now.getTime())
  ) {
    return {
      result: "invalidated",
      errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
    };
  }

  const transition = await tx.governanceControl.updateMany({
    where: {
      id: controlId,
      status: "active",
      OR: [
        {
          endsAt: null
        },
        {
          endsAt: {
            gt: now
          }
        }
      ]
    },
    data: {
      status: "lifted",
      liftedByUserId: review.initiatorUserId,
      liftedAt: now,
      liftReason: reason
    }
  });
  if (transition.count !== 1) {
    return {
      result: "invalidated",
      errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
    };
  }

  const updated = await tx.governanceControl.findUniqueOrThrow({
    where: {
      id: controlId
    }
  });
  await tx.auditLog.create({
    data: {
      actorUserId: review.initiatorUserId,
      action: "stage8.governance_control.lift",
      targetType: "governance_control",
      targetId: updated.id,
      reason,
      beforeJson: {
        status: current.status
      },
      afterJson: {
        controlId: updated.id,
        reviewRequestId: review.id,
        scopeType: updated.scopeType,
        scopeId: updated.scopeId,
        controlType: updated.controlType,
        status: updated.status,
        liftedByUserId: review.initiatorUserId,
        liftedAt: now.toISOString()
      } as Prisma.InputJsonValue,
      createdAt: now
    }
  });
  await tx.outboxEvent.create({
    data: {
      eventType: "governance_control.lifted",
      targetType: "governance_control",
      targetId: updated.id,
      idempotencyKey: `governance_control.lifted:${updated.id}`,
      payloadJson: {
        controlId: updated.id,
        reviewRequestId: review.id,
        scopeType: updated.scopeType,
        scopeId: updated.scopeId,
        controlType: updated.controlType,
        status: updated.status,
        liftedByUserId: review.initiatorUserId,
        liftedAt: now.toISOString()
      },
      availableAt: now
    }
  });

  return {
    result: "succeeded",
    summary: {
      controlId: updated.id,
      status: updated.status
    }
  };
}

function parseFrozenOptionalDate(
  value: unknown
): { result: "accepted"; value: Date | null } | { result: "invalid" } {
  if (value === null || value === undefined) {
    return {
      result: "accepted",
      value: null
    };
  }
  if (typeof value !== "string") {
    return {
      result: "invalid"
    };
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      result: "invalid"
    };
  }
  return {
    result: "accepted",
    value: parsed
  };
}

function governanceControlCreateReplayPayload(input: {
  scopeType: GovernanceControlScopeType;
  scopeId: string | null;
  controlType: GovernanceControlType;
  previewId?: string;
  reason?: string;
  endsAt?: Date | null;
}) {
  return compactReplayPayload({
    actionType: "governance_control_create",
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    controlType: input.controlType,
    previewId: input.previewId,
    reason: input.reason,
    endsAt: input.endsAt === undefined ? undefined : input.endsAt?.toISOString() ?? null
  });
}

function governanceControlLiftReplayPayload(input: {
  control: GovernanceControl;
  reason?: string;
}) {
  return compactReplayPayload({
    actionType: "governance_control_lift",
    controlId: input.control.id,
    scopeType: input.control.scopeType,
    scopeId: input.control.scopeId,
    controlType: input.control.controlType,
    reason: input.reason
  });
}

function compactReplayPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function jsonObjectContains(
  actualValue: unknown,
  expectedSubset: Record<string, unknown>
) {
  const actual = asRecord(actualValue);
  if (!actual) {
    return false;
  }

  return Object.entries(expectedSubset).every(
    ([key, expectedValue]) => actual[key] === expectedValue
  );
}

function toGovernanceControlRow(
  control: GovernanceControl,
  now: Date
): Stage8GovernanceControlRow {
  return {
    id: control.id,
    scopeType: control.scopeType,
    scopeId: control.scopeId,
    controlType: control.controlType,
    status: control.status,
    effective:
      control.status === "active" &&
      control.startsAt.getTime() <= now.getTime() &&
      (!control.endsAt || control.endsAt.getTime() > now.getTime()),
    reason: control.reason,
    createdByUserId: control.createdByUserId,
    liftedByUserId: control.liftedByUserId,
    startsAt: control.startsAt.toISOString(),
    endsAt: control.endsAt?.toISOString() ?? null,
    createdAt: control.createdAt.toISOString(),
    liftedAt: control.liftedAt?.toISOString() ?? null,
    liftReason: control.liftReason,
    previewAuditLogId: control.previewAuditLogId
  };
}

function blockedActionsForControl(controlType: GovernanceControlType) {
  switch (controlType) {
    case "pause_publish":
      return [
        "item.submit",
        "item.edit",
        "wanted_post.submit",
        "wanted_post.edit",
        "wanted_response.submit"
      ];
    case "pause_bid":
      return ["bid.create"];
    case "pause_settlement":
      return [
        "auction.settle",
        "transaction.guardian_confirm",
        "transaction.delivery_confirm"
      ];
    case "force_platform_review":
      return ["moderation_task.activity_admin_approve"];
  }
}

function warningsForGovernanceControl(controlType: GovernanceControlType) {
  switch (controlType) {
    case "pause_publish":
      return [
        "Blocks new publishing writes only; existing public content is not delisted."
      ];
    case "pause_bid":
      return [
        "Blocks new bids only; active auctions, existing bids, and point holds remain unchanged."
      ];
    case "pause_settlement":
      return [
        "Blocks ordinary settlement progress and guardian confirmation; platform recovery actions remain available."
      ];
    case "force_platform_review":
      return [
        "Allows content submission but prevents activity-admin approval into public visibility."
      ];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isStage8HighRiskGovernanceReviewRouteEnabled() {
  const configured = process.env.STAGE8_HIGH_RISK_GOVERNANCE_REVIEW;
  if (configured) {
    const normalized = configured.trim().toLowerCase();
    if (["1", "true", "enabled", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "disabled", "off"].includes(normalized)) {
      return false;
    }
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return (
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.CODEX_CI === "1"
  );
}

class GovernanceControlAlreadyActiveError extends Error {}

class GovernanceControlNotActiveError extends Error {}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
