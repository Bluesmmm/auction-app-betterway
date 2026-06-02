import type { MediaVisibility, PrismaClient } from "@prisma/client";

export type CreateTempPrivateMediaInput = {
  actorUserId: string;
  storageBucket: string;
  storageKey: string;
  mimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  pixelWidth: number;
  pixelHeight: number;
  checksum: string;
  metadataPrivacyCleared: boolean;
  now?: Date;
};

export type CreateTempPrivateMediaResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      visibility: MediaVisibility;
    }
  | {
      result: "rejected";
      errorCode:
        | "MIME_NOT_ALLOWED"
        | "MIME_MISMATCH"
        | "SVG_NOT_ALLOWED"
        | "IMAGE_TOO_LARGE"
        | "CHECKSUM_REQUIRED"
        | "METADATA_PRIVACY_UNCLEAR"
        | "STORAGE_OBJECT_INVALID";
    };

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSizeBytes = 5 * 1024 * 1024;
const maxPixels = 12_000_000;

export class MediaUploadService {
  constructor(private readonly prisma: PrismaClient) {}

  async createTempPrivateMedia(
    input: CreateTempPrivateMediaInput
  ): Promise<CreateTempPrivateMediaResult> {
    if (!input.storageBucket || !input.storageKey) {
      return { result: "rejected", errorCode: "STORAGE_OBJECT_INVALID" };
    }

    if (
      input.mimeType === "image/svg+xml" ||
      input.detectedMimeType === "image/svg+xml"
    ) {
      return { result: "rejected", errorCode: "SVG_NOT_ALLOWED" };
    }

    if (
      !allowedMimeTypes.has(input.mimeType) ||
      !allowedMimeTypes.has(input.detectedMimeType)
    ) {
      return { result: "rejected", errorCode: "MIME_NOT_ALLOWED" };
    }

    if (input.mimeType !== input.detectedMimeType) {
      return { result: "rejected", errorCode: "MIME_MISMATCH" };
    }

    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > maxSizeBytes ||
      !Number.isInteger(input.pixelWidth) ||
      !Number.isInteger(input.pixelHeight) ||
      input.pixelWidth < 1 ||
      input.pixelHeight < 1 ||
      input.pixelWidth * input.pixelHeight > maxPixels
    ) {
      return { result: "rejected", errorCode: "IMAGE_TOO_LARGE" };
    }

    if (!input.checksum.trim()) {
      return { result: "rejected", errorCode: "CHECKSUM_REQUIRED" };
    }

    if (!input.metadataPrivacyCleared) {
      return { result: "rejected", errorCode: "METADATA_PRIVACY_UNCLEAR" };
    }

    const media = await this.prisma.mediaAsset.create({
      data: {
        ownerUserId: input.actorUserId,
        storageBucket: input.storageBucket,
        storageKey: input.storageKey,
        visibility: "temp_private",
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        createdAt: input.now ?? new Date()
      }
    });

    return {
      result: "accepted",
      mediaAssetId: media.id,
      visibility: media.visibility
    };
  }
}
