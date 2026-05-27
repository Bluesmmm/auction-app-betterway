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

export class PrivateObjectStorageService {
  createReadGrant(input: CreatePrivateReadGrantInput): PrivateReadGrantResult {
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 900) {
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
    const grantToken = Buffer.from(
      JSON.stringify({
        mediaAssetId: input.mediaAssetId,
        granteeUserId: input.granteeUserId,
        purpose: input.purpose,
        accessPolicyVersion: input.accessPolicyVersion,
        expiresAt: expiresAt.toISOString()
      })
    ).toString("base64url");

    return {
      result: "accepted",
      mediaAssetId: input.mediaAssetId,
      url: `https://private.local/object-grants/${input.mediaAssetId}?grant=${grantToken}`,
      expiresAt: expiresAt.toISOString(),
      accessPolicyVersion: input.accessPolicyVersion,
      publicAccess: false
    };
  }
}
