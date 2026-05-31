import type {
  Prisma,
  PrismaClient,
  RiskRestrictionScope,
  RiskRestrictionType,
  RiskSignalStatus,
  RiskSignalType
} from "@prisma/client";
import { randomUUID } from "node:crypto";

export type RecordRiskSignalInput = {
  actorUserId?: string;
  type: RiskSignalType;
  scope: RiskRestrictionScope;
  targetId: string;
  evidenceJson: Prisma.InputJsonValue;
  now?: Date;
};

export type RecordRiskSignalResult =
  | {
      result: "accepted";
      signalId: string;
      status: RiskSignalStatus;
      restrictionIds: string[];
    }
  | {
      result: "rejected";
      errorCode: "RISK_TARGET_NOT_FOUND" | "RISK_SIGNAL_ACTOR_NOT_AUTHORIZED";
    };

export type ReviewRiskSignalInput = {
  platformAdminUserId: string;
  signalId: string;
  decision: Extract<RiskSignalStatus, "resolved" | "dismissed">;
  resolutionText: string;
  resolveRestrictions?: boolean;
  now?: Date;
};

export type ReviewRiskSignalResult =
  | {
      result: "accepted";
      signalId: string;
      status: Extract<RiskSignalStatus, "resolved" | "dismissed">;
      resolvedRestrictionCount: number;
    }
  | {
      result: "rejected";
      errorCode:
        | "PLATFORM_ADMIN_REQUIRED"
        | "RISK_SIGNAL_NOT_FOUND"
        | "RISK_SIGNAL_STATE_INVALID";
    };

export type ApplyRiskRestrictionInput = {
  platformAdminUserId: string;
  type: RiskRestrictionType;
  scope: RiskRestrictionScope;
  targetId: string;
  reason: string;
  expiresAt?: Date;
  now?: Date;
};

export type ApplyRiskRestrictionResult =
  | {
      result: "accepted";
      restrictionId: string;
      status: "active";
    }
  | {
      result: "rejected";
      errorCode: "PLATFORM_ADMIN_REQUIRED" | "RISK_TARGET_NOT_FOUND";
    };

export type ResolveRiskRestrictionInput = {
  platformAdminUserId: string;
  restrictionId: string;
  resolutionText: string;
  now?: Date;
};

export type ResolveRiskRestrictionResult =
  | {
      result: "accepted";
      restrictionId: string;
      status: "resolved";
    }
  | {
      result: "rejected";
      errorCode: "PLATFORM_ADMIN_REQUIRED" | "RISK_RESTRICTION_NOT_FOUND";
    };

export type ListRiskSignalsResult =
  | {
      result: "accepted";
      signals: Array<{
        key: string;
        signalId: string;
        scope: RiskRestrictionScope;
        targetId: string;
        type: RiskSignalType;
        status: RiskSignalStatus;
        restrictionCount: number;
        openedAt: string;
      }>;
    }
  | {
      result: "rejected";
      errorCode: "PLATFORM_ADMIN_REQUIRED";
    };

type RiskTargetContext = {
  userId: string | null;
  guardianId: string | null;
  childId: string | null;
  communityId: string | null;
  communityMemberId: string | null;
};

type RestrictionTargetData = {
  scope: RiskRestrictionScope;
  targetId: string;
  targetUserId?: string | null;
  communityMemberId?: string | null;
  guardianId?: string | null;
  childId?: string | null;
  communityId?: string | null;
};

export class RiskGovernanceService {
  constructor(private readonly prisma: PrismaClient) {}

