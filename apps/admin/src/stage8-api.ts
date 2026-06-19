import { z } from "zod";
import { buildStage2AdminUrl } from "./stage2-api.js";

const stage8BaseResponseSchema = z.object({
  serverTime: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetVersion: z.number().int().positive(),
  latestStatus: z.string(),
  refreshRequired: z.boolean()
});

const stage8RejectedResponseSchema = stage8BaseResponseSchema.extend({
  result: z.literal("rejected"),
  errorCode: z.string()
});

const adminScopeSchema = z.object({
  role: z.string(),
  platformWide: z.boolean(),
  communityIds: z.array(z.string()),
  mfaEnabled: z.boolean()
});

const queueSummarySchema = z.object({
  pendingCommunityRequests: z.number().int(),
  pendingMemberReviews: z.number().int(),
  contentReviewTasks: z.number().int(),
  pendingAppeals: z.number().int(),
  platformAppeals: z.number().int(),
  unreadHighPriorityNotifications: z.number().int()
});

const systemSummarySchema = z.object({
  pendingOutboxEvents: z.number().int(),
  failedOutboxEvents: z.number().int(),
  latestLedgerCheck: z
    .object({
      id: z.string(),
      status: z.string(),
      ledgerDiffCount: z.number().int(),
      startedAt: z.string(),
      finishedAt: z.string().nullable()
    })
    .nullable()
});

const pilotMetricsSchema = z.object({
  activeCommunities: z.number().int(),
  activeMembers: z.number().int(),
  activeAuctions: z.number().int(),
  pendingGuardianTransactions: z.number().int()
});

const auditLogRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string()
});

const governanceOverviewAcceptedSchema = stage8BaseResponseSchema.extend({
  result: z.literal("accepted"),
  adminScope: adminScopeSchema,
  queueSummary: queueSummarySchema,
  systemSummary: systemSummarySchema,
  pilotMetrics: pilotMetricsSchema,
  recentAuditLogs: z.array(auditLogRowSchema)
});

const impactSummarySchema = z.object({
  operation: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  communityId: z.string().nullable(),
  counts: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string())
});

const adminOperationPreviewAcceptedSchema = stage8BaseResponseSchema.extend({
  result: z.literal("accepted"),
  previewId: z.string(),
  operation: z.string(),
  previewTargetType: z.string(),
  previewTargetId: z.string(),
  communityId: z.string().nullable(),
  impactSummary: impactSummarySchema,
  confirmationRequired: z.literal(true),
  expiresAt: z.string(),
  mutatesBusinessState: z.literal(false)
});

const governanceControlImpactSummarySchema = z.object({
  scopeType: z.string(),
  scopeId: z.string().nullable(),
  controlType: z.string(),
  counts: z.object({
    activeAuctionCount: z.number().int(),
    activeHoldCount: z.number().int(),
    pendingTransactionCount: z.number().int(),
    manualReviewTaskCount: z.number().int()
  }),
  blockedActions: z.array(z.string()),
  warnings: z.array(z.string())
});

const governanceControlRowSchema = z.object({
  id: z.string(),
  scopeType: z.string(),
  scopeId: z.string().nullable(),
  controlType: z.string(),
  status: z.string(),
  effective: z.boolean(),
  reason: z.string(),
  createdByUserId: z.string(),
  liftedByUserId: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  liftedAt: z.string().nullable(),
  liftReason: z.string().nullable(),
  previewAuditLogId: z.string()
});

const governanceControlsAcceptedSchema = stage8BaseResponseSchema.extend({
  result: z.literal("accepted"),
  controls: z.array(governanceControlRowSchema)
});

const governanceControlPreviewAcceptedSchema = stage8BaseResponseSchema.extend({
  result: z.literal("accepted"),
  previewId: z.string(),
  scopeType: z.string(),
  scopeId: z.string().nullable(),
  controlType: z.string(),
  impactSummary: governanceControlImpactSummarySchema,
  confirmationRequired: z.literal(true),
  expiresAt: z.string(),
  mutatesBusinessState: z.literal(false)
});

const governanceControlMutationAcceptedSchema = stage8BaseResponseSchema.extend({
  result: z.literal("accepted"),
  control: governanceControlRowSchema
});

const governanceControlMutationPendingReviewSchema =
  stage8BaseResponseSchema.extend({
    result: z.literal("pending_review"),
    reviewRequestId: z.string(),
    reviewStatus: z.string(),
    executionStatus: z.string(),
    expiresAt: z.string(),
    actionType: z.string(),
    reviewTargetType: z.string(),
    reviewTargetId: z.string()
  });

const highRiskGovernanceReviewSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  decisionState: z.string(),
  executionState: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  scopeType: z.string().nullable(),
  scopeId: z.string().nullable(),
  controlType: z.string().nullable(),
  sourcePreviewAuditLogId: z.string().nullable(),
  initiatorUserId: z.string(),
  reviewerUserId: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  frozenPayloadJson: z.unknown(),
  evidenceJson: z.unknown(),
  decisionReason: z.string().nullable(),
  executionErrorCode: z.string().nullable(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const highRiskGovernanceReviewEventSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  eventType: z.string(),
  actorUserId: z.string().nullable(),
  reason: z.string().nullable(),
  errorCode: z.string().nullable(),
  fromDecisionState: z.string().nullable(),
  toDecisionState: z.string().nullable(),
  fromExecutionState: z.string().nullable(),
  toExecutionState: z.string().nullable(),
  targetType: z.string(),
  targetId: z.string(),
  payloadSummaryJson: z.unknown().nullable(),
  createdAt: z.string()
});

const highRiskGovernanceReviewListAcceptedSchema =
  stage8BaseResponseSchema.extend({
    result: z.literal("accepted"),
    reviews: z.array(highRiskGovernanceReviewSchema)
  });

const highRiskGovernanceReviewDetailAcceptedSchema =
  stage8BaseResponseSchema.extend({
    result: z.literal("accepted"),
    review: highRiskGovernanceReviewSchema,
    events: z.array(highRiskGovernanceReviewEventSchema)
  });

const highRiskGovernanceReviewTransitionAcceptedSchema =
  stage8BaseResponseSchema.extend({
    result: z.literal("accepted"),
    review: highRiskGovernanceReviewSchema,
    transitionApplied: z.boolean()
  });

