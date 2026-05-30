import { createHmac, timingSafeEqual } from "node:crypto";

export type CreatePrivateReadGrantInput = {
  mediaAssetId: string;
  storageBucket: string;
  storageKey: string;
  ownerUserId: string;
  granteeUserId: string;
  purpose: string;
  ttlSeconds: number;
  accessPolicyVersion: number;
  now?: Date;
};

export type PrivateReadGrantResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      url: string;
      expiresAt: string;
      accessPolicyVersion: number;
      publicAccess: false;
    }
  | {
      result: "rejected";
      errorCode:
        | "INVALID_TTL"
        | "INVALID_STORAGE_OBJECT"
        | "INVALID_ACCESS_POLICY_VERSION";
    };

export type VerifyPrivateReadGrantResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      granteeUserId: string;
      purpose: string;
      accessPolicyVersion: number;
      expiresAt: string;
    }
  | {
      result: "rejected";
      errorCode: "INVALID_GRANT" | "GRANT_EXPIRED";
    };

export class PrivateObjectStorageService {
  constructor(private readonly signingKey: string) {
    if (!signingKey) {
      throw new Error("OBJECT_STORAGE_KEY_CURRENT must be configured");
    }
  }

  createReadGrant(input: CreatePrivateReadGrantInput): PrivateReadGrantResult {
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < 1 ||
      input.ttlSeconds > 900
    ) {
      return {
        result: "rejected",
        errorCode: "INVALID_TTL"
      };
    }

    if (!input.storageBucket || !input.storageKey || !input.mediaAssetId) {
      return {
        result: "rejected",
        errorCode: "INVALID_STORAGE_OBJECT"
      };
    }

    if (
      !Number.isInteger(input.accessPolicyVersion) ||
      input.accessPolicyVersion < 1
    ) {
      return {
        result: "rejected",
        errorCode: "INVALID_ACCESS_POLICY_VERSION"
      };
    }

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const grantPayload = encodeGrantPayload({
      mediaAssetId: input.mediaAssetId,
      granteeUserId: input.granteeUserId,
      purpose: input.purpose,
      accessPolicyVersion: input.accessPolicyVersion,
      expiresAt: expiresAt.toISOString()
    });
    const grantToken = `${grantPayload}.${signGrantPayload(
      grantPayload,
      this.signingKey
    )}`;

    return {
      result: "accepted",
      mediaAssetId: input.mediaAssetId,
      url: `https://private.local/object-grants/${input.mediaAssetId}?grant=${grantToken}`,
      expiresAt: expiresAt.toISOString(),
      accessPolicyVersion: input.accessPolicyVersion,
      publicAccess: false
    };
  }

  verifyReadGrant(
    grantToken: string,
    now: Date = new Date()
  ): VerifyPrivateReadGrantResult {
    const [encodedPayload, signature, extra] = grantToken.split(".");
    if (!encodedPayload || !signature || extra !== undefined) {
      return {
        result: "rejected",
        errorCode: "INVALID_GRANT"
      };
    }

    const expectedSignature = signGrantPayload(encodedPayload, this.signingKey);
    if (!constantTimeEquals(signature, expectedSignature)) {
      return {
        result: "rejected",
        errorCode: "INVALID_GRANT"
      };
    }

    const payload = decodeGrantPayload(encodedPayload);
    if (!payload) {
      return {
        result: "rejected",
        errorCode: "INVALID_GRANT"
      };
    }

    if (Date.parse(payload.expiresAt) <= now.getTime()) {
      return {
        result: "rejected",
        errorCode: "GRANT_EXPIRED"
      };
    }

    return {
      result: "accepted",
      ...payload
    };
  }
}

type GrantPayload = {
  mediaAssetId: string;
  granteeUserId: string;
  purpose: string;
  accessPolicyVersion: number;
  expiresAt: string;
};

function encodeGrantPayload(payload: GrantPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeGrantPayload(encodedPayload: string): GrantPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<GrantPayload>;

    const accessPolicyVersion = payload.accessPolicyVersion;
    if (
      typeof payload.mediaAssetId !== "string" ||
      typeof payload.granteeUserId !== "string" ||
      typeof payload.purpose !== "string" ||
      typeof accessPolicyVersion !== "number" ||
      !Number.isInteger(accessPolicyVersion) ||
      typeof payload.expiresAt !== "string"
    ) {
      return null;
    }

    return {
      mediaAssetId: payload.mediaAssetId,
      granteeUserId: payload.granteeUserId,
      purpose: payload.purpose,
      accessPolicyVersion,
      expiresAt: payload.expiresAt
    };
  } catch {
    return null;
  }
}

function signGrantPayload(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
