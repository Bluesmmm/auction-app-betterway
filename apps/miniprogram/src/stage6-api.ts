import {
  buildStage2ApiUrl,
  type MiniprogramJsonRequestOptions
} from "./stage2-api.js";

export type Stage6TransactionDetailPayload = {
  accessToken: string;
  transactionId: string;
};

export type Stage6GuardianConfirmationPayload =
  Stage6TransactionDetailPayload & {
    value: "confirmed" | "rejected";
    deliveryMethod?: "designated_point" | "guardian_arranged";
    deliveryPointId?: string | null;
    reason?: string;
    idempotencyKey: string;
    challengeId?: string;
  };

export type Stage6DeliveryConfirmationPayload =
  Stage6TransactionDetailPayload & {
    value: "confirmed" | "rejected";
    idempotencyKey: string;
    challengeId?: string;
  };

export type Stage6TransactionAppealPayload =
  Stage6TransactionDetailPayload & {
    reason: string;
    attachmentMediaAssetIds?: string[];
  };

export type Stage6AppealAttachmentGrantPayload = {
  accessToken: string;
  appealAttachmentId: string;
  ttlSeconds: number;
};

export function buildStage6TransactionDetailRequest(
  apiBaseUrl: string,
  payload: Stage6TransactionDetailPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/transactions/${encodeURIComponent(payload.transactionId)}`
    ),
    method: "GET",
    data: {},
    header: stage6AuthHeader(payload.accessToken)
  };
}

export function buildStage6GuardianConfirmationRequest(
  apiBaseUrl: string,
  payload: Stage6GuardianConfirmationPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage6GuardianConfirmationPayload, "accessToken" | "transactionId">
> {
  const { accessToken, transactionId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/transactions/${encodeURIComponent(transactionId)}/guardian-confirm`
    ),
    method: "POST",
    data,
    header: stage6AuthHeader(accessToken)
  };
}

export function buildStage6DeliveryConfirmationRequest(
  apiBaseUrl: string,
  payload: Stage6DeliveryConfirmationPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage6DeliveryConfirmationPayload, "accessToken" | "transactionId">
> {
  const { accessToken, transactionId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/transactions/${encodeURIComponent(transactionId)}/delivery-confirm`
    ),
    method: "POST",
    data,
    header: stage6AuthHeader(accessToken)
  };
}

export function buildStage6TransactionAppealRequest(
  apiBaseUrl: string,
  payload: Stage6TransactionAppealPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage6TransactionAppealPayload, "accessToken" | "transactionId">
> {
  const { accessToken, transactionId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/transactions/${encodeURIComponent(transactionId)}/appeals`
    ),
    method: "POST",
    data,
    header: stage6AuthHeader(accessToken)
  };
}

export function buildStage6AppealAttachmentGrantRequest(
  apiBaseUrl: string,
  payload: Stage6AppealAttachmentGrantPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage6AppealAttachmentGrantPayload, "accessToken" | "appealAttachmentId">
> {
  const { accessToken, appealAttachmentId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/appeal-attachments/${encodeURIComponent(appealAttachmentId)}/grant`
    ),
    method: "POST",
    data,
    header: stage6AuthHeader(accessToken)
  };
}

function stage6AuthHeader(accessToken: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`
  };
}