  async listRiskSignals(input: {
    platformAdminUserId: string;
  }): Promise<ListRiskSignalsResult> {
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const signals = await this.prisma.riskSignal.findMany({
      where: {
        status: {
          in: ["open", "under_review"]
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      take: 100,
      include: {
        restrictions: {
          where: {
            status: "active"
          },
          select: {
            id: true
          }
        }
      }
    });

    return {
      result: "accepted",
      signals: signals.map((signal) => ({
        key: signal.id,
        signalId: signal.id,
        scope: signal.scope,
        targetId: signal.targetId,
        type: signal.type,
        status: signal.status,
        restrictionCount: signal.restrictions.length,
        openedAt: signal.createdAt.toISOString()
      }))
    };
  }

  async recordRiskSignal(
    input: RecordRiskSignalInput
  ): Promise<RecordRiskSignalResult> {
    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const targetContext = await resolveRiskTargetContext(
        tx,
        input.scope,
        input.targetId
      );

      if (!targetContext) {
        return {
          result: "rejected" as const,
          errorCode: "RISK_TARGET_NOT_FOUND" as const
        };
      }

      if (
        !(await isAuthorizedRiskSignalActor(
          tx,
          input.actorUserId,
          targetContext
        ))
      ) {
        return {
          result: "rejected" as const,
          errorCode: "RISK_SIGNAL_ACTOR_NOT_AUTHORIZED" as const
        };
      }

      await lockRiskTarget(tx, targetContext);

      const signal = await createRiskSignal(tx, input, targetContext, now);

      const restrictionIds: string[] = [];
      const restrictionTarget = restrictionTargetForContext(targetContext);
      if (restrictionTarget) {
        for (const restrictionType of restrictionTypesForSignal(input.type)) {
          const restrictionId = await createRiskRestriction(tx, {
            target: restrictionTarget,
            type: restrictionType,
            riskSignalId: signal.id,
            reason: `risk_signal:${signal.id}:${input.type}`,
            imposedByUserId: input.actorUserId,
            now
          });
          restrictionIds.push(restrictionId);
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "risk_signal.record",
          targetType: "risk_signal",
          targetId: signal.id,
          afterJson: {
            type: input.type,
            scope: input.scope,
            targetId: input.targetId,
            status: signal.status,
            restrictionIds,
            recordedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted" as const,
        signalId: signal.id,
        status: signal.status,
        restrictionIds
      };
    });
  }

  async reviewRiskSignal(
    input: ReviewRiskSignalInput
  ): Promise<ReviewRiskSignalResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const signal = await tx.riskSignal.findUnique({
        where: {
          id: input.signalId
        }
      });

      if (!signal) {
        return {
          result: "rejected" as const,
          errorCode: "RISK_SIGNAL_NOT_FOUND" as const
        };
      }

      if (signal.status === "resolved" || signal.status === "dismissed") {
        return {
          result: "rejected" as const,
          errorCode: "RISK_SIGNAL_STATE_INVALID" as const
        };
      }

      const updatedSignal = await tx.riskSignal.update({
        where: {
          id: input.signalId
        },
        data: {
          status: input.decision,
          reviewerUserId: input.platformAdminUserId,
          reviewedAt: now,
          resolutionText: input.resolutionText
        }
      });

      const resolvedRestrictionCount =
        input.resolveRestrictions === false
          ? 0
          : await tx.$executeRaw`
              UPDATE "RiskRestriction"
              SET
                "status" = ${"resolved"}::"RiskRestrictionStatus",
                "resolvedAt" = ${now},
                "updatedAt" = ${now}
              WHERE "status" = ${"active"}::"RiskRestrictionStatus"
                AND "riskSignalId" = ${signal.id}
            `;

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "risk_signal.review",
          targetType: "risk_signal",
          targetId: signal.id,
          afterJson: {
            status: updatedSignal.status,
            resolvedRestrictionCount,
            reviewedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted" as const,
        signalId: updatedSignal.id,
        status: updatedSignal.status as Extract<
          RiskSignalStatus,
          "resolved" | "dismissed"
        >,
        resolvedRestrictionCount
      };
    });
  }

  async applyRiskRestriction(
    input: ApplyRiskRestrictionInput
  ): Promise<ApplyRiskRestrictionResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const targetContext = await resolveRiskTargetContext(
        tx,
        input.scope,
        input.targetId
      );
      if (!targetContext) {
        return {
          result: "rejected" as const,
          errorCode: "RISK_TARGET_NOT_FOUND" as const
        };
      }

      await lockRiskTarget(tx, targetContext);
      const restrictionTarget = restrictionTargetForContext(targetContext);
      if (!restrictionTarget) {
        return {
          result: "rejected" as const,
          errorCode: "RISK_TARGET_NOT_FOUND" as const
        };
      }

      const restrictionId = await createRiskRestriction(tx, {
        target: restrictionTarget,
        type: input.type,
        reason: input.reason,
        imposedByUserId: input.platformAdminUserId,
        expiresAt: input.expiresAt,
        now
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "risk_restriction.apply",
          targetType: "risk_restriction",
          targetId: restrictionId,
          reason: input.reason,
          afterJson: {
            type: input.type,
            scope: input.scope,
            targetId: input.targetId,
            expiresAt: input.expiresAt?.toISOString() ?? null,
            appliedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted" as const,
        restrictionId,
        status: "active" as const
      };
    });
  }

  async resolveRiskRestriction(
    input: ResolveRiskRestrictionInput
  ): Promise<ResolveRiskRestrictionResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const updated = await this.prisma.riskRestriction.updateMany({
      where: {
        id: input.restrictionId,
        status: "active"
      },
      data: {
        status: "resolved",
        resolvedAt: now
      }
    });

    if (updated.count !== 1) {
      return {
        result: "rejected",
        errorCode: "RISK_RESTRICTION_NOT_FOUND"
      };
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.platformAdminUserId,
        action: "risk_restriction.resolve",
        targetType: "risk_restriction",
        targetId: input.restrictionId,
        reason: input.resolutionText,
        afterJson: {
          resolvedAt: now.toISOString()
        }
      }
    });

    return {
      result: "accepted",
      restrictionId: input.restrictionId,
      status: "resolved"
    };
  }

  private async isActiveMfaPlatformAdmin(userId: string): Promise<boolean> {
    const platformAdmin = await this.prisma.adminProfile.findUnique({
      where: {
        userId
      },
      select: {
        role: true,
        status: true,
        mfaEnabled: true
      }
    });

    return Boolean(
      platformAdmin &&
        platformAdmin.role === "platform_admin" &&
        platformAdmin.status === "active" &&
        platformAdmin.mfaEnabled
    );
  }
}

