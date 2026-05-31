import type {
  Prisma,
  PrismaClient,
  RiskRestrictionType,
  SensitiveOperationChallengeStatus
} from "@prisma/client";
import {
  getChallengeSessionId,
  SensitiveOperationType
} from "./sensitive-operation.service.js";
import { SessionService } from "./session.service.js";

export type ChildParticipationAction =
  | "join_community"
  | "browse_community"
  | "publish"
  | "bid"
  | "transaction_confirm"
  | "export"
  | "delete";

export type EvaluateChildParticipationInput = {
  actorUserId?: string;
  childId: string;
  action: ChildParticipationAction;
  communityId?: string;
  amountPoints?: number;
  sensitiveChallengeId?: string;
  sessionId?: string;
  now?: Date;
};

export type ChildParticipationDecision =
  | {
      result: "accepted";
    }
  | {
      result: "rejected";
      errorCode:
        | "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        | "GUARDIAN_DISPUTE_FROZEN"
        | "RISK_RESTRICTED"
        | "GUARDIAN_CONTROL_DISABLED"
        | "COMMUNITY_MEMBER_REQUIRED"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "MAX_BID_POINTS_EXCEEDED";
    };

type ChildParticipationContext = {
  primaryGuardianId: string;
  primaryGuardianUserId: string;
  settings: {
    canPublish: boolean;
    canBid: boolean;
    maxBidPoints: number | null;
  } | null;
};

