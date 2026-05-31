import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type CreateAccessTokenInput = {
  userId: string;
  sessionId: string;
  expiresAt: Date | string;
};

export type VerifyAccessTokenResult =
  | {
      result: "accepted";
      userId: string;
      sessionId: string;
      expiresAt: string;
    }
  | {
      result: "rejected";
      errorCode: "ACCESS_TOKEN_INVALID" | "ACCESS_TOKEN_EXPIRED";
    };

type AccessTokenPayload = {
  userId: string;
  sessionId: string;
  expiresAt: string;
};

export class SessionTokenService {
  constructor(private readonly signingKey: string) {
    if (!signingKey) {
      throw new Error("AUTH_TOKEN_SIGNING_KEY must be configured");
    }
  }

  createAccessToken(input: CreateAccessTokenInput): string {
    const payload = encodePayload({
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAt: toIsoString(input.expiresAt)
    });

    return `${payload}.${signValue(payload, this.signingKey)}`;
  }

  verifyAccessToken(
    token: string,
    now: Date = new Date()
  ): VerifyAccessTokenResult {
    const [encodedPayload, signature, extra] = token.split(".");
    if (!encodedPayload || !signature || extra !== undefined) {
      return {
        result: "rejected",
        errorCode: "ACCESS_TOKEN_INVALID"
      };
    }

    const expectedSignature = signValue(encodedPayload, this.signingKey);
    if (!constantTimeEquals(signature, expectedSignature)) {
      return {
        result: "rejected",
        errorCode: "ACCESS_TOKEN_INVALID"
      };
    }

    const payload = decodePayload(encodedPayload);
    if (!payload) {
      return {
        result: "rejected",
        errorCode: "ACCESS_TOKEN_INVALID"
      };
    }

    if (Date.parse(payload.expiresAt) <= now.getTime()) {
      return {
        result: "rejected",
        errorCode: "ACCESS_TOKEN_EXPIRED"
      };
    }

    return {
      result: "accepted",
      ...payload
    };
  }

  createRefreshToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashRefreshToken(refreshToken: string): string {
    return signValue(refreshToken, this.signingKey);
  }
}

function encodePayload(payload: AccessTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encodedPayload: string): AccessTokenPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<AccessTokenPayload>;

    if (
      typeof payload.userId !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.expiresAt !== "string"
    ) {
      return null;
    }

    if (Number.isNaN(Date.parse(payload.expiresAt))) {
      return null;
    }

    return {
      userId: payload.userId,
      sessionId: payload.sessionId,
      expiresAt: payload.expiresAt
    };
  } catch {
    return null;
  }
}

function signValue(value: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(value).digest("base64url");
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
