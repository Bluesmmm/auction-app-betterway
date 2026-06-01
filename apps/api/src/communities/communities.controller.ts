import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post
} from "@nestjs/common";
import type {
  Prisma,
  RiskRestrictionScope,
  RiskRestrictionType,
  RiskSignalType,
  RosterVerificationStatus
} from "@prisma/client";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { RiskGovernanceService } from "../accounts/risk-governance.service.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { CommunityAdminAuthorizationService } from "./community-admin-authorization.service.js";
import { CommunityAccessService } from "./community-access.service.js";
import { CommunityApplicationService } from "./community-application.service.js";

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

export class CommunitiesController {
  constructor(
    private readonly applications: CommunityApplicationService,
    private readonly adminAuthorizations: CommunityAdminAuthorizationService,
    private readonly access: CommunityAccessService,
    private readonly risks: RiskGovernanceService,
    private readonly sessionTokens: SessionTokenService,
    private readonly sessions: SessionService
  ) {}

  async listCreationRequests(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.applications.listCreationRequests({
      platformAdminUserId: actor.userId
    });
  }

  async listMemberReviewQueue(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.access.listMemberReviewQueue({
      platformAdminUserId: actor.userId,
      now
    });
  }

  async listScopedMemberReviewQueue(
    communityId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.access.listScopedMemberReviewQueue({
      actorUserId: actor.userId,
      communityId,
      now
    });
  }

  async listRiskSignals(authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.risks.listRiskSignals({
      platformAdminUserId: actor.userId
    });
  }

