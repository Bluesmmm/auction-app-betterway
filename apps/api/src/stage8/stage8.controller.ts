import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import {
  Stage8GovernanceService,
  type Stage8AdminOperation
} from "./stage8-governance.service.js";
import type { HighRiskGovernanceReviewDecisionState } from "./high-risk-governance-review.service.js";
import type {
  GovernanceControlScopeType,
  GovernanceControlType
} from "@prisma/client";

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

const allowedOperations = new Set<Stage8AdminOperation>([
  "export_child_data",
  "pause_community",
  "force_delist",
  "adjust_points",
  "adjust_auction_end_time"
]);
const allowedGovernanceControlScopeTypes = new Set<GovernanceControlScopeType>([
  "platform",
  "community"
]);
const allowedGovernanceControlTypes = new Set<GovernanceControlType>([
  "pause_publish",
  "pause_bid",
  "pause_settlement",
  "force_platform_review"
]);
const allowedReviewDecisionStates = new Set<
  HighRiskGovernanceReviewDecisionState | "all"
>(["pending", "approved", "rejected", "expired", "withdrawn", "invalidated", "all"]);

export class Stage8Controller {
  constructor(
    private readonly governance: Stage8GovernanceService,
    private readonly sessions: SessionService,
    private readonly sessionTokens: SessionTokenService
  ) {}

