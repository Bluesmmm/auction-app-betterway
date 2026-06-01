import { z } from "zod";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type Stage2Fetch = typeof fetch;

const trimmedStringSchema = z.string().trim().min(1);
const stage2AuthSchema = z.object({
  accessToken: trimmedStringSchema
});
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

const communityCreationRequestStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "cancelled"
]);
const adminScopeStatusSchema = z.enum(["active", "suspended", "revoked"]);
const inviteCodeStatusSchema = z.enum(["active", "disabled", "expired"]);
const communityMemberStatusSchema = z.enum([
  "pending_guardian",
  "pending_admin",
  "active",
  "removed",
  "banned"
]);
const rosterVerificationStatusSchema = z.enum([
  "pending",
  "matched",
  "not_matched",
  "manual_exception",
  "rejected"
]);
const riskSignalStatusSchema = z.enum([
  "open",
  "under_review",
  "resolved",
  "dismissed"
]);
const riskSignalDecisionSchema = z.enum(["resolved", "dismissed"]);
const riskSignalTypeSchema = z.enum([
  "adult_impersonation_suspected",
  "abnormal_join_pattern",
  "contact_inducement_suspected",
  "cross_community_anomaly",
  "guardian_account_takeover_suspected"
]);
const riskRestrictionTypeSchema = z.enum([
  "no_join",
  "no_publish",
  "no_bid",
  "no_transaction_confirm",
  "no_export",
  "no_delete",
  "sensitive_challenge_required",
  "suspended"
]);
const riskRestrictionScopeSchema = z.enum([
  "user",
  "guardian",
  "child",
  "community_member",
  "community"
]);
const riskRestrictionStatusSchema = z.enum(["active", "resolved", "expired"]);
const highRiskSensitiveChallengeErrorCodes = [
  "SENSITIVE_CHALLENGE_REQUIRED",
  "SENSITIVE_CHALLENGE_EXPIRED",
  "SESSION_REVOKED",
  "DEVICE_NOT_TRUSTED"
] as const;

export const communityCreationRequestRowSchema = z.object({
  requestId: trimmedStringSchema,
  guardianId: trimmedStringSchema,
  requestedName: trimmedStringSchema,
  gradeBand: trimmedStringSchema,
  expectedChildCount: z.number().int().positive(),
  status: communityCreationRequestStatusSchema,
  submittedAt: z.string().datetime().optional()
});

export const listCommunityCreationRequestsResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    requests: z.array(communityCreationRequestRowSchema)
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["PLATFORM_ADMIN_REQUIRED"])
  })
]);

export const memberReviewRowSchema = z.object({
  key: trimmedStringSchema,
  communityId: trimmedStringSchema,
  childId: trimmedStringSchema,
  guardianId: z.string(),
  memberStatus: communityMemberStatusSchema,
  rosterVerificationStatus: rosterVerificationStatusSchema,
  riskState: z.enum(["clear", "restricted"]),
  requestedAt: z.string()
});

const memberReviewQueueAcceptedResultSchema = z.object({
  result: z.literal("accepted"),
  members: z.array(memberReviewRowSchema)
});

export const listMemberReviewQueueResultSchema = z.union([
  memberReviewQueueAcceptedResultSchema,
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["PLATFORM_ADMIN_REQUIRED"])
  })
]);

export const listScopedMemberReviewQueueResultSchema = z.union([
  memberReviewQueueAcceptedResultSchema,
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["COMMUNITY_ADMIN_REQUIRED"])
  })
]);

export const riskReviewRowSchema = z.object({
  key: trimmedStringSchema,
  signalId: trimmedStringSchema,
  scope: riskRestrictionScopeSchema,
  targetId: trimmedStringSchema,
  type: riskSignalTypeSchema,
  status: riskSignalStatusSchema,
  restrictionCount: z.number().int().nonnegative(),
  openedAt: z.string()
});

export const listRiskSignalsResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    signals: z.array(riskReviewRowSchema)
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["PLATFORM_ADMIN_REQUIRED"])
  })
]);

