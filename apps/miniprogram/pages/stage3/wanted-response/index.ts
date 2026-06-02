import { stage1AppConfig } from "../../../app.js";
import {
  buildSubmitWantedResponseRequest,
  type SubmitWantedResponsePayload
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

type Stage3WantedResponsePage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    submitStatus: "idle" | "submitting" | "accepted" | "rejected";
  };
  submitWantedResponse(
    this: Stage3WantedResponsePage,
    payload: SubmitWantedResponsePayload,
    request?: (
      input: MiniprogramJsonRequestOptions
    ) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage3WantedResponsePage: Stage3WantedResponsePage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    submitStatus: "idle"
  },
  async submitWantedResponse(
    this: Stage3WantedResponsePage,
    payload: SubmitWantedResponsePayload,
    request = requestJson
  ) {
    this.setData?.({ submitStatus: "submitting" });
    const response = await request(
      buildSubmitWantedResponseRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ submitStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage3WantedResponsePage);
