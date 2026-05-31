import { stage1AppConfig } from "../../../app.js";
import {
  buildGuardianOnboardingRequest,
  buildWechatLoginRequest,
  requestJson,
  type GuardianOnboardingPayload,
  type MiniprogramJsonRequestOptions,
  type MiniprogramJsonResponse,
  type Stage2RequestResult,
  type WechatLoginPayload,
  toStage2SubmissionStatus
} from "../../../src/stage2-api.js";

type PageSubmissionStatus = "idle" | "submitting" | "accepted" | "rejected";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage2RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage2OnboardingPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    loginStatus: PageSubmissionStatus;
    guardianStatus: PageSubmissionStatus;
  };
  submitWechatLogin(
    this: Stage2OnboardingPage,
    payload: WechatLoginPayload,
    request?: Stage2RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  submitGuardianProfile(
    this: Stage2OnboardingPage,
    payload: GuardianOnboardingPayload,
    request?: Stage2RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage2OnboardingPage: Stage2OnboardingPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    loginStatus: "idle",
    guardianStatus: "idle"
  },
  async submitWechatLogin(
    this: Stage2OnboardingPage,
    payload: WechatLoginPayload,
    request: Stage2RequestInvoker = requestJson
  ) {
    this.setData?.({ loginStatus: "submitting" });
    const response = await request(
      buildWechatLoginRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ loginStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async submitGuardianProfile(
    this: Stage2OnboardingPage,
    payload: GuardianOnboardingPayload,
    request: Stage2RequestInvoker = requestJson
  ) {
    this.setData?.({ guardianStatus: "submitting" });
    const response = await request(
      buildGuardianOnboardingRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ guardianStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage2OnboardingPage);
