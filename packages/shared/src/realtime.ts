export const STAGE7_REALTIME_CHANNEL = "stage7:realtime:hints";

export const RealtimeRoomKind = [
  "auction",
  "transaction",
  "notifications"
] as const;

export type RealtimeRoomKind = (typeof RealtimeRoomKind)[number];

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

export function parseRealtimeHintEvent(
  input: unknown
): RealtimeHintEvent | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const event = input as Partial<RealtimeHintEvent>;
  if (event.kind !== "stage7_realtime_hint") {
    return null;
  }
  if (
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

export function isNewerRealtimeHint(
  event: Pick<RealtimeHintEvent, "targetVersion">,
  knownTargetVersion?: number
) {
  return (
    knownTargetVersion === undefined ||
    event.targetVersion > knownTargetVersion
  );
}
