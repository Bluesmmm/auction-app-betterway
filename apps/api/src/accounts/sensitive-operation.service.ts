import type { Prisma, PrismaClient, RiskRestrictionType } from "@prisma/client";
import { createHash, randomInt } from "node:crypto";
import type { SensitiveOperationVerificationProvider } from "../providers/provider-contracts.js";
import { SessionService } from "./session.service.js";

export const SensitiveOperationType = {
  createCommunity: "create_community",
  exportChildData: "export_child_data",
  deleteChildProfile: "delete_child_profile",
  confirmTransaction: "confirm_transaction",
  changeChildPermissions: "change_child_permissions",
  manageChildGuardians: "manage_child_guardians",
  resolveGuardianDispute: "resolve_guardian_dispute",
  grantActivityAdmin: "grant_activity_admin",
  revokeActivityAdmin: "revoke_activity_admin",
  applyRiskRestriction: "apply_risk_restriction",
  resolveRiskRestriction: "resolve_risk_restriction",
  reviewRiskSignal: "review_risk_signal",
  adjustPoints: "adjust_points",
  manageGovernanceControl: "manage_governance_control"
} as const;

export type SensitiveOperationType =
  (typeof SensitiveOperationType)[keyof typeof SensitiveOperationType];

const REQUIRED_OPERATIONS = new Set<string>(Object.values(SensitiveOperationType));
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_TTL_SECONDS = CHALLENGE_TTL_MS / 1000;
const SENSITIVE_DEVICE_COOLDOWN_MS = 2 * 60 * 1000;
export const ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE =
  "admin_community_scope_request";
export const GOVERNANCE_CONTROL_CHALLENGE_TARGET_TYPE =
  "governance_control_scope";

export type CreateSensitiveOperationChallengeInput = {
  actorUserId: string;
  sessionId: string;
  operationType: string;
  targetType: string;
  targetId: string;
  riskLabels?: string[];
  now?: Date;
};

export type CreateSensitiveOperationChallengeResult =
  | {
      result: "accepted";
      challengeId: string;
      actorUserId: string;
      operationType: string;
      targetType: string;
      targetId: string;
      expiresAt: string;
      status: "pending";
    }
  | {
      result: "rejected";
      errorCode:
        | "SESSION_REVOKED"
        | "SENSITIVE_CHALLENGE_DELIVERY_FAILED"
        | "SENSITIVE_OPERATION_NOT_SUPPORTED"
        | "SENSITIVE_CHALLENGE_TARGET_FORBIDDEN";
    };

export type MarkSensitiveOperationChallengePassedInput = {
  challengeId: string;
  actorUserId: string;
  sessionId: string;
  verificationCode: string;
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
      errorCode:
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SENSITIVE_CHALLENGE_VERIFICATION_FAILED"
        | "SESSION_REVOKED";
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
        | "DEVICE_NOT_TRUSTED"
        | "RISK_RESTRICTED"
        | "GUARDIAN_DISPUTE_FROZEN";
    };

export type AuthorizeFreshSensitiveChallengeInput = {
  actorUserId: string;
  operationType: string;
  targetType: string;
  targetId: string;
  sessionId: string;
  challengeId?: string;
  now?: Date;
};