export const reviewCommunityRequestResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    requestId: trimmedStringSchema,
    requestStatus: communityCreationRequestStatusSchema,
    communityId: trimmedStringSchema.nullable()
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "CREATION_REQUEST_NOT_FOUND",
      "CREATION_REQUEST_STATE_INVALID",
      "DEFAULT_AUCTION_DURATION_INVALID"
    ])
  })
]);

export const grantActivityAdminResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    adminProfileId: trimmedStringSchema,
    communityId: trimmedStringSchema,
    scopeStatus: adminScopeStatusSchema
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "COMMUNITY_NOT_ACTIVE",
      "TARGET_ADMIN_ROLE_INVALID",
      "TARGET_ADMIN_NOT_ACTIVE",
      ...highRiskSensitiveChallengeErrorCodes
    ])
  })
]);

export const revokeActivityAdminResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    adminProfileId: trimmedStringSchema,
    communityId: trimmedStringSchema,
    scopeStatus: z.literal("revoked")
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "COMMUNITY_ADMIN_SCOPE_NOT_FOUND",
      ...highRiskSensitiveChallengeErrorCodes
    ])
  })
]);

export const createInviteCodeResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    inviteCodeId: trimmedStringSchema,
    code: trimmedStringSchema,
    status: inviteCodeStatusSchema
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "COMMUNITY_NOT_ACTIVE",
      "COMMUNITY_NOT_OPEN_FOR_ADMISSION",
      "COMMUNITY_ADMIN_REQUIRED",
      "INVITE_MAX_USES_INVALID",
      "ACTIVE_RULE_VERSION_REQUIRED"
    ])
  })
]);

export const communityMemberTransitionResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    communityId: trimmedStringSchema,
    childId: trimmedStringSchema,
    memberStatus: communityMemberStatusSchema
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "ACTIVE_PRIMARY_GUARDIAN_REQUIRED",
      "INVITE_CODE_UNAVAILABLE",
      "COMMUNITY_MEMBER_STATE_INVALID",
      "COMMUNITY_ADMIN_REQUIRED",
      "PLATFORM_ADMIN_REQUIRED",
      "RISK_RESTRICTED",
      "JOIN_ACTOR_NOT_AUTHORIZED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
      "COMMUNITY_NOT_OPEN_FOR_ADMISSION",
      "ROSTER_VERIFICATION_REQUIRED",
      "GUARDIAN_DISPUTE_FROZEN"
    ])
  })
]);

export const reviewRiskSignalResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    signalId: trimmedStringSchema,
    status: riskSignalDecisionSchema,
    resolvedRestrictionCount: z.number().int().nonnegative()
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "RISK_SIGNAL_NOT_FOUND",
      "RISK_SIGNAL_STATE_INVALID",
      ...highRiskSensitiveChallengeErrorCodes
    ])
  })
]);

export const recordRiskSignalResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    signalId: trimmedStringSchema,
    status: riskSignalStatusSchema,
    restrictionIds: z.array(trimmedStringSchema)
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "RISK_TARGET_NOT_FOUND",
      "RISK_SIGNAL_ACTOR_NOT_AUTHORIZED"
    ])
  })
]);

export const applyRiskRestrictionResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    restrictionId: trimmedStringSchema,
    status: z.literal("active")
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "RISK_TARGET_NOT_FOUND",
      ...highRiskSensitiveChallengeErrorCodes
    ])
  })
]);

export const resolveRiskRestrictionResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    restrictionId: trimmedStringSchema,
    status: z.literal("resolved")
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum([
      "PLATFORM_ADMIN_REQUIRED",
      "RISK_RESTRICTION_NOT_FOUND",
      ...highRiskSensitiveChallengeErrorCodes
    ])
  })
]);

export const approveCommunityRequestInputSchema = stage2AuthSchema.extend({
  requestId: trimmedStringSchema,
  defaultAuctionDurationMinutes: z.number().int().positive()
});

export const rejectCommunityRequestInputSchema = stage2AuthSchema.extend({
  requestId: trimmedStringSchema,
  reason: trimmedStringSchema
});

export const grantActivityAdminInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema,
  targetUserId: trimmedStringSchema,
  challengeId: trimmedStringSchema.optional()
});