export const governanceOverviewResultSchema = z.union([
  governanceOverviewAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const adminOperationPreviewResultSchema = z.union([
  adminOperationPreviewAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const governanceControlsResultSchema = z.union([
  governanceControlsAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const governanceControlPreviewResultSchema = z.union([
  governanceControlPreviewAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const governanceControlMutationResultSchema = z.union([
  governanceControlMutationAcceptedSchema,
  governanceControlMutationPendingReviewSchema,
  stage8RejectedResponseSchema
]);

export const highRiskGovernanceReviewListResultSchema = z.union([
  highRiskGovernanceReviewListAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const highRiskGovernanceReviewDetailResultSchema = z.union([
  highRiskGovernanceReviewDetailAcceptedSchema,
  stage8RejectedResponseSchema
]);

export const highRiskGovernanceReviewTransitionResultSchema = z.union([
  highRiskGovernanceReviewTransitionAcceptedSchema,
  stage8RejectedResponseSchema
]);

export type GovernanceOverviewResult = z.infer<
  typeof governanceOverviewResultSchema
>;
export type AdminOperationPreviewResult = z.infer<
  typeof adminOperationPreviewResultSchema
>;
export type GovernanceControlsResult = z.infer<
  typeof governanceControlsResultSchema
>;
export type GovernanceControlPreviewResult = z.infer<
  typeof governanceControlPreviewResultSchema
>;
export type GovernanceControlMutationResult = z.infer<
  typeof governanceControlMutationResultSchema
>;
export type HighRiskGovernanceReviewListResult = z.infer<
  typeof highRiskGovernanceReviewListResultSchema
>;
export type HighRiskGovernanceReviewDetailResult = z.infer<
  typeof highRiskGovernanceReviewDetailResultSchema
>;
export type HighRiskGovernanceReviewTransitionResult = z.infer<
  typeof highRiskGovernanceReviewTransitionResultSchema
>;

export type GovernanceOverviewInput = {
  accessToken: string;
  communityId?: string;
};

export type AdminOperationPreviewInput = {
  accessToken: string;
  operation: string;
  targetType: string;
  targetId: string;
  communityId?: string;
  reason?: string;
};

export type GovernanceControlsInput = {
  accessToken: string;
  communityId?: string;
};

export type GovernanceControlPreviewInput = {
  accessToken: string;
  scopeType: string;
  scopeId?: string;
  controlType: string;
  reason?: string;
};

export type GovernanceControlCreateInput = GovernanceControlPreviewInput & {
  previewId: string;
  sensitiveChallengeId: string;
  idempotencyKey?: string;
  endsAt?: string;
};

export type GovernanceControlLiftInput = {
  accessToken: string;
  controlId: string;
  sensitiveChallengeId: string;
  idempotencyKey?: string;
  reason?: string;
};

export type HighRiskGovernanceReviewListInput = {
  accessToken: string;
  decisionState?: string;
};

export type HighRiskGovernanceReviewDetailInput = {
  accessToken: string;
  reviewRequestId: string;
};

export type HighRiskGovernanceReviewApproveInput =
  HighRiskGovernanceReviewDetailInput & {
    sensitiveChallengeId: string;
  };

export type HighRiskGovernanceReviewRejectInput =
  HighRiskGovernanceReviewApproveInput & {
    reason: string;
  };

export type HighRiskGovernanceReviewWithdrawInput =
  HighRiskGovernanceReviewDetailInput & {
    reason: string;
  };

export async function getGovernanceOverview(
  apiBaseUrl: string,
  payload: GovernanceOverviewInput
): Promise<GovernanceOverviewResult> {
  const params = new URLSearchParams();
  appendOptional(params, "communityId", payload.communityId);
  const query = params.toString();
  const response = await fetch(
    `${buildStage2AdminUrl(apiBaseUrl, "/stage8/governance/overview")}${
      query ? `?${query}` : ""
    }`,
    {
      method: "GET",
      headers: stage8AuthHeader(payload.accessToken)
    }
  );

  return governanceOverviewResultSchema.parse(await response.json());
}

export async function createAdminOperationPreview(
  apiBaseUrl: string,
  payload: AdminOperationPreviewInput
): Promise<AdminOperationPreviewResult> {
  const response = await fetch(
    buildStage2AdminUrl(apiBaseUrl, "/stage8/admin-operation-previews"),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: payload.operation,
        targetType: payload.targetType,
        targetId: payload.targetId,
        communityId: payload.communityId,
        reason: payload.reason
      })
    }
  );

  return adminOperationPreviewResultSchema.parse(await response.json());
}

export async function listGovernanceControls(
  apiBaseUrl: string,
  payload: GovernanceControlsInput
): Promise<GovernanceControlsResult> {
  const params = new URLSearchParams();
  appendOptional(params, "communityId", payload.communityId);
  const query = params.toString();
  const response = await fetch(
    `${buildStage2AdminUrl(apiBaseUrl, "/stage8/governance-controls")}${
      query ? `?${query}` : ""
    }`,
    {
      method: "GET",
      headers: stage8AuthHeader(payload.accessToken)
    }
  );

  return governanceControlsResultSchema.parse(await response.json());
}

export async function createGovernanceControlPreview(
  apiBaseUrl: string,
  payload: GovernanceControlPreviewInput
): Promise<GovernanceControlPreviewResult> {
  const response = await fetch(
    buildStage2AdminUrl(apiBaseUrl, "/stage8/governance-control-previews"),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        scopeType: payload.scopeType,
        scopeId: payload.scopeId,
        controlType: payload.controlType,
        reason: payload.reason
      })
    }
  );

  return governanceControlPreviewResultSchema.parse(await response.json());
}

export async function createGovernanceControl(
  apiBaseUrl: string,
  payload: GovernanceControlCreateInput
): Promise<GovernanceControlMutationResult> {
  const response = await fetch(
    buildStage2AdminUrl(apiBaseUrl, "/stage8/governance-controls"),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        scopeType: payload.scopeType,
        scopeId: payload.scopeId,
        controlType: payload.controlType,
        previewId: payload.previewId,
        sensitiveChallengeId: payload.sensitiveChallengeId,
        idempotencyKey: payload.idempotencyKey,
        reason: payload.reason,
        endsAt: payload.endsAt
      })
    }
  );

  return governanceControlMutationResultSchema.parse(await response.json());
}

export async function liftGovernanceControl(
  apiBaseUrl: string,
  payload: GovernanceControlLiftInput
): Promise<GovernanceControlMutationResult> {
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `/stage8/governance-controls/${payload.controlId}/lift`
    ),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sensitiveChallengeId: payload.sensitiveChallengeId,
        idempotencyKey: payload.idempotencyKey,
        reason: payload.reason
      })
    }
  );

  return governanceControlMutationResultSchema.parse(await response.json());
}