export type AuthorizeFreshSensitiveChallengeResult =
  | {
      result: "accepted";
      actorUserId: string;
      operationType: string;
      targetType: string;
      targetId: string;
      challengeId: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SESSION_REVOKED"
        | "DEVICE_NOT_TRUSTED";
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
    private readonly sessionService: SessionService,
    private readonly verificationProvider: SensitiveOperationVerificationProvider,
    private readonly verificationCodeGenerator: () => string =
      generateSensitiveOperationVerificationCode
  ) {}

  async createChallenge(
    input: CreateSensitiveOperationChallengeInput
  ): Promise<CreateSensitiveOperationChallengeResult> {
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

    const challengeTarget = await this.authorizeChallengeTarget({
      actorUserId: input.actorUserId,
      operationType: input.operationType,
      targetType: input.targetType,
      targetId: input.targetId,
      now
    });
    if (challengeTarget.result === "rejected") {
      return challengeTarget;
    }

    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const verificationCode = this.verificationCodeGenerator();
    const riskLabelsJson = {
      labels: dedupe(input.riskLabels ?? []),
      sessionId: input.sessionId,
      verificationCodeHash:
        hashSensitiveOperationVerificationCode(verificationCode)
    };
    const challenge = await this.prisma.sensitiveOperationChallenge.create({
      data: {
        actorUserId: input.actorUserId,
        operation: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        status: "pending",
        riskLabelsJson,
        expiresAt
      }
    });

    const delivery = await this.verificationProvider.send({
      recipientUserId: input.actorUserId,
      challengeId: challenge.id,
      operationType: input.operationType,
      targetType: input.targetType,
      targetId: input.targetId,
      code: verificationCode,
      expiresAt,
      ttlSeconds: CHALLENGE_TTL_SECONDS
    });

    if (!delivery.ok) {
      await this.prisma.sensitiveOperationChallenge.updateMany({
        where: {
          id: challenge.id,
          status: "pending"
        },
        data: {
          status: "failed"
        }
      });
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_DELIVERY_FAILED"
      };
    }

    await this.prisma.sensitiveOperationChallenge.update({
      where: {
        id: challenge.id
      },
      data: {
        riskLabelsJson: {
          ...riskLabelsJson,
          verificationProviderMessageId: delivery.providerMessageId
        }
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

    const challenge = await this.prisma.sensitiveOperationChallenge.findUnique({
      where: {
        id: input.challengeId
      }
    });

    if (
      !challenge ||
      challenge.actorUserId !== input.actorUserId ||
      getChallengeSessionId(challenge.riskLabelsJson) !== input.sessionId
    ) {
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

    if (challenge.status !== "pending") {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    if (
      getChallengeVerificationCodeHash(challenge.riskLabelsJson) !==
      hashSensitiveOperationVerificationCode(input.verificationCode)
    ) {
      await this.prisma.sensitiveOperationChallenge.updateMany({
        where: {
          id: challenge.id,
          status: "pending"
        },
        data: {
          status: "failed"
        }
      });

      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_VERIFICATION_FAILED"
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
    await this.trustSessionDeviceForSensitiveOperations({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      riskLabelsJson: challenge.riskLabelsJson,
      now
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

    const challengeRequired =
      REQUIRED_OPERATIONS.has(input.operationType) ||
      (await this.hasActiveSensitiveChallengeRequiredRestriction(
        input.actorUserId,
        input.targetType,
        input.targetId,
        now
      ));

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

    if (
      input.operationType !== SensitiveOperationType.resolveGuardianDispute &&
      (await this.hasFrozenGuardianDispute(input.targetType, input.targetId))
    ) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_DISPUTE_FROZEN"
      };
    }

    if (!challengeRequired) {
      return {
        result: "accepted",
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: null
      };
    }

    const challengeAuthorization = await this.authorizeFreshChallenge({
      actorUserId: input.actorUserId,
      operationType: input.operationType,
      targetType: input.targetType,
      targetId: input.targetId,
      sessionId: input.sessionId,
      now
    });
    if (challengeAuthorization.result === "accepted") {
      return {
        result: "accepted",
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: challengeAuthorization.challengeId
      };
    }

    return challengeAuthorization;
  }

  async authorizeFreshChallenge(
    input: AuthorizeFreshSensitiveChallengeInput
  ): Promise<AuthorizeFreshSensitiveChallengeResult> {
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

    const challenges = input.challengeId
      ? await this.prisma.sensitiveOperationChallenge.findMany({
          where: {
            id: input.challengeId
          },
          orderBy: [{ passedAt: "desc" }, { createdAt: "desc" }],
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
        })
      : await this.prisma.sensitiveOperationChallenge.findMany({
          where: {
            actorUserId: input.actorUserId,
            operation: input.operationType,
            targetType: input.targetType,
            targetId: input.targetId
          },
          orderBy: [{ passedAt: "desc" }, { createdAt: "desc" }],
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
    const passedChallenge = challenges.find(
      (candidate) =>
        candidate.status === "passed" &&
        candidate.expiresAt.getTime() > now.getTime() &&
        getChallengeSessionId(candidate.riskLabelsJson) === input.sessionId
    );
    const challenge = passedChallenge ?? challenges.find(
      (candidate) =>
        getChallengeSessionId(candidate.riskLabelsJson) === input.sessionId
    );

    if (
      !challenge ||
      challenge.actorUserId !== input.actorUserId ||
      challenge.operation !== input.operationType ||
      challenge.targetType !== input.targetType ||
      challenge.targetId !== input.targetId
    ) {
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

    if (challenge.status === "passed") {
      if (
        !(await this.isSessionDeviceUsableForSensitiveOperations(
          input.actorUserId,
          input.sessionId,
          now
        ))
      ) {
        return {
          result: "rejected",
          errorCode: "DEVICE_NOT_TRUSTED"
        };
      }

      return {
        result: "accepted",
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: challenge.id
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

  private async authorizeChallengeTarget(input: {
    actorUserId: string;
    operationType: string;
    targetType: string;
    targetId: string;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | Extract<CreateSensitiveOperationChallengeResult, { result: "rejected" }>
  > {
    if (!REQUIRED_OPERATIONS.has(input.operationType)) {
      const hasStepUpRestriction =
        await this.hasActiveSensitiveChallengeRequiredRestriction(
          input.actorUserId,
          input.targetType,
          input.targetId,
          input.now
        );
      if (!hasStepUpRestriction) {
        return {
          result: "rejected",
          errorCode: "SENSITIVE_OPERATION_NOT_SUPPORTED"
        };
      }

      if (!(await this.actorCanRequestTargetChallenge(input))) {
        return {
          result: "rejected",
          errorCode: "SENSITIVE_CHALLENGE_TARGET_FORBIDDEN"
        };
      }

      return {
        result: "accepted"
      };
    }

    switch (input.operationType) {
      case SensitiveOperationType.createCommunity:
        return this.acceptIf(
          input.targetType === "guardian_profile" &&
            (await this.actorOwnsActiveGuardianProfile(
              input.actorUserId,
              input.targetId
            ))
        );
      case SensitiveOperationType.exportChildData:
      case SensitiveOperationType.deleteChildProfile:
      case SensitiveOperationType.changeChildPermissions:
      case SensitiveOperationType.manageChildGuardians:
        return this.acceptIf(
          input.targetType === "child_profile" &&
            (await this.actorHasActiveGuardianLinkToChild(
              input.actorUserId,
              input.targetId
            ))
        );
      case SensitiveOperationType.confirmTransaction:
        return this.acceptIf(
          (input.targetType === "child_profile" &&
            (await this.actorHasActiveGuardianLinkToChild(
              input.actorUserId,
              input.targetId
            ))) ||
            (input.targetType === "transaction" &&
              (await this.actorHasActiveGuardianLinkToTransactionChild(
                input.actorUserId,
                input.targetId
              )))
        );
      case SensitiveOperationType.resolveGuardianDispute:
        return this.acceptIf(
          input.targetType === "guardian_dispute" &&
            (await this.isActiveMfaPlatformAdmin(input.actorUserId))
        );
      case SensitiveOperationType.grantActivityAdmin:
      case SensitiveOperationType.revokeActivityAdmin:
        return this.acceptIf(
          input.targetType === ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE &&
            (await this.canRequestAdminCommunityScopeChallenge(input))
        );
      case SensitiveOperationType.applyRiskRestriction:
        return this.acceptIf(
          (await this.isActiveMfaPlatformAdmin(input.actorUserId)) &&
            (await this.sensitiveTargetExists(input.targetType, input.targetId))
        );
      case SensitiveOperationType.resolveRiskRestriction:
        return this.acceptIf(
          input.targetType === "risk_restriction" &&
            (await this.isActiveMfaPlatformAdmin(input.actorUserId)) &&
            (await this.activeRiskRestrictionExists(input.targetId))
        );
      case SensitiveOperationType.reviewRiskSignal:
        return this.acceptIf(
          input.targetType === "risk_signal" &&
            (await this.isActiveMfaPlatformAdmin(input.actorUserId)) &&
            (await this.activeRiskSignalExists(input.targetId))
        );
      case SensitiveOperationType.adjustPoints:
        return this.acceptIf(
          (await this.isActiveMfaPlatformAdmin(input.actorUserId)) &&
            ((input.targetType === "child_profile" &&
              (await this.sensitiveTargetExists(input.targetType, input.targetId))) ||
              (input.targetType === "point_adjustment_request" &&
                (await this.sensitiveTargetExists(input.targetType, input.targetId))))
        );
      case SensitiveOperationType.manageGovernanceControl:
        return this.acceptIf(
          input.targetType === GOVERNANCE_CONTROL_CHALLENGE_TARGET_TYPE &&
            (await this.canRequestGovernanceControlChallenge({
              actorUserId: input.actorUserId,
              targetId: input.targetId
            }))
        );
      default:
        return {
          result: "rejected",
          errorCode: "SENSITIVE_OPERATION_NOT_SUPPORTED"
        };
    }
  }

  private acceptIf(
    accepted: boolean
  ):
    | { result: "accepted" }
    | Extract<CreateSensitiveOperationChallengeResult, { result: "rejected" }> {
    return accepted
      ? { result: "accepted" }
      : {
          result: "rejected",
          errorCode: "SENSITIVE_CHALLENGE_TARGET_FORBIDDEN"
        };
  }

  private async actorCanRequestTargetChallenge(input: {
    actorUserId: string;
    targetType: string;
    targetId: string;
  }): Promise<boolean> {
    switch (input.targetType) {
      case "user":
      case "user_profile":
        return input.targetId === input.actorUserId;
      case "guardian":
      case "guardian_profile":
        return this.actorOwnsActiveGuardianProfile(
          input.actorUserId,
          input.targetId
        );
      case "child":
      case "child_profile":
        return this.actorHasActiveGuardianLinkToChild(
          input.actorUserId,
          input.targetId
        );
      case "transaction":
        return this.actorHasActiveGuardianLinkToTransactionChild(
          input.actorUserId,
          input.targetId
        );
      case "community":
      case "auction_community":
        return (
          (await this.isActiveMfaPlatformAdmin(input.actorUserId)) ||
          (await this.actorHasCommunityAdminScope(
            input.actorUserId,
            input.targetId
          ))
        );
      case "community_member":
        return this.actorHasActiveGuardianLinkToCommunityMemberChild(
          input.actorUserId,
          input.targetId
        );
      case "guardian_dispute":
        return (
          (await this.isActiveMfaPlatformAdmin(input.actorUserId)) ||
          (await this.actorHasActiveGuardianLinkToDisputeChild(
            input.actorUserId,
            input.targetId
          ))
        );
      case "risk_restriction":
        return this.isActiveMfaPlatformAdmin(input.actorUserId);
      case "risk_signal":
        return this.isActiveMfaPlatformAdmin(input.actorUserId);
      case "point_adjustment_request":
        return this.isActiveMfaPlatformAdmin(input.actorUserId);
      case ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE:
        return this.canRequestAdminCommunityScopeChallenge(input);
      default:
        return false;
    }
  }

  private async actorOwnsActiveGuardianProfile(
    actorUserId: string,
    guardianId: string
  ): Promise<boolean> {
    const guardian = await this.prisma.guardianProfile.findFirst({
      where: {
        id: guardianId,
        userId: actorUserId,
        status: "active"
      },
      select: {
        id: true
      }
    });

    return Boolean(guardian);
  }

  private async actorHasActiveGuardianLinkToChild(
    actorUserId: string,
    childId: string
  ): Promise<boolean> {
    const link = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId,
        status: "active",
        child: {
          status: "active"
        },
        guardian: {
          userId: actorUserId,
          status: "active"
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(link);
  }

  private async actorHasActiveGuardianLinkToTransactionChild(
    actorUserId: string,
    transactionId: string
  ): Promise<boolean> {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id: transactionId
      },
      select: {
        buyerChildId: true,
        sellerChildId: true
      }
    });

    if (!transaction) {
      return false;
    }

    const link = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId: {
          in: [transaction.buyerChildId, transaction.sellerChildId]
        },
        status: "active",
        guardian: {
          userId: actorUserId,
          status: "active"
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(link);
  }

  private async actorHasActiveGuardianLinkToCommunityMemberChild(
    actorUserId: string,
    communityMemberId: string
  ): Promise<boolean> {
    const member = await this.prisma.communityMember.findUnique({
      where: {
        id: communityMemberId
      },
      select: {
        childId: true
      }
    });

    return member
      ? this.actorHasActiveGuardianLinkToChild(actorUserId, member.childId)
      : false;
  }

  private async actorHasActiveGuardianLinkToDisputeChild(
    actorUserId: string,
    disputeId: string
  ): Promise<boolean> {
    const dispute = await this.prisma.guardianDispute.findUnique({
      where: {
        id: disputeId
      },
      select: {
        childId: true
      }
    });

    return dispute
      ? this.actorHasActiveGuardianLinkToChild(actorUserId, dispute.childId)
      : false;
  }

  private async actorHasCommunityAdminScope(
    actorUserId: string,
    communityId: string
  ): Promise<boolean> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId: actorUserId,
        role: "activity_admin",
        status: "active",
        mfaEnabled: true,
        communityScopes: {
          some: {
            communityId,
            status: "active"
          }
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(admin);
  }

  private async isActiveMfaPlatformAdmin(userId: string): Promise<boolean> {
    const admin = await this.prisma.adminProfile.findUnique({
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
      admin &&
        admin.role === "platform_admin" &&
        admin.status === "active" &&
        admin.mfaEnabled
    );
  }

  private async canRequestAdminCommunityScopeChallenge(input: {
    actorUserId: string;
    operationType?: string;
    targetId: string;
  }): Promise<boolean> {
    if (!(await this.isActiveMfaPlatformAdmin(input.actorUserId))) {
      return false;
    }

    const target = parseAdminCommunityScopeChallengeTargetId(input.targetId);
    if (!target) {
      return false;
    }

    const [community, targetUser] = await Promise.all([
      this.prisma.auctionCommunity.findUnique({
        where: {
          id: target.communityId
        },
        select: {
          status: true
        }
      }),
      this.prisma.user.findUnique({
        where: {
          id: target.targetUserId
        },
        select: {
          status: true,
          adminProfile: {
            select: {
              id: true,
              role: true,
              status: true,
              communityScopes: {
                where: {
                  communityId: target.communityId
                },
                select: {
                  status: true
                },
                take: 1
              }
            }
          }
        }
      })
    ]);

    if (!community || community.status !== "active") {
      return false;
    }

    if (!targetUser || targetUser.status !== "active") {
      return false;
    }

    if (input.operationType === SensitiveOperationType.grantActivityAdmin) {
      return (
        !targetUser.adminProfile ||
        (targetUser.adminProfile.role === "activity_admin" &&
          targetUser.adminProfile.status === "active")
      );
    }

    if (input.operationType === SensitiveOperationType.revokeActivityAdmin) {
      return (
        targetUser.adminProfile?.role === "activity_admin" &&
        targetUser.adminProfile.communityScopes.some(
          (scope) => scope.status === "active"
        )
      );
    }

    return true;
  }

  private async sensitiveTargetExists(
    targetType: string,
    targetId: string
  ): Promise<boolean> {
    switch (targetType) {
      case "user":
      case "user_profile":
        return Boolean(
          await this.prisma.user.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "guardian":
      case "guardian_profile":
        return Boolean(
          await this.prisma.guardianProfile.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "child":
      case "child_profile":
        return Boolean(
          await this.prisma.childProfile.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "community":
      case "auction_community":
        return Boolean(
          await this.prisma.auctionCommunity.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "community_member":
        return Boolean(
          await this.prisma.communityMember.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "transaction":
        return Boolean(
          await this.prisma.transaction.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "guardian_dispute":
        return Boolean(
          await this.prisma.guardianDispute.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case "risk_restriction":
        return this.activeRiskRestrictionExists(targetId);
      case "risk_signal":
        return this.activeRiskSignalExists(targetId);
      case "point_adjustment_request":
        return Boolean(
          await this.prisma.pointAdjustmentRequest.findUnique({
            where: { id: targetId },
            select: { id: true }
          })
        );
      case ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE:
        return Boolean(parseAdminCommunityScopeChallengeTargetId(targetId));
      case GOVERNANCE_CONTROL_CHALLENGE_TARGET_TYPE:
        return targetId === "platform"
          ? true
          : Boolean(
              await this.prisma.auctionCommunity.findUnique({
                where: { id: targetId },
                select: { id: true }
              })
            );
      default:
        return false;
    }
  }

  private async canRequestGovernanceControlChallenge(input: {
    actorUserId: string;
    targetId: string;
  }) {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId: input.actorUserId,
        status: "active",
        mfaEnabled: true,
        user: {
          status: "active"
        }
      },
      select: {
        role: true,
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
      return false;
    }

    if (admin.role === "platform_admin") {
      return input.targetId === "platform"
        ? true
        : Boolean(
            await this.prisma.auctionCommunity.findUnique({
              where: { id: input.targetId },
              select: { id: true }
            })
          );
    }

    return (
      admin.role === "activity_admin" &&
      input.targetId !== "platform" &&
      admin.communityScopes.some((scope) => scope.communityId === input.targetId)
    );
  }

  private async activeRiskRestrictionExists(restrictionId: string): Promise<boolean> {
    const restriction = await this.prisma.riskRestriction.findFirst({
      where: {
        id: restrictionId,
        status: "active"
      },
      select: {
        id: true
      }
    });

    return Boolean(restriction);
  }

  private async activeRiskSignalExists(signalId: string): Promise<boolean> {
    const signal = await this.prisma.riskSignal.findFirst({
      where: {
        id: signalId,
        status: {
          in: ["open", "under_review"]
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(signal);
  }

  private async trustSessionDeviceForSensitiveOperations(input: {
    actorUserId: string;
    sessionId: string;
    riskLabelsJson: Prisma.JsonValue | null;
    now: Date;
  }): Promise<void> {
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: input.sessionId,
        userId: input.actorUserId,
        status: "active"
      },
      select: {
        deviceFingerprintHash: true
      }
    });

    if (!session) {
      return;
    }

    const currentDevice = await this.prisma.trustedDevice.findUnique({
      where: {
        userId_deviceFingerprintHash: {
          userId: input.actorUserId,
          deviceFingerprintHash: session.deviceFingerprintHash
        }
      },
      select: {
        trustLevel: true
      }
    });

    if (currentDevice?.trustLevel === "revoked") {
      return;
    }

    const trustedAt = sensitiveDeviceTrustedAt(input.riskLabelsJson, input.now);
    await this.prisma.trustedDevice.upsert({
      where: {
        userId_deviceFingerprintHash: {
          userId: input.actorUserId,
          deviceFingerprintHash: session.deviceFingerprintHash
        }
      },
      update: {
        trustLevel: "sensitive_allowed",
        trustedAt,
        revokedAt: null,
        lastSeenAt: input.now
      },
      create: {
        userId: input.actorUserId,
        deviceFingerprintHash: session.deviceFingerprintHash,
        trustLevel: "sensitive_allowed",
        trustedAt,
        lastSeenAt: input.now
      }
    });
  }

  private async isSessionDeviceUsableForSensitiveOperations(
    actorUserId: string,
    sessionId: string,
    now: Date
  ): Promise<boolean> {
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: sessionId,
        userId: actorUserId,
        status: "active",
        expiresAt: {
          gt: now
        }
      },
      select: {
        deviceFingerprintHash: true
      }
    });

    if (!session) {
      return false;
    }

    const device = await this.prisma.trustedDevice.findUnique({
      where: {
        userId_deviceFingerprintHash: {
          userId: actorUserId,
          deviceFingerprintHash: session.deviceFingerprintHash
        }
      },
      select: {
        trustLevel: true,
        trustedAt: true,
        revokedAt: true
      }
    });

    if (!device || device.trustLevel !== "sensitive_allowed") {
      return false;
    }

    if (!device.trustedAt || device.trustedAt.getTime() > now.getTime()) {
      return false;
    }

    return !device.revokedAt || device.revokedAt.getTime() > now.getTime();
  }

  private async hasActiveRiskRestriction(
    actorUserId: string,
    operationType: string,
    targetType: string,
    targetId: string,
    now: Date
  ): Promise<boolean> {
    return this.hasActiveRestriction({
      actorUserId,
      targetType,
      targetId,
      now,
      matchingRestrictionTypes: riskRestrictionTypesForOperation(operationType)
    });
  }

  private async hasActiveSensitiveChallengeRequiredRestriction(
    actorUserId: string,
    targetType: string,
    targetId: string,
    now: Date
  ): Promise<boolean> {
    return this.hasActiveRestriction({
      actorUserId,
      targetType,
      targetId,
      now,
      matchingRestrictionTypes: ["sensitive_challenge_required"]
    });
  }

  private async hasActiveRestriction(input: {
    actorUserId: string;
    targetType: string;
    targetId: string;
    now: Date;
    matchingRestrictionTypes: RiskRestrictionType[];
  }): Promise<boolean> {
    const actor = await this.prisma.user.findUnique({
      where: {
        id: input.actorUserId
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
    const targetContext = await this.resolveTargetContext(
      input.targetType,
      input.targetId
    );
    const filters: Prisma.RiskRestrictionWhereInput[] = [
      {
        scope: "user",
        targetId: input.actorUserId
      }
    ];

    if (actor?.guardianProfile?.id) {
      filters.push({
        scope: "guardian",
        targetId: actor.guardianProfile.id
      });
    }

    if (actor?.childProfile?.id) {
      filters.push({
        scope: "child",
        targetId: actor.childProfile.id
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
    }

    for (const childId of targetContext.childIds) {
      filters.push({
        scope: "child",
        targetId: childId
      });
    }

    for (const communityId of targetContext.communityIds) {
      filters.push({
        scope: "community",
        targetId: communityId
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
          in: input.matchingRestrictionTypes
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
        status: {
          in: ["pending_platform_review", "frozen"]
        }
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
      case "guardian_dispute": {
        const dispute = await this.prisma.guardianDispute.findUnique({
          where: {
            id: targetId
          },
          select: {
            childId: true,
            submittingGuardianId: true,
            submittingGuardian: {
              select: {
                userId: true
              }
            }
          }
        });

        if (dispute) {
          context.childIds.push(dispute.childId);
          context.guardianIds.push(dispute.submittingGuardianId);
          context.userIds.push(dispute.submittingGuardian.userId);
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

export function buildAdminCommunityScopeChallengeTargetId(
  communityId: string,
  targetUserId: string
): string {
  return `${communityId}:${targetUserId}`;
}

function parseAdminCommunityScopeChallengeTargetId(
  targetId: string
): { communityId: string; targetUserId: string } | null {
  const [communityId, targetUserId, extra] = targetId.split(":");
  if (!communityId || !targetUserId || extra !== undefined) {
    return null;
  }

  return {
    communityId,
    targetUserId
  };
}

export function getChallengeSessionId(value: Prisma.JsonValue | null): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sessionId = (value as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}

export function hashSensitiveOperationVerificationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateSensitiveOperationVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function getChallengeVerificationCodeHash(
  value: Prisma.JsonValue | null
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const verificationCodeHash = (value as { verificationCodeHash?: unknown })
    .verificationCodeHash;
  return typeof verificationCodeHash === "string" ? verificationCodeHash : null;
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

function sensitiveDeviceTrustedAt(
  riskLabelsJson: Prisma.JsonValue | null,
  now: Date
): Date {
  const labels = getChallengeRiskLabels(riskLabelsJson);
  return labels.includes("new_device") || labels.includes("abnormal_login")
    ? new Date(now.getTime() + SENSITIVE_DEVICE_COOLDOWN_MS)
    : now;
}

function getChallengeRiskLabels(value: Prisma.JsonValue | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const labels = (value as { labels?: unknown }).labels;
  return Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : [];
}
