import {
  buildStage2ApiUrl,
  type MiniprogramJsonRequestOptions
} from "./stage2-api.js";

export type SubmitItemPayload = {
  accessToken: string;
  childId: string;
  communityId: string;
  title: string;
  description: string;
  startPoints: number;
  minIncrementPoints: number;
  images: Array<{
    mediaAssetId: string;
    mediaRole: "front" | "back" | "side" | "detail";
    sortOrder: number;
  }>;
  idempotencyKey: string;
};

export function buildSubmitItemRequest(
  apiBaseUrl: string,
  payload: SubmitItemPayload
): MiniprogramJsonRequestOptions<Omit<SubmitItemPayload, "accessToken">> {
  const { accessToken, ...data } = payload;
  return {
    url: buildStage2ApiUrl(apiBaseUrl, "/content/items"),
    method: "POST",
    data,
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    }
  };
}

export function buildVisibleItemDetailRequest(
  apiBaseUrl: string,
  input: {
    accessToken: string;
    communityId: string;
    itemId: string;
    childId: string;
  }
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/content/communities/${encodeURIComponent(input.communityId)}/items/${encodeURIComponent(
        input.itemId
      )}/visible-detail?childId=${encodeURIComponent(input.childId)}`
    ),
    method: "GET",
    data: {},
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${input.accessToken}`
    }
  };
}
