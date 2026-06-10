export const STAGE7_REALTIME_CHANNEL = "stage7:realtime:hints";

export type RealtimeRoomKey =
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

export type RealtimeHintEvent = {
  kind: "stage7_realtime_hint";
  eventId: string;
  serverTime: string;
  eventType: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  refreshRequired: true;
};

export type RealtimeClientMessage = {
  type: "subscribe";
  requestId?: string;
  room: RealtimeRoomKey;
  knownTargetVersion?: number;
};

export type RealtimeServerFrame =
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
      event: RealtimeHintEvent;
      refreshRequired: true;
    }
  | {
      type: "subscription_revoked";
      roomId: string;
      reason: "PERMISSION_REVOKED";
      refreshRequired: true;
    };

export function realtimeRoomId(room: RealtimeRoomKey): string {
  switch (room.kind) {
    case "auction":
      return `auction:${room.childId}:${room.auctionSessionId}`;
    case "transaction":
      return `transaction:${room.childId}:${room.transactionId}`;
    case "notifications":
      return `notifications:${room.childId ?? "__user__"}`;
  }
}

export function parseRealtimeClientMessage(
  input: unknown
): RealtimeClientMessage | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const message = input as Partial<RealtimeClientMessage>;
  if (message.type !== "subscribe" || !isRealtimeRoomKey(message.room)) {
    return null;
  }
  const knownTargetVersion =
    typeof message.knownTargetVersion === "number" &&
    Number.isInteger(message.knownTargetVersion) &&
    message.knownTargetVersion >= 0
      ? message.knownTargetVersion
      : undefined;

  return {
    type: "subscribe",
    requestId:
      typeof message.requestId === "string" ? message.requestId : undefined,
    room: message.room,
    knownTargetVersion
  };
}

export function parseRealtimeHintEvent(input: unknown): RealtimeHintEvent | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const event = input as Partial<RealtimeHintEvent>;
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

export function eventMatchesRoom(
  event: RealtimeHintEvent,
  room: RealtimeRoomKey
) {
  if (room.kind === "auction") {
    return (
      event.targetType === "auction_session" &&
      event.targetId === room.auctionSessionId
    );
  }
  if (room.kind === "transaction") {
    return (
      event.targetType === "transaction" &&
      event.targetId === room.transactionId
    );
  }

  return event.targetType === "notifications";
}

export function isNewerRealtimeHint(
  event: Pick<RealtimeHintEvent, "targetVersion">,
  knownTargetVersion?: number
) {
  return (
    knownTargetVersion === undefined ||
    event.targetVersion > knownTargetVersion
  );
}

function isRealtimeRoomKey(input: unknown): input is RealtimeRoomKey {
  if (!input || typeof input !== "object") {
    return false;
  }
  const room = input as Partial<RealtimeRoomKey>;
  if (room.kind === "auction") {
    return (
      typeof room.childId === "string" &&
      Boolean(room.childId) &&
      typeof room.auctionSessionId === "string" &&
      Boolean(room.auctionSessionId)
    );
  }
  if (room.kind === "transaction") {
    return (
      typeof room.childId === "string" &&
      Boolean(room.childId) &&
      typeof room.transactionId === "string" &&
      Boolean(room.transactionId)
    );
  }
  if (room.kind === "notifications") {
    return room.childId === undefined || typeof room.childId === "string";
  }
  return false;
}
