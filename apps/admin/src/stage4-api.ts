import { z } from "zod";
import { buildStage2AdminUrl } from "./stage2-api.js";

const stage4AuthSchema = z.object({
  accessToken: z.string().min(1)
});

const stage4BaseResponseSchema = z.object({
  serverTime: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetVersion: z.number().int().positive(),
  latestStatus: z.string(),
  refreshRequired: z.boolean()
});

const adjustmentRequestRowSchema = z.object({
  id: z.string(),
  source: z.string(),
  requestType: z.string(),
  status: z.string(),
  childId: z.string(),
  requestedPoints: z.number().int(),
  requiresSecondReview: z.boolean(),
  createdAt: z.string()
});

const ledgerCheckRunRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  checkedAccountCount: z.number().int(),
  ledgerDiffCount: z.number().int(),
  negativeReplayCount: z.number().int(),
  orphanLedgerCount: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  workerName: z.string().nullable(),
  failureReason: z.string().nullable()
});

const operationsLedgerEntryRowSchema = z.object({
  id: z.string(),
  childId: z.string(),
  type: z.string(),
  amountPoints: z.number().int(),
  availableAfter: z.number().int(),
  frozenAfter: z.number().int(),
  relatedType: z.string(),
  relatedId: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string()
});

const operationsActiveHoldRowSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  childId: z.string(),
  childDisplayName: z.string(),
  auctionSessionId: z.string(),
  communityId: z.string(),
  sellerChildId: z.string(),
  amountPoints: z.number().int(),
  status: z.string(),
  auctionStatus: z.string(),
  currentPricePoints: z.number().int(),
  createdAt: z.string()
});

const operationsTransactionRowSchema = z.object({
  id: z.string(),
  auctionSessionId: z.string(),
  communityId: z.string(),
  buyerChildId: z.string(),
  sellerChildId: z.string(),
  pointHoldId: z.string(),
  pointsAmount: z.number().int(),
  status: z.string(),
  auctionStatus: z.string(),
  guardianConfirmDeadlineAt: z.string(),
  deliveryConfirmDeadlineAt: z.string().nullable(),
  createdAt: z.string()
});

const operationsOutboxRowSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  availableAt: z.string(),
  lockedAt: z.string().nullable(),
  createdAt: z.string()
});

const operationsDashboardPayloadSchema = z.object({
  generatedAt: z.string(),
  totals: z.object({
    accountCount: z.number().int(),
    availablePoints: z.number().int(),
    frozenPoints: z.number().int(),
    totalEarnedPoints: z.number().int(),
    totalSpentPoints: z.number().int(),
    totalAwardedPoints: z.number().int(),
    totalPenaltyPoints: z.number().int()
  }),
  holds: z.object({
    activeCount: z.number().int(),
    releasedCount: z.number().int(),
    transferredCount: z.number().int(),
    cancelledCount: z.number().int(),
    disputedCount: z.number().int(),
    activeAmountPoints: z.number().int()
  }),
  transactions: z.object({
    pendingGuardianConfirmCount: z.number().int(),
    pendingDeliveryConfirmCount: z.number().int(),
    completedCount: z.number().int(),
    cancelledCount: z.number().int(),
    disputedCount: z.number().int(),
    platformReviewCount: z.number().int(),
    reviewQueueCount: z.number().int()
  }),
  auctions: z.object({
    pendingStartCount: z.number().int(),
    activeCount: z.number().int(),
    pendingSettlementCount: z.number().int(),
    settledCount: z.number().int(),
    cancelledCount: z.number().int(),
    unsoldCount: z.number().int(),
    delistedCount: z.number().int()
  }),
  outbox: z.object({
    pendingCount: z.number().int(),
    processingCount: z.number().int(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    cancelledCount: z.number().int(),
    exceptionCount: z.number().int()
  }),
  activeHolds: z.array(operationsActiveHoldRowSchema),
  reviewTransactions: z.array(operationsTransactionRowSchema),
  recentLedgerEntries: z.array(operationsLedgerEntryRowSchema),
  outboxExceptions: z.array(operationsOutboxRowSchema),
  latestLedgerCheckRun: ledgerCheckRunRowSchema.nullable()
});

const stage4RejectedResponseSchema = stage4BaseResponseSchema.extend({
  result: z.literal("rejected"),
  errorCode: z.string()
});
const platformAdminRejectedResponseSchema = stage4BaseResponseSchema.extend({
  result: z.literal("rejected"),
  errorCode: z.literal("PLATFORM_ADMIN_REQUIRED")
});

const listPointAdjustmentRequestsAcceptedSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  requests: z.array(adjustmentRequestRowSchema)
});

const listLedgerCheckRunsAcceptedSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  runs: z.array(ledgerCheckRunRowSchema)
});

const listOperationsDashboardAcceptedSchema = stage4BaseResponseSchema
  .extend({
    result: z.literal("accepted")
  })
  .merge(operationsDashboardPayloadSchema);

export const listPointAdjustmentRequestsResultSchema = z.union([
  listPointAdjustmentRequestsAcceptedSchema,
  platformAdminRejectedResponseSchema
]);

export const listLedgerCheckRunsResultSchema = z.union([
  listLedgerCheckRunsAcceptedSchema,
  platformAdminRejectedResponseSchema
]);

