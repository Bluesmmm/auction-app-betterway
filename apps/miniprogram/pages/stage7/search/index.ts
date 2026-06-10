import { stage1AppConfig } from "../../../app.js";
import {
  buildStage7FavoriteItemRequest,
  buildStage7FavoriteListRequest,
  buildStage7RemoveFavoriteItemRequest,
  buildStage7SearchRequest,
  type Stage7FavoriteItemPayload,
  type Stage7FavoriteListPayload,
  type Stage7SearchPayload
} from "../../../src/stage7-api.js";
import {
  requestJson,
  toStage2SubmissionStatus,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse,
  type Stage2RequestResult
} from "../../../src/stage2-api.js";

type PageSubmissionStatus = "idle" | "submitting" | "accepted" | "rejected";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage7RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage7SearchPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    searchStatus: PageSubmissionStatus;
    favoriteListStatus: PageSubmissionStatus;
    favoriteStatus: PageSubmissionStatus;
    removeFavoriteStatus: PageSubmissionStatus;
  };
  searchCommunityContent(
    this: Stage7SearchPage,
    payload: Stage7SearchPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  loadFavoriteItems(
    this: Stage7SearchPage,
    payload: Stage7FavoriteListPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  favoriteItem(
    this: Stage7SearchPage,
    payload: Stage7FavoriteItemPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  removeFavoriteItem(
    this: Stage7SearchPage,
    payload: Stage7FavoriteItemPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage7SearchPage: Stage7SearchPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    searchStatus: "idle",
    favoriteListStatus: "idle",
    favoriteStatus: "idle",
    removeFavoriteStatus: "idle"
  },
  async searchCommunityContent(
    this: Stage7SearchPage,
    payload: Stage7SearchPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ searchStatus: "submitting" });
    const response = await request(
      buildStage7SearchRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ searchStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async loadFavoriteItems(
    this: Stage7SearchPage,
    payload: Stage7FavoriteListPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ favoriteListStatus: "submitting" });
    const response = await request(
      buildStage7FavoriteListRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({
      favoriteListStatus: toStage2SubmissionStatus(response)
    });
    return response;
  },
  async favoriteItem(
    this: Stage7SearchPage,
    payload: Stage7FavoriteItemPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ favoriteStatus: "submitting" });
    const response = await request(
      buildStage7FavoriteItemRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ favoriteStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async removeFavoriteItem(
    this: Stage7SearchPage,
    payload: Stage7FavoriteItemPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ removeFavoriteStatus: "submitting" });
    const response = await request(
      buildStage7RemoveFavoriteItemRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({
      removeFavoriteStatus: toStage2SubmissionStatus(response)
    });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage7SearchPage);
