import type {
  ChildGuardianSettings,
  GuardianDisputeStatus,
  GuardianDisputeType,
  Prisma,
  PrismaClient
} from "@prisma/client";
import {
  getChallengeSessionId,
  SensitiveOperationService,
  SensitiveOperationType
} from "./sensitive-operation.service.js";

export type GuardianControlPatch = {
  canPublish?: boolean;
  canBid?: boolean;
  maxBidPoints?: number | null;
  bidRequiresGuardianConfirmation?: boolean;
  canUseCourier?: boolean;
  canUseGuardianArrangedDelivery?: boolean;
  canFavorite?: boolean;
};

export type GuardianLinkTransitionResult =
  | {
      result: "accepted";
      childId: string;
      guardianId: string;
      role: "secondary";
      status: "pending" | "active";
      confirmedAt: string | null;
    }
  | {
      result: "rejected";
      errorCode:
        | "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        | "CHILD_ACTIVE_GUARDIAN_LIMIT_EXCEEDED"
        | "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        | "SECONDARY_GUARDIAN_NOT_ACTIVE"
        | "SECONDARY_GUARDIAN_INVITE_NOT_PENDING";
    };

export type UpdateChildGuardianSettingsResult =
  | {
      result: "accepted";
      childId: string;
      challengeId: string | null;
      settings: GuardianSettingsSnapshot;
    }
  | {
      result: "rejected";
      errorCode:
        | "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        | "INVALID_MAX_BID_POINTS"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "DEVICE_NOT_TRUSTED"
        | "SESSION_REVOKED"
        | "RISK_RESTRICTED"
        | "GUARDIAN_DISPUTE_FROZEN";
    };

export type GuardianDisputeTransitionResult =
  | {
      result: "accepted";
      disputeId: string;
      childId: string;
      status: GuardianDisputeStatus;
      frozenAt: string | null;
      resolvedAt: string | null;
      resolutionSummary: string | null;
    }
  | {
      result: "rejected";
      errorCode:
        | "ACTIVE_GUARDIAN_REQUIRED"
        | "DISPUTE_NOT_FOUND"
        | "DISPUTE_ALREADY_RESOLVED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "DEVICE_NOT_TRUSTED"
        | "SESSION_REVOKED"
        | "RISK_RESTRICTED"
        | "GUARDIAN_DISPUTE_FROZEN";
    };

export type ResolveGuardianDisputeInput = {
  platformAdminUserId: string;
  sessionId: string;
  disputeId: string;
  resolution: {
    status: Extract<GuardianDisputeStatus, "resolved" | "rejected">;
    summary?: string;
  };
  now?: Date;
};

type GuardianSettingsSnapshot = Pick<
  ChildGuardianSettings,
  | "canPublish"
  | "canBid"
  | "maxBidPoints"
  | "bidRequiresGuardianConfirmation"
  | "canUseCourier"
  | "canUseGuardianArrangedDelivery"
  | "canFavorite"
>;

const GUARDIAN_SETTINGS_DEFAULTS: GuardianSettingsSnapshot = {
  canPublish: true,
  canBid: true,
  maxBidPoints: null,
  bidRequiresGuardianConfirmation: false,
  canUseCourier: false,
  canUseGuardianArrangedDelivery: true,
  canFavorite: true
};

