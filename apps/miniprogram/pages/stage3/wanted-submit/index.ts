import { stage1AppConfig } from "../../../app.js";
import {
  buildSubmitWantedPostRequest,
  type SubmitWantedPostPayload
} from "../../../src/stage3-api.js";
import {
  requestJson,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse,
  type Stage2RequestResult,
  toStage2SubmissionStatus
} from "../../../src/stage2-api.js";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage3WantedSubmitPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    submitStatus: "idle" | "submitting" | "accepted" | "rejected";
  };
  submitWantedPost(
    this: Stage3WantedSubmitPage,
    payload: SubmitWantedPostPayload,
    request?: (
      input: MiniprogramJsonRequestOptions
    ) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage3WantedSubmitPage: Stage3WantedSubmitPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    submitStatus: "idle"
  },
  async submitWantedPost(
    this: Stage3WantedSubmitPage,
    payload: SubmitWantedPostPayload,
    request = requestJson
  ) {
    this.setData?.({ submitStatus: "submitting" });
    const response = await request(
      buildSubmitWantedPostRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ submitStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage3WantedSubmitPage);
