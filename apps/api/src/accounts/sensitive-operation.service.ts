import type { Prisma, PrismaClient, RiskRestrictionType } from "@prisma/client";
import { SessionService } from "./session.service.js";

export const SensitiveOperationType = {
  createCommunity: "create_community",
  exportChildData: "export_child_data",
  deleteChildProfile: "delete_child_profile",
  confirmTransaction: "confirm_transaction",
  changeChildPermissions: "change_child_permissions"
} as const;

export type SensitiveOperationType =
  (typeof SensitiveOperationType)[keyof typeof SensitiveOperationType];

const REQUIRED_OPERATIONS = new Set<string>(Object.values(SensitiveOperationType));
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type CreateSensitiveOperationChallengeInput = {
  actorUserId: string;
  operationType: string;
  targetType: string;
  targetId: string;
  riskLabels: string[];
  now?: Date;
};

export type CreateSensitiveOperationChallengeResult = {
  result: "accepted";
  challengeId: string;
  actorUserId: string;
  operationType: string;
  targetType: string;
  targetId: string;
  expiresAt: string;
  status: "pending";
};

export type MarkSensitiveOperationChallengePassedInput = {
  challengeId: string;
  actorUserId: string;
  now?: Date;
};

export type MarkSensitiveOperationChallengePassedResult =
  | {
      result: "accepted";
      challengeId: string;
      actorUserId: string;
      status: "passed";
      passedAt: string;
      expiresAt: string;
    }
  | {
      result: "rejected";
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED" | "SENSITIVE_CHALLENGE_EXPIRED";
    };

export type AuthorizeSensitiveOperationInput = {
  actorUserId: string;
  operationType: string;
  targetType: string;
  targetId: string;
  sessionId: string;
  now?: Date;
};

export type AuthorizeSensitiveOperationResult =
  | {
      result: "accepted";
      actorUserId: string;
      operationType: string;
      targetType: string;
      targetId: string;
      challengeId: string | null;
    }
  | {
      result: "rejected";
      errorCode:
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SESSION_REVOKED"
        | "RISK_RESTRICTED"
        | "GUARDIAN_DISPUTE_FROZEN";
    };

export type ExpireActorChallengesInput = {
  actorUserId: string;
  reason: string;
  now?: Date;
};

export type ExpireActorChallengesResult = {
  result: "accepted";
  actorUserId: string;
  expiredChallengeCount: number;
};

