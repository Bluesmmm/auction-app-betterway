import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post
} from "@nestjs/common";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { LedgerCheckService } from "./ledger-check.service.js";
import { PointLedgerService } from "./point-ledger.service.js";

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

export class PointsController {
  constructor(
    private readonly points: PointLedgerService,
    private readonly ledgerChecks: LedgerCheckService,
    private readonly sessions: SessionService,
    private readonly sessionTokens: SessionTokenService
  ) {}

  async getChildPointSummary(childId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const summary = await this.points.getChildPointSummary({
      actorUserId: actor.userId,
      childId
    });

    if (summary.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "point_account",
          targetId: childId,
          latestStatus: "rejected"
        },
        summary.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "point_account",
        targetId: childId,
        latestStatus: "active"
      },
      summary
    );
  }

  async listChildLedgerEntries(childId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const entries = await this.points.listChildLedgerEntries({
      actorUserId: actor.userId,
      childId
    });

    if (entries.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "point_ledger_entries",
          targetId: childId,
          latestStatus: "rejected"
        },
        entries.errorCode
      );
    }

    const { result: _result, ...payload } = entries;
    return acceptedWriteResponse(
      {
        now,
        targetType: "point_ledger_entries",
        targetId: childId,
        latestStatus: "active"
      },
      payload
    );
  }

  async createGuardianAdjustmentRequest(
    childId: string,
    body: {
      requestType: "correction" | "activity_reward";
      requestedPoints: number;
      reason: string;
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.createGuardianAdjustmentRequest({
      actorUserId: actor.userId,
      childId,
      requestType: body.requestType,
      requestedPoints: body.requestedPoints,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "point_adjustment_request",
          targetId: result.requestId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "point_adjustment_request",
        targetId: childId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async listAdjustmentRequests(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.listAdjustmentRequests({
      platformAdminUserId: actor.userId
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "point_adjustment_request_queue",
          targetId: "latest",
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedWriteResponse(
      {
        now,
        targetType: "point_adjustment_request_queue",
        targetId: "latest",
        latestStatus: "active"
      },
      {
        requests: result.requests
      }
    );
  }

  async listLedgerCheckRuns(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const authorizationResult = await this.points.authorizePlatformAdmin({
      platformAdminUserId: actor.userId
    });
    if (authorizationResult.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "ledger_check_runs",
          targetId: "latest",
          latestStatus: "rejected"
        },
        authorizationResult.errorCode
      );
    }
    const runs = await this.ledgerChecks.listRecentRuns();

    return acceptedWriteResponse(
      {
        now,
        targetType: "ledger_check_runs",
        targetId: "latest",
        latestStatus: "active"
      },
      {
        runs
      }
    );
  }

  async getOperationsDashboard(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.getOperationsDashboard({
      platformAdminUserId: actor.userId,
      now
    });

    if (result.result === "rejected") {
      return rejectedWriteResponse(
        {
          now,
          targetType: "points_operations_dashboard",
          targetId: "latest",
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    const { result: _result, ...payload } = result;
    return acceptedWriteResponse(
      {
        now,
        targetType: "points_operations_dashboard",
        targetId: "latest",
        latestStatus: "active"
      },
      payload
    );
  }

  async createAdminAdjustmentRequest(
    body: {
      childId: string;
      requestType: "correction" | "admin_award" | "admin_penalty" | "batch_award";
      requestedPoints: number;
      reason: string;
      idempotencyKey: string;
      batchKey?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.createAdminAdjustmentRequest({
      platformAdminUserId: actor.userId,
      childId: body.childId,
      requestType: body.requestType,
      requestedPoints: body.requestedPoints,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      batchKey: body.batchKey,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "point_adjustment_request",
          targetId: result.requestId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "point_adjustment_request",
        targetId: body.childId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async reviewAdjustmentRequest(
    requestId: string,
    body: {
      decision: "approve" | "reject";
      reviewReason: string;
      challengeId?: string;
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.reviewAdjustmentRequest({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      requestId,
      decision: body.decision,
      reviewReason: body.reviewReason,
      challengeId: body.challengeId,
      idempotencyKey: body.idempotencyKey,
      now
    });

    return adjustmentReviewResponse(now, requestId, result);
  }

  async secondReviewAdjustmentRequest(
    requestId: string,
    body: {
      decision: "approve" | "reject";
      reviewReason: string;
      challengeId?: string;
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.points.secondReviewAdjustmentRequest({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      requestId,
      decision: body.decision,
      reviewReason: body.reviewReason,
      challengeId: body.challengeId,
      idempotencyKey: body.idempotencyKey,
      now
    });

    return adjustmentReviewResponse(now, requestId, result);
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

defineConstructorParamTypes(PointsController, [
  PointLedgerService,
  LedgerCheckService,
  SessionService,
  SessionTokenService
]);
Controller("points")(PointsController);
applyMethodDecorator(
  Get("children/:childId/summary"),
  PointsController.prototype,
  "getChildPointSummary"
);
applyMethodDecorator(
  Get("children/:childId/ledger-entries"),
  PointsController.prototype,
  "listChildLedgerEntries"
);
applyMethodDecorator(
  Get("adjustment-requests"),
  PointsController.prototype,
  "listAdjustmentRequests"
);
applyMethodDecorator(
  Get("ledger-check-runs"),
  PointsController.prototype,
  "listLedgerCheckRuns"
);
applyMethodDecorator(
  Get("operations-dashboard"),
  PointsController.prototype,
  "getOperationsDashboard"
);
applyMethodDecorator(
  Post("children/:childId/adjustment-requests"),
  PointsController.prototype,
  "createGuardianAdjustmentRequest"
);
applyMethodDecorator(
  Post("admin-adjustment-requests"),
  PointsController.prototype,
  "createAdminAdjustmentRequest"
);
applyMethodDecorator(
  Post("adjustment-requests/:requestId/review"),
  PointsController.prototype,
  "reviewAdjustmentRequest"
);
applyMethodDecorator(
  Post("adjustment-requests/:requestId/second-review"),
  PointsController.prototype,
  "secondReviewAdjustmentRequest"
);
applyParameterDecorator(
  Param("childId"),
  PointsController.prototype,
  "getChildPointSummary",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "getChildPointSummary",
  1
);
applyParameterDecorator(
  Param("childId"),
  PointsController.prototype,
  "listChildLedgerEntries",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "listChildLedgerEntries",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "listAdjustmentRequests",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "listLedgerCheckRuns",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "getOperationsDashboard",
  0
);
applyParameterDecorator(
  Param("childId"),
  PointsController.prototype,
  "createGuardianAdjustmentRequest",
  0
);
applyParameterDecorator(
  Body(),
  PointsController.prototype,
  "createGuardianAdjustmentRequest",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "createGuardianAdjustmentRequest",
  2
);
applyParameterDecorator(
  Body(),
  PointsController.prototype,
  "createAdminAdjustmentRequest",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "createAdminAdjustmentRequest",
  1
);
applyParameterDecorator(
  Param("requestId"),
  PointsController.prototype,
  "reviewAdjustmentRequest",
  0
);
applyParameterDecorator(
  Body(),
  PointsController.prototype,
  "reviewAdjustmentRequest",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "reviewAdjustmentRequest",
  2
);
applyParameterDecorator(
  Param("requestId"),
  PointsController.prototype,
  "secondReviewAdjustmentRequest",
  0
);
applyParameterDecorator(
  Body(),
  PointsController.prototype,
  "secondReviewAdjustmentRequest",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  PointsController.prototype,
  "secondReviewAdjustmentRequest",
  2
);

function adjustmentReviewResponse(
  now: Date,
  requestId: string,
  result: Awaited<ReturnType<PointLedgerService["reviewAdjustmentRequest"]>>
) {
  if (result.result === "accepted") {
    const { result: _result, ...payload } = result;
    return acceptedWriteResponse(
      {
        now,
        targetType: "point_adjustment_request",
        targetId: result.requestId,
        latestStatus: result.status
      },
      payload
    );
  }

  return rejectedWriteResponse(
    {
      now,
      targetType: "point_adjustment_request",
      targetId: requestId,
      latestStatus: "rejected"
    },
    result.errorCode
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

function rejectedWriteResponse(meta: WriteResponseMeta, errorCode: string) {
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
