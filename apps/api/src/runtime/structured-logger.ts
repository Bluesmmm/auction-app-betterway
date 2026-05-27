import { redactForStructuredLog, type RedactedJson } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type StructuredLogInput = {
  level: LogLevel;
  event: string;
  requestId?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  payload?: unknown;
  now?: Date;
};

export type StructuredLogRecord = {
  time: string;
  level: LogLevel;
  event: string;
  requestId?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  payload?: RedactedJson;
};

export class StructuredLogger {
  createRecord(input: StructuredLogInput): StructuredLogRecord {
    return {
      time: (input.now ?? new Date()).toISOString(),
      level: input.level,
      event: input.event,
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      payload:
        input.payload === undefined
          ? undefined
          : redactForStructuredLog(input.payload)
    };
  }

  serialize(input: StructuredLogInput): string {
    return JSON.stringify(this.createRecord(input));
  }
}
