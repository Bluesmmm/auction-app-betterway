import { stage1AppConfig } from "../../../app.js";
import {
  buildStage6AppealAttachmentGrantRequest,
  buildStage6DeliveryConfirmationRequest,
  buildStage6GuardianConfirmationRequest,
  buildStage6TransactionAppealRequest,
  buildStage6TransactionDetailRequest,
  type Stage6AppealAttachmentGrantPayload,
  type Stage6DeliveryConfirmationPayload,
  type Stage6GuardianConfirmationPayload,
  type Stage6TransactionAppealPayload,
  type Stage6TransactionDetailPayload
} from "../../../src/stage6-api.js";
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

type Stage6RequestInvoker = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse<Stage2RequestResult>>;

type Stage6TransactionsPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    detailStatus: PageSubmissionStatus;
    guardianDecisionStatus: PageSubmissionStatus;
    deliveryDecisionStatus: PageSubmissionStatus;
    appealStatus: PageSubmissionStatus;
    grantStatus: PageSubmissionStatus;
  };
  loadTransactionDetail(
    this: Stage6TransactionsPage,
    payload: Stage6TransactionDetailPayload,
    request?: Stage6RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  submitGuardianProposal(
    this: Stage6TransactionsPage,
    payload: Stage6GuardianConfirmationPayload,
    request?: Stage6RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  submitDeliveryConfirmation(
    this: Stage6TransactionsPage,
    payload: Stage6DeliveryConfirmationPayload,
    request?: Stage6RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  submitTransactionAppeal(
    this: Stage6TransactionsPage,
    payload: Stage6TransactionAppealPayload,
    request?: Stage6RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  createAppealImageGrant(
    this: Stage6TransactionsPage,
    payload: Stage6AppealAttachmentGrantPayload,
    request?: Stage6RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
};

export const stage6TransactionsPage: Stage6TransactionsPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    detailStatus: "idle",
    guardianDecisionStatus: "idle",
    deliveryDecisionStatus: "idle",
    appealStatus: "idle",
    grantStatus: "idle"
  },
  async loadTransactionDetail(
    this: Stage6TransactionsPage,
    payload: Stage6TransactionDetailPayload,
    request: Stage6RequestInvoker = requestJson
  ) {
    this.setData?.({ detailStatus: "submitting" });
    const response = await request(
      buildStage6TransactionDetailRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ detailStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async submitGuardianProposal(
    this: Stage6TransactionsPage,
    payload: Stage6GuardianConfirmationPayload,
    request: Stage6RequestInvoker = requestJson
  ) {
    this.setData?.({ guardianDecisionStatus: "submitting" });
    const response = await request(
      buildStage6GuardianConfirmationRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({
      guardianDecisionStatus: toStage2SubmissionStatus(response)
    });
    return response;
  },
  async submitDeliveryConfirmation(
    this: Stage6TransactionsPage,
    payload: Stage6DeliveryConfirmationPayload,
    request: Stage6RequestInvoker = requestJson
  ) {
    this.setData?.({ deliveryDecisionStatus: "submitting" });
    const response = await request(
      buildStage6DeliveryConfirmationRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({
      deliveryDecisionStatus: toStage2SubmissionStatus(response)
    });
    return response;
  },
  async submitTransactionAppeal(
    this: Stage6TransactionsPage,
    payload: Stage6TransactionAppealPayload,
    request: Stage6RequestInvoker = requestJson
  ) {
    this.setData?.({ appealStatus: "submitting" });
    const response = await request(
      buildStage6TransactionAppealRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ appealStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async createAppealImageGrant(
    this: Stage6TransactionsPage,
    payload: Stage6AppealAttachmentGrantPayload,
    request: Stage6RequestInvoker = requestJson
  ) {
    this.setData?.({ grantStatus: "submitting" });
    const response = await request(
      buildStage6AppealAttachmentGrantRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ grantStatus: toStage2SubmissionStatus(response) });
    return response;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage6TransactionsPage);
