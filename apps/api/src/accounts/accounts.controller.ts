import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "./controller-auth.js";
import { GuardianManagementService } from "./guardian-management.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { SensitiveOperationService } from "./sensitive-operation.service.js";
import { SessionService } from "./session.service.js";
import { SessionTokenService } from "./session-token.service.js";

type WriteResponse = {
  serverTime: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  latestStatus: string;
  result: "accepted" | "rejected" | "pending" | "unknown";
  refreshRequired: boolean;
  errorCode?: string;
};

type RejectedWriteResponse = WriteResponse & {
  result: "rejected";
  refreshRequired: false;
  errorCode: string;
};

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

export class AccountsController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly sessions: SessionService,
    private readonly guardians: GuardianManagementService,
    private readonly sensitiveOperations: SensitiveOperationService,
    private readonly sessionTokens: SessionTokenService
  ) {}

  async loginWithWechat(
    body: {
      code: string;
      deviceFingerprintHash: string;
      ipHash: string;
      userAgentHash: string;
    }
  ) {
    const now = new Date();
    const result = await this.onboarding.loginWithWechatCodeAndCreateSession({
      code: body.code,
      deviceFingerprintHash: body.deviceFingerprintHash,
      ipHash: body.ipHash,
      userAgentHash: body.userAgentHash,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "user_session",
          targetId: result.sessionId,
          latestStatus: "active"
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "user_session",
        targetId: "wechat_login",
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async refreshSession(
    body: {
      refreshToken: string;
    }
  ) {
    const now = new Date();
    const result = await this.sessions.refreshSession({
      refreshToken: body.refreshToken,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "user_session",
          targetId: result.sessionId,
          latestStatus: "active"
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "user_session",
        targetId: "session_refresh",
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async logout(
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.sessions.revokeSession({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      reason: body.reason,
      now
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "user_session",
          targetId: actor.sessionId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    const { result: _result, ...payload } = result;
    return acceptedWriteResponse(
      {
        now,
        targetType: "user_session",
        targetId: result.sessionId,
        latestStatus: result.status
      },
      payload
    );
  }

  async ensureGuardianProfile(
    body: {
      phoneHash: string;
      phoneLast4: string;
      consentVersion: string;
      consentedAt: Date | string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.onboarding.ensureGuardianProfile({
      userId: actor.userId,
      phoneHash: body.phoneHash,
      phoneLast4: body.phoneLast4,
      consentVersion: body.consentVersion,
      consentedAt: coerceRequiredDate(body.consentedAt)
    });
    const { result: _result, ...payload } = result;

    return acceptedWriteResponse(
      {
        now,
        targetType: "guardian_profile",
        targetId: result.guardianId,
        latestStatus: result.guardianStatus
      },
      payload
    );
  }

  async createChild(
    body: {
      guardianId: string;
      displayName: string;
      gradeBand: string;
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.onboarding.createChildWithPrimaryGuardian({
      actorUserId: actor.userId,
      guardianId: body.guardianId,
      displayName: body.displayName,
      gradeBand: body.gradeBand,
      idempotencyKey: body.idempotencyKey,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "child_profile",
          targetId: result.childId,
          latestStatus: result.childStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "child_profile",
        targetId: body.guardianId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async updateChildSettings(
    childId: string,
    body: {
      challengeId?: string;
      patch: {
        canPublish?: boolean;
        canBid?: boolean;
        maxBidPoints?: number | null;
        bidRequiresGuardianConfirmation?: boolean;
        canUseCourier?: boolean;
        canUseGuardianArrangedDelivery?: boolean;
        canFavorite?: boolean;
      };
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.guardians.updateChildGuardianSettings({
      actorUserId: actor.userId,
      childId,
      sessionId: actor.sessionId,
      challengeId: body.challengeId,
      patch: body.patch,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "child_guardian_settings",
          targetId: result.childId,
          latestStatus: "active"
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "child_guardian_settings",
        targetId: childId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async openGuardianDispute(
    childId: string,
    body: {
      disputeType:
        | "guardian_change"
        | "unlink"
        | "deletion"
        | "consent"
        | "transaction";
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.guardians.openGuardianDispute({
      actorUserId: actor.userId,
      childId,
      disputeType: body.disputeType,
      reason: body.reason,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "guardian_dispute",
          targetId: result.disputeId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "guardian_dispute",
        targetId: childId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async createSensitiveOperationChallenge(
    body: {
      operationType: string;
      targetType: string;
      targetId: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.sensitiveOperations.createChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: body.operationType,
      targetType: body.targetType,
      targetId: body.targetId,
      now
    });

    if (result.result === "accepted") {
      const {
        result: _result,
        targetType,
        targetId,
        ...payload
      } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "sensitive_operation_challenge",
          targetId: result.challengeId,
          latestStatus: result.status
        },
        {
          ...payload,
          operationTargetType: targetType,
          operationTargetId: targetId
        }
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "sensitive_operation_challenge",
        targetId: body.targetId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async verifySensitiveOperationChallenge(
    challengeId: string,
    body: {
      verificationCode: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.sensitiveOperations.markPassed({
      challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode: body.verificationCode,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "sensitive_operation_challenge",
          targetId: result.challengeId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "sensitive_operation_challenge",
        targetId: challengeId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  private authenticate(
    authorization: string | undefined,
    now: Date
  ): Promise<AuthenticatedActor> {
    return authenticateBearerSession(
      {
        authorization,
        now
      },
      this.sessionTokens,
      this.sessions
    );
  }
}

defineConstructorParamTypes(AccountsController, [
  OnboardingService,
  SessionService,
  GuardianManagementService,
  SensitiveOperationService,
  SessionTokenService
]);
Controller("accounts")(AccountsController);
applyMethodDecorator(
  Post("wechat-login"),
  AccountsController.prototype,
  "loginWithWechat"
);
applyMethodDecorator(
  Post("refresh"),
  AccountsController.prototype,
  "refreshSession"
);
applyMethodDecorator(Post("logout"), AccountsController.prototype, "logout");
applyMethodDecorator(
  Post("guardian-profile"),
  AccountsController.prototype,
  "ensureGuardianProfile"
);
applyMethodDecorator(Post("children"), AccountsController.prototype, "createChild");
applyMethodDecorator(
  Patch("children/:childId/settings"),
  AccountsController.prototype,
  "updateChildSettings"
);
applyMethodDecorator(
  Post("children/:childId/guardian-disputes"),
  AccountsController.prototype,
  "openGuardianDispute"
);
applyMethodDecorator(
  Post("sensitive-operation-challenges"),
  AccountsController.prototype,
  "createSensitiveOperationChallenge"
);
applyMethodDecorator(
  Post("sensitive-operation-challenges/:challengeId/verify"),
  AccountsController.prototype,
  "verifySensitiveOperationChallenge"
);
applyParameterDecorator(Body(), AccountsController.prototype, "loginWithWechat", 0);
applyParameterDecorator(Body(), AccountsController.prototype, "refreshSession", 0);
applyParameterDecorator(Body(), AccountsController.prototype, "logout", 0);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "logout",
  1
);
applyParameterDecorator(
  Body(),
  AccountsController.prototype,
  "ensureGuardianProfile",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "ensureGuardianProfile",
  1
);
applyParameterDecorator(Body(), AccountsController.prototype, "createChild", 0);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "createChild",
  1
);
applyParameterDecorator(
  Param("childId"),
  AccountsController.prototype,
  "updateChildSettings",
  0
);
applyParameterDecorator(
  Body(),
  AccountsController.prototype,
  "updateChildSettings",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "updateChildSettings",
  2
);
applyParameterDecorator(
  Param("childId"),
  AccountsController.prototype,
  "openGuardianDispute",
  0
);
applyParameterDecorator(
  Body(),
  AccountsController.prototype,
  "openGuardianDispute",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "openGuardianDispute",
  2
);
applyParameterDecorator(
  Body(),
  AccountsController.prototype,
  "createSensitiveOperationChallenge",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "createSensitiveOperationChallenge",
  1
);
applyParameterDecorator(
  Param("challengeId"),
  AccountsController.prototype,
  "verifySensitiveOperationChallenge",
  0
);
applyParameterDecorator(
  Body(),
  AccountsController.prototype,
  "verifySensitiveOperationChallenge",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  AccountsController.prototype,
  "verifySensitiveOperationChallenge",
  2
);

function coerceRequiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function acceptedWriteResponse<T extends Record<string, unknown>>(
  meta: WriteResponseMeta,
  payload: T
) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: "accepted",
    refreshRequired: false,
    ...payload
  };
}

function rejectedWriteResponse(
  meta: WriteResponseMeta,
  errorCode: string
): RejectedWriteResponse {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: "rejected",
    refreshRequired: false,
    errorCode
  };
}

function applyParameterDecorator(
  decorator: ParameterDecorator,
  target: object,
  propertyKey: string,
  parameterIndex: number
) {
  decorator(target, propertyKey, parameterIndex);
}

function applyMethodDecorator(
  decorator: MethodDecorator,
  target: object,
  propertyKey: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) {
    throw new Error(`Missing method descriptor for ${propertyKey}`);
  }

  decorator(target, propertyKey, descriptor);
}

function defineConstructorParamTypes(target: object, paramTypes: unknown[]) {
  Reflect.defineMetadata("design:paramtypes", paramTypes, target);
}
