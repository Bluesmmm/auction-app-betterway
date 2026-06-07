import { z } from "zod";
import { buildStage2AdminUrl } from "./stage2-api.js";

const stage6AuthSchema = z.object({
  accessToken: z.string().min(1)
});

const stage6BaseResponseSchema = z.object({
  serverTime: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetVersion: z.number().int().positive(),
  latestStatus: z.string(),
  refreshRequired: z.boolean()
});

const deliveryPointRowSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  name: z.string(),
  addressText: z.string(),
  availableTimeText: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const appealAttachmentRowSchema = z.object({
  id: z.string(),
  mediaAssetId: z.string(),
  status: z.string(),
  sortOrder: z.number().int(),
  riskLabelsJson: z.unknown().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

const appealRowSchema = z.object({
  id: z.string(),
  targetType: z.literal("transaction"),
  targetId: z.string(),
  transactionId: z.string().nullable(),
  submittedByGuardianId: z.string(),
  communityId: z.string(),
  status: z.string(),
  reason: z.string(),
  resolution: z.string().nullable(),
  reviewedByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  attachmentCount: z.number().int()
});

const stage6RejectedResponseSchema = stage6BaseResponseSchema.extend({
  result: z.literal("rejected"),
  errorCode: z.string()
});

const listDeliveryPointsAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  points: z.array(deliveryPointRowSchema)
});

const deliveryPointCommandAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  point: deliveryPointRowSchema
});

const listAppealsAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  appeals: z.array(appealRowSchema)
});

const appealDetailAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  appeal: appealRowSchema.extend({
    attachments: z.array(appealAttachmentRowSchema)
  })
});

const appealReviewAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  appealId: z.string(),
  status: z.string(),
  reviewedByUserId: z.string(),
  resolution: z.string()
});

const appealGrantAcceptedSchema = stage6BaseResponseSchema.extend({
  result: z.literal("accepted"),
  mediaAssetId: z.string(),
  purpose: z.literal("appeal"),
  url: z.string(),
  expiresAt: z.string(),
  publicAccess: z.literal(false)
});

const transactionDisputeActionSchema = z.enum([
  "release_to_buyer",
  "transfer_to_seller",
  "keep_frozen_for_platform_review"
]);

const transactionDisputeResolutionAcceptedSchema =
  stage6BaseResponseSchema.extend({
    result: z.literal("accepted"),
    transactionId: z.string(),
    action: transactionDisputeActionSchema,
    status: z.string(),
    releasedAmountPoints: z.number().int(),
    transferredAmountPoints: z.number().int(),
    idempotencyKey: z.string()
  });

