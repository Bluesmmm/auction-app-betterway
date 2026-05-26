export type IdempotencyFingerprintInput = {
  idempotencyKey: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  requestHash: string;
};

export type IdempotencyFingerprint = IdempotencyFingerprintInput & {
  conflictsWith(other: IdempotencyFingerprintInput): boolean;
};

export function createIdempotencyFingerprint(
  input: IdempotencyFingerprintInput
): IdempotencyFingerprint {
  return {
    ...input,
    conflictsWith(other) {
      return (
        input.idempotencyKey === other.idempotencyKey &&
        input.actorId === other.actorId &&
        input.action === other.action &&
        input.targetType === other.targetType &&
        input.targetId === other.targetId &&
        input.requestHash !== other.requestHash
      );
    }
  };
}