export const revokeActivityAdminInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema,
  targetUserId: trimmedStringSchema,
  reason: trimmedStringSchema,
  challengeId: trimmedStringSchema.optional()
});

export const createInviteCodeInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema,
  code: trimmedStringSchema,
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional()
});

export const recordRosterVerificationInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema,
  childId: trimmedStringSchema,
  status: rosterVerificationStatusSchema,
  evidenceJson: jsonValueSchema
});

export const approveCommunityMemberInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema,
  childId: trimmedStringSchema
});

export const listScopedMemberReviewQueueInputSchema = stage2AuthSchema.extend({
  communityId: trimmedStringSchema
});

export const reviewRiskSignalInputSchema = stage2AuthSchema.extend({
  signalId: trimmedStringSchema,
  decision: riskSignalDecisionSchema,
  resolutionText: trimmedStringSchema,
  resolveRestrictions: z.boolean().optional(),
  challengeId: trimmedStringSchema.optional()
});

export const recordRiskSignalInputSchema = stage2AuthSchema.extend({
  type: riskSignalTypeSchema,
  scope: riskRestrictionScopeSchema,
  targetId: trimmedStringSchema,
  evidenceJson: jsonValueSchema
});

export const applyRiskRestrictionInputSchema = stage2AuthSchema.extend({
  type: riskRestrictionTypeSchema,
  scope: riskRestrictionScopeSchema,
  targetId: trimmedStringSchema,
  reason: trimmedStringSchema,
  challengeId: trimmedStringSchema.optional(),
  expiresAt: z.string().datetime().optional()
});

export const resolveRiskRestrictionInputSchema = stage2AuthSchema.extend({
  restrictionId: trimmedStringSchema,
  resolutionText: trimmedStringSchema,
  challengeId: trimmedStringSchema.optional()
});

export type Stage2Auth = z.infer<typeof stage2AuthSchema>;

export type CommunityCreationRequestRow = z.infer<
  typeof communityCreationRequestRowSchema
>;
export type ListCommunityCreationRequestsResult = z.infer<
  typeof listCommunityCreationRequestsResultSchema
>;
export type ListMemberReviewQueueResult = z.infer<
  typeof listMemberReviewQueueResultSchema
>;
export type ListScopedMemberReviewQueueResult = z.infer<
  typeof listScopedMemberReviewQueueResultSchema
>;
export type ListRiskSignalsResult = z.infer<
  typeof listRiskSignalsResultSchema
>;

export type ReviewCommunityRequestResult = z.infer<
  typeof reviewCommunityRequestResultSchema
>;
export type GrantActivityAdminResult = z.infer<
  typeof grantActivityAdminResultSchema
>;
export type RevokeActivityAdminResult = z.infer<
  typeof revokeActivityAdminResultSchema
>;
export type CreateInviteCodeResult = z.infer<
  typeof createInviteCodeResultSchema
>;
export type CommunityMemberTransitionResult = z.infer<
  typeof communityMemberTransitionResultSchema
>;
export type ReviewRiskSignalResult = z.infer<
  typeof reviewRiskSignalResultSchema
>;
export type RecordRiskSignalResult = z.infer<
  typeof recordRiskSignalResultSchema
>;
export type ApplyRiskRestrictionResult = z.infer<
  typeof applyRiskRestrictionResultSchema
>;
export type ResolveRiskRestrictionResult = z.infer<
  typeof resolveRiskRestrictionResultSchema
>;

export type ApproveCommunityRequestInput = z.infer<
  typeof approveCommunityRequestInputSchema
>;
export type RejectCommunityRequestInput = z.infer<
  typeof rejectCommunityRequestInputSchema
>;
export type GrantActivityAdminInput = z.infer<
  typeof grantActivityAdminInputSchema
>;
export type RevokeActivityAdminInput = z.infer<
  typeof revokeActivityAdminInputSchema
>;
export type CreateInviteCodeInput = z.infer<
  typeof createInviteCodeInputSchema
>;
export type RecordRosterVerificationInput = z.infer<
  typeof recordRosterVerificationInputSchema
>;
export type ApproveCommunityMemberInput = z.infer<
  typeof approveCommunityMemberInputSchema
