import { stage1AppConfig } from "../../../app.js";
import {
  buildPointSummaryRequest,
  buildSubmitGuardianPointAdjustmentRequest,
  type GetPointSummaryPayload,
  type SubmitGuardianPointAdjustmentPayload
} from "../../../src/stage4-api.js";
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

type Stage4RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage4PointsPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    summaryStatus: PageSubmissionStatus;
    requestStatus: PageSubmissionStatus;
  };
  loadPointSummary(
    this: Stage4PointsPage,
    payload: GetPointSummaryPayload,
    request?: Stage4RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  submitGuardianPointAdjustment(
    this: Stage4PointsPage,
    payload: SubmitGuardianPointAdjustmentPayload,
    request?: Stage4RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage4PointsPage: Stage4PointsPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    summaryStatus: "idle",
    requestStatus: "idle"
  },
  async loadPointSummary(
    this: Stage4PointsPage,
    payload: GetPointSummaryPayload,
    request: Stage4RequestInvoker = requestJson
  ) {
    this.setData?.({ summaryStatus: "submitting" });
    const response = await request(
      buildPointSummaryRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ summaryStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async submitGuardianPointAdjustment(
    this: Stage4PointsPage,
    payload: SubmitGuardianPointAdjustmentPayload,
    request: Stage4RequestInvoker = requestJson
  ) {
    this.setData?.({ requestStatus: "submitting" });
    const response = await request(
      buildSubmitGuardianPointAdjustmentRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ requestStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage4PointsPage);
