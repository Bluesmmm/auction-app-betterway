import type {
  ChildStatus,
  GuardianStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { createHash } from "node:crypto";
import { AppConfigService } from "../config/app-config.service.js";
import type { WechatAuthProvider } from "../providers/provider-contracts.js";
import type { SessionService } from "./session.service.js";

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

export type LoginWithWechatCodeAndSessionInput = LoginWithWechatCodeInput & {
  deviceFingerprintHash: string;
  ipHash: string;
  userAgentHash: string;
};

export type LoginWithWechatCodeAndSessionResult =
  | {
      result: "accepted";
      userId: string;
      openid: string;
      isNewUser: boolean;
      sessionId: string;
      accessToken: string;
      accessTokenExpiresAt: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "WECHAT_AUTH_FAILED"
        | "USER_NOT_ACTIVE"
        | "SESSION_SERVICE_UNAVAILABLE";
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
        | "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "IDEMPOTENCY_CONFLICT";
    };

type CreateChildWithPrimaryGuardianErrorCode = Extract<
  CreateChildWithPrimaryGuardianResult,
  { result: "rejected" }
>["errorCode"];

type CreateChildIdempotencyReservation =
  | {
      result: "reserved";
      id: string;
    }
  | {
      result: "replay";
      response: CreateChildWithPrimaryGuardianResult;
    }
  | {
      result: "conflict";
    };

export const STAGE2_CHILD_INITIAL_POINTS = 100;

export class OnboardingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly wechatAuth: WechatAuthProvider,
    private readonly sessionService?: SessionService,
    private readonly config: AppConfigService = new AppConfigService()
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

  async loginWithWechatCodeAndCreateSession(
    input: LoginWithWechatCodeAndSessionInput
  ): Promise<LoginWithWechatCodeAndSessionResult> {
    if (!this.sessionService) {
      return {
        result: "rejected",
        errorCode: "SESSION_SERVICE_UNAVAILABLE"
      };
    }

    const login = await this.loginWithWechatCode(input);
    if (login.result !== "accepted") {
      return login;
    }

    const session = await this.sessionService.createSession({
      userId: login.userId,
      deviceFingerprintHash: input.deviceFingerprintHash,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      now: input.now
    });

    if (session.result !== "accepted") {
      return session;
    }

    return {
      result: "accepted",
      userId: login.userId,
      openid: login.openid,
      isNewUser: login.isNewUser,
      sessionId: session.sessionId,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt
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
        consentedAt: input.consentedAt
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
    if (!input.idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      guardianId: input.guardianId,
      displayName: input.displayName,
      gradeBand: input.gradeBand
    });

    return this.prisma.$transaction(async (tx) => {
      await lockGuardian(tx, input.guardianId);

      const idempotency = await reserveCreateChildIdempotencyRecord(tx, {
        key: input.idempotencyKey,
        actorUserId: input.actorUserId,
        action: "child_profile.create_with_primary_guardian",
        targetType: "guardian_profile",
        targetId: input.guardianId,
        requestHash
      });

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const lockedGuardian = await tx.guardianProfile.findUnique({
        where: {
          id: input.guardianId
        },
        select: {
          userId: true,
          status: true
        }
      });

      if (!lockedGuardian || lockedGuardian.status !== "active") {
        return completeIdempotentCreateChild(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GUARDIAN_NOT_ACTIVE"
        });
      }

      if (lockedGuardian.userId !== input.actorUserId) {
        return completeIdempotentCreateChild(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GUARDIAN_NOT_OWNED_BY_ACTOR"
        });
      }

      const activeChildCount = await tx.guardianChildLink.count({
        where: {
          guardianId: input.guardianId,
          status: "active",
          child: {
            status: "active"
          }
        }
      });

      if (activeChildCount >= 3) {
        return completeIdempotentCreateChild(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
        });
      }

      const child = await tx.childProfile.create({
        data: {
          displayName: input.displayName,
          gradeBand: input.gradeBand,
          status: "active",
          createdByGuardianId: input.guardianId,
          initialPointsGrantedAt: now
        }
      });

      await tx.guardianChildLink.create({
        data: {
          guardianId: input.guardianId,
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

      const initialChildPoints = this.config.initialChildPoints;
      const pointAccount = await tx.pointAccount.create({
        data: {
          childId: child.id,
          availablePoints: initialChildPoints,
          frozenPoints: 0,
          totalEarnedPoints: initialChildPoints,
          totalSpentPoints: 0,
          totalAwardedPoints: initialChildPoints,
          totalPenaltyPoints: 0,
          ledgerEntries: {
            create: {
              child: {
                connect: {
                  id: child.id
                }
              },
              type: "initial_grant",
              amountPoints: initialChildPoints,
              availableAfter: initialChildPoints,
              frozenAfter: 0,
              relatedType: "child_profile",
              relatedId: child.id,
              idempotencyKey: input.idempotencyKey,
              reason: "initial_child_points",
              createdAt: now,
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
            guardianId: input.guardianId,
            initialPoints: initialChildPoints
          }
        }
      });

      return completeIdempotentCreateChild(tx, idempotency.id, {
        result: "accepted",
        childId: child.id,
        childStatus: child.status,
        availablePoints: pointAccount.availablePoints
      });
    });
  }
}

async function lockGuardian(tx: Prisma.TransactionClient, guardianId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "GuardianProfile"
    WHERE "id" = ${guardianId}
    FOR UPDATE
  `;
}

async function reserveCreateChildIdempotencyRecord(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  }
): Promise<CreateChildIdempotencyReservation> {
  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      key_actorUserId_action_targetType_targetId: {
        key: input.key,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId
      }
    },
    select: {
      id: true,
      requestHash: true,
      status: true,
      responseJson: true
    }
  });

  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      return {
        result: "conflict"
      };
    }

    const response = parseCreateChildWithPrimaryGuardianResult(
      existing.responseJson
    );
    if (existing.status === "completed" && response) {
      return {
        result: "replay",
        response
      };
    }

    return {
      result: "conflict"
    };
  }

  const created = await tx.idempotencyRecord.create({
    data: {
      key: input.key,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestHash: input.requestHash,
      status: "processing"
    },
    select: {
      id: true
    }
  });

  return {
    result: "reserved",
    id: created.id
  };
}

async function completeIdempotentCreateChild(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: CreateChildWithPrimaryGuardianResult
): Promise<CreateChildWithPrimaryGuardianResult> {
  await tx.idempotencyRecord.update({
    where: {
      id: idempotencyRecordId
    },
    data: {
      status: "completed",
      responseJson: response
    }
  });

  return response;
}

function parseCreateChildWithPrimaryGuardianResult(
  value: Prisma.JsonValue | null
): CreateChildWithPrimaryGuardianResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (response.result === "accepted") {
    return typeof response.childId === "string" &&
      typeof response.childStatus === "string" &&
      typeof response.availablePoints === "number"
      ? {
          result: "accepted",
          childId: response.childId,
          childStatus: response.childStatus as ChildStatus,
          availablePoints: response.availablePoints
        }
      : null;
  }

  if (response.result === "rejected" && typeof response.errorCode === "string") {
    return {
      result: "rejected",
      errorCode: response.errorCode as CreateChildWithPrimaryGuardianErrorCode
    };
  }

  return null;
}

function createStableHash(value: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
