import { Redis } from "ioredis";
import type { RedisConnectionConfig } from "./worker-config.js";

export const STAGE7_REALTIME_CHANNEL = "stage7:realtime:hints";

export type RealtimeHintEvent = {
  kind: "stage7_realtime_hint";
  eventId: string;
  serverTime: string;
  eventType: string;
  targetType: "auction_session" | "transaction";
  targetId: string;
  targetVersion: number;
  refreshRequired: true;
};

export type RealtimeHintTarget = Pick<
  RealtimeHintEvent,
  "targetType" | "targetId"
>;

export type OutboxRealtimeSourceEvent = {
  id: string;
  eventType: string;
  targetType: string;
  targetId: string;
  payloadJson: unknown;
};

export type RealtimeHintPublishResult =
  | {
      ok: true;
      mutatesBusinessState: false;
    }
  | {
      ok: false;
      errorCode: "REALTIME_HINT_PUBLISH_FAILED";
      mutatesBusinessState: false;
    };

export type RealtimeHintPublisher = {
  publish(event: RealtimeHintEvent): Promise<RealtimeHintPublishResult>;
  close?(): Promise<void>;
};

type RedisRealtimeClient = {
  publish(channel: string, message: string): Promise<number> | number;
  quit?(): Promise<unknown>;
};

const realtimeAuctionEvents = new Set([
  "auction.bid_accepted",
  "auction.bid_outbid",
  "auction.bid_withdrawn",
  "auction.settled",
  "auction.unsold",
  "auction.cancelled"
]);

const realtimeTransactionEvents = new Set([
  "transaction.guardian_confirmed",
  "transaction.cancelled",
  "transaction.completed",
  "transaction.disputed",
  "transaction.platform_review_required"
]);

export class RedisRealtimeHintPublisher implements RealtimeHintPublisher {
  constructor(private readonly redis: RedisRealtimeClient) {}

  async publish(event: RealtimeHintEvent): Promise<RealtimeHintPublishResult> {
    try {
      await this.redis.publish(
        STAGE7_REALTIME_CHANNEL,
        JSON.stringify(event)
      );
      return {
        ok: true,
        mutatesBusinessState: false
      };
    } catch {
      return {
        ok: false,
        errorCode: "REALTIME_HINT_PUBLISH_FAILED",
        mutatesBusinessState: false
      };
    }
  }

  async close() {
    await this.redis.quit?.();
  }
}

export function createRedisRealtimeHintPublisher(input: {
  connection: RedisConnectionConfig;
}) {
  return new RedisRealtimeHintPublisher(new Redis(input.connection));
}

export async function buildRealtimeHintFromOutboxEvent(
  event: OutboxRealtimeSourceEvent,
  input: {
    now: Date;
    loadTargetVersion?: (
      target: RealtimeHintTarget
    ) => Promise<number | null> | number | null;
  }
): Promise<RealtimeHintEvent | null> {
  const payload = asPayloadRecord(event.payloadJson);
  const target = resolveRealtimeTarget(event, payload);
  if (!target) {
    return null;
  }

  const targetVersion =
    readTargetVersion(payload) ??
    (await input.loadTargetVersion?.(target)) ??
    0;

  return {
    kind: "stage7_realtime_hint",
    eventId: event.id,
    serverTime: input.now.toISOString(),
    eventType: event.eventType,
    targetType: target.targetType,
    targetId: target.targetId,
    targetVersion,
    refreshRequired: true
  };
}

function resolveRealtimeTarget(
  event: OutboxRealtimeSourceEvent,
  payload: Record<string, unknown>
): RealtimeHintTarget | null {
  if (realtimeAuctionEvents.has(event.eventType)) {
    const auctionSessionId =
      readString(payload.auctionSessionId) ??
      (event.targetType === "auction_session" ? event.targetId : null);
    return auctionSessionId
      ? {
          targetType: "auction_session",
          targetId: auctionSessionId
        }
      : null;
  }

  if (realtimeTransactionEvents.has(event.eventType)) {
    const transactionId =
      readString(payload.transactionId) ??
      (event.targetType === "transaction" ? event.targetId : null);
    return transactionId
      ? {
          targetType: "transaction",
          targetId: transactionId
        }
      : null;
  }

  return null;
}

function readTargetVersion(payload: Record<string, unknown>) {
  return (
    readVersionNumber(payload.targetVersion) ??
    readVersionNumber(payload.version) ??
    readVersionNumber(payload.auctionVersion) ??
    readVersionNumber(payload.transactionVersion)
  );
}

function readVersionNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asPayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
