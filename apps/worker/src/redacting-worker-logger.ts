const SENSITIVE_FIELD_PATTERN =
  /phone|mobile|address|courier|tracking|storageKey|objectKey|signedUrl|password|secret|token|credential/i;
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;
const SIGNED_URL_PATTERN =
  /https?:\/\/[^\s"]*(signature|token|X-Amz-Signature|grant=|expires=|expiresAt=)[^\s"]*/gi;
const STORAGE_KEY_PATTERN =
  /\b(?:objects|uploads|private|formal)\/[A-Za-z0-9._/-]{8,}(?:\?[^\s"]*)?/g;
const CHINESE_ADDRESS_PATTERN =
  /[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道|路|街|巷|弄)[\u4e00-\u9fa5\d\s-]*(?:号|室|栋|幢|单元)?/g;
const COURIER_TRACKING_PATTERN =
  /\b(?:SF|EMS|JD|JDL|YT|YTO|ZTO|STO|YD|YUNDA|DBL|JT)[A-Z0-9-]{6,24}\b/gi;

export type WorkerLogLevel = "info" | "warn" | "error";

type RedactedJson =
  | string
  | number
  | boolean
  | null
  | RedactedJson[]
  | { [key: string]: RedactedJson };

export class RedactingWorkerLogger {
  serialize(input: {
    level: WorkerLogLevel;
    event: string;
    payload?: unknown;
    now?: Date;
  }): string {
    return JSON.stringify({
      time: (input.now ?? new Date()).toISOString(),
      level: input.level,
      event: input.event,
      payload:
        input.payload === undefined ? undefined : redactValue(input.payload)
    });
  }

  info(event: string, payload?: unknown): void {
    console.log(this.serialize({ level: "info", event, payload }));
  }

  error(event: string, payload?: unknown): void {
    console.error(this.serialize({ level: "error", event, payload }));
  }
}

function redactValue(value: unknown, keyName = ""): RedactedJson {
  if (value === null || value === undefined) {
    return null;
  }

  if (SENSITIVE_FIELD_PATTERN.test(keyName)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactValue(item, key)
      ])
    );
  }

  return String(value);
}

function redactString(value: string): string {
  return value
    .replace(SIGNED_URL_PATTERN, "[REDACTED_URL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(STORAGE_KEY_PATTERN, "[REDACTED_OBJECT_KEY]")
    .replace(CHINESE_ADDRESS_PATTERN, "[REDACTED_ADDRESS]")
    .replace(COURIER_TRACKING_PATTERN, "[REDACTED_COURIER]");
}
