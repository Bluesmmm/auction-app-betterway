import {
  buildStage2ApiUrl,
  type MiniprogramJsonRequestOptions
} from "./stage2-api.js";

export type GetPointSummaryPayload = {
  accessToken: string;
  childId: string;
};

export type SubmitGuardianPointAdjustmentPayload = {
  accessToken: string;
  childId: string;
  requestType: "correction" | "activity_reward";
  requestedPoints: number;
  reason: string;
  idempotencyKey: string;
};

export function buildPointSummaryRequest(
  apiBaseUrl: string,
  payload: GetPointSummaryPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/points/children/${encodeURIComponent(payload.childId)}/summary`
    ),
    method: "GET",
    data: {},
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${payload.accessToken}`
    }
  };
}

export function buildSubmitGuardianPointAdjustmentRequest(
  apiBaseUrl: string,
  payload: SubmitGuardianPointAdjustmentPayload
): MiniprogramJsonRequestOptions<
  Omit<SubmitGuardianPointAdjustmentPayload, "accessToken" | "childId">
> {
  const { accessToken, childId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/points/children/${encodeURIComponent(childId)}/adjustment-requests`
    ),
    method: "POST",
    data,
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    }
  };
}
