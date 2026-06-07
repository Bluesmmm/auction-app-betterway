import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import type {
  AppealStatus,
  DecisionValue,
  DeliveryMethod
} from "@prisma/client";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../accounts/sensitive-operation.service.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { TransactionAppealService } from "./transaction-appeal.service.js";
import {
  type AdminDisputeResolutionAction,
  TransactionDecisionService
} from "./transaction-decision.service.js";

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

export class AuctionsController {
  constructor(
    private readonly decisions: TransactionDecisionService,
    private readonly appeals: TransactionAppealService,
    private readonly sessions: SessionService,
    private readonly sessionTokens: SessionTokenService,
    private readonly sensitiveOperations: SensitiveOperationService
  ) {}

  async getTransactionDetail(transactionId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.decisions.getTransactionDetail({
      actorUserId: actor.userId,
      transactionId
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction",
          targetId: transactionId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    const { result: _result, ...payload } = result;
    return acceptedWriteResponse(
      {
        now,
        targetType: "transaction",
        targetId: result.transactionId,
        targetVersion: result.version,
        latestStatus: result.status
      },
      payload
    );
  }

  async decideGuardianConfirmation(
    transactionId: string,
    body: {
      value: DecisionValue;
      deliveryMethod?: DeliveryMethod;
      deliveryPointId?: string | null;
      reason?: string;
      idempotencyKey: string;
      challengeId?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const challenge = await this.authorizeTransactionMutation({
      actor,
      transactionId,
      challengeId: body.challengeId,
      now
    });
    if (challenge.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction",
          targetId: transactionId,
          latestStatus: "rejected"
        },
        challenge.errorCode
      );
    }

    const result = await this.decisions.decideGuardianConfirmation({
      actorUserId: actor.userId,
      transactionId,
      value: body.value,
      deliveryMethod: body.deliveryMethod,
      deliveryPointId: body.deliveryPointId,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      now
    });

    return transactionDecisionResponse(now, transactionId, result);
  }

  async decideDeliveryConfirmation(
    transactionId: string,
    body: {
      value: DecisionValue;
      idempotencyKey: string;
      challengeId?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const challenge = await this.authorizeTransactionMutation({
      actor,
      transactionId,
      challengeId: body.challengeId,
      now
    });
    if (challenge.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction",
          targetId: transactionId,
          latestStatus: "rejected"
        },
        challenge.errorCode
      );
    }

    const result = await this.decisions.decideDeliveryConfirmation({
      actorUserId: actor.userId,
      transactionId,
      value: body.value,
      idempotencyKey: body.idempotencyKey,
      now
    });

    return transactionDecisionResponse(now, transactionId, result);
  }

