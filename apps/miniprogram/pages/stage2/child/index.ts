import { stage1AppConfig } from "../../../app.js";
import {
  buildChildOnboardingRequest,
  requestJson,
  type ChildOnboardingPayload,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse,
  type Stage2RequestResult,
  toStage2SubmissionStatus
} from "../../../src/stage2-api.js";

type PageSubmissionStatus = "idle" | "submitting" | "accepted" | "rejected";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage2RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage2ChildPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    childStatus: PageSubmissionStatus;
  };
  submitChildProfile(
    this: Stage2ChildPage,
    payload: ChildOnboardingPayload,
    request?: Stage2RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage2ChildPage: Stage2ChildPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    childStatus: "idle"
  },
  async submitChildProfile(
    this: Stage2ChildPage,
    payload: ChildOnboardingPayload,
    request: Stage2RequestInvoker = requestJson
  ) {
    this.setData?.({ childStatus: "submitting" });
    const response = await request(
      buildChildOnboardingRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ childStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage2ChildPage);
