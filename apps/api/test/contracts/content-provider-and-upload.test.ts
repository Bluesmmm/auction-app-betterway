import { describe, expect, it } from "vitest";
import { MediaUploadService } from "../../src/content/media-upload.service.js";
import { FakeContentSafetyProvider } from "../../src/providers/fake-providers.js";

const prisma = {
  mediaAsset: {
    create: async ({ data }: { data: Record<string, unknown> }) => ({
      id: "asset_stage3_1",
      ...data
    })
  }
};

describe("Stage 3 fake content provider", () => {
  it("simulates risk levels and structured image signals", async () => {
    const provider = new FakeContentSafetyProvider();

    await expect(
      provider.reviewContent({
        text: "普通玩具",
        media: [{ mediaAssetId: "m1", checksum: "risk:low" }]
      })
    ).resolves.toEqual(
      expect.objectContaining({ ok: true, riskLevel: "low", labels: [] })
    );

    await expect(
      provider.reviewContent({
        text: "这里有电话",
        media: [{ mediaAssetId: "m1", checksum: "risk:medium:ocr-contact" }]
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        riskLevel: "high",
        labels: expect.arrayContaining(["contact_info", "ocr_contact"])
      })
    );

    await expect(
      provider.reviewContent({
        text: "药",
        media: [{ mediaAssetId: "m1", checksum: "risk:severe:qr" }]
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        riskLevel: "severe",
        labels: expect.arrayContaining(["prohibited_item", "qr_or_barcode"])
      })
    );
  });

  it("fails closed for provider failure mode", async () => {
    const provider = new FakeContentSafetyProvider({ mode: "failure" });

    await expect(
      provider.reviewContent({ text: "普通玩具", media: [] })
    ).resolves.toEqual({
      ok: false,
      errorCode: "CONTENT_SAFETY_UNAVAILABLE",
      failureClosesBusiness: true
    });
  });
});

describe("MediaUploadService", () => {
  it("creates temp private media for valid local compressed images", async () => {
    const service = new MediaUploadService(prisma as never);

    await expect(
      service.createTempPrivateMedia({
        actorUserId: "user_1",
        storageBucket: "private-stage3",
        storageKey: "temp/user_1/photo.jpg",
        mimeType: "image/jpeg",
        detectedMimeType: "image/jpeg",
        sizeBytes: 300_000,
        pixelWidth: 1200,
        pixelHeight: 900,
        checksum: "sha256:abc",
        metadataPrivacyCleared: true,
        now: new Date("2026-06-02T10:00:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        mediaAssetId: "asset_stage3_1",
        visibility: "temp_private"
      })
    );
  });

  it("rejects format and resource risks before moderation", async () => {
    const service = new MediaUploadService(prisma as never);

    await expect(
      service.createTempPrivateMedia({
        actorUserId: "user_1",
        storageBucket: "private-stage3",
        storageKey: "temp/user_1/vector.svg",
        mimeType: "image/svg+xml",
        detectedMimeType: "image/svg+xml",
        sizeBytes: 100,
        pixelWidth: 100,
        pixelHeight: 100,
        checksum: "sha256:svg",
        metadataPrivacyCleared: true
      })
    ).resolves.toEqual({ result: "rejected", errorCode: "SVG_NOT_ALLOWED" });
  });
});
