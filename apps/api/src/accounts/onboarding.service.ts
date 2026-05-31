import type { ChildStatus, GuardianStatus, PrismaClient } from "@prisma/client";
import type { WechatAuthProvider } from "../providers/provider-contracts.js";

export type LoginWithWechatCodeInput = {
  code: string;
  now?: Date;
};

export type LoginWithWechatCodeResult =
  | {
      result: "accepted";
      userId: string;
      openid: string;
      isNewUser: boolean;
    }
  | {
      result: "rejected";
      errorCode: "WECHAT_AUTH_FAILED";
    };

export type EnsureGuardianProfileInput = {
  userId: string;
  phoneHash: string;
  phoneLast4: string;
  consentVersion: string;
  consentedAt: Date;
};

export type EnsureGuardianProfileResult = {
  result: "accepted";
  guardianId: string;
  guardianStatus: GuardianStatus;
};

export type CreateChildWithPrimaryGuardianInput = {
  actorUserId: string;
  guardianId: string;
  displayName: string;
  gradeBand: string;
  initialPoints: number;
  idempotencyKey: string;
  now?: Date;
};

export type CreateChildWithPrimaryGuardianResult =
  | {
      result: "accepted";
      childId: string;
      childStatus: ChildStatus;
      availablePoints: number;
    }
  | {
      result: "rejected";
      errorCode:
        | "GUARDIAN_NOT_ACTIVE"
        | "GUARDIAN_NOT_OWNED_BY_ACTOR"
        | "INITIAL_POINTS_INVALID"
        | "GUARDIAN_CHILD_LIMIT_EXCEEDED";
    };

export class OnboardingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly wechatAuth: WechatAuthProvider
  ) {}

  async loginWithWechatCode(
    input: LoginWithWechatCodeInput
  ): Promise<LoginWithWechatCodeResult> {
    const identity = await this.wechatAuth.exchangeCode(input.code);
    if (!identity.ok) {
      return {
        result: "rejected",
        errorCode: "WECHAT_AUTH_FAILED"
      };
    }

    const now = input.now ?? new Date();
    const existingIdentity = await this.prisma.wechatIdentity.findUnique({
      where: {
        openid: identity.openid
      }
    });

    if (existingIdentity) {
      const updatedIdentity = await this.prisma.wechatIdentity.update({
        where: {
          openid: identity.openid
        },
        data: {
          unionid: identity.unionid,
          lastLoginAt: now
        }
      });

      return {
        result: "accepted",
        userId: updatedIdentity.userId,
        openid: updatedIdentity.openid,
        isNewUser: false
      };
    }

    const user = await this.prisma.user.create({
      data: {
        wechatIdentities: {
          create: {
            openid: identity.openid,
            unionid: identity.unionid,
            lastLoginAt: now
          }
        }
      },
      include: {
        wechatIdentities: true
      }
    });

    return {
      result: "accepted",
      userId: user.id,
      openid: identity.openid,
      isNewUser: true
    };
  }

  async ensureGuardianProfile(
    input: EnsureGuardianProfileInput
  ): Promise<EnsureGuardianProfileResult> {
    const guardian = await this.prisma.guardianProfile.upsert({
      where: {
        userId: input.userId
      },
      update: {
        phoneHash: input.phoneHash,
        phoneLast4: input.phoneLast4,
        consentVersion: input.consentVersion,
        consentedAt: input.consentedAt,
        status: "active"
      },
      create: {
        userId: input.userId,
        phoneHash: input.phoneHash,
        phoneLast4: input.phoneLast4,
        consentVersion: input.consentVersion,
        consentedAt: input.consentedAt,
        status: "active"
      }
    });

    return {
      result: "accepted",
      guardianId: guardian.id,
      guardianStatus: guardian.status
    };
  }

  async createChildWithPrimaryGuardian(
    input: CreateChildWithPrimaryGuardianInput
  ): Promise<CreateChildWithPrimaryGuardianResult> {
    if (!Number.isInteger(input.initialPoints) || input.initialPoints <= 0) {
      return {
        result: "rejected",
        errorCode: "INITIAL_POINTS_INVALID"
      };
    }

    const guardian = await this.prisma.guardianProfile.findUnique({
      where: {
        id: input.guardianId
      }
    });

    if (!guardian || guardian.status !== "active") {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_NOT_ACTIVE"
      };
    }

    if (guardian.userId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_NOT_OWNED_BY_ACTOR"
      };
    }

    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "GuardianProfile"
        WHERE "id" = ${guardian.id}
        FOR UPDATE
      `;

      const lockedGuardian = await tx.guardianProfile.findUnique({
        where: {
          id: guardian.id
        },
        select: {
          userId: true,
          status: true
        }
      });

      if (!lockedGuardian || lockedGuardian.status !== "active") {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_NOT_ACTIVE"
        };
      }

      if (lockedGuardian.userId !== input.actorUserId) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_NOT_OWNED_BY_ACTOR"
        };
      }

      const activeChildCount = await tx.guardianChildLink.count({
        where: {
          guardianId: guardian.id,
          status: "active",
          child: {
            status: "active"
          }
        }
      });

      if (activeChildCount >= 3) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        };
      }

      const child = await tx.childProfile.create({
        data: {
          displayName: input.displayName,
          gradeBand: input.gradeBand,
          status: "active",
          createdByGuardianId: guardian.id,
          initialPointsGrantedAt: now
        }
      });

      await tx.guardianChildLink.create({
        data: {
          guardianId: guardian.id,
          childId: child.id,
          role: "primary",
          status: "active",
          confirmedAt: now
        }
      });

      await tx.childGuardianSettings.create({
        data: {
          childId: child.id,
          canPublish: true,
          canBid: true,
          maxBidPoints: null,
          bidRequiresGuardianConfirmation: false,
          canUseCourier: false,
          canUseGuardianArrangedDelivery: true,
          canFavorite: true
        }
      });

      const pointAccount = await tx.pointAccount.create({
        data: {
          childId: child.id,
          availablePoints: input.initialPoints,
          frozenPoints: 0,
          totalEarnedPoints: input.initialPoints,
          totalSpentPoints: 0,
          ledgerEntries: {
            create: {
              child: {
                connect: {
                  id: child.id
                }
              },
              type: "initial_grant",
              amountPoints: input.initialPoints,
              availableAfter: input.initialPoints,
              frozenAfter: 0,
              relatedType: "child_profile",
              relatedId: child.id,
              idempotencyKey: input.idempotencyKey,
              reason: "initial_child_points",
              createdBy: {
                connect: {
                  id: input.actorUserId
                }
              }
            }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "child_profile.create_with_primary_guardian",
          targetType: "child_profile",
          targetId: child.id,
          afterJson: {
            guardianId: guardian.id,
            initialPoints: input.initialPoints
          }
        }
      });

      return {
        result: "accepted",
        childId: child.id,
        childStatus: child.status,
        availablePoints: pointAccount.availablePoints
      };
    });
  }
}