export const listOperationsDashboardResultSchema = z.union([
  listOperationsDashboardAcceptedSchema,
  platformAdminRejectedResponseSchema
]);

const adjustmentCommandAcceptedSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  requestId: z.string(),
  status: z.string(),
  requiresSecondReview: z.boolean().optional(),
  ledgerEntryId: z.string().nullable().optional(),
  availablePoints: z.number().int().optional(),
  idempotencyKey: z.string().optional()
});

export const pointAdjustmentCommandResultSchema = z.union([
  adjustmentCommandAcceptedSchema,
  stage4RejectedResponseSchema
]);

export type ListPointAdjustmentRequestsResult = z.infer<
  typeof listPointAdjustmentRequestsResultSchema
>;
export type ListLedgerCheckRunsResult = z.infer<
  typeof listLedgerCheckRunsResultSchema
>;
export type ListOperationsDashboardResult = z.infer<
  typeof listOperationsDashboardResultSchema
>;
export type PointAdjustmentCommandResult = z.infer<
  typeof pointAdjustmentCommandResultSchema
>;

export type Stage4Auth = z.infer<typeof stage4AuthSchema>;

export type CreateAdminPointAdjustmentInput = Stage4Auth & {
  childId: string;
  requestType: "correction" | "admin_award" | "admin_penalty" | "batch_award";
  requestedPoints: number;
  reason: string;
  idempotencyKey: string;
  batchKey?: string;
};

export type ReviewPointAdjustmentInput = Stage4Auth & {
  requestId: string;
  decision: "approve" | "reject";
  reviewReason: string;
  challengeId?: string;
  idempotencyKey: string;
};

export const stage4AdminCommandCatalog = {
  listPointAdjustmentRequests: {
    method: "GET",
    path: "/points/adjustment-requests",
    resultSchema: listPointAdjustmentRequestsResultSchema
  },
  listLedgerCheckRuns: {
    method: "GET",
    path: "/points/ledger-check-runs",
    resultSchema: listLedgerCheckRunsResultSchema
  },
  listOperationsDashboard: {
    method: "GET",
    path: "/points/operations-dashboard",
    resultSchema: listOperationsDashboardResultSchema
  },
  createAdminPointAdjustment: {
    method: "POST",
    path: "/points/admin-adjustment-requests",
    resultSchema: pointAdjustmentCommandResultSchema
  },
  reviewPointAdjustment: {
    method: "POST",
    path: "/points/adjustment-requests/:requestId/review",
    resultSchema: pointAdjustmentCommandResultSchema
  },
  secondReviewPointAdjustment: {
    method: "POST",
    path: "/points/adjustment-requests/:requestId/second-review",
    resultSchema: pointAdjustmentCommandResultSchema
  }
} as const;

export async function listPointAdjustmentRequests(
  apiBaseUrl: string,
  auth: Stage4Auth
): Promise<ListPointAdjustmentRequestsResult> {
  const parsed = stage4AuthSchema.parse(auth);
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.listPointAdjustmentRequests.path
    ),
    {
      headers: {
        authorization: `Bearer ${parsed.accessToken}`
      }
    }
  );

  return parseStage4Response(response, listPointAdjustmentRequestsResultSchema);
}

export async function listLedgerCheckRuns(
  apiBaseUrl: string,
  auth: Stage4Auth
): Promise<ListLedgerCheckRunsResult> {
  const parsed = stage4AuthSchema.parse(auth);
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.listLedgerCheckRuns.path
    ),
    {
      headers: {
        authorization: `Bearer ${parsed.accessToken}`
      }
    }
  );

  return parseStage4Response(response, listLedgerCheckRunsResultSchema);
}

export async function listOperationsDashboard(
  apiBaseUrl: string,
  auth: Stage4Auth
): Promise<ListOperationsDashboardResult> {
  const parsed = stage4AuthSchema.parse(auth);
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.listOperationsDashboard.path
    ),
    {
      headers: {
        authorization: `Bearer ${parsed.accessToken}`
      }
    }
  );

  return parseStage4Response(response, listOperationsDashboardResultSchema);
}

export async function createAdminPointAdjustment(
  apiBaseUrl: string,
  input: CreateAdminPointAdjustmentInput
): Promise<PointAdjustmentCommandResult> {
  const { accessToken, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.createAdminPointAdjustment.path
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(data)
    }
  );

  return parseStage4Response(response, pointAdjustmentCommandResultSchema);
}

export async function reviewPointAdjustment(
  apiBaseUrl: string,
  input: ReviewPointAdjustmentInput
): Promise<PointAdjustmentCommandResult> {
  const { accessToken, requestId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.reviewPointAdjustment.path.replace(
        ":requestId",
        encodeURIComponent(requestId)
      )
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(data)
    }
  );

  return parseStage4Response(response, pointAdjustmentCommandResultSchema);
}

export async function secondReviewPointAdjustment(
  apiBaseUrl: string,
  input: ReviewPointAdjustmentInput
): Promise<PointAdjustmentCommandResult> {
  const { accessToken, requestId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage4AdminCommandCatalog.secondReviewPointAdjustment.path.replace(
        ":requestId",
        encodeURIComponent(requestId)
      )
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(data)
    }
  );

  return parseStage4Response(response, pointAdjustmentCommandResultSchema);
}

async function parseStage4Response<T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T> {
  const payload = await response.json();
  return schema.parse(payload);
}
