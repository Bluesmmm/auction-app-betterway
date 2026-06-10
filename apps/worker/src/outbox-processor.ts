export type OutboxJobPayload = {
  outboxEventId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  payloadJson: Record<string, unknown>;
};

export type NotificationSender = {
  send(input: {
    outboxEventId: string;
    eventType: string;
    targetType: string;
    targetId: string;
    idempotencyKey: string;
    payloadJson: Record<string, unknown>;
  }): Promise<
    | { ok: true; providerMessageId: string; mutatesBusinessState: false }
    | { ok: false; errorCode: string; mutatesBusinessState: false }
  >;
};

export type OutboxProcessingResult =
  | {
      result: "sent";
      outboxEventId: string;
      providerMessageId: string;
      mutatesBusinessState: false;
    }
  | {
      result: "failed";
      outboxEventId: string;
      errorCode: string;
      retryable: true;
      mutatesBusinessState: false;
    };

export async function processOutboxNotification(
  payload: OutboxJobPayload,
  sender: NotificationSender
): Promise<OutboxProcessingResult> {
  const sendResult = await sender.send({
    outboxEventId: payload.outboxEventId,
    eventType: payload.eventType,
    targetType: payload.targetType,
    targetId: payload.targetId,
    idempotencyKey: payload.idempotencyKey,
    payloadJson: payload.payloadJson
  });

  if (!sendResult.ok) {
    return {
      result: "failed",
      outboxEventId: payload.outboxEventId,
      errorCode: sendResult.errorCode,
      retryable: true,
      mutatesBusinessState: false
    };
  }

  return {
    result: "sent",
    outboxEventId: payload.outboxEventId,
    providerMessageId: sendResult.providerMessageId,
    mutatesBusinessState: false
  };
}
