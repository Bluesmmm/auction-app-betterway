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

export const listPointAdjustmentRequestsResultSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  requests: z.array(adjustmentRequestRowSchema)
});

export const listLedgerCheckRunsResultSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  runs: z.array(ledgerCheckRunRowSchema)
});

const adjustmentCommandAcceptedSchema = stage4BaseResponseSchema.extend({
  result: z.literal("accepted"),
  requestId: z.string(),
  status: z.string(),
  requiresSecondReview: z.boolean().optional(),
  ledgerEntryId: z.string().nullable().optional(),
  availablePoints: z.number().int().optional(),
  idempotencyKey: z.string().optional()
});

const adjustmentCommandRejectedSchema = stage4BaseResponseSchema.extend({
  result: z.literal("rejected"),
  errorCode: z.string()
});

export const pointAdjustmentCommandResultSchema = z.union([
  adjustmentCommandAcceptedSchema,
  adjustmentCommandRejectedSchema
]);

export type ListPointAdjustmentRequestsResult = z.infer<
  typeof listPointAdjustmentRequestsResultSchema
>;
export type ListLedgerCheckRunsResult = z.infer<
  typeof listLedgerCheckRunsResultSchema
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