export class SensitiveOperationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionService: SessionService
  ) {}

  async createChallenge(
    input: CreateSensitiveOperationChallengeInput
  ): Promise<CreateSensitiveOperationChallengeResult> {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const challenge = await this.prisma.sensitiveOperationChallenge.create({
      data: {
        actorUserId: input.actorUserId,
        operation: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        status: "pending",
        riskLabelsJson: input.riskLabels,
        expiresAt
      }
    });

    return {
      result: "accepted",
      challengeId: challenge.id,
      actorUserId: challenge.actorUserId,
      operationType: challenge.operation,
      targetType: challenge.targetType,
      targetId: challenge.targetId,
      expiresAt: challenge.expiresAt.toISOString(),
      status: "pending"
    };
  }

  async markPassed(
    input: MarkSensitiveOperationChallengePassedInput
  ): Promise<MarkSensitiveOperationChallengePassedResult> {
    const now = input.now ?? new Date();
    const challenge = await this.prisma.sensitiveOperationChallenge.findUnique({
      where: {
        id: input.challengeId
      }
    });

    if (!challenge || challenge.actorUserId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    if (challenge.expiresAt.getTime() <= now.getTime()) {
      if (challenge.status !== "expired") {
        await this.prisma.sensitiveOperationChallenge.updateMany({
          where: {
            id: challenge.id,
            status: {
              in: ["pending", "passed", "cooling_down"]
            }
          },
          data: {
            status: "expired"
          }
        });
      }

      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
      };
    }

    const passed = await this.prisma.sensitiveOperationChallenge.updateMany({
      where: {
        id: challenge.id,
        actorUserId: input.actorUserId,
        status: "pending",
        expiresAt: {
          gt: now
        }
      },
      data: {
        status: "passed",
        passedAt: now
      }
    });

    if (passed.count !== 1) {
      const currentChallenge =
        await this.prisma.sensitiveOperationChallenge.findUnique({
          where: {
            id: challenge.id
          }
        });

      if (
        currentChallenge?.status === "expired" ||
        (currentChallenge &&
          currentChallenge.expiresAt.getTime() <= now.getTime())
      ) {
        return {
          result: "rejected",
          errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
        };
      }

      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    const updated =
      await this.prisma.sensitiveOperationChallenge.findUniqueOrThrow({
        where: {
          id: challenge.id
        }
      });

    return {
      result: "accepted",
      challengeId: updated.id,
      actorUserId: updated.actorUserId,
      status: "passed",
      passedAt: updated.passedAt?.toISOString() ?? now.toISOString(),
      expiresAt: updated.expiresAt.toISOString()
    };
  }

  async authorize(
    input: AuthorizeSensitiveOperationInput
  ): Promise<AuthorizeSensitiveOperationResult> {
    const now = input.now ?? new Date();
    const activeSession = await this.sessionService.assertActiveSession({
      userId: input.actorUserId,
      sessionId: input.sessionId,
      now
    });
    if (activeSession.result !== "accepted") {
      return {
        result: "rejected",
        errorCode: "SESSION_REVOKED"
      };
    }

    if (
      await this.hasActiveRiskRestriction(
        input.actorUserId,
        input.operationType,
        input.targetType,
        input.targetId,
        now
      )
    ) {
      return {
        result: "rejected",
        errorCode: "RISK_RESTRICTED"
      };
    }

    if (await this.hasFrozenGuardianDispute(input.targetType, input.targetId)) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_DISPUTE_FROZEN"
      };
    }

    if (!REQUIRED_OPERATIONS.has(input.operationType)) {
      return {
        result: "accepted",
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: null
      };
    }

    const passedChallenge =
      await this.prisma.sensitiveOperationChallenge.findFirst({
        where: {
          actorUserId: input.actorUserId,
          operation: input.operationType,
          targetType: input.targetType,
          targetId: input.targetId,
          status: "passed",
          expiresAt: {
            gt: now
          }
        },
        orderBy: [{ passedAt: "desc" }, { createdAt: "desc" }]
      });

    if (passedChallenge) {
      return {
        result: "accepted",
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: passedChallenge.id
      };
    }

    const challenge = await this.prisma.sensitiveOperationChallenge.findFirst({
      where: {
        actorUserId: input.actorUserId,
        operation: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId
      },
      orderBy: [{ passedAt: "desc" }, { createdAt: "desc" }]
    });

    if (!challenge) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    const isExpired = challenge.expiresAt.getTime() <= now.getTime();
    if (
      isExpired &&
      (challenge.status === "pending" || challenge.status === "passed")
    ) {
      await this.prisma.sensitiveOperationChallenge.updateMany({
        where: {
          id: challenge.id,
          status: {
            in: ["pending", "passed", "cooling_down"]
          }
        },
        data: {
          status: "expired"
        }
      });
    }

    if (isExpired || challenge.status === "expired") {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
      };
    }

    return {
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    };
  }

  async expireActorChallenges(
    input: ExpireActorChallengesInput
  ): Promise<ExpireActorChallengesResult> {
    const now = input.now ?? new Date();
    const expired = await this.prisma.sensitiveOperationChallenge.updateMany({
      where: {
        actorUserId: input.actorUserId,
        status: {
          in: ["pending", "passed", "cooling_down"]
        }
      },
      data: {
        status: "expired",
        expiresAt: now
      }
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "sensitive_operation_challenge.expire_all",
        targetType: "user",
        targetId: input.actorUserId,
        reason: input.reason,
        afterJson: {
          expiredChallengeCount: expired.count
        }
      }
    });

    return {
      result: "accepted",
      actorUserId: input.actorUserId,
      expiredChallengeCount: expired.count
    };
  }

  private async hasActiveRiskRestriction(
    actorUserId: string,
    operationType: string,
    targetType: string,
    targetId: string,
    now: Date
  ): Promise<boolean> {
    const matchingRestrictionTypes = riskRestrictionTypesForOperation(
      operationType
    );
    const actor = await this.prisma.user.findUnique({
      where: {
        id: actorUserId
      },
      select: {
        guardianProfile: {
          select: {
            id: true
          }
        },
        childProfile: {
          select: {
            id: true
          }
        }
      }
    });
    const targetContext = await this.resolveTargetContext(targetType, targetId);
    const filters: Prisma.RiskRestrictionWhereInput[] = [
      {
        scope: "user",
        targetId: actorUserId
      }
    ];

    if (actor?.guardianProfile?.id) {
      filters.push({
        scope: "guardian",
        targetId: actor.guardianProfile.id
      });
      filters.push({
        guardianId: actor.guardianProfile.id
      });
    }

    if (actor?.childProfile?.id) {
      filters.push({
        scope: "child",
        targetId: actor.childProfile.id
      });
      filters.push({
        childId: actor.childProfile.id
      });
    }

    for (const userId of targetContext.userIds) {
      filters.push({
        scope: "user",
        targetId: userId
      });
    }

    for (const guardianId of targetContext.guardianIds) {
      filters.push({
        scope: "guardian",
        targetId: guardianId
      });
      filters.push({
        guardianId
      });
    }

    for (const childId of targetContext.childIds) {
      filters.push({
        scope: "child",
        targetId: childId
      });
      filters.push({
        childId
      });
    }

    for (const communityId of targetContext.communityIds) {
      filters.push({
        scope: "community",
        targetId: communityId
      });
      filters.push({
        communityId
      });
    }

    for (const communityMemberId of targetContext.communityMemberIds) {
      filters.push({
        scope: "community_member",
        targetId: communityMemberId
      });
    }

    const restriction = await this.prisma.riskRestriction.findFirst({
      where: {
        status: "active",
        type: {
          in: matchingRestrictionTypes
        },
        startsAt: {
          lte: now
        },
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
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

  private async hasFrozenGuardianDispute(
    targetType: string,
    targetId: string
  ): Promise<boolean> {
    const targetContext = await this.resolveTargetContext(targetType, targetId);
    if (targetContext.childIds.length === 0) {
      return false;
    }

    const dispute = await this.prisma.guardianDispute.findFirst({
      where: {
        childId: {
          in: targetContext.childIds
        },
        status: "frozen"
      },
      select: {
        id: true
      }
    });

    return Boolean(dispute);
  }

  private async resolveTargetContext(targetType: string, targetId: string) {
    const context = {
      userIds: [] as string[],
      guardianIds: [] as string[],
      childIds: [] as string[],
      communityIds: [] as string[],
      communityMemberIds: [] as string[]
    };

    switch (targetType) {
      case "user":
      case "user_profile":
        context.userIds.push(targetId);
        break;
      case "guardian":
      case "guardian_profile":
        context.guardianIds.push(targetId);
        break;
      case "child":
      case "child_profile":
        context.childIds.push(targetId);
        break;
      case "community":
      case "auction_community":
        context.communityIds.push(targetId);
        break;
      case "community_member": {
        context.communityMemberIds.push(targetId);
        const member = await this.prisma.communityMember.findUnique({
          where: {
            id: targetId
          },
          select: {
            childId: true,
            communityId: true
          }
        });

        if (member) {
          context.childIds.push(member.childId);
          context.communityIds.push(member.communityId);
        }
        break;
      }
      case "transaction": {
        const transaction = await this.prisma.transaction.findUnique({
          where: {
            id: targetId
          },
          select: {
            buyerChildId: true,
            sellerChildId: true,
            auctionSession: {
              select: {
                item: {
                  select: {
                    communityId: true
                  }
                }
              }
            }
          }
        });

        if (transaction) {
          context.childIds.push(
            transaction.buyerChildId,
            transaction.sellerChildId
          );
          context.communityIds.push(transaction.auctionSession.item.communityId);
        }
        break;
      }
      default:
        break;
    }

    return {
      userIds: dedupe(context.userIds),
      guardianIds: dedupe(context.guardianIds),
      childIds: dedupe(context.childIds),
      communityIds: dedupe(context.communityIds),
      communityMemberIds: dedupe(context.communityMemberIds)
    };
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function riskRestrictionTypesForOperation(
  operationType: string
): RiskRestrictionType[] {
  const universalRestrictions: RiskRestrictionType[] = ["suspended"];

  switch (operationType) {
    case SensitiveOperationType.exportChildData:
      return [...universalRestrictions, "no_export"];
    case SensitiveOperationType.deleteChildProfile:
      return [...universalRestrictions, "no_delete"];
    case SensitiveOperationType.confirmTransaction:
      return [...universalRestrictions, "no_transaction_confirm"];
    default:
      return universalRestrictions;
  }
}
