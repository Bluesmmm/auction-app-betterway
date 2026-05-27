const SENSITIVE_FIELD_PATTERN =
  /phone|mobile|address|courier|tracking|storageKey|objectKey|signedUrl|password|secret|token|credential/i;
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;
const SIGNED_URL_PATTERN =
  /https?:\/\/[^\s"]*(signature|token|X-Amz-Signature|grant=|expires=|expiresAt=)[^\s"]*/gi;
const STORAGE_KEY_PATTERN = /\b(?:objects|uploads|private|formal)\/[A-Za-z0-9._/-]{8,}\b/g;

export type RedactedJson =
  | string
  | number
  | boolean
  | null
  | RedactedJson[]
  | { [key: string]: RedactedJson };

export function redactForStructuredLog(value: unknown): RedactedJson {
  return redactValue(value);
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
    .replace(STORAGE_KEY_PATTERN, "[REDACTED_OBJECT_KEY]");
}