export async function listHighRiskGovernanceReviews(
  apiBaseUrl: string,
  payload: HighRiskGovernanceReviewListInput
): Promise<HighRiskGovernanceReviewListResult> {
  const params = new URLSearchParams();
  appendOptional(params, "decisionState", payload.decisionState);
  const query = params.toString();
  const response = await fetch(
    `${buildStage2AdminUrl(apiBaseUrl, "/stage8/high-risk-governance-reviews")}${
      query ? `?${query}` : ""
    }`,
    {
      method: "GET",
      headers: stage8AuthHeader(payload.accessToken)
    }
  );

  return highRiskGovernanceReviewListResultSchema.parse(await response.json());
}

export async function getHighRiskGovernanceReviewDetail(
  apiBaseUrl: string,
  payload: HighRiskGovernanceReviewDetailInput
): Promise<HighRiskGovernanceReviewDetailResult> {
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `/stage8/high-risk-governance-reviews/${payload.reviewRequestId}`
    ),
    {
      method: "GET",
      headers: stage8AuthHeader(payload.accessToken)
    }
  );

  return highRiskGovernanceReviewDetailResultSchema.parse(await response.json());
}

export async function approveHighRiskGovernanceReview(
  apiBaseUrl: string,
  payload: HighRiskGovernanceReviewApproveInput
): Promise<HighRiskGovernanceReviewTransitionResult> {
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `/stage8/high-risk-governance-reviews/${payload.reviewRequestId}/approve`
    ),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sensitiveChallengeId: payload.sensitiveChallengeId
      })
    }
  );

  return highRiskGovernanceReviewTransitionResultSchema.parse(await response.json());
}

export async function rejectHighRiskGovernanceReview(
  apiBaseUrl: string,
  payload: HighRiskGovernanceReviewRejectInput
): Promise<HighRiskGovernanceReviewTransitionResult> {
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `/stage8/high-risk-governance-reviews/${payload.reviewRequestId}/reject`
    ),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sensitiveChallengeId: payload.sensitiveChallengeId,
        reason: payload.reason
      })
    }
  );

  return highRiskGovernanceReviewTransitionResultSchema.parse(await response.json());
}

export async function withdrawHighRiskGovernanceReview(
  apiBaseUrl: string,
  payload: HighRiskGovernanceReviewWithdrawInput
): Promise<HighRiskGovernanceReviewTransitionResult> {
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `/stage8/high-risk-governance-reviews/${payload.reviewRequestId}/withdraw`
    ),
    {
      method: "POST",
      headers: {
        ...stage8AuthHeader(payload.accessToken),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reason: payload.reason
      })
    }
  );

  return highRiskGovernanceReviewTransitionResultSchema.parse(await response.json());
}

export const stage8AdminCommandCatalog = [
  {
    key: "governance-overview",
    method: "GET",
    path: "/stage8/governance/overview"
  },
  {
    key: "admin-operation-preview",
    method: "POST",
    path: "/stage8/admin-operation-previews"
  },
  {
    key: "governance-controls",
    method: "GET",
    path: "/stage8/governance-controls"
  },
  {
    key: "governance-control-preview",
    method: "POST",
    path: "/stage8/governance-control-previews"
  },
  {
    key: "governance-control-create",
    method: "POST",
    path: "/stage8/governance-controls"
  },
  {
    key: "governance-control-lift",
    method: "POST",
    path: "/stage8/governance-controls/:controlId/lift"
  },
  {
    key: "high-risk-governance-reviews",
    method: "GET",
    path: "/stage8/high-risk-governance-reviews"
  },
  {
    key: "high-risk-governance-review-detail",
    method: "GET",
    path: "/stage8/high-risk-governance-reviews/:reviewRequestId"
  },
  {
    key: "high-risk-governance-review-approve",
    method: "POST",
    path: "/stage8/high-risk-governance-reviews/:reviewRequestId/approve"
  },
  {
    key: "high-risk-governance-review-reject",
    method: "POST",
    path: "/stage8/high-risk-governance-reviews/:reviewRequestId/reject"
  },
  {
    key: "high-risk-governance-review-withdraw",
    method: "POST",
    path: "/stage8/high-risk-governance-reviews/:reviewRequestId/withdraw"
  }
] as const;

function stage8AuthHeader(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

function appendOptional(
  params: URLSearchParams,
  key: string,
  value: string | undefined
) {
  if (value) {
    params.set(key, value);
  }
}