async function createRiskRestriction(
  tx: Prisma.TransactionClient,
  input: {
    target: RestrictionTargetData;
    type: RiskRestrictionType;
    riskSignalId?: string;
    reason: string;
    imposedByUserId?: string;
    expiresAt?: Date;
    now: Date;
  }
): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "RiskRestriction" (
      "id", "type", "scope", "targetId", "targetUserId",
      "communityMemberId", "communityId", "childId", "guardianId",
      "riskSignalId", "status", "reason", "imposedByUserId", "startsAt",
      "expiresAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${id},
      ${input.type}::"RiskRestrictionType",
      ${input.target.scope}::"RiskRestrictionScope",
      ${input.target.targetId},
      ${input.target.targetUserId ?? null},
      ${input.target.communityMemberId ?? null},
      ${input.target.communityId ?? null},
      ${input.target.childId ?? null},
      ${input.target.guardianId ?? null},
      ${input.riskSignalId ?? null},
      ${"active"}::"RiskRestrictionStatus",
      ${input.reason},
      ${input.imposedByUserId ?? null},
      ${input.now},
      ${input.expiresAt ?? null},
      ${input.now},
      ${input.now}
    )
  `;

  return id;
}

async function createRiskSignal(
  tx: Prisma.TransactionClient,
  input: RecordRiskSignalInput,
  targetContext: RiskTargetContext,
  now: Date
): Promise<{ id: string; status: RiskSignalStatus }> {
  const status = "under_review";

  switch (input.scope) {
    case "community": {
      const signal = await tx.riskSignal.create({
        data: {
          type: input.type,
          scope: input.scope,
          targetId: input.targetId,
          communityId: targetContext.communityId,
          evidenceJson: input.evidenceJson,
          status,
          createdAt: now
        }
      });

      return {
        id: signal.id,
        status: signal.status
      };
    }
    case "child": {
      const signal = await tx.riskSignal.create({
        data: {
          type: input.type,
          scope: input.scope,
          targetId: input.targetId,
          childId: targetContext.childId,
          evidenceJson: input.evidenceJson,
          status,
          createdAt: now
        }
      });

      return {
        id: signal.id,
        status: signal.status
      };
    }
    case "guardian": {
      const signal = await tx.riskSignal.create({
        data: {
          type: input.type,
          scope: input.scope,
          targetId: input.targetId,
          guardianId: targetContext.guardianId,
          evidenceJson: input.evidenceJson,
          status,
          createdAt: now
        }
      });

      return {
        id: signal.id,
        status: signal.status
      };
    }
    case "user": {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "RiskSignal" (
          "id", "type", "scope", "targetId", "targetUserId",
          "evidenceJson", "status", "createdAt", "updatedAt"
        )
        VALUES (
          ${id},
          ${input.type}::"RiskSignalType",
          ${input.scope}::"RiskRestrictionScope",
          ${input.targetId},
          ${targetContext.userId},
          ${JSON.stringify(input.evidenceJson)}::jsonb,
          ${status}::"RiskSignalStatus",
          ${now},
          ${now}
        )
      `;

      return {
        id,
        status
      };
    }
    case "community_member": {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "RiskSignal" (
          "id", "type", "scope", "targetId", "communityMemberId",
          "communityId", "childId", "evidenceJson", "status",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${id},
          ${input.type}::"RiskSignalType",
          ${input.scope}::"RiskRestrictionScope",
          ${input.targetId},
          ${targetContext.communityMemberId},
          ${targetContext.communityId},
          ${targetContext.childId},
          ${JSON.stringify(input.evidenceJson)}::jsonb,
          ${status}::"RiskSignalStatus",
          ${now},
          ${now}
        )
      `;

      return {
        id,
        status
      };
    }
  }
}

async function resolveRiskTargetContext(
  tx: Prisma.TransactionClient,
  scope: RiskRestrictionScope,
  targetId: string
): Promise<RiskTargetContext | null> {
  switch (scope) {
    case "user": {
      const user = await tx.user.findUnique({
        where: {
          id: targetId
        },
        select: {
          id: true
        }
      });

      return user
        ? {
            userId: user.id,
            guardianId: null,
            childId: null,
            communityId: null,
            communityMemberId: null
          }
        : null;
    }
    case "guardian": {
      const guardian = await tx.guardianProfile.findUnique({
        where: {
          id: targetId
        },
        select: {
          id: true,
          userId: true
        }
      });

      return guardian
        ? {
            userId: guardian.userId,
            guardianId: guardian.id,
            childId: null,
            communityId: null,
            communityMemberId: null
          }
        : null;
    }
    case "child": {
      const child = await tx.childProfile.findUnique({
        where: {
          id: targetId
        },
        select: {
          id: true,
          userId: true,
          guardianLinks: {
            where: {
              role: "primary",
              status: "active"
            },
            select: {
              guardianId: true
            },
            take: 1
          }
        }
      });

      return child
        ? {
            userId: child.userId,
            guardianId: child.guardianLinks[0]?.guardianId ?? null,
            childId: child.id,
            communityId: null,
            communityMemberId: null
          }
        : null;
    }
    case "community": {
      const community = await tx.auctionCommunity.findUnique({
        where: {
          id: targetId
        },
        select: {
          id: true
        }
      });

      return community
        ? {
            userId: null,
            guardianId: null,
            childId: null,
            communityId: community.id,
            communityMemberId: null
          }
        : null;
    }
    case "community_member": {
      const member = await tx.communityMember.findUnique({
        where: {
          id: targetId
        },
        select: {
          id: true,
          communityId: true,
          childId: true,
          child: {
            select: {
              userId: true,
              guardianLinks: {
                where: {
                  role: "primary",
                  status: "active"
                },
                select: {
                  guardianId: true
                },
                take: 1
              }
            }
          }
        }
      });

      return member
        ? {
            userId: member.child.userId,
            guardianId: member.child.guardianLinks[0]?.guardianId ?? null,
            childId: member.childId,
            communityId: member.communityId,
            communityMemberId: member.id
          }
        : null;
    }
  }
}

async function lockRiskTarget(
  tx: Prisma.TransactionClient,
  targetContext: RiskTargetContext
) {
  if (targetContext.childId) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ChildProfile"
      WHERE "id" = ${targetContext.childId}
      FOR UPDATE
    `;
  }

  if (targetContext.communityId) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AuctionCommunity"
      WHERE "id" = ${targetContext.communityId}
      FOR UPDATE
    `;
  }
}

async function isAuthorizedRiskSignalActor(
  tx: Prisma.TransactionClient,
  actorUserId: string | undefined,
  targetContext: RiskTargetContext
): Promise<boolean> {
  if (!actorUserId) {
    return true;
  }

  const platformAdmin = await tx.adminProfile.findFirst({
    where: {
      userId: actorUserId,
      role: "platform_admin",
      status: "active",
      mfaEnabled: true
    },
    select: {
      id: true
    }
  });
  if (platformAdmin) {
    return true;
  }

  if (!targetContext.communityId) {
    return false;
  }

  const scopedActivityAdmin = await tx.adminProfile.findFirst({
    where: {
      userId: actorUserId,
      role: "activity_admin",
      status: "active",
      mfaEnabled: true,
      communityScopes: {
        some: {
          communityId: targetContext.communityId,
          status: "active"
        }
      }
    },
    select: {
      id: true
    }
  });

  return Boolean(scopedActivityAdmin);
}

function restrictionTypesForSignal(
  signalType: RiskSignalType
): RiskRestrictionType[] {
  switch (signalType) {
    case "adult_impersonation_suspected":
      return ["suspended"];
    case "abnormal_join_pattern":
      return ["suspended", "no_join"];
    case "contact_inducement_suspected":
      return ["suspended", "no_publish", "no_transaction_confirm"];
    case "cross_community_anomaly":
      return ["suspended", "no_join", "no_bid"];
    case "guardian_account_takeover_suspected":
      return [
        "suspended",
        "no_export",
        "no_delete",
        "no_transaction_confirm",
        "sensitive_challenge_required"
      ];
  }
}

function restrictionTargetForContext(
  targetContext: RiskTargetContext
): RestrictionTargetData | null {
  if (targetContext.communityMemberId) {
    return {
      scope: "community_member",
      targetId: targetContext.communityMemberId,
      communityMemberId: targetContext.communityMemberId,
      communityId: targetContext.communityId,
      childId: targetContext.childId
    };
  }

  if (targetContext.childId) {
    return {
      scope: "child",
      targetId: targetContext.childId,
      childId: targetContext.childId
    };
  }

  if (targetContext.guardianId) {
    return {
      scope: "guardian",
      targetId: targetContext.guardianId,
      guardianId: targetContext.guardianId
    };
  }

  if (targetContext.userId) {
    return {
      scope: "user",
      targetId: targetContext.userId,
      targetUserId: targetContext.userId
    };
  }

  if (targetContext.communityId) {
    return {
      scope: "community",
      targetId: targetContext.communityId,
      communityId: targetContext.communityId
    };
  }

  return null;
}
