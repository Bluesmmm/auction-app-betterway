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

export type SubmitWantedPostPayload = {
  accessToken: string;
  childId: string;
  communityId: string;
  title: string;
  description: string;
  category?: string;
  images: SubmitItemPayload["images"];
  idempotencyKey: string;
};

export type SubmitWantedResponsePayload = {
  accessToken: string;
  responderChildId: string;
  communityId: string;
  wantedPostId: string;
  title: string;
  description: string;
  images: SubmitItemPayload["images"];
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

export function buildSubmitWantedPostRequest(
  apiBaseUrl: string,
  payload: SubmitWantedPostPayload
): MiniprogramJsonRequestOptions<Omit<SubmitWantedPostPayload, "accessToken">> {
  const { accessToken, ...data } = payload;
  return {
    url: buildStage2ApiUrl(apiBaseUrl, "/content/wanted-posts"),
    method: "POST",
    data,
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    }
  };
}

export function buildSubmitWantedResponseRequest(
  apiBaseUrl: string,
  payload: SubmitWantedResponsePayload
): MiniprogramJsonRequestOptions<
  Omit<SubmitWantedResponsePayload, "accessToken" | "wantedPostId">
> {
  const { accessToken, wantedPostId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/content/wanted-posts/${encodeURIComponent(wantedPostId)}/responses`
    ),
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

export function buildVisibleWantedPostDetailRequest(
  apiBaseUrl: string,
  input: {
    accessToken: string;
    communityId: string;
    wantedPostId: string;
    childId: string;
  }
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/content/communities/${encodeURIComponent(input.communityId)}/wanted-posts/${encodeURIComponent(
        input.wantedPostId
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

export function buildVisibleWantedResponseDetailRequest(
  apiBaseUrl: string,
  input: {
    accessToken: string;
    communityId: string;
    wantedResponseId: string;
    childId: string;
  }
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/content/communities/${encodeURIComponent(input.communityId)}/wanted-responses/${encodeURIComponent(
        input.wantedResponseId
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