  async getGovernanceOverview(
    query: {
      communityId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const communityId = nonEmptyString(query.communityId);
    const result = await this.governance.getGovernanceOverview({
      actorUserId: actor.userId,
      communityId
    });

    if (result.result === "rejected") {
      return rejectedResponse(
        {
          now,
          targetType: "stage8_governance_overview",
          targetId: communityId ?? actor.userId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    const { result: _result, ...payload } = result;
    return acceptedResponse(
      {
        now,
        targetType: "stage8_governance_overview",
        targetId: communityId ?? actor.userId,
        latestStatus: "active"
      },
      payload
    );
  }

  async createAdminOperationPreview(
    body: {
      operation?: string;
      targetType?: string;
      targetId?: string;
      communityId?: string;
      reason?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const operation = coerceOperation(body.operation);
    const targetType = nonEmptyString(body.targetType);
    const targetId = nonEmptyString(body.targetId);
    const meta = {
      now,
      targetType: "stage8_admin_operation_preview",
      targetId: targetId ?? actor.userId,
      latestStatus: "active"
    };
    if (!operation) {
      return rejectedResponse(meta, "OPERATION_NOT_SUPPORTED");
    }
    if (!targetType || !targetId) {
      return rejectedResponse(meta, "TARGET_REQUIRED");
    }

    const result = await this.governance.createAdminOperationPreview({
      actorUserId: actor.userId,
      operation,
      targetType,
      targetId,
      communityId: nonEmptyString(body.communityId),
      reason: nonEmptyString(body.reason),
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    const {
      result: _result,
      targetType: previewTargetType,
      targetId: previewTargetId,
      ...payload
    } = result;
    return acceptedResponse(
      {
        ...meta,
        targetId: result.previewId,
        latestStatus: "preview_created"
      },
      {
        ...payload,
        previewTargetType,
        previewTargetId
      }
    );
  }

  async listGovernanceControls(
    query: {
      communityId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.listGovernanceControls({
      actorUserId: actor.userId,
      communityId: nonEmptyString(query.communityId),
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(
        {
          now,
          targetType: "stage8_governance_controls",
          targetId: nonEmptyString(query.communityId) ?? actor.userId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedResponse(
      {
        now,
        targetType: "stage8_governance_controls",
        targetId: nonEmptyString(query.communityId) ?? actor.userId,
        latestStatus: "active"
      },
      {
        controls: result.controls
      }
    );
  }

  async createGovernanceControlPreview(
    body: {
      scopeType?: string;
      scopeId?: string | null;
      controlType?: string;
      reason?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const scopeType = coerceGovernanceControlScopeType(body.scopeType);
    const controlType = coerceGovernanceControlType(body.controlType);
    const meta = {
      now,
      targetType: "stage8_governance_control_preview",
      targetId: nonEmptyString(body.scopeId) ?? actor.userId,
      latestStatus: "active"
    };
    if (!scopeType || !controlType) {
      return rejectedResponse(meta, "GOVERNANCE_CONTROL_SCOPE_INVALID");
    }

    const result = await this.governance.createGovernanceControlPreview({
      actorUserId: actor.userId,
      scopeType,
      scopeId: nonEmptyString(body.scopeId) ?? null,
      controlType,
      reason: nonEmptyString(body.reason),
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    const { result: _result, ...payload } = result;
    return acceptedResponse(
      {
        ...meta,
        targetId: result.previewId,
        latestStatus: "preview_created"
      },
      payload
    );
  }

  async createGovernanceControl(
    body: {
      scopeType?: string;
      scopeId?: string | null;
      controlType?: string;
      previewId?: string;
      sensitiveChallengeId?: string;
      idempotencyKey?: string;
      reason?: string;
      endsAt?: string | null;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const scopeType = coerceGovernanceControlScopeType(body.scopeType);
    const controlType = coerceGovernanceControlType(body.controlType);
    const meta = {
      now,
      targetType: "stage8_governance_control",
      targetId: nonEmptyString(body.scopeId) ?? actor.userId,
      latestStatus: "active"
    };
    if (!scopeType || !controlType) {
      return rejectedResponse(meta, "GOVERNANCE_CONTROL_SCOPE_INVALID");
    }
    const parsedEndsAt = parseOptionalDate(body.endsAt);
    if (parsedEndsAt.result === "rejected") {
      return rejectedResponse(meta, "GOVERNANCE_CONTROL_ENDS_AT_INVALID");
    }

    const result = await this.governance.createGovernanceControl({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: nonEmptyString(body.sensitiveChallengeId),
      idempotencyKey: nonEmptyString(body.idempotencyKey),
      previewId: nonEmptyString(body.previewId),
      scopeType,
      scopeId: nonEmptyString(body.scopeId) ?? null,
      controlType,
      reason: nonEmptyString(body.reason),
      endsAt: parsedEndsAt.value,
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }
    if (result.result === "pending_review") {
      return pendingReviewResponse(
        {
          ...meta,
          targetId: result.review.id,
          latestStatus: result.review.decisionState
        },
        result.review
      );
    }

    return acceptedResponse(
      {
        ...meta,
        targetId: result.control.id,
        latestStatus: result.control.status
      },
      {
        control: result.control
      }
    );
  }

  async liftGovernanceControl(
    controlId: string,
    body: {
      sensitiveChallengeId?: string;
      idempotencyKey?: string;
      reason?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.liftGovernanceControl({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: nonEmptyString(body.sensitiveChallengeId),
      idempotencyKey: nonEmptyString(body.idempotencyKey),
      controlId,
      reason: nonEmptyString(body.reason),
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(
        {
          now,
          targetType: "stage8_governance_control",
          targetId: controlId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }
    if (result.result === "pending_review") {
      return pendingReviewResponse(
        {
          now,
          targetType: "stage8_governance_control",
          targetId: result.review.id,
          latestStatus: result.review.decisionState
        },
        result.review
      );
    }

    return acceptedResponse(
      {
        now,
        targetType: "stage8_governance_control",
        targetId: result.control.id,
        latestStatus: result.control.status
      },
      {
        control: result.control
      }
    );
  }

  async listHighRiskGovernanceReviews(
    query: {
      decisionState?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const requestedDecisionState = nonEmptyString(query.decisionState);
    const decisionState = coerceReviewDecisionState(requestedDecisionState);
    const meta = {
      now,
      targetType: "stage8_high_risk_governance_reviews",
      targetId: decisionState ?? "pending",
      latestStatus: "active"
    };
    if (requestedDecisionState && !decisionState) {
      return rejectedResponse(meta, "REVIEW_DECISION_STATE_INVALID");
    }

    const result = await this.governance.listHighRiskGovernanceReviews({
      actorUserId: actor.userId,
      decisionState,
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      reviews: result.reviews
    });
  }

  async getHighRiskGovernanceReviewDetail(
    reviewRequestId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.getHighRiskGovernanceReviewDetail({
      actorUserId: actor.userId,
      reviewRequestId,
      now
    });
    const meta = {
      now,
      targetType: "stage8_high_risk_governance_review",
      targetId: reviewRequestId,
      latestStatus: "active"
    };
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(
      {
        ...meta,
        latestStatus: result.review.decisionState
      },
      {
        review: result.review,
        events: result.events
      }
    );
  }

  async approveHighRiskGovernanceReview(
    reviewRequestId: string,
    body: {
      sensitiveChallengeId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.approveGovernanceControlReview({
      reviewRequestId,
      reviewerUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: nonEmptyString(body.sensitiveChallengeId),
      now
    });
    return this.reviewTransitionResponse({
      now,
      reviewRequestId,
      result
    });
  }

  async rejectHighRiskGovernanceReview(
    reviewRequestId: string,
    body: {
      sensitiveChallengeId?: string;
      reason?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.rejectGovernanceControlReview({
      reviewRequestId,
      reviewerUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: nonEmptyString(body.sensitiveChallengeId),
      reason: nonEmptyString(body.reason) ?? "",
      now
    });
    return this.reviewTransitionResponse({
      now,
      reviewRequestId,
      result
    });
  }

  async withdrawHighRiskGovernanceReview(
    reviewRequestId: string,
    body: {
      reason?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.governance.withdrawGovernanceControlReview({
      reviewRequestId,
      actorUserId: actor.userId,
      reason: nonEmptyString(body.reason) ?? "",
      now
    });
    return this.reviewTransitionResponse({
      now,
      reviewRequestId,
      result
    });
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

  private reviewTransitionResponse(input: {
    now: Date;
    reviewRequestId: string;
    result: Awaited<ReturnType<Stage8GovernanceService["approveGovernanceControlReview"]>>;
  }) {
    const meta = {
      now: input.now,
      targetType: "stage8_high_risk_governance_review",
      targetId: input.reviewRequestId,
      latestStatus: "active"
    };
    if (input.result.result === "rejected") {
      return rejectedResponse(meta, input.result.errorCode);
    }

    return acceptedResponse(
      {
        ...meta,
        targetId: input.result.review.id,
        latestStatus: input.result.review.decisionState
      },
      {
        review: input.result.review,
        transitionApplied: input.result.transitionApplied
      }
    );
  }
}

defineConstructorParamTypes(Stage8Controller, [
  Stage8GovernanceService,
  SessionService,
  SessionTokenService
]);
Controller("stage8")(Stage8Controller);
applyMethodDecorator(
  Get("governance/overview"),
  Stage8Controller.prototype,
  "getGovernanceOverview"
);
applyMethodDecorator(
  Post("admin-operation-previews"),
  Stage8Controller.prototype,
  "createAdminOperationPreview"
);
applyMethodDecorator(
  Get("governance-controls"),
  Stage8Controller.prototype,
  "listGovernanceControls"
);
applyMethodDecorator(
  Post("governance-control-previews"),
  Stage8Controller.prototype,
  "createGovernanceControlPreview"
);
applyMethodDecorator(
  Post("governance-controls"),
  Stage8Controller.prototype,
  "createGovernanceControl"
);
applyMethodDecorator(
  Post("governance-controls/:controlId/lift"),
  Stage8Controller.prototype,
  "liftGovernanceControl"
);
applyMethodDecorator(
  Get("high-risk-governance-reviews"),
  Stage8Controller.prototype,
  "listHighRiskGovernanceReviews"
);
applyMethodDecorator(
  Get("high-risk-governance-reviews/:reviewRequestId"),
  Stage8Controller.prototype,
  "getHighRiskGovernanceReviewDetail"
);
applyMethodDecorator(
  Post("high-risk-governance-reviews/:reviewRequestId/approve"),
  Stage8Controller.prototype,
  "approveHighRiskGovernanceReview"
);
applyMethodDecorator(
  Post("high-risk-governance-reviews/:reviewRequestId/reject"),
  Stage8Controller.prototype,
  "rejectHighRiskGovernanceReview"
);
applyMethodDecorator(
  Post("high-risk-governance-reviews/:reviewRequestId/withdraw"),
  Stage8Controller.prototype,
  "withdrawHighRiskGovernanceReview"
);
applyParameterDecorator(
  Query(),
  Stage8Controller.prototype,
  "getGovernanceOverview",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "getGovernanceOverview",
  1
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "createAdminOperationPreview",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "createAdminOperationPreview",
  1
);
applyParameterDecorator(
  Query(),
  Stage8Controller.prototype,
  "listGovernanceControls",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "listGovernanceControls",
  1
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "createGovernanceControlPreview",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "createGovernanceControlPreview",
  1
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "createGovernanceControl",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "createGovernanceControl",
  1
);
applyParameterDecorator(
  Param("controlId"),
  Stage8Controller.prototype,
  "liftGovernanceControl",
  0
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "liftGovernanceControl",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "liftGovernanceControl",
  2
);
applyParameterDecorator(
  Query(),
  Stage8Controller.prototype,
  "listHighRiskGovernanceReviews",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "listHighRiskGovernanceReviews",
  1
);
applyParameterDecorator(
  Param("reviewRequestId"),
  Stage8Controller.prototype,
  "getHighRiskGovernanceReviewDetail",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "getHighRiskGovernanceReviewDetail",
  1
);
applyParameterDecorator(
  Param("reviewRequestId"),
  Stage8Controller.prototype,
  "approveHighRiskGovernanceReview",
  0
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "approveHighRiskGovernanceReview",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "approveHighRiskGovernanceReview",
  2
);
applyParameterDecorator(
  Param("reviewRequestId"),
  Stage8Controller.prototype,
  "rejectHighRiskGovernanceReview",
  0
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "rejectHighRiskGovernanceReview",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "rejectHighRiskGovernanceReview",
  2
);
applyParameterDecorator(
  Param("reviewRequestId"),
  Stage8Controller.prototype,
  "withdrawHighRiskGovernanceReview",
  0
);
applyParameterDecorator(
  Body(),
  Stage8Controller.prototype,
  "withdrawHighRiskGovernanceReview",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  Stage8Controller.prototype,
  "withdrawHighRiskGovernanceReview",
  2
);

function acceptedResponse<T extends Record<string, unknown>>(
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

function rejectedResponse(meta: WriteResponseMeta, errorCode: string) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: "rejected",
    result: "rejected",
    refreshRequired: false,
    errorCode
  };
}

function pendingReviewResponse(
  meta: WriteResponseMeta,
  review: {
    id: string;
    actionType: string;
    decisionState: string;
    executionState: string;
    expiresAt: string;
    targetType: string;
    targetId: string;
  }
) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: "pending_review",
    refreshRequired: false,
    reviewRequestId: review.id,
    reviewStatus: review.decisionState,
    executionStatus: review.executionState,
    expiresAt: review.expiresAt,
    actionType: review.actionType,
    reviewTargetType: review.targetType,
    reviewTargetId: review.targetId
  };
}

function coerceOperation(value: unknown): Stage8AdminOperation | undefined {
  return typeof value === "string" && allowedOperations.has(value as Stage8AdminOperation)
    ? (value as Stage8AdminOperation)
    : undefined;
}

function coerceGovernanceControlScopeType(
  value: unknown
): GovernanceControlScopeType | undefined {
  return typeof value === "string" &&
    allowedGovernanceControlScopeTypes.has(value as GovernanceControlScopeType)
    ? (value as GovernanceControlScopeType)
    : undefined;
}

function coerceGovernanceControlType(
  value: unknown
): GovernanceControlType | undefined {
  return typeof value === "string" &&
    allowedGovernanceControlTypes.has(value as GovernanceControlType)
    ? (value as GovernanceControlType)
    : undefined;
}

function coerceReviewDecisionState(
  value: unknown
): HighRiskGovernanceReviewDecisionState | "all" | undefined {
  return typeof value === "string" &&
    allowedReviewDecisionStates.has(
      value as HighRiskGovernanceReviewDecisionState | "all"
    )
    ? (value as HighRiskGovernanceReviewDecisionState | "all")
    : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOptionalDate(value: unknown) {
  if (value == null) {
    return {
      result: "accepted" as const,
      value: null
    };
  }
  if (typeof value !== "string") {
    return {
      result: "rejected" as const
    };
  }
  if (!value.trim()) {
    return {
      result: "accepted" as const,
      value: null
    };
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? {
        result: "rejected" as const
      }
    : {
        result: "accepted" as const,
        value: date
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