  async submitCreationRequest(
    body: {
      guardianId: string;
      name: string;
      description?: string;
      gradeBand: string;
      expectedChildCount: number;
      ruleDraftJson: Prisma.InputJsonValue;
      challengeId: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.applications.submitCreationRequest({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      guardianId: body.guardianId,
      name: body.name,
      description: body.description,
      gradeBand: body.gradeBand,
      expectedChildCount: body.expectedChildCount,
      ruleDraftJson: body.ruleDraftJson,
      challengeId: body.challengeId,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_creation_request",
          targetId: result.requestId,
          latestStatus: result.requestStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_creation_request",
        targetId: body.guardianId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async approveCreationRequest(
    requestId: string,
    body: {
      defaultAuctionDurationMinutes: number;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.applications.approveCreationRequest({
      platformAdminUserId: actor.userId,
      requestId,
      defaultAuctionDurationMinutes: body.defaultAuctionDurationMinutes,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_creation_request",
          targetId: result.requestId,
          latestStatus: result.requestStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_creation_request",
        targetId: requestId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async rejectCreationRequest(
    requestId: string,
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.applications.rejectCreationRequest({
      platformAdminUserId: actor.userId,
      requestId,
      reason: body.reason,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_creation_request",
          targetId: result.requestId,
          latestStatus: result.requestStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_creation_request",
        targetId: requestId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async grantActivityAdmin(
    communityId: string,
    body: {
      targetUserId: string;
      challengeId?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.adminAuthorizations.grantActivityAdmin({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: body.challengeId,
      targetUserId: body.targetUserId,
      communityId,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "admin_community_scope",
          targetId: result.adminProfileId,
          latestStatus: result.scopeStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "admin_community_scope",
        targetId: body.targetUserId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async revokeActivityAdmin(
    communityId: string,
    body: {
      targetUserId: string;
      reason: string;
      challengeId?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.adminAuthorizations.revokeActivityAdmin({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: body.challengeId,
      targetUserId: body.targetUserId,
      communityId,
      reason: body.reason,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "admin_community_scope",
          targetId: result.adminProfileId,
          latestStatus: result.scopeStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "admin_community_scope",
        targetId: body.targetUserId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async createInvite(
    communityId: string,
    body: {
      code: string;
      maxUses?: number;
      expiresAt?: Date | string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.access.createInviteCode({
      actorUserId: actor.userId,
      communityId,
      code: body.code,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? coerceRequiredDate(body.expiresAt) : undefined
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_invite_code",
          targetId: result.inviteCodeId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_invite_code",
        targetId: communityId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async requestJoin(
    body: {
      childId: string;
      code: string;
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.access.requestJoinWithInvite({
      actorUserId: actor.userId,
      childId: body.childId,
      code: body.code,
      idempotencyKey: body.idempotencyKey,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_member",
          targetId: memberTargetId(result.communityId, result.childId),
          latestStatus: result.memberStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_member",
        targetId: body.childId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async guardianConfirmMember(
    communityId: string,
    childId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.access.confirmJoinByPrimaryGuardian({
      actorUserId: actor.userId,
      communityId,
      childId,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_member",
          targetId: memberTargetId(result.communityId, result.childId),
          latestStatus: result.memberStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_member",
        targetId: memberTargetId(communityId, childId),
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async recordRosterVerification(
    communityId: string,
    childId: string,
    body: {
      status: RosterVerificationStatus;
      evidenceJson: Prisma.InputJsonValue;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.access.recordRosterVerification({
      actorUserId: actor.userId,
      communityId,
      childId,
      status: body.status,
      evidenceJson: body.evidenceJson,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_member",
          targetId: memberTargetId(result.communityId, result.childId),
          latestStatus: result.memberStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_member",
        targetId: memberTargetId(communityId, childId),
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async approveCommunityMember(
    communityId: string,
    childId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.access.approveCommunityMember({
      actorUserId: actor.userId,
      communityId,
      childId,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "community_member",
          targetId: memberTargetId(result.communityId, result.childId),
          latestStatus: result.memberStatus
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "community_member",
        targetId: memberTargetId(communityId, childId),
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async recordRiskSignal(
    body: {
      type: RiskSignalType;
      scope: RiskRestrictionScope;
      targetId: string;
      evidenceJson: Prisma.InputJsonValue;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.risks.recordRiskSignal({
      actorUserId: actor.userId,
      type: body.type,
      scope: body.scope,
      targetId: body.targetId,
      evidenceJson: body.evidenceJson,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "risk_signal",
          targetId: result.signalId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "risk_signal",
        targetId: body.targetId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async reviewRiskSignal(
    signalId: string,
    body: {
      decision: "resolved" | "dismissed";
      resolutionText: string;
      resolveRestrictions?: boolean;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.risks.reviewRiskSignal({
      platformAdminUserId: actor.userId,
      signalId,
      decision: body.decision,
      resolutionText: body.resolutionText,
      resolveRestrictions: body.resolveRestrictions,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "risk_signal",
          targetId: result.signalId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "risk_signal",
        targetId: signalId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async applyRiskRestriction(
    body: {
      type: RiskRestrictionType;
      scope: RiskRestrictionScope;
      targetId: string;
      reason: string;
      challengeId?: string;
      expiresAt?: Date | string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.risks.applyRiskRestriction({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: body.challengeId,
      type: body.type,
      scope: body.scope,
      targetId: body.targetId,
      reason: body.reason,
      expiresAt: body.expiresAt ? coerceRequiredDate(body.expiresAt) : undefined,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "risk_restriction",
          targetId: result.restrictionId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "risk_restriction",
        targetId: body.targetId,
        latestStatus: "rejected"
      },
      result.errorCode
    );
  }

  async resolveRiskRestriction(
    restrictionId: string,
    body: {
      resolutionText: string;
      challengeId?: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.risks.resolveRiskRestriction({
      platformAdminUserId: actor.userId,
      sessionId: actor.sessionId,
      challengeId: body.challengeId,
      restrictionId,
      resolutionText: body.resolutionText,
      now
    });

    if (result.result === "accepted") {
      const { result: _result, ...payload } = result;
      return acceptedWriteResponse(
        {
          now,
          targetType: "risk_restriction",
          targetId: result.restrictionId,
          latestStatus: result.status
        },
        payload
      );
    }

    return rejectedWriteResponse(
      {
        now,
        targetType: "risk_restriction",
        targetId: restrictionId,
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

defineConstructorParamTypes(CommunitiesController, [
  CommunityApplicationService,
  CommunityAdminAuthorizationService,
  CommunityAccessService,
  RiskGovernanceService,
  SessionTokenService,
  SessionService
]);
Controller("communities")(CommunitiesController);
applyMethodDecorator(
  Get("creation-requests"),
  CommunitiesController.prototype,
  "listCreationRequests"
);
applyMethodDecorator(
  Get("member-review-queue"),
  CommunitiesController.prototype,
  "listMemberReviewQueue"
);
applyMethodDecorator(
  Get(":communityId/member-review-queue"),
  CommunitiesController.prototype,
  "listScopedMemberReviewQueue"
);
applyMethodDecorator(
  Get("risk-signals"),
  CommunitiesController.prototype,
  "listRiskSignals"
);
applyMethodDecorator(
  Post("creation-requests"),
  CommunitiesController.prototype,
  "submitCreationRequest"
);
applyMethodDecorator(
  Post("creation-requests/:requestId/approve"),
  CommunitiesController.prototype,
  "approveCreationRequest"
);
applyMethodDecorator(
  Post("creation-requests/:requestId/reject"),
  CommunitiesController.prototype,
  "rejectCreationRequest"
);
applyMethodDecorator(
  Post(":communityId/activity-admins"),
  CommunitiesController.prototype,
  "grantActivityAdmin"
);
applyMethodDecorator(
  Post(":communityId/activity-admins/revoke"),
  CommunitiesController.prototype,
  "revokeActivityAdmin"
);
applyMethodDecorator(
  Post(":communityId/invites"),
  CommunitiesController.prototype,
  "createInvite"
);
applyMethodDecorator(
  Post("join-requests"),
  CommunitiesController.prototype,
  "requestJoin"
);
applyMethodDecorator(
  Post(":communityId/members/:childId/guardian-confirm"),
  CommunitiesController.prototype,
  "guardianConfirmMember"
);
applyMethodDecorator(
  Post(":communityId/members/:childId/roster-verification"),
  CommunitiesController.prototype,
  "recordRosterVerification"
);
applyMethodDecorator(
  Post(":communityId/members/:childId/approve"),
  CommunitiesController.prototype,
  "approveCommunityMember"
);
applyMethodDecorator(
  Post("risk-signals"),
  CommunitiesController.prototype,
  "recordRiskSignal"
);
applyMethodDecorator(
  Post("risk-signals/:signalId/review"),
  CommunitiesController.prototype,
  "reviewRiskSignal"
);
applyMethodDecorator(
  Post("risk-restrictions"),
  CommunitiesController.prototype,
  "applyRiskRestriction"
);
applyMethodDecorator(
  Post("risk-restrictions/:restrictionId/resolve"),
  CommunitiesController.prototype,
  "resolveRiskRestriction"
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "listCreationRequests",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "listMemberReviewQueue",
  0
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "listScopedMemberReviewQueue",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "listScopedMemberReviewQueue",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "listRiskSignals",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "submitCreationRequest",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "submitCreationRequest",
  1
);
applyParameterDecorator(
  Param("requestId"),
  CommunitiesController.prototype,
  "approveCreationRequest",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "approveCreationRequest",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "approveCreationRequest",
  2
);
applyParameterDecorator(
  Param("requestId"),
  CommunitiesController.prototype,
  "rejectCreationRequest",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "rejectCreationRequest",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "rejectCreationRequest",
  2
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "grantActivityAdmin",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "grantActivityAdmin",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "grantActivityAdmin",
  2
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "revokeActivityAdmin",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "revokeActivityAdmin",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "revokeActivityAdmin",
  2
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "createInvite",
  0
);
applyParameterDecorator(Body(), CommunitiesController.prototype, "createInvite", 1);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "createInvite",
  2
);
applyParameterDecorator(Body(), CommunitiesController.prototype, "requestJoin", 0);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "requestJoin",
  1
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "guardianConfirmMember",
  0
);
applyParameterDecorator(
  Param("childId"),
  CommunitiesController.prototype,
  "guardianConfirmMember",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "guardianConfirmMember",
  2
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "recordRosterVerification",
  0
);
applyParameterDecorator(
  Param("childId"),
  CommunitiesController.prototype,
  "recordRosterVerification",
  1
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "recordRosterVerification",
  2
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "recordRosterVerification",
  3
);
applyParameterDecorator(
  Param("communityId"),
  CommunitiesController.prototype,
  "approveCommunityMember",
  0
);
applyParameterDecorator(
  Param("childId"),
  CommunitiesController.prototype,
  "approveCommunityMember",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "approveCommunityMember",
  2
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "recordRiskSignal",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "recordRiskSignal",
  1
);
applyParameterDecorator(
  Param("signalId"),
  CommunitiesController.prototype,
  "reviewRiskSignal",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "reviewRiskSignal",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "reviewRiskSignal",
  2
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "applyRiskRestriction",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "applyRiskRestriction",
  1
);
applyParameterDecorator(
  Param("restrictionId"),
  CommunitiesController.prototype,
  "resolveRiskRestriction",
  0
);
applyParameterDecorator(
  Body(),
  CommunitiesController.prototype,
  "resolveRiskRestriction",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  CommunitiesController.prototype,
  "resolveRiskRestriction",
  2
);

function coerceRequiredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function memberTargetId(communityId: string, childId: string): string {
  return `${communityId}:${childId}`;
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