  async createTransactionAppeal(
    transactionId: string,
    body: {
      reason: string;
      attachmentMediaAssetIds?: string[];
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.createTransactionAppeal({
      actorUserId: actor.userId,
      transactionId,
      reason: body.reason,
      attachmentMediaAssetIds: body.attachmentMediaAssetIds,
      now
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction_appeal",
          targetId: transactionId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    const { result: _result, ...payload } = result;
    return acceptedWriteResponse(
      {
        now,
        targetType: "transaction_appeal",
        targetId: result.appealId,
        latestStatus: result.status
      },
      payload
    );
  }

  async resolveTransactionDispute(
    transactionId: string,
    body: {
      action: AdminDisputeResolutionAction;
      idempotencyKey: string;
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.decisions.resolveTransactionDispute({
      actorUserId: actor.userId,
      transactionId,
      action: body.action,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
      now
    });

    return adminDisputeResolutionResponse(now, transactionId, result);
  }

  async createAppealAttachmentGrant(
    appealAttachmentId: string,
    body: {
      ttlSeconds: number;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.createAppealImageGrant({
      actorUserId: actor.userId,
      appealAttachmentId,
      ttlSeconds: body.ttlSeconds,
      now
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "appeal_attachment_grant",
          targetId: appealAttachmentId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "appeal_attachment_grant",
        targetId: appealAttachmentId,
        latestStatus: "active"
      },
      result
    );
  }

  async listDeliveryPoints(communityId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.listDeliveryPoints({
      actorUserId: actor.userId,
      communityId
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "delivery_points",
          targetId: communityId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "delivery_points",
        targetId: communityId,
        latestStatus: "active"
      },
      {
        points: result.points
      }
    );
  }

  async createDeliveryPoint(
    communityId: string,
    body: {
      name: string;
      addressText: string;
      availableTimeText: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.createDeliveryPoint({
      actorUserId: actor.userId,
      communityId,
      name: body.name,
      addressText: body.addressText,
      availableTimeText: body.availableTimeText,
      now
    });

    return deliveryPointResponse(now, communityId, result);
  }

  async updateDeliveryPoint(
    deliveryPointId: string,
    body: {
      name?: string;
      addressText?: string;
      availableTimeText?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.updateDeliveryPoint({
      actorUserId: actor.userId,
      deliveryPointId,
      name: body.name,
      addressText: body.addressText,
      availableTimeText: body.availableTimeText,
      now
    });

    return deliveryPointResponse(now, deliveryPointId, result);
  }

  async disableDeliveryPoint(
    deliveryPointId: string,
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.disableDeliveryPoint({
      actorUserId: actor.userId,
      deliveryPointId,
      reason: body.reason,
      now
    });

    return deliveryPointResponse(now, deliveryPointId, result);
  }

  async listAppeals(
    communityId?: string,
    status?: AppealStatus,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.listAppeals({
      actorUserId: actor.userId,
      communityId,
      status
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction_appeals",
          targetId: communityId ?? "platform",
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "transaction_appeals",
        targetId: communityId ?? "platform",
        latestStatus: "active"
      },
      {
        appeals: result.appeals
      }
    );
  }

  async getAppealDetail(appealId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.getAppealDetail({
      actorUserId: actor.userId,
      appealId
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction_appeal",
          targetId: appealId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "transaction_appeal",
        targetId: appealId,
        latestStatus: result.appeal.status
      },
      {
        appeal: result.appeal
      }
    );
  }

  async reviewAppeal(
    appealId: string,
    body: {
      action: "resolve" | "reject" | "escalate_platform" | "platform_resolve";
      resolution: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.appeals.reviewAppeal({
      actorUserId: actor.userId,
      appealId,
      action: body.action,
      resolution: body.resolution,
      now
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "transaction_appeal",
          targetId: appealId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "transaction_appeal",
        targetId: appealId,
        latestStatus: result.status
      },
      result
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

  private async authorizeTransactionMutation(input: {
    actor: AuthenticatedActor;
    transactionId: string;
    challengeId?: string;
    now: Date;
  }) {
    return this.sensitiveOperations.authorizeFreshChallenge({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      operationType: SensitiveOperationType.confirmTransaction,
      targetType: "transaction",
      targetId: input.transactionId,
      challengeId: input.challengeId,
      now: input.now
    });
  }
}

defineConstructorParamTypes(AuctionsController, [
  TransactionDecisionService,
  TransactionAppealService,
  SessionService,
  SessionTokenService,
  SensitiveOperationService
]);
Controller("auctions")(AuctionsController);
applyMethodDecorator(
  Get("transactions/:transactionId"),
  AuctionsController.prototype,
  "getTransactionDetail"
);
applyMethodDecorator(
  Post("transactions/:transactionId/guardian-confirm"),
  AuctionsController.prototype,
  "decideGuardianConfirmation"
);
applyMethodDecorator(
  Post("transactions/:transactionId/delivery-confirm"),
  AuctionsController.prototype,
  "decideDeliveryConfirmation"
);
applyMethodDecorator(
  Post("transactions/:transactionId/appeals"),
  AuctionsController.prototype,
  "createTransactionAppeal"
);
applyMethodDecorator(
  Post("transactions/:transactionId/dispute-resolution"),
  AuctionsController.prototype,
  "resolveTransactionDispute"
);
applyMethodDecorator(
  Post("appeal-attachments/:appealAttachmentId/grant"),
  AuctionsController.prototype,
  "createAppealAttachmentGrant"
);
applyMethodDecorator(
  Get("communities/:communityId/delivery-points"),
  AuctionsController.prototype,
  "listDeliveryPoints"
);
applyMethodDecorator(
  Post("communities/:communityId/delivery-points"),
  AuctionsController.prototype,
  "createDeliveryPoint"
);
applyMethodDecorator(
  Patch("delivery-points/:deliveryPointId"),
  AuctionsController.prototype,
  "updateDeliveryPoint"
);
applyMethodDecorator(
  Post("delivery-points/:deliveryPointId/disable"),
  AuctionsController.prototype,
  "disableDeliveryPoint"
);
applyMethodDecorator(Get("appeals"), AuctionsController.prototype, "listAppeals");
applyMethodDecorator(
  Get("appeals/:appealId"),
  AuctionsController.prototype,
  "getAppealDetail"
);
applyMethodDecorator(
  Post("appeals/:appealId/review"),
  AuctionsController.prototype,
  "reviewAppeal"
);
applyParameterDecorator(
  Param("transactionId"),
  AuctionsController.prototype,
  "getTransactionDetail",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "getTransactionDetail",
  1
);
applyParameterDecorator(
  Param("transactionId"),
  AuctionsController.prototype,
  "decideGuardianConfirmation",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "decideGuardianConfirmation", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "decideGuardianConfirmation",
  2
);
applyParameterDecorator(
  Param("transactionId"),
  AuctionsController.prototype,
  "decideDeliveryConfirmation",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "decideDeliveryConfirmation", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "decideDeliveryConfirmation",
  2
);
applyParameterDecorator(
  Param("transactionId"),
  AuctionsController.prototype,
  "createTransactionAppeal",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "createTransactionAppeal", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "createTransactionAppeal",
  2
);
applyParameterDecorator(
  Param("transactionId"),
  AuctionsController.prototype,
  "resolveTransactionDispute",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "resolveTransactionDispute", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "resolveTransactionDispute",
  2
);
applyParameterDecorator(
  Param("appealAttachmentId"),
  AuctionsController.prototype,
  "createAppealAttachmentGrant",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "createAppealAttachmentGrant", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "createAppealAttachmentGrant",
  2
);
applyParameterDecorator(
  Param("communityId"),
  AuctionsController.prototype,
  "listDeliveryPoints",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "listDeliveryPoints",
  1
);
applyParameterDecorator(
  Param("communityId"),
  AuctionsController.prototype,
  "createDeliveryPoint",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "createDeliveryPoint", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "createDeliveryPoint",
  2
);
applyParameterDecorator(
  Param("deliveryPointId"),
  AuctionsController.prototype,
  "updateDeliveryPoint",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "updateDeliveryPoint", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "updateDeliveryPoint",
  2
);
applyParameterDecorator(
  Param("deliveryPointId"),
  AuctionsController.prototype,
  "disableDeliveryPoint",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "disableDeliveryPoint", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "disableDeliveryPoint",
  2
);
applyParameterDecorator(Query("communityId"), AuctionsController.prototype, "listAppeals", 0);
applyParameterDecorator(Query("status"), AuctionsController.prototype, "listAppeals", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "listAppeals",
  2
);
applyParameterDecorator(
  Param("appealId"),
  AuctionsController.prototype,
  "getAppealDetail",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "getAppealDetail",
  1
);
applyParameterDecorator(
  Param("appealId"),
  AuctionsController.prototype,
  "reviewAppeal",
  0
);
applyParameterDecorator(Body(), AuctionsController.prototype, "reviewAppeal", 1);
applyParameterDecorator(
  Headers("authorization"),
  AuctionsController.prototype,
  "reviewAppeal",
  2
);

function transactionDecisionResponse(
  now: Date,
  transactionId: string,
  result: Awaited<
    ReturnType<TransactionDecisionService["decideGuardianConfirmation"]>
  >
) {
  if (result.result === "rejected") {
    return rejectedWriteResponse(
      {
        now,
        targetType: "transaction",
        targetId: transactionId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  const { result: _result, ...payload } = result;
  return acceptedWriteResponse(
    {
      now,
      targetType: "transaction",
      targetId: result.transactionId,
      latestStatus: result.status
    },
    payload
  );
}

function adminDisputeResolutionResponse(
  now: Date,
  transactionId: string,
  result: Awaited<
    ReturnType<TransactionDecisionService["resolveTransactionDispute"]>
  >
) {
  if (result.result === "rejected") {
    return rejectedWriteResponse(
      {
        now,
        targetType: "transaction",
        targetId: transactionId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  const { result: _result, ...payload } = result;
  return acceptedWriteResponse(
    {
      now,
      targetType: "transaction",
      targetId: result.transactionId,
      latestStatus: result.status
    },
    payload
  );
}

function deliveryPointResponse(
  now: Date,
  fallbackTargetId: string,
  result: Awaited<ReturnType<TransactionAppealService["createDeliveryPoint"]>>
) {
  if (result.result === "rejected") {
    return rejectedWriteResponse(
      {
        now,
        targetType: "delivery_point",
        targetId: fallbackTargetId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  return acceptedWriteResponse(
    {
      now,
      targetType: "delivery_point",
      targetId: result.point.id,
      latestStatus: result.point.status
    },
    {
      point: result.point
    }
  );
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