>;
export type ListScopedMemberReviewQueueInput = z.infer<
  typeof listScopedMemberReviewQueueInputSchema
>;
export type ReviewRiskSignalInput = z.infer<
  typeof reviewRiskSignalInputSchema
>;
export type RecordRiskSignalInput = z.infer<
  typeof recordRiskSignalInputSchema
>;
export type ApplyRiskRestrictionInput = z.infer<
  typeof applyRiskRestrictionInputSchema
>;
export type ResolveRiskRestrictionInput = z.infer<
  typeof resolveRiskRestrictionInputSchema
>;

export const stage2AdminCommandCatalog = {
  listCommunityCreationRequests: {
    method: "GET",
    path: "/communities/creation-requests",
    resultSchema: listCommunityCreationRequestsResultSchema
  },
  listMemberReviewQueue: {
    method: "GET",
    path: "/communities/member-review-queue",
    resultSchema: listMemberReviewQueueResultSchema
  },
  listScopedMemberReviewQueue: {
    method: "GET",
    path: "/communities/:communityId/member-review-queue",
    resultSchema: listScopedMemberReviewQueueResultSchema
  },
  listRiskSignals: {
    method: "GET",
    path: "/communities/risk-signals",
    resultSchema: listRiskSignalsResultSchema
  },
  approveCommunityRequest: {
    method: "POST",
    path: "/communities/creation-requests/:requestId/approve",
    resultSchema: reviewCommunityRequestResultSchema
  },
  rejectCommunityRequest: {
    method: "POST",
    path: "/communities/creation-requests/:requestId/reject",
    resultSchema: reviewCommunityRequestResultSchema
  },
  grantActivityAdmin: {
    method: "POST",
    path: "/communities/:communityId/activity-admins",
    resultSchema: grantActivityAdminResultSchema
  },
  revokeActivityAdmin: {
    method: "POST",
    path: "/communities/:communityId/activity-admins/revoke",
    resultSchema: revokeActivityAdminResultSchema
  },
  createInviteCode: {
    method: "POST",
    path: "/communities/:communityId/invites",
    resultSchema: createInviteCodeResultSchema
  },
  recordRosterVerification: {
    method: "POST",
    path: "/communities/:communityId/members/:childId/roster-verification",
    resultSchema: communityMemberTransitionResultSchema
  },
  approveCommunityMember: {
    method: "POST",
    path: "/communities/:communityId/members/:childId/approve",
    resultSchema: communityMemberTransitionResultSchema
  },
  reviewRiskSignal: {
    method: "POST",
    path: "/communities/risk-signals/:signalId/review",
    resultSchema: reviewRiskSignalResultSchema
  },
  recordRiskSignal: {
    method: "POST",
    path: "/communities/risk-signals",
    resultSchema: recordRiskSignalResultSchema
  },
  applyRiskRestriction: {
    method: "POST",
    path: "/communities/risk-restrictions",
    resultSchema: applyRiskRestrictionResultSchema
  },
  resolveRiskRestriction: {
    method: "POST",
    path: "/communities/risk-restrictions/:restrictionId/resolve",
    resultSchema: resolveRiskRestrictionResultSchema
  }
} as const;

