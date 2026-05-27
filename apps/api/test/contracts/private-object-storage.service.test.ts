import { describe, expect, it } from "vitest";
import { PrivateObjectStorageService } from "../../src/storage/private-object-storage.service.js";

describe("PrivateObjectStorageService", () => {
  it("creates short-lived private grants without exposing raw object keys", () => {
    const service = new PrivateObjectStorageService();
    const result = service.createReadGrant({
      mediaAssetId: "asset_1",
      storageBucket: "private-bucket",
      storageKey: "private/children/raw/object-key-123456789.jpg",
      ownerUserId: "owner_1",
      granteeUserId: "viewer_1",
      purpose: "item_image_view",
      ttlSeconds: 60,
      accessPolicyVersion: 3,
      now: new Date("2026-05-27T16:10:00.000Z")
    });

    expect(result.result).toBe("accepted");
    if (result.result !== "accepted") {
      throw new Error("expected grant creation to succeed");
    }
    expect(result.publicAccess).toBe(false);
    expect(result.expiresAt).toBe("2026-05-27T16:11:00.000Z");
    expect(result.accessPolicyVersion).toBe(3);
    expect(result.url).toContain("private.local/object-grants/asset_1");
    expect(result.url).not.toContain("private-bucket");
    expect(result.url).not.toContain("object-key-123456789");
  });

  it("rejects permanent or invalid grant durations", () => {
    const service = new PrivateObjectStorageService();

    expect(
      service.createReadGrant({
        mediaAssetId: "asset_1",
        storageBucket: "private-bucket",
        storageKey: "private/children/raw/object-key-123456789.jpg",
        ownerUserId: "owner_1",
        granteeUserId: "viewer_1",
        purpose: "item_image_view",
        ttlSeconds: 3600,
        accessPolicyVersion: 1
      })
    ).toEqual({
      result: "rejected",
      errorCode: "INVALID_TTL"
    });
  });
});