export class ChildParticipationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionService: SessionService
  ) {}

  async evaluateChildParticipation(
    input: EvaluateChildParticipationInput
  ): Promise<ChildParticipationDecision> {
    const now = input.now ?? new Date();
    const context = await this.getChildContext(input.childId);

    if (!context) {
      return {
        result: "rejected",
        errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
      };
    }

    if (await this.hasFrozenGuardianDispute(input.childId)) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_DISPUTE_FROZEN"
      };
    }

    if (
      await this.hasActiveRiskRestriction({
        action: input.action,
        childId: input.childId,
        primaryGuardianId: context.primaryGuardianId,
        primaryGuardianUserId: context.primaryGuardianUserId,
        communityId: input.communityId,
        now
      })
    ) {
      return {
        result: "rejected",
        errorCode: "RISK_RESTRICTED"
      };
    }

    switch (input.action) {
      case "join_community":
        return {
          result: "accepted"
        };
      case "browse_community":
        return this.evaluateBrowseCommunity(input.childId, input.communityId);
      case "publish":
        return context.settings?.canPublish
          ? { result: "accepted" }
          : {
              result: "rejected",
              errorCode: "GUARDIAN_CONTROL_DISABLED"
            };
      case "bid":
        return this.evaluateBid(input.amountPoints, context.settings);
      case "transaction_confirm":
      case "export":
      case "delete":
        return (await this.hasFreshSensitiveChallenge({
          action: input.action,
          actorUserId: input.actorUserId,
          challengeId: input.sensitiveChallengeId,
          sessionId: input.sessionId,
          childId: input.childId,
          primaryGuardianUserId: context.primaryGuardianUserId,
          now
        }))
          ? { result: "accepted" }
          : {
              result: "rejected",
              errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
            };
      default:
        return {
          result: "accepted"
        };
    }
  }

  private async getChildContext(
    childId: string
  ): Promise<ChildParticipationContext | null> {
    const child = await this.prisma.childProfile.findUnique({
      where: {
        id: childId
      },
      select: {
        guardianSettings: {
          select: {
            canPublish: true,
            canBid: true,
            maxBidPoints: true
          }
        },
        guardianLinks: {
          where: {
            role: "primary",
            status: "active",
            guardian: {
              status: "active"
            }
          },
          select: {
            guardianId: true,
            guardian: {
              select: {
                userId: true
              }
            }
          },
          take: 1
        }
      }
    });

    const primaryGuardian = child?.guardianLinks[0];
    if (!primaryGuardian) {
      return null;
    }

    return {
      primaryGuardianId: primaryGuardian.guardianId,
      primaryGuardianUserId: primaryGuardian.guardian.userId,
      settings: child?.guardianSettings ?? null
    };
  }

  private async evaluateBrowseCommunity(
    childId: string,
    communityId?: string
  ): Promise<ChildParticipationDecision> {
    if (!communityId) {
      return {
        result: "accepted"
      };
    }

    const membership = await this.prisma.communityMember.findUnique({
      where: {
        communityId_childId: {
          communityId,
          childId
        }
      },
      select: {
        status: true
      }
    });

    if (membership?.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_MEMBER_REQUIRED"
      };
    }

    return {
      result: "accepted"
    };
  }

  private evaluateBid(
    amountPoints: number | undefined,
    settings: ChildParticipationContext["settings"]
  ): ChildParticipationDecision {
    if (!settings?.canBid) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_CONTROL_DISABLED"
      };
    }

    if (
      settings.maxBidPoints !== null &&
      settings.maxBidPoints !== undefined &&
      amountPoints !== undefined &&
      amountPoints > settings.maxBidPoints
    ) {
      return {
        result: "rejected",
        errorCode: "MAX_BID_POINTS_EXCEEDED"
      };
    }

    return {
      result: "accepted"
    };
  }

  private async hasFrozenGuardianDispute(childId: string): Promise<boolean> {
    const dispute = await this.prisma.guardianDispute.findFirst({
      where: {
        childId,
        status: "frozen"
      },
      select: {
        id: true
      }
    });

    return Boolean(dispute);
  }

  private async hasActiveRiskRestriction(input: {
    action: ChildParticipationAction;
    childId: string;
    primaryGuardianId: string;
    primaryGuardianUserId: string;
    communityId?: string;
    now: Date;
  }): Promise<boolean> {
    const matchingTypes = riskRestrictionTypesForAction(input.action);
    const filters: Prisma.RiskRestrictionWhereInput[] = [
      {
        scope: "child",
        targetId: input.childId
      },
      {
        childId: input.childId
      },
      {
        scope: "guardian",
        targetId: input.primaryGuardianId
      },
      {
        guardianId: input.primaryGuardianId
      },
      {
        scope: "user",
        targetId: input.primaryGuardianUserId
      }
    ];

    if (input.communityId) {
      filters.push({
        scope: "community",
        targetId: input.communityId
      });
      filters.push({
        communityId: input.communityId
      });
    }

    const restriction = await this.prisma.riskRestriction.findFirst({
      where: {
        status: "active",
        type: {
          in: matchingTypes
        },
        startsAt: {
          lte: input.now
        },
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }]
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

  private async hasFreshSensitiveChallenge(input: {
    action: Extract<
      ChildParticipationAction,
      "transaction_confirm" | "export" | "delete"
    >;
    actorUserId?: string;
    challengeId?: string;
    sessionId?: string;
    childId: string;
    primaryGuardianUserId: string;
    now: Date;
  }): Promise<boolean> {
    if (
      !input.actorUserId ||
      input.actorUserId !== input.primaryGuardianUserId ||
      !input.challengeId ||
      !input.sessionId
    ) {
      return false;
    }

    const activeSession = await this.sessionService.assertActiveSession({
      userId: input.actorUserId,
      sessionId: input.sessionId,
      now: input.now
    });
    if (activeSession.result !== "accepted") {
      return false;
    }

    const challenge = await this.prisma.sensitiveOperationChallenge.findUnique({
      where: {
        id: input.challengeId
      },
      select: {
        id: true,
        actorUserId: true,
        operation: true,
        targetType: true,
        targetId: true,
        status: true,
        expiresAt: true,
        riskLabelsJson: true
      }
    });

    if (
      !challenge ||
      challenge.actorUserId !== input.actorUserId ||
      challenge.operation !== sensitiveOperationTypeForAction(input.action) ||
      getChallengeSessionId(challenge.riskLabelsJson) !== input.sessionId ||
      challenge.targetType !== "child_profile" ||
      challenge.targetId !== input.childId
    ) {
      return false;
    }

    const expired = challenge.expiresAt.getTime() <= input.now.getTime();
    if (expired || challenge.status === "expired") {
      if (expired && canAutoExpireChallenge(challenge.status)) {
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

      return false;
    }

    return challenge.status === "passed";
  }
}

function canAutoExpireChallenge(
  status: SensitiveOperationChallengeStatus
): boolean {
  return status === "pending" || status === "passed" || status === "cooling_down";
}

function riskRestrictionTypesForAction(
  action: ChildParticipationAction
): RiskRestrictionType[] {
  const universalRestrictions: RiskRestrictionType[] = ["suspended"];

  switch (action) {
    case "join_community":
      return [...universalRestrictions, "no_join"];
    case "publish":
      return [...universalRestrictions, "no_publish"];
    case "bid":
      return [...universalRestrictions, "no_bid"];
    case "transaction_confirm":
      return [...universalRestrictions, "no_transaction_confirm"];
    case "export":
      return [...universalRestrictions, "no_export"];
    case "delete":
      return [...universalRestrictions, "no_delete"];
    default:
      return universalRestrictions;
  }
}

function sensitiveOperationTypeForAction(
  action: Extract<ChildParticipationAction, "transaction_confirm" | "export" | "delete">
) {
  switch (action) {
    case "transaction_confirm":
      return SensitiveOperationType.confirmTransaction;
    case "export":
      return SensitiveOperationType.exportChildData;
    case "delete":
      return SensitiveOperationType.deleteChildProfile;
  }
}