export function buildStage2AdminUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}${path}`;
}

export function buildStage2AdminCommandPath(
  key: keyof typeof stage2AdminCommandCatalog,
  params: Record<string, string>
): string {
  return stage2AdminCommandCatalog[key].path.replace(
    /:([a-zA-Z]+)/g,
    (_, token: string) => encodeURIComponent(params[token] ?? "")
  );
}

export async function listCommunityCreationRequests(
  apiBaseUrl: string,
  auth: Stage2Auth,
  fetcher: Stage2Fetch = fetch
): Promise<ListCommunityCreationRequestsResult> {
  const parsedAuth = stage2AuthSchema.parse(auth);
  return executeStage2Query(
    apiBaseUrl,
    stage2AdminCommandCatalog.listCommunityCreationRequests.path,
    listCommunityCreationRequestsResultSchema,
    fetcher,
    parsedAuth.accessToken
  );
}

export async function listMemberReviewQueue(
  apiBaseUrl: string,
  auth: Stage2Auth,
  fetcher: Stage2Fetch = fetch
): Promise<ListMemberReviewQueueResult> {
  const parsedAuth = stage2AuthSchema.parse(auth);
  return executeStage2Query(
    apiBaseUrl,
    stage2AdminCommandCatalog.listMemberReviewQueue.path,
    listMemberReviewQueueResultSchema,
    fetcher,
    parsedAuth.accessToken
  );
}

export async function listScopedMemberReviewQueue(
  apiBaseUrl: string,
  input: ListScopedMemberReviewQueueInput,
  fetcher: Stage2Fetch = fetch
): Promise<ListScopedMemberReviewQueueResult> {
  const parsed = listScopedMemberReviewQueueInputSchema.parse(input);
  return executeStage2Query(
    apiBaseUrl,
    buildStage2AdminCommandPath("listScopedMemberReviewQueue", {
      communityId: parsed.communityId
    }),
    listScopedMemberReviewQueueResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function listRiskSignals(
  apiBaseUrl: string,
  auth: Stage2Auth,
  fetcher: Stage2Fetch = fetch
): Promise<ListRiskSignalsResult> {
  const parsedAuth = stage2AuthSchema.parse(auth);
  return executeStage2Query(
    apiBaseUrl,
    stage2AdminCommandCatalog.listRiskSignals.path,
    listRiskSignalsResultSchema,
    fetcher,
    parsedAuth.accessToken
  );
}

export async function approveCommunityRequest(
  apiBaseUrl: string,
  input: ApproveCommunityRequestInput,
  fetcher: Stage2Fetch = fetch
): Promise<ReviewCommunityRequestResult> {
  const parsed = approveCommunityRequestInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("approveCommunityRequest", {
      requestId: parsed.requestId
    }),
    {
      defaultAuctionDurationMinutes: parsed.defaultAuctionDurationMinutes
    },
    reviewCommunityRequestResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function rejectCommunityRequest(
  apiBaseUrl: string,
  input: RejectCommunityRequestInput,
  fetcher: Stage2Fetch = fetch
): Promise<ReviewCommunityRequestResult> {
  const parsed = rejectCommunityRequestInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("rejectCommunityRequest", {
      requestId: parsed.requestId
    }),
    {
      reason: parsed.reason
    },
    reviewCommunityRequestResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function grantActivityAdmin(
  apiBaseUrl: string,
  input: GrantActivityAdminInput,
  fetcher: Stage2Fetch = fetch
): Promise<GrantActivityAdminResult> {
  const parsed = grantActivityAdminInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("grantActivityAdmin", {
      communityId: parsed.communityId
    }),
    {
      targetUserId: parsed.targetUserId,
      challengeId: parsed.challengeId
    },
    grantActivityAdminResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function revokeActivityAdmin(
  apiBaseUrl: string,
  input: RevokeActivityAdminInput,
  fetcher: Stage2Fetch = fetch
): Promise<RevokeActivityAdminResult> {
  const parsed = revokeActivityAdminInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("revokeActivityAdmin", {
      communityId: parsed.communityId
    }),
    {
      targetUserId: parsed.targetUserId,
      reason: parsed.reason,
      challengeId: parsed.challengeId
    },
    revokeActivityAdminResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function createInviteCode(
  apiBaseUrl: string,
  input: CreateInviteCodeInput,
  fetcher: Stage2Fetch = fetch
): Promise<CreateInviteCodeResult> {
  const parsed = createInviteCodeInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("createInviteCode", {
      communityId: parsed.communityId
    }),
    {
      code: parsed.code,
      maxUses: parsed.maxUses,
      expiresAt: parsed.expiresAt
    },
    createInviteCodeResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function recordRosterVerification(
  apiBaseUrl: string,
  input: RecordRosterVerificationInput,
  fetcher: Stage2Fetch = fetch
): Promise<CommunityMemberTransitionResult> {
  const parsed = recordRosterVerificationInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("recordRosterVerification", {
      communityId: parsed.communityId,
      childId: parsed.childId
    }),
    {
      status: parsed.status,
      evidenceJson: parsed.evidenceJson
    },
    communityMemberTransitionResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function approveCommunityMember(
  apiBaseUrl: string,
  input: ApproveCommunityMemberInput,
  fetcher: Stage2Fetch = fetch
): Promise<CommunityMemberTransitionResult> {
  const parsed = approveCommunityMemberInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("approveCommunityMember", {
      communityId: parsed.communityId,
      childId: parsed.childId
    }),
    {},
    communityMemberTransitionResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function reviewRiskSignal(
  apiBaseUrl: string,
  input: ReviewRiskSignalInput,
  fetcher: Stage2Fetch = fetch
): Promise<ReviewRiskSignalResult> {
  const parsed = reviewRiskSignalInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("reviewRiskSignal", {
      signalId: parsed.signalId
    }),
    {
      decision: parsed.decision,
      resolutionText: parsed.resolutionText,
      resolveRestrictions: parsed.resolveRestrictions,
      challengeId: parsed.challengeId
    },
    reviewRiskSignalResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function recordRiskSignal(
  apiBaseUrl: string,
  input: RecordRiskSignalInput,
  fetcher: Stage2Fetch = fetch
): Promise<RecordRiskSignalResult> {
  const parsed = recordRiskSignalInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    stage2AdminCommandCatalog.recordRiskSignal.path,
    {
      type: parsed.type,
      scope: parsed.scope,
      targetId: parsed.targetId,
      evidenceJson: parsed.evidenceJson
    },
    recordRiskSignalResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function applyRiskRestriction(
  apiBaseUrl: string,
  input: ApplyRiskRestrictionInput,
  fetcher: Stage2Fetch = fetch
): Promise<ApplyRiskRestrictionResult> {
  const parsed = applyRiskRestrictionInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    stage2AdminCommandCatalog.applyRiskRestriction.path,
    {
      type: parsed.type,
      scope: parsed.scope,
      targetId: parsed.targetId,
      reason: parsed.reason,
      challengeId: parsed.challengeId,
      expiresAt: parsed.expiresAt
    },
    applyRiskRestrictionResultSchema,
    fetcher,
    parsed.accessToken
  );
}

export async function resolveRiskRestriction(
  apiBaseUrl: string,
  input: ResolveRiskRestrictionInput,
  fetcher: Stage2Fetch = fetch
): Promise<ResolveRiskRestrictionResult> {
  const parsed = resolveRiskRestrictionInputSchema.parse(input);
  return executeStage2Command(
    apiBaseUrl,
    buildStage2AdminCommandPath("resolveRiskRestriction", {
      restrictionId: parsed.restrictionId
    }),
    {
      resolutionText: parsed.resolutionText,
      challengeId: parsed.challengeId
    },
    resolveRiskRestrictionResultSchema,
    fetcher,
    parsed.accessToken
  );
}

async function executeStage2Query<TOutput>(
  apiBaseUrl: string,
  path: string,
  responseSchema: z.ZodType<TOutput>,
  fetcher: Stage2Fetch,
  accessToken: string
): Promise<TOutput> {
  const response = await fetcher(buildStage2AdminUrl(apiBaseUrl, path), {
    method: "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    }
  });

  return parseStage2Response(response, path, responseSchema);
}

async function executeStage2Command<TOutput>(
  apiBaseUrl: string,
  path: string,
  body: Record<string, unknown>,
  responseSchema: z.ZodType<TOutput>,
  fetcher: Stage2Fetch,
  accessToken: string
): Promise<TOutput> {
  const response = await fetcher(buildStage2AdminUrl(apiBaseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  return parseStage2Response(response, path, responseSchema);
}

async function parseStage2Response<TOutput>(
  response: Response,
  path: string,
  responseSchema: z.ZodType<TOutput>
): Promise<TOutput> {
  const payload = (await response.json()) as unknown;
  const parsed = responseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(
      `Stage 2 admin command response did not match contract for ${path}`
    );
  }

  if (!response.ok && parsed.data && typeof parsed.data === "object") {
    const result = (parsed.data as { result?: string }).result;
    if (result !== "rejected") {
      throw new Error(`Stage 2 admin command failed with ${response.status}`);
    }
  }

  return parsed.data;
}