export const listDeliveryPointsResultSchema = z.union([
  listDeliveryPointsAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const deliveryPointCommandResultSchema = z.union([
  deliveryPointCommandAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const listAppealsResultSchema = z.union([
  listAppealsAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const appealDetailResultSchema = z.union([
  appealDetailAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const appealReviewResultSchema = z.union([
  appealReviewAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const appealGrantResultSchema = z.union([
  appealGrantAcceptedSchema,
  stage6RejectedResponseSchema
]);
export const transactionDisputeResolutionResultSchema = z.union([
  transactionDisputeResolutionAcceptedSchema,
  stage6RejectedResponseSchema
]);

export type Stage6Auth = z.infer<typeof stage6AuthSchema>;
export type ListDeliveryPointsResult = z.infer<
  typeof listDeliveryPointsResultSchema
>;
export type DeliveryPointCommandResult = z.infer<
  typeof deliveryPointCommandResultSchema
>;
export type ListAppealsResult = z.infer<typeof listAppealsResultSchema>;
export type AppealDetailResult = z.infer<typeof appealDetailResultSchema>;
export type AppealReviewResult = z.infer<typeof appealReviewResultSchema>;
export type AppealGrantResult = z.infer<typeof appealGrantResultSchema>;
export type TransactionDisputeResolutionResult = z.infer<
  typeof transactionDisputeResolutionResultSchema
>;

export type CreateDeliveryPointInput = Stage6Auth & {
  communityId: string;
  name: string;
  addressText: string;
  availableTimeText: string;
};

export type UpdateDeliveryPointInput = Stage6Auth & {
  deliveryPointId: string;
  name?: string;
  addressText?: string;
  availableTimeText?: string;
};

export type DisableDeliveryPointInput = Stage6Auth & {
  deliveryPointId: string;
  reason: string;
};

export type ListAppealsInput = Stage6Auth & {
  communityId?: string;
  status?: string;
};

export type ReviewAppealInput = Stage6Auth & {
  appealId: string;
  action: "resolve" | "reject" | "escalate_platform" | "platform_resolve";
  resolution: string;
};

export type CreateAppealAttachmentGrantInput = Stage6Auth & {
  appealAttachmentId: string;
  ttlSeconds: number;
};

export type ResolveTransactionDisputeInput = Stage6Auth & {
  transactionId: string;
  action: z.infer<typeof transactionDisputeActionSchema>;
  reason: string;
  idempotencyKey: string;
};

export const stage6AdminCommandCatalog = {
  listDeliveryPoints: {
    method: "GET",
    path: "/auctions/communities/:communityId/delivery-points",
    resultSchema: listDeliveryPointsResultSchema
  },
  createDeliveryPoint: {
    method: "POST",
    path: "/auctions/communities/:communityId/delivery-points",
    resultSchema: deliveryPointCommandResultSchema
  },
  updateDeliveryPoint: {
    method: "PATCH",
    path: "/auctions/delivery-points/:deliveryPointId",
    resultSchema: deliveryPointCommandResultSchema
  },
  disableDeliveryPoint: {
    method: "POST",
    path: "/auctions/delivery-points/:deliveryPointId/disable",
    resultSchema: deliveryPointCommandResultSchema
  },
  listAppeals: {
    method: "GET",
    path: "/auctions/appeals",
    resultSchema: listAppealsResultSchema
  },
  getAppealDetail: {
    method: "GET",
    path: "/auctions/appeals/:appealId",
    resultSchema: appealDetailResultSchema
  },
  reviewAppeal: {
    method: "POST",
    path: "/auctions/appeals/:appealId/review",
    resultSchema: appealReviewResultSchema
  },
  createAppealAttachmentGrant: {
    method: "POST",
    path: "/auctions/appeal-attachments/:appealAttachmentId/grant",
    resultSchema: appealGrantResultSchema
  },
  resolveTransactionDispute: {
    method: "POST",
    path: "/auctions/transactions/:transactionId/dispute-resolution",
    resultSchema: transactionDisputeResolutionResultSchema
  }
} as const;

export async function listDeliveryPoints(
  apiBaseUrl: string,
  input: Stage6Auth & { communityId: string }
): Promise<ListDeliveryPointsResult> {
  const { accessToken, communityId } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.listDeliveryPoints.path.replace(
        ":communityId",
        encodeURIComponent(communityId)
      )
    ),
    {
      headers: authHeaders(accessToken)
    }
  );

  return parseStage6Response(response, listDeliveryPointsResultSchema);
}

export async function createDeliveryPoint(
  apiBaseUrl: string,
  input: CreateDeliveryPointInput
): Promise<DeliveryPointCommandResult> {
  const { accessToken, communityId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.createDeliveryPoint.path.replace(
        ":communityId",
        encodeURIComponent(communityId)
      )
    ),
    jsonRequest("POST", accessToken, data)
  );

  return parseStage6Response(response, deliveryPointCommandResultSchema);
}

export async function updateDeliveryPoint(
  apiBaseUrl: string,
  input: UpdateDeliveryPointInput
): Promise<DeliveryPointCommandResult> {
  const { accessToken, deliveryPointId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.updateDeliveryPoint.path.replace(
        ":deliveryPointId",
        encodeURIComponent(deliveryPointId)
      )
    ),
    jsonRequest("PATCH", accessToken, data)
  );

  return parseStage6Response(response, deliveryPointCommandResultSchema);
}

export async function disableDeliveryPoint(
  apiBaseUrl: string,
  input: DisableDeliveryPointInput
): Promise<DeliveryPointCommandResult> {
  const { accessToken, deliveryPointId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.disableDeliveryPoint.path.replace(
        ":deliveryPointId",
        encodeURIComponent(deliveryPointId)
      )
    ),
    jsonRequest("POST", accessToken, data)
  );

  return parseStage6Response(response, deliveryPointCommandResultSchema);
}

export async function listAppeals(
  apiBaseUrl: string,
  input: ListAppealsInput
): Promise<ListAppealsResult> {
  const { accessToken, communityId, status } = input;
  const params = new URLSearchParams();
  if (communityId) {
    params.set("communityId", communityId);
  }
  if (status) {
    params.set("status", status);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      `${stage6AdminCommandCatalog.listAppeals.path}${suffix}`
    ),
    {
      headers: authHeaders(accessToken)
    }
  );

  return parseStage6Response(response, listAppealsResultSchema);
}

export async function getAppealDetail(
  apiBaseUrl: string,
  input: Stage6Auth & { appealId: string }
): Promise<AppealDetailResult> {
  const { accessToken, appealId } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.getAppealDetail.path.replace(
        ":appealId",
        encodeURIComponent(appealId)
      )
    ),
    {
      headers: authHeaders(accessToken)
    }
  );

  return parseStage6Response(response, appealDetailResultSchema);
}

export async function reviewAppeal(
  apiBaseUrl: string,
  input: ReviewAppealInput
): Promise<AppealReviewResult> {
  const { accessToken, appealId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.reviewAppeal.path.replace(
        ":appealId",
        encodeURIComponent(appealId)
      )
    ),
    jsonRequest("POST", accessToken, data)
  );

  return parseStage6Response(response, appealReviewResultSchema);
}

export async function createAppealAttachmentGrant(
  apiBaseUrl: string,
  input: CreateAppealAttachmentGrantInput
): Promise<AppealGrantResult> {
  const { accessToken, appealAttachmentId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.createAppealAttachmentGrant.path.replace(
        ":appealAttachmentId",
        encodeURIComponent(appealAttachmentId)
      )
    ),
    jsonRequest("POST", accessToken, data)
  );

  return parseStage6Response(response, appealGrantResultSchema);
}

export async function resolveTransactionDispute(
  apiBaseUrl: string,
  input: ResolveTransactionDisputeInput
): Promise<TransactionDisputeResolutionResult> {
  const { accessToken, transactionId, ...data } = input;
  const response = await fetch(
    buildStage2AdminUrl(
      apiBaseUrl,
      stage6AdminCommandCatalog.resolveTransactionDispute.path.replace(
        ":transactionId",
        encodeURIComponent(transactionId)
      )
    ),
    jsonRequest("POST", accessToken, data)
  );

  return parseStage6Response(
    response,
    transactionDisputeResolutionResultSchema
  );
}

function authHeaders(accessToken: string) {
  const parsed = stage6AuthSchema.parse({ accessToken });

  return {
    authorization: `Bearer ${parsed.accessToken}`
  };
}

function jsonRequest(method: "POST" | "PATCH", accessToken: string, data: unknown) {
  return {
    method,
    headers: {
      "content-type": "application/json",
      ...authHeaders(accessToken)
    },
    body: JSON.stringify(data)
  };
}

async function parseStage6Response<T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T> {
  const payload = await response.json();
  return schema.parse(payload);
}
