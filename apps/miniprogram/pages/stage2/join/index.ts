import { stage1AppConfig } from "../../../app.js";
import {
  buildCommunityJoinRequest,
  buildGuardianJoinConfirmationRequest,
  requestJson,
  type CommunityJoinPayload,
  type GuardianJoinConfirmationPayload,
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

type Stage2JoinPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    joinStatus: PageSubmissionStatus;
    confirmationStatus: PageSubmissionStatus;
  };
  submitJoinRequest(
    this: Stage2JoinPage,
    payload: CommunityJoinPayload,
    request?: Stage2RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  confirmGuardianJoin(
    this: Stage2JoinPage,
    payload: GuardianJoinConfirmationPayload,
    request?: Stage2RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage2JoinPage: Stage2JoinPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    joinStatus: "idle",
    confirmationStatus: "idle"
  },
  async submitJoinRequest(
    this: Stage2JoinPage,
    payload: CommunityJoinPayload,
    request: Stage2RequestInvoker = requestJson
  ) {
    this.setData?.({ joinStatus: "submitting" });
    const response = await request(
      buildCommunityJoinRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ joinStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async confirmGuardianJoin(
    this: Stage2JoinPage,
    payload: GuardianJoinConfirmationPayload,
    request: Stage2RequestInvoker = requestJson
  ) {
    this.setData?.({ confirmationStatus: "submitting" });
    const response = await request(
      buildGuardianJoinConfirmationRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ confirmationStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage2JoinPage);
