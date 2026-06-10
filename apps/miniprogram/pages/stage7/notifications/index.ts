import { stage1AppConfig } from "../../../app.js";
import {
  buildStage7MarkAllNotificationsReadRequest,
  buildStage7MarkNotificationReadRequest,
  buildStage7NotificationListRequest,
  buildStage7NotificationPreferencesRequest,
  buildStage7UpdateNotificationPreferenceRequest,
  buildStage7UnreadCountRequest,
  parseStage7NotificationTarget,
  resolveStage7NotificationAction,
  type Stage7MarkAllNotificationsReadPayload,
  type Stage7MarkNotificationReadPayload,
  type Stage7NotificationListPayload,
  type Stage7NotificationPreferencesPayload,
  type Stage7NotificationTarget,
  type Stage7UpdateNotificationPreferencePayload,
  type Stage7UnreadCountPayload
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

type Stage7NotificationsPage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    listStatus: PageSubmissionStatus;
    unreadCountStatus: PageSubmissionStatus;
    readStatus: PageSubmissionStatus;
    readAllStatus: PageSubmissionStatus;
    preferencesStatus: PageSubmissionStatus;
    preferenceUpdateStatus: PageSubmissionStatus;
  };
  loadNotifications(
    this: Stage7NotificationsPage,
    payload: Stage7NotificationListPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  loadUnreadCount(
    this: Stage7NotificationsPage,
    payload: Stage7UnreadCountPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  markNotificationRead(
    this: Stage7NotificationsPage,
    payload: Stage7MarkNotificationReadPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  markAllNotificationsRead(
    this: Stage7NotificationsPage,
    payload: Stage7MarkAllNotificationsReadPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  loadPreferences(
    this: Stage7NotificationsPage,
    payload: Stage7NotificationPreferencesPayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  updatePreference(
    this: Stage7NotificationsPage,
    payload: Stage7UpdateNotificationPreferencePayload,
    request?: Stage7RequestInvoker
  ): Promise<MiniprogramJsonResponse<Stage2RequestResult>>;
  resolveNotificationTarget(input: {
    relatedType?: unknown;
    relatedId?: unknown;
    targetVersion?: unknown;
    actionType?: unknown;
  }): Stage7NotificationTarget | null;
  resolveNotificationAction(input: {
    actionType?: unknown;
    relatedType?: unknown;
    relatedId?: unknown;
    targetVersion?: unknown;
  }): Stage7NotificationTarget | null;
};

export const stage7NotificationsPage: Stage7NotificationsPage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    listStatus: "idle",
    unreadCountStatus: "idle",
    readStatus: "idle",
    readAllStatus: "idle",
    preferencesStatus: "idle",
    preferenceUpdateStatus: "idle"
  },
  async loadNotifications(
    this: Stage7NotificationsPage,
    payload: Stage7NotificationListPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ listStatus: "submitting" });
    const response = await request(
      buildStage7NotificationListRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ listStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async loadUnreadCount(
    this: Stage7NotificationsPage,
    payload: Stage7UnreadCountPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ unreadCountStatus: "submitting" });
    const response = await request(
      buildStage7UnreadCountRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ unreadCountStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async markNotificationRead(
    this: Stage7NotificationsPage,
    payload: Stage7MarkNotificationReadPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ readStatus: "submitting" });
    const response = await request(
      buildStage7MarkNotificationReadRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ readStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async markAllNotificationsRead(
    this: Stage7NotificationsPage,
    payload: Stage7MarkAllNotificationsReadPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ readAllStatus: "submitting" });
    const response = await request(
      buildStage7MarkAllNotificationsReadRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ readAllStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async loadPreferences(
    this: Stage7NotificationsPage,
    payload: Stage7NotificationPreferencesPayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ preferencesStatus: "submitting" });
    const response = await request(
      buildStage7NotificationPreferencesRequest(this.data.apiBaseUrl, payload)
    );
    this.setData?.({ preferencesStatus: toStage2SubmissionStatus(response) });
    return response;
  },
  async updatePreference(
    this: Stage7NotificationsPage,
    payload: Stage7UpdateNotificationPreferencePayload,
    request: Stage7RequestInvoker = requestJson
  ) {
    this.setData?.({ preferenceUpdateStatus: "submitting" });
    const response = await request(
      buildStage7UpdateNotificationPreferenceRequest(
        this.data.apiBaseUrl,
        payload
      )
    );
    this.setData?.({
      preferenceUpdateStatus: toStage2SubmissionStatus(response)
    });
    return response;
  },
  resolveNotificationTarget(input) {
    return parseStage7NotificationTarget(input);
  },
  resolveNotificationAction(input) {
    return resolveStage7NotificationAction(input);
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
};

wechatRuntime.Page?.(stage7NotificationsPage);
