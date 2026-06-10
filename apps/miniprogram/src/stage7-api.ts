import {
  buildStage2ApiUrl,
  type MiniprogramJsonRequestOptions
} from "./stage2-api.js";

export type Stage7NotificationListPayload = {
  accessToken: string;
  recipientChildId?: string;
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type Stage7UnreadCountPayload = {
  accessToken: string;
  recipientChildId?: string;
};

export type Stage7MarkNotificationReadPayload = {
  accessToken: string;
  notificationId: string;
};

export type Stage7MarkAllNotificationsReadPayload = {
  accessToken: string;
  recipientChildId?: string;
};

export type Stage7NotificationPreferencesPayload = {
  accessToken: string;
  recipientChildId?: string;
};

export type Stage7UpdateNotificationPreferencePayload = {
  accessToken: string;
  eventType: string;
  recipientChildId?: string;
  inAppEnabled?: boolean;
  wechatSubscribeEnabled?: boolean;
  childVisible?: boolean;
};

export type Stage7SearchPayload = {
  accessToken: string;
  childId: string;
  communityId: string;
  q?: string;
  category?: string;
  targetType?: "item" | "wanted_post";
  sort?: "latest" | "ending_soon" | "bid_count" | "popular";
  cursor?: string;
  limit?: number;
};

export type Stage7FavoriteItemPayload = {
  accessToken: string;
  childId: string;
  communityId: string;
  itemId: string;
};

export type Stage7FavoriteListPayload = {
  accessToken: string;
  childId: string;
  communityId: string;
};

export type Stage7TransactionDetailCompensationPayload = {
  accessToken: string;
  transactionId: string;
};

export type Stage7NotificationTarget = {
  relatedType: string;
  relatedId: string;
  targetVersion: number | null;
  actionType: string | null;
};

export type Stage7RealtimeRoomKey =
  | {
      kind: "auction";
      childId: string;
      auctionSessionId: string;
    }
  | {
      kind: "transaction";
      childId: string;
      transactionId: string;
    }
  | {
      kind: "notifications";
      childId?: string;
    };

export type Stage7RealtimeConnectPayload = {
  accessToken: string;
};

export type Stage7RealtimeSubscribePayload = {
  requestId?: string;
  room: Stage7RealtimeRoomKey;
  knownTargetVersion?: number;
};

export type Stage7RealtimeHintEvent = {
  kind: "stage7_realtime_hint";
  eventId: string;
  serverTime: string;
  eventType: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  refreshRequired: true;
};

export type Stage7RealtimeServerFrame =
  | {
      type: "subscribed";
      requestId?: string;
      roomId: string;
      refreshRequired: true;
    }
  | {
      type: "rejected";
      requestId?: string;
      errorCode: string;
      refreshRequired: true;
    }
  | {
      type: "hint";
      event: Stage7RealtimeHintEvent;
      refreshRequired: true;
    }
  | {
      type: "subscription_revoked";
      roomId: string;
      reason: "PERMISSION_REVOKED";
      refreshRequired: true;
    };

export type Stage7RealtimeCompensationPayload = {
  accessToken: string;
  recipientChildId?: string;
  search?: Omit<Stage7SearchPayload, "accessToken">;
  transactionId?: string;
};

export function buildStage7RealtimeUrl(
  apiBaseUrl: string,
  payload: Stage7RealtimeConnectPayload
) {
  const url = new URL(buildStage2ApiUrl(apiBaseUrl, "/stage7/realtime"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("accessToken", payload.accessToken);
  return url.toString();
}

export function buildStage7RealtimeSubscribeMessage(
  payload: Stage7RealtimeSubscribePayload
) {
  return {
    type: "subscribe" as const,
    requestId: payload.requestId,
    room: payload.room,
    knownTargetVersion: payload.knownTargetVersion
  };
}

export function parseStage7RealtimeServerFrame(
  input: unknown
): Stage7RealtimeServerFrame | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const frame = input as Partial<Stage7RealtimeServerFrame>;
  if (
    frame.type === "subscribed" &&
    typeof frame.roomId === "string" &&
    frame.refreshRequired === true
  ) {
    return {
      type: "subscribed",
      requestId:
        typeof frame.requestId === "string" ? frame.requestId : undefined,
      roomId: frame.roomId,
      refreshRequired: true
    };
  }
  if (
    frame.type === "rejected" &&
    typeof frame.errorCode === "string" &&
    frame.refreshRequired === true
  ) {
    return {
      type: "rejected",
      requestId:
        typeof frame.requestId === "string" ? frame.requestId : undefined,
      errorCode: frame.errorCode,
      refreshRequired: true
    };
  }
  if (
    frame.type === "hint" &&
    parseStage7RealtimeHint(frame.event) &&
    frame.refreshRequired === true
  ) {
    return {
      type: "hint",
      event: parseStage7RealtimeHint(frame.event) as Stage7RealtimeHintEvent,
      refreshRequired: true
    };
  }
  if (
    frame.type === "subscription_revoked" &&
    typeof frame.roomId === "string" &&
    frame.reason === "PERMISSION_REVOKED" &&
    frame.refreshRequired === true
  ) {
    return {
      type: "subscription_revoked",
      roomId: frame.roomId,
      reason: "PERMISSION_REVOKED",
      refreshRequired: true
    };
  }
  return null;
}

export function parseStage7RealtimeHint(
  input: unknown
): Stage7RealtimeHintEvent | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const event = input as Partial<Stage7RealtimeHintEvent>;
  if (
    event.kind !== "stage7_realtime_hint" ||
    typeof event.eventId !== "string" ||
    !event.eventId ||
    typeof event.serverTime !== "string" ||
    Number.isNaN(Date.parse(event.serverTime)) ||
    typeof event.eventType !== "string" ||
    !event.eventType ||
    typeof event.targetType !== "string" ||
    !event.targetType ||
    typeof event.targetId !== "string" ||
    !event.targetId ||
    typeof event.targetVersion !== "number" ||
    !Number.isInteger(event.targetVersion) ||
    event.targetVersion < 0 ||
    event.refreshRequired !== true
  ) {
    return null;
  }

  return {
    kind: "stage7_realtime_hint",
    eventId: event.eventId,
    serverTime: event.serverTime,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    targetVersion: event.targetVersion,
    refreshRequired: true
  };
}

export function buildStage7RealtimeCompensationRequests(
  apiBaseUrl: string,
  payload: Stage7RealtimeCompensationPayload
): MiniprogramJsonRequestOptions<Record<string, never>>[] {
  const requests: MiniprogramJsonRequestOptions<Record<string, never>>[] = [
    buildStage7UnreadCountRequest(apiBaseUrl, {
      accessToken: payload.accessToken,
      recipientChildId: payload.recipientChildId
    }),
    buildStage7NotificationListRequest(apiBaseUrl, {
      accessToken: payload.accessToken,
      recipientChildId: payload.recipientChildId,
      unreadOnly: true,
      limit: 20
    })
  ];

  if (payload.search) {
    requests.push(
      buildStage7SearchRequest(apiBaseUrl, {
        ...payload.search,
        accessToken: payload.accessToken
      })
    );
  }

  if (payload.transactionId) {
    requests.push(
      buildStage7TransactionDetailCompensationRequest(apiBaseUrl, {
        accessToken: payload.accessToken,
        transactionId: payload.transactionId
      })
    );
  }

  return requests;
}

export function buildStage7NotificationListRequest(
  apiBaseUrl: string,
  payload: Stage7NotificationListPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const params = new URLSearchParams();
  appendOptional(params, "recipientChildId", payload.recipientChildId);
  appendOptional(params, "cursor", payload.cursor);
  if (payload.unreadOnly !== undefined) {
    params.set("unreadOnly", String(payload.unreadOnly));
  }
  if (payload.limit !== undefined) {
    params.set("limit", String(payload.limit));
  }
  const query = params.toString();

  return {
    url: `${buildStage2ApiUrl(apiBaseUrl, "/notifications")}${
      query ? `?${query}` : ""
    }`,
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7UnreadCountRequest(
  apiBaseUrl: string,
  payload: Stage7UnreadCountPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const params = new URLSearchParams();
  appendOptional(params, "recipientChildId", payload.recipientChildId);
  const query = params.toString();

  return {
    url: `${buildStage2ApiUrl(apiBaseUrl, "/notifications/unread-count")}${
      query ? `?${query}` : ""
    }`,
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7MarkNotificationReadRequest(
  apiBaseUrl: string,
  payload: Stage7MarkNotificationReadPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/notifications/${encodeURIComponent(payload.notificationId)}/read`
    ),
    method: "POST",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7MarkAllNotificationsReadRequest(
  apiBaseUrl: string,
  payload: Stage7MarkAllNotificationsReadPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage7MarkAllNotificationsReadPayload, "accessToken">
> {
  const { accessToken, ...data } = payload;
  return {
    url: buildStage2ApiUrl(apiBaseUrl, "/notifications/read-all"),
    method: "POST",
    data,
    header: stage7AuthHeader(accessToken)
  };
}

export function buildStage7NotificationPreferencesRequest(
  apiBaseUrl: string,
  payload: Stage7NotificationPreferencesPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const params = new URLSearchParams();
  appendOptional(params, "recipientChildId", payload.recipientChildId);
  const query = params.toString();

  return {
    url: `${buildStage2ApiUrl(apiBaseUrl, "/notifications/preferences")}${
      query ? `?${query}` : ""
    }`,
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7UpdateNotificationPreferenceRequest(
  apiBaseUrl: string,
  payload: Stage7UpdateNotificationPreferencePayload
): MiniprogramJsonRequestOptions<
  Omit<Stage7UpdateNotificationPreferencePayload, "accessToken" | "eventType">
> {
  const { accessToken, eventType, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/notifications/preferences/${encodeURIComponent(eventType)}`
    ),
    method: "PUT",
    data,
    header: stage7AuthHeader(accessToken)
  };
}

export function buildStage7SearchRequest(
  apiBaseUrl: string,
  payload: Stage7SearchPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const params = new URLSearchParams();
  params.set("childId", payload.childId);
  params.set("communityId", payload.communityId);
  appendOptional(params, "q", payload.q);
  appendOptional(params, "category", payload.category);
  appendOptional(params, "targetType", payload.targetType);
  appendOptional(params, "sort", payload.sort);
  appendOptional(params, "cursor", payload.cursor);
  if (payload.limit !== undefined) {
    params.set("limit", String(payload.limit));
  }

  return {
    url: `${buildStage2ApiUrl(apiBaseUrl, "/stage7/search")}?${params.toString()}`,
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7FavoriteListRequest(
  apiBaseUrl: string,
  payload: Stage7FavoriteListPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const params = new URLSearchParams();
  params.set("childId", payload.childId);
  params.set("communityId", payload.communityId);

  return {
    url: `${buildStage2ApiUrl(apiBaseUrl, "/stage7/favorites/items")}?${params.toString()}`,
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function buildStage7FavoriteItemRequest(
  apiBaseUrl: string,
  payload: Stage7FavoriteItemPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage7FavoriteItemPayload, "accessToken" | "itemId">
> {
  const { accessToken, itemId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/stage7/favorites/items/${encodeURIComponent(itemId)}`
    ),
    method: "POST",
    data,
    header: stage7AuthHeader(accessToken)
  };
}

export function buildStage7RemoveFavoriteItemRequest(
  apiBaseUrl: string,
  payload: Stage7FavoriteItemPayload
): MiniprogramJsonRequestOptions<
  Omit<Stage7FavoriteItemPayload, "accessToken" | "itemId">
> {
  const { accessToken, itemId, ...data } = payload;
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/stage7/favorites/items/${encodeURIComponent(itemId)}/remove`
    ),
    method: "POST",
    data,
    header: stage7AuthHeader(accessToken)
  };
}

export function buildStage7TransactionDetailCompensationRequest(
  apiBaseUrl: string,
  payload: Stage7TransactionDetailCompensationPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  return {
    url: buildStage2ApiUrl(
      apiBaseUrl,
      `/auctions/transactions/${encodeURIComponent(payload.transactionId)}`
    ),
    method: "GET",
    data: {},
    header: stage7AuthHeader(payload.accessToken)
  };
}

export function parseStage7NotificationTarget(input: {
  relatedType?: unknown;
  relatedId?: unknown;
  targetVersion?: unknown;
  actionType?: unknown;
}): Stage7NotificationTarget | null {
  if (typeof input.relatedType !== "string" || !input.relatedType) {
    return null;
  }
  if (typeof input.relatedId !== "string" || !input.relatedId) {
    return null;
  }

  return {
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    targetVersion:
      typeof input.targetVersion === "number" ? input.targetVersion : null,
    actionType: typeof input.actionType === "string" ? input.actionType : null
  };
}

export function resolveStage7NotificationAction(input: {
  actionType?: unknown;
  relatedType?: unknown;
  relatedId?: unknown;
  targetVersion?: unknown;
}): Stage7NotificationTarget | null {
  const target = parseStage7NotificationTarget(input);
  if (!target?.actionType) {
    return null;
  }
  return isStage7ActionType(target.actionType) ? target : null;
}

function appendOptional(
  params: URLSearchParams,
  key: string,
  value: string | undefined
) {
  if (value) {
    params.set(key, value);
  }
}

function stage7AuthHeader(accessToken: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`
  };
}

function isStage7ActionType(actionType: string) {
  return (
    actionType === "view_auction" ||
    actionType === "view_transaction" ||
    actionType === "view_appeal" ||
    actionType === "view_points" ||
    actionType === "open_search_result"
  );
}
