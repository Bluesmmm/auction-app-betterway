import { describe, expect, it } from "vitest";
import { PrivateObjectStorageService } from "../../src/storage/private-object-storage.service.js";

describe("PrivateObjectStorageService", () => {
  it("creates short-lived private grants without exposing raw object keys", () => {
    const service = new PrivateObjectStorageService("test-signing-key");
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

    const grantToken = new URL(result.url).searchParams.get("grant");
    expect(grantToken).toBeTruthy();
    const verified = service.verifyReadGrant(
      grantToken ?? "",
      new Date("2026-05-27T16:10:30.000Z")
    );

    expect(verified).toEqual({
      result: "accepted",
      mediaAssetId: "asset_1",
      granteeUserId: "viewer_1",
      purpose: "item_image_view",
      accessPolicyVersion: 3,
      expiresAt: "2026-05-27T16:11:00.000Z"
    });
  });

  it("rejects permanent or invalid grant durations", () => {
    const service = new PrivateObjectStorageService("test-signing-key");

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

  it("fails fast when the signing key is not configured", () => {
    expect(() => new PrivateObjectStorageService("")).toThrow(
      "OBJECT_STORAGE_KEY_CURRENT must be configured"
    );
  });

  it("rejects tampered or expired private grants", () => {
    const service = new PrivateObjectStorageService("test-signing-key");
    const result = service.createReadGrant({
      mediaAssetId: "asset_1",
      storageBucket: "private-bucket",
      storageKey: "private/children/raw/object-key-123456789.jpg",
      ownerUserId: "owner_1",
      granteeUserId: "viewer_1",
      purpose: "item_image_view",
      ttlSeconds: 60,
      accessPolicyVersion: 1,
      now: new Date("2026-05-27T16:10:00.000Z")
    });

    expect(result.result).toBe("accepted");
    if (result.result !== "accepted") {
      throw new Error("expected grant creation to succeed");
    }

    const grantToken = new URL(result.url).searchParams.get("grant") ?? "";

    expect(service.verifyReadGrant(`${grantToken}x`)).toEqual({
      result: "rejected",
      errorCode: "INVALID_GRANT"
    });
    expect(
      service.verifyReadGrant(
        grantToken,
        new Date("2026-05-27T16:12:00.000Z")
      )
    ).toEqual({
      result: "rejected",
      errorCode: "GRANT_EXPIRED"
    });
  });
});