export class GuardianManagementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sensitiveOperations: SensitiveOperationService
  ) {}

  async inviteSecondaryGuardian(input: {
    actorUserId: string;
    childId: string;
    secondaryGuardianId: string;
    now?: Date;
  }): Promise<GuardianLinkTransitionResult> {
    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const primaryLink = await findActivePrimaryGuardianLink(
        tx,
        input.actorUserId,
        input.childId
      );
      if (!primaryLink) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      await lockChild(tx, input.childId);
      await lockGuardian(tx, input.secondaryGuardianId);

      const secondaryGuardian = await tx.guardianProfile.findUnique({
        where: {
          id: input.secondaryGuardianId
        },
        select: {
          id: true,
          status: true
        }
      });

      if (!secondaryGuardian || secondaryGuardian.status !== "active") {
        return {
          result: "rejected",
          errorCode: "SECONDARY_GUARDIAN_NOT_ACTIVE"
        };
      }

      const existingLink = await tx.guardianChildLink.findUnique({
        where: {
          guardianId_childId: {
            guardianId: input.secondaryGuardianId,
            childId: input.childId
          }
        }
      });

      if (existingLink && existingLink.role !== "secondary") {
        return {
          result: "rejected",
          errorCode: "SECONDARY_GUARDIAN_INVITE_NOT_PENDING"
        };
      }

      if (existingLink?.status === "active") {
        return {
          result: "accepted",
          childId: existingLink.childId,
          guardianId: existingLink.guardianId,
          role: "secondary",
          status: "active",
          confirmedAt: existingLink.confirmedAt?.toISOString() ?? null
        };
      }

      if (existingLink?.status === "pending") {
        return {
          result: "accepted",
          childId: existingLink.childId,
          guardianId: existingLink.guardianId,
          role: "secondary",
          status: "pending",
          confirmedAt: existingLink.confirmedAt?.toISOString() ?? null
        };
      }

      const activeGuardianCount = await countActiveGuardiansForChild(
        tx,
        input.childId
      );

      if (activeGuardianCount >= 2) {
        return {
          result: "rejected",
          errorCode: "CHILD_ACTIVE_GUARDIAN_LIMIT_EXCEEDED"
        };
      }

      const activeChildCount = await countActiveChildrenForGuardian(
        tx,
        input.secondaryGuardianId
      );

      if (activeChildCount >= 3) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        };
      }

      const link = existingLink
        ? await tx.guardianChildLink.update({
            where: {
              guardianId_childId: {
                guardianId: input.secondaryGuardianId,
                childId: input.childId
              }
            },
            data: {
              role: "secondary",
              status: "pending",
              confirmedAt: null
            }
          })
        : await tx.guardianChildLink.create({
            data: {
              guardianId: input.secondaryGuardianId,
              childId: input.childId,
              role: "secondary",
              status: "pending"
            }
          });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "guardian_child_link.invite_secondary",
          targetType: "guardian_child_link",
          targetId: link.id,
          afterJson: {
            childId: input.childId,
            guardianId: input.secondaryGuardianId,
            status: link.status
          }
        }
      });

      return {
        result: "accepted",
        childId: link.childId,
        guardianId: link.guardianId,
        role: "secondary",
        status: "pending",
        confirmedAt: link.confirmedAt?.toISOString() ?? null
      };
    });
  }

  async confirmSecondaryGuardian(input: {
    actorUserId: string;
    childId: string;
    secondaryGuardianId: string;
    now?: Date;
  }): Promise<GuardianLinkTransitionResult> {
    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const primaryLink = await findActivePrimaryGuardianLink(
        tx,
        input.actorUserId,
        input.childId
      );
      if (!primaryLink) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      await lockChild(tx, input.childId);
      await lockGuardian(tx, input.secondaryGuardianId);

      const existingLink = await tx.guardianChildLink.findUnique({
        where: {
          guardianId_childId: {
            guardianId: input.secondaryGuardianId,
            childId: input.childId
          }
        }
      });

      if (!existingLink || existingLink.role !== "secondary") {
        return {
          result: "rejected",
          errorCode: "SECONDARY_GUARDIAN_INVITE_NOT_PENDING"
        };
      }

      if (existingLink.status === "active") {
        return {
          result: "accepted",
          childId: existingLink.childId,
          guardianId: existingLink.guardianId,
          role: "secondary",
          status: "active",
          confirmedAt: existingLink.confirmedAt?.toISOString() ?? null
        };
      }

      if (existingLink.status !== "pending") {
        return {
          result: "rejected",
          errorCode: "SECONDARY_GUARDIAN_INVITE_NOT_PENDING"
        };
      }

      const activeGuardianCount = await countActiveGuardiansForChild(
        tx,
        input.childId
      );

      if (activeGuardianCount >= 2) {
        return {
          result: "rejected",
          errorCode: "CHILD_ACTIVE_GUARDIAN_LIMIT_EXCEEDED"
        };
      }

      const activeChildCount = await countActiveChildrenForGuardian(
        tx,
        input.secondaryGuardianId
      );

      if (activeChildCount >= 3) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        };
      }

      const confirmed = await tx.guardianChildLink.update({
        where: {
          guardianId_childId: {
            guardianId: input.secondaryGuardianId,
            childId: input.childId
          }
        },
        data: {
          status: "active",
          confirmedAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "guardian_child_link.confirm_secondary",
          targetType: "guardian_child_link",
          targetId: confirmed.id,
          afterJson: {
            childId: input.childId,
            guardianId: input.secondaryGuardianId,
            status: confirmed.status,
            confirmedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        childId: confirmed.childId,
        guardianId: confirmed.guardianId,
        role: "secondary",
        status: "active",
        confirmedAt: confirmed.confirmedAt?.toISOString() ?? null
      };
    });
  }

  async updateChildGuardianSettings(input: {
    actorUserId: string;
    childId: string;
    patch: GuardianControlPatch;
    challengeId?: string;
    sessionId: string;
    now?: Date;
  }): Promise<UpdateChildGuardianSettingsResult> {
    const now = input.now ?? new Date();
    const invalidMaxBidPoints =
      input.patch.maxBidPoints !== undefined &&
      input.patch.maxBidPoints !== null &&
      (!Number.isInteger(input.patch.maxBidPoints) || input.patch.maxBidPoints <= 0);

    if (invalidMaxBidPoints) {
      return {
        result: "rejected",
        errorCode: "INVALID_MAX_BID_POINTS"
      };
    }

    if (input.challengeId) {
      const challengeCheck = await this.assertFreshChallengeId({
        actorUserId: input.actorUserId,
        challengeId: input.challengeId,
        sessionId: input.sessionId,
        childId: input.childId,
        now
      });
      if (challengeCheck.result === "rejected") {
        return challengeCheck;
      }
    }

    const authorization = await this.sensitiveOperations.authorize({
      actorUserId: input.actorUserId,
      operationType: SensitiveOperationType.changeChildPermissions,
      targetType: "child_profile",
      targetId: input.childId,
      sessionId: input.sessionId,
      now
    });

    if (authorization.result === "rejected") {
      return authorization;
    }

    return this.prisma.$transaction(async (tx) => {
      const primaryLink = await findActivePrimaryGuardianLink(
        tx,
        input.actorUserId,
        input.childId
      );
      if (!primaryLink) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      const before = await tx.childGuardianSettings.findUnique({
        where: {
          childId: input.childId
        }
      });

      const updated = await tx.childGuardianSettings.upsert({
        where: {
          childId: input.childId
        },
        update: buildGuardianSettingsMutation(input.patch),
        create: {
          childId: input.childId,
          ...GUARDIAN_SETTINGS_DEFAULTS,
          ...buildGuardianSettingsMutation(input.patch)
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "child_guardian_settings.update",
          targetType: "child_guardian_settings",
          targetId: updated.id,
          beforeJson: before
            ? toGuardianSettingsSnapshot(before)
            : GUARDIAN_SETTINGS_DEFAULTS,
          afterJson: {
            ...toGuardianSettingsSnapshot(updated),
            challengeId: input.challengeId ?? authorization.challengeId
          }
        }
      });

      return {
        result: "accepted",
        childId: input.childId,
        challengeId: input.challengeId ?? authorization.challengeId,
        settings: toGuardianSettingsSnapshot(updated)
      };
    });
  }

  async openGuardianDispute(input: {
    actorUserId: string;
    childId: string;
    disputeType: GuardianDisputeType;
    reason: string;
    now?: Date;
  }): Promise<GuardianDisputeTransitionResult> {
    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      await lockChild(tx, input.childId);

      const activeGuardian = await tx.guardianChildLink.findFirst({
        where: {
          childId: input.childId,
          status: "active",
          guardian: {
            userId: input.actorUserId,
            status: "active"
          }
        },
        select: {
          guardianId: true
        }
      });

      if (!activeGuardian) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_GUARDIAN_REQUIRED"
        };
      }

      const existing = await tx.guardianDispute.findFirst({
        where: {
          childId: input.childId,
          status: {
            in: ["pending_platform_review", "frozen"]
          }
        }
      });

      if (existing) {
        return {
          result: "accepted",
          disputeId: existing.id,
          childId: existing.childId,
          status: existing.status,
          frozenAt: existing.frozenAt?.toISOString() ?? null,
          resolvedAt: existing.resolvedAt?.toISOString() ?? null,
          resolutionSummary: existing.resolutionSummary
        };
      }

      const dispute = await tx.guardianDispute.create({
        data: {
          childId: input.childId,
          submittingGuardianId: activeGuardian.guardianId,
          type: input.disputeType,
          status: "frozen",
          frozenAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "guardian_dispute.open",
          targetType: "guardian_dispute",
          targetId: dispute.id,
          reason: input.reason,
          afterJson: {
            childId: input.childId,
            status: dispute.status,
            frozenAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        disputeId: dispute.id,
        childId: dispute.childId,
        status: dispute.status,
        frozenAt: dispute.frozenAt?.toISOString() ?? null,
        resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
        resolutionSummary: dispute.resolutionSummary
      };
    });
  }

  async resolveGuardianDispute(
    input: ResolveGuardianDisputeInput
  ): Promise<GuardianDisputeTransitionResult> {
    const now = input.now ?? new Date();
    const platformAdmin = await this.prisma.adminProfile.findUnique({
      where: {
        userId: input.platformAdminUserId
      },
      select: {
        role: true,
        status: true,
        mfaEnabled: true
      }
    });

    if (
      !platformAdmin ||
      platformAdmin.role !== "platform_admin" ||
      platformAdmin.status !== "active" ||
      !platformAdmin.mfaEnabled
    ) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const authorization = await this.sensitiveOperations.authorize({
      actorUserId: input.platformAdminUserId,
      operationType: SensitiveOperationType.resolveGuardianDispute,
      targetType: "guardian_dispute",
      targetId: input.disputeId,
      sessionId: input.sessionId,
      now
    });

    if (authorization.result === "rejected") {
      return authorization;
    }

    const dispute = await this.prisma.guardianDispute.findUnique({
      where: {
        id: input.disputeId
      }
    });

    if (!dispute) {
      return {
        result: "rejected",
        errorCode: "DISPUTE_NOT_FOUND"
      };
    }

    if (dispute.status === "resolved" || dispute.status === "rejected") {
      return {
        result: "rejected",
        errorCode: "DISPUTE_ALREADY_RESOLVED"
      };
    }

    const updatedCount = await this.prisma.guardianDispute.updateMany({
      where: {
        id: input.disputeId,
        status: {
          in: ["pending_platform_review", "frozen"]
        }
      },
      data: {
        status: input.resolution.status,
        resolvedAt: now,
        resolutionSummary: input.resolution.summary ?? null
      }
    });

    if (updatedCount.count !== 1) {
      return {
        result: "rejected",
        errorCode: "DISPUTE_ALREADY_RESOLVED"
      };
    }

    const updated = await this.prisma.guardianDispute.findUniqueOrThrow({
      where: {
        id: input.disputeId
      }
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.platformAdminUserId,
        action: "guardian_dispute.resolve",
        targetType: "guardian_dispute",
        targetId: updated.id,
        beforeJson: {
          status: dispute.status,
          resolutionSummary: dispute.resolutionSummary
        },
        afterJson: {
          status: updated.status,
          resolutionSummary: updated.resolutionSummary,
          resolvedAt: updated.resolvedAt?.toISOString() ?? now.toISOString(),
          challengeId: authorization.challengeId
        }
      }
    });

    return {
      result: "accepted",
      disputeId: updated.id,
      childId: updated.childId,
      status: updated.status,
      frozenAt: updated.frozenAt?.toISOString() ?? null,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      resolutionSummary: updated.resolutionSummary
    };
  }

  private async assertFreshChallengeId(input: {
    actorUserId: string;
    challengeId: string;
    sessionId: string;
    childId: string;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED" | "SENSITIVE_CHALLENGE_EXPIRED";
      }
  > {
    const challenge = await this.prisma.sensitiveOperationChallenge.findUnique({
      where: {
        id: input.challengeId
      }
    });

    if (
      !challenge ||
      challenge.actorUserId !== input.actorUserId ||
      challenge.operation !== SensitiveOperationType.changeChildPermissions ||
      getChallengeSessionId(challenge.riskLabelsJson) !== input.sessionId ||
      challenge.targetType !== "child_profile" ||
      challenge.targetId !== input.childId
    ) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    const expired = challenge.expiresAt.getTime() <= input.now.getTime();
    if (expired || challenge.status === "expired") {
      if (expired && challenge.status !== "expired") {
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

    if (challenge.status !== "passed") {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    return {
      result: "accepted"
    };
  }
}

async function findActivePrimaryGuardianLink(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  childId: string
) {
  return tx.guardianChildLink.findFirst({
    where: {
      childId,
      role: "primary",
      status: "active",
      guardian: {
        userId: actorUserId,
        status: "active"
      }
    },
    select: {
      id: true,
      guardianId: true
    }
  });
}

async function lockChild(tx: Prisma.TransactionClient, childId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ChildProfile"
    WHERE "id" = ${childId}
    FOR UPDATE
  `;
}

async function lockGuardian(tx: Prisma.TransactionClient, guardianId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "GuardianProfile"
    WHERE "id" = ${guardianId}
    FOR UPDATE
  `;
}

async function countActiveGuardiansForChild(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<number> {
  return tx.guardianChildLink.count({
    where: {
      childId,
      status: "active",
      guardian: {
        status: "active"
      }
    }
  });
}

async function countActiveChildrenForGuardian(
  tx: Prisma.TransactionClient,
  guardianId: string
): Promise<number> {
  return tx.guardianChildLink.count({
    where: {
      guardianId,
      status: "active",
      child: {
        status: "active"
      }
    }
  });
}

function buildGuardianSettingsMutation(
  patch: GuardianControlPatch
) {
  return {
    ...(patch.canPublish !== undefined ? { canPublish: patch.canPublish } : {}),
    ...(patch.canBid !== undefined ? { canBid: patch.canBid } : {}),
    ...(patch.maxBidPoints !== undefined ? { maxBidPoints: patch.maxBidPoints } : {}),
    ...(patch.bidRequiresGuardianConfirmation !== undefined
      ? {
          bidRequiresGuardianConfirmation: patch.bidRequiresGuardianConfirmation
        }
      : {}),
    ...(patch.canUseCourier !== undefined
      ? { canUseCourier: patch.canUseCourier }
      : {}),
    ...(patch.canUseGuardianArrangedDelivery !== undefined
      ? {
          canUseGuardianArrangedDelivery: patch.canUseGuardianArrangedDelivery
        }
      : {}),
    ...(patch.canFavorite !== undefined ? { canFavorite: patch.canFavorite } : {})
  };
}

function toGuardianSettingsSnapshot(
  settings: GuardianSettingsSnapshot
): GuardianSettingsSnapshot {
  return {
    canPublish: settings.canPublish,
    canBid: settings.canBid,
    maxBidPoints: settings.maxBidPoints,
    bidRequiresGuardianConfirmation: settings.bidRequiresGuardianConfirmation,
    canUseCourier: settings.canUseCourier,
    canUseGuardianArrangedDelivery: settings.canUseGuardianArrangedDelivery,
    canFavorite: settings.canFavorite
  };
}
