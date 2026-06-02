import { stage1AppConfig } from "../../../app.js";
import {
  buildSubmitItemRequest,
  type SubmitItemPayload
} from "../../../src/stage3-api.js";
import {
  requestJson,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse,
  type Stage2RequestResult,
  toStage2SubmissionStatus
} from "../../../src/stage2-api.js";

type PageSubmissionStatus = "idle" | "submitting" | "accepted" | "rejected";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage3RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage3ItemSubmitPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    submitStatus: PageSubmissionStatus;
  };
  submitItem(
    this: Stage3ItemSubmitPage,
    payload: SubmitItemPayload,
    request?: Stage3RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage3ItemSubmitPage: Stage3ItemSubmitPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    submitStatus: "idle"
  },
  async submitItem(
    this: Stage3ItemSubmitPage,
    payload: SubmitItemPayload,
    request: Stage3RequestInvoker = requestJson
  ) {
    this.setData?.({ submitStatus: "submitting" });
    const response = await request(
      buildSubmitItemRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ submitStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage3ItemSubmitPage);
