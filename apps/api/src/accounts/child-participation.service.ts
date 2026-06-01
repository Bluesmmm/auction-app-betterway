import type {
  Prisma,
  PrismaClient,
  RiskRestrictionType
} from "@prisma/client";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "./sensitive-operation.service.js";

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
        | "ACTOR_NOT_AUTHORIZED"
        | "CHILD_NOT_ACTIVE"
        | "GUARDIAN_DISPUTE_FROZEN"
        | "RISK_RESTRICTED"
        | "GUARDIAN_CONTROL_DISABLED"
        | "COMMUNITY_ID_REQUIRED"
        | "COMMUNITY_MEMBER_REQUIRED"
        | "COMMUNITY_NOT_ACTIVE"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SESSION_REVOKED"
        | "DEVICE_NOT_TRUSTED"
        | "MAX_BID_POINTS_EXCEEDED";
    };

type ChildParticipationContext = {
  childStatus: string;
  childUserId: string | null;
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
    private readonly sensitiveOperations: SensitiveOperationService
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

    if (context.childStatus !== "active") {
      return {
        result: "rejected",
        errorCode: "CHILD_NOT_ACTIVE"
      };
    }

    if (!canActorRepresentChild(input.actorUserId, context)) {
      return {
        result: "rejected",
        errorCode: "ACTOR_NOT_AUTHORIZED"
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
        actorUserId: input.actorUserId,
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
        if (!input.communityId) {
          return {
            result: "rejected",
            errorCode: "COMMUNITY_ID_REQUIRED"
          };
        }
        return this.evaluateBrowseCommunity(input.childId, input.communityId);
      case "publish":
        if (!input.communityId) {
          return {
            result: "rejected",
            errorCode: "COMMUNITY_ID_REQUIRED"
          };
        }

        {
          const membership = await this.evaluateCommunityMembership(
            input.childId,
            input.communityId
          );
          if (membership.result === "rejected") {
            return membership;
          }
        }

        return context.settings?.canPublish
          ? { result: "accepted" }
          : {
              result: "rejected",
              errorCode: "GUARDIAN_CONTROL_DISABLED"
            };
      case "bid":
        if (!input.communityId) {
          return {
            result: "rejected",
            errorCode: "COMMUNITY_ID_REQUIRED"
          };
        }

        {
          const membership = await this.evaluateCommunityMembership(
            input.childId,
            input.communityId
          );
          if (membership.result === "rejected") {
            return membership;
          }
        }

        return this.evaluateBid(input.amountPoints, context.settings);
      case "transaction_confirm":
      case "export":
      case "delete": {
        const challengeAuthorization = await this.hasFreshSensitiveChallenge({
          action: input.action,
          actorUserId: input.actorUserId,
          challengeId: input.sensitiveChallengeId,
          sessionId: input.sessionId,
          childId: input.childId,
          primaryGuardianUserId: context.primaryGuardianUserId,
          now
        });
        return challengeAuthorization.result === "accepted"
          ? { result: "accepted" }
          : challengeAuthorization;
      }
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
        status: true,
        userId: true,
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
    if (!child || !primaryGuardian) {
      return null;
    }

    return {
      childStatus: child.status,
      childUserId: child.userId,
      primaryGuardianId: primaryGuardian.guardianId,
      primaryGuardianUserId: primaryGuardian.guardian.userId,
      settings: child?.guardianSettings ?? null
    };
  }

  private async evaluateBrowseCommunity(
    childId: string,
    communityId: string
  ): Promise<ChildParticipationDecision> {
    return this.evaluateCommunityMembership(childId, communityId);
  }

  private async evaluateCommunityMembership(
    childId: string,
    communityId: string
  ): Promise<ChildParticipationDecision> {
    const membership = await this.prisma.communityMember.findUnique({
      where: {
        communityId_childId: {
          communityId,
          childId
        }
      },
      select: {
        status: true,
        community: {
          select: {
            status: true
          }
        }
      }
    });

    if (membership?.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_MEMBER_REQUIRED"
      };
    }

    if (membership.community.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_NOT_ACTIVE"
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
    actorUserId?: string;
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
        scope: "guardian",
        targetId: input.primaryGuardianId
      },
      {
        scope: "user",
        targetId: input.primaryGuardianUserId
      }
    ];

    if (
      input.actorUserId &&
      input.actorUserId !== input.primaryGuardianUserId
    ) {
      filters.push({
        scope: "user",
        targetId: input.actorUserId
      });
    }

    if (input.communityId) {
      filters.push({
        scope: "community",
        targetId: input.communityId
      });
      filters.push({
        scope: "community_member",
        childId: input.childId,
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
  }): Promise<
    | { result: "accepted" }
    | Extract<ChildParticipationDecision, { result: "rejected" }>
  > {
    if (
      !input.actorUserId ||
      input.actorUserId !== input.primaryGuardianUserId ||
      !input.challengeId ||
      !input.sessionId
    ) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    const authorization = await this.sensitiveOperations.authorizeFreshChallenge({
      actorUserId: input.actorUserId,
      operationType: sensitiveOperationTypeForAction(input.action),
      targetType: "child_profile",
      targetId: input.childId,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      now: input.now
    });

    return authorization.result === "accepted"
      ? { result: "accepted" }
      : authorization;
  }
}

function canActorRepresentChild(
  actorUserId: string | undefined,
  context: ChildParticipationContext
): boolean {
  return Boolean(
    actorUserId &&
      (actorUserId === context.primaryGuardianUserId ||
        actorUserId === context.childUserId)
  );
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
