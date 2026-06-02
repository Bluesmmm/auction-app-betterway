import { stage1AppConfig } from "../../../app.js";
import { buildVisibleItemDetailRequest } from "../../../src/stage3-api.js";
import {
  requestJson,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse
} from "../../../src/stage2-api.js";

type VisibleDetailPayload = {
  accessToken: string;
  communityId: string;
  itemId: string;
  childId: string;
};

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage3DetailPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    detailStatus: "idle" | "loading" | "loaded" | "rejected";
  };
  loadItemDetail(
    this: Stage3DetailPage,
    payload: VisibleDetailPayload,
    request?: (
      input: MiniprogramJsonRequestOptions
    ) => Promise<MiniprogramJsonResponse>
  ): Promise<MiniprogramJsonResponse>;
};

export const stage3ItemDetailPage: Stage3DetailPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    detailStatus: "idle"
  },
  async loadItemDetail(
    this: Stage3DetailPage,
    payload: VisibleDetailPayload,
    request = requestJson
  ) {
    this.setData?.({ detailStatus: "loading" });
    const response = await request(
      buildVisibleItemDetailRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({
      detailStatus:
        response.statusCode >= 200 && response.statusCode < 300
          ? "loaded"
          : "rejected"
    });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage3ItemDetailPage);
