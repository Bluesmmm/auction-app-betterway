import { stage1AppConfig } from "../../../app.js";
import {
  buildStage7RealtimeCompensationRequests,
  buildStage7RealtimeSubscribeMessage,
  buildStage7RealtimeUrl,
  parseStage7RealtimeServerFrame,
  type Stage7RealtimeCompensationPayload,
  type Stage7RealtimeConnectPayload,
  type Stage7RealtimeHintEvent,
  type Stage7RealtimeServerFrame,
  type Stage7RealtimeSubscribePayload
} from "../../../src/stage7-api.js";
import type { MiniprogramJsonRequestOptions } from "../../../src/stage2-api.js";

type RealtimeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "rejected";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type Stage7RealtimeSocketTask = {
  send(input: { data: string }): void;
  close?(): void;
  onOpen?(listener: () => void): void;
  onClose?(listener: () => void): void;
  onMessage?(listener: (message: { data: unknown }) => void): void;
};

type Stage7RealtimeConnector = (input: {
  url: string;
}) => Stage7RealtimeSocketTask;

type Stage7RealtimePage = MiniprogramPageRuntime & {
  data: {
    apiBaseUrl: string;
    connectionStatus: RealtimeConnectionStatus;
    refreshRequired: boolean;
    unreadDot: boolean;
    lastEventId: string | null;
    lastRevokedRoomId: string | null;
    lastErrorCode: string | null;
  };
  socketTask?: Stage7RealtimeSocketTask;
  connectRealtime(
    this: Stage7RealtimePage,
    payload: Stage7RealtimeConnectPayload,
    connector?: Stage7RealtimeConnector
  ): Stage7RealtimeSocketTask;
  subscribeRoom(
    this: Stage7RealtimePage,
    payload: Stage7RealtimeSubscribePayload
  ): ReturnType<typeof buildStage7RealtimeSubscribeMessage>;
  handleRealtimeMessage(
    this: Stage7RealtimePage,
    raw: unknown
  ): Stage7RealtimeServerFrame | null;
  handleRealtimeHint(
    this: Stage7RealtimePage,
    event: Stage7RealtimeHintEvent
  ): { refreshRequired: true; unreadDot: true };
  markDisconnected(this: Stage7RealtimePage): void;
  buildReconnectRefreshRequests(
    this: Stage7RealtimePage,
    payload: Stage7RealtimeCompensationPayload
  ): MiniprogramJsonRequestOptions<Record<string, never>>[];
};

export const stage7RealtimePage: Stage7RealtimePage = {
  data: {
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    connectionStatus: "idle",
    refreshRequired: false,
    unreadDot: false,
    lastEventId: null,
    lastRevokedRoomId: null,
    lastErrorCode: null
  },
  connectRealtime(
    this: Stage7RealtimePage,
    payload: Stage7RealtimeConnectPayload,
    connector: Stage7RealtimeConnector = connectWechatRealtimeSocket
  ) {
    this.setData?.({ connectionStatus: "connecting" });
    const socketTask = connector({
      url: buildStage7RealtimeUrl(this.data.apiBaseUrl, payload)
    });
    this.socketTask = socketTask;
    socketTask.onOpen?.(() => {
      this.setData?.({ connectionStatus: "connected" });
    });
    socketTask.onMessage?.((message) => {
      this.handleRealtimeMessage(message.data);
    });
    socketTask.onClose?.(() => {
      this.markDisconnected();
    });
    return socketTask;
  },
  subscribeRoom(this: Stage7RealtimePage, payload: Stage7RealtimeSubscribePayload) {
    const message = buildStage7RealtimeSubscribeMessage(payload);
    this.socketTask?.send({
      data: JSON.stringify(message)
    });
    return message;
  },
  handleRealtimeMessage(this: Stage7RealtimePage, raw: unknown) {
    const frame = parseStage7RealtimeServerFrame(safeJsonParse(raw));
    if (!frame) {
      return null;
    }

    if (frame.type === "hint") {
      this.handleRealtimeHint(frame.event);
      return frame;
    }
    if (frame.type === "subscription_revoked") {
      this.setData?.({
        refreshRequired: true,
        unreadDot: true,
        lastRevokedRoomId: frame.roomId
      });
      return frame;
    }
    if (frame.type === "rejected") {
      this.setData?.({
        connectionStatus: "rejected",
        refreshRequired: true,
        unreadDot: true,
        lastErrorCode: frame.errorCode
      });
      return frame;
    }

    this.setData?.({ refreshRequired: frame.refreshRequired });
    return frame;
  },
  handleRealtimeHint(this: Stage7RealtimePage, event: Stage7RealtimeHintEvent) {
    this.setData?.({
      refreshRequired: true,
      unreadDot: true,
      lastEventId: event.eventId
    });
    return {
      refreshRequired: true,
      unreadDot: true
    };
  },
  markDisconnected(this: Stage7RealtimePage) {
    this.setData?.({
      connectionStatus: "disconnected",
      refreshRequired: true,
      unreadDot: true
    });
  },
  buildReconnectRefreshRequests(
    this: Stage7RealtimePage,
    payload: Stage7RealtimeCompensationPayload
  ) {
    return buildStage7RealtimeCompensationRequests(
      this.data.apiBaseUrl,
      payload
    );
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
  wx?: {
    connectSocket(input: { url: string }): Stage7RealtimeSocketTask;
  };
};

wechatRuntime.Page?.(stage7RealtimePage);

function connectWechatRealtimeSocket(input: {
  url: string;
}): Stage7RealtimeSocketTask {
  if (!wechatRuntime.wx?.connectSocket) {
    throw new Error("WX_CONNECT_SOCKET_UNAVAILABLE");
  }
  return wechatRuntime.wx.connectSocket(input);
}

function safeJsonParse(raw: unknown) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
