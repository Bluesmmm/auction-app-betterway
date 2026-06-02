import type { PrismaClient } from "@prisma/client";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";

export type VerifyItemImageGrantResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      granteeUserId: string;
      purpose: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "INVALID_GRANT"
        | "GRANT_EXPIRED"
        | "MEDIA_NOT_VISIBLE"
        | "CONTENT_NOT_VISIBLE"
        | "GRANTEE_MISMATCH"
        | "PURPOSE_MISMATCH";
    };

export class ContentFileAccessService {
  private readonly storage: PrivateObjectStorageService;

  constructor(
    private readonly prisma: PrismaClient,
    signingKey: string
  ) {
    this.storage = new PrivateObjectStorageService(signingKey);
  }

  async verifyItemImageGrant(input: {
    grantToken: string;
    granteeUserId: string;
    purpose: string;
    now?: Date;
  }): Promise<VerifyItemImageGrantResult> {
    const grant = this.storage.verifyReadGrant(input.grantToken, input.now);
    if (grant.result === "rejected") {
      return {
        result: "rejected",
        errorCode: grant.errorCode
      };
    }

    if (grant.granteeUserId !== input.granteeUserId) {
      return { result: "rejected", errorCode: "GRANTEE_MISMATCH" };
    }
    if (grant.purpose !== input.purpose) {
      return { result: "rejected", errorCode: "PURPOSE_MISMATCH" };
    }

    const media = await this.prisma.mediaAsset.findUnique({
      where: { id: grant.mediaAssetId }
    });
    if (!media) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const contentVersionBinding = await this.findContentVersionForMedia(media.id);
    if (!contentVersionBinding) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const contentVersion = await this.prisma.contentVersion.findUnique({
      where: { id: contentVersionBinding.contentVersionId }
    });
    if (!contentVersion) {
      return { result: "rejected", errorCode: "CONTENT_NOT_VISIBLE" };
    }

    if (
      contentVersion.status !== "approved" ||
      !(await this.isCurrentVisibleContentVersion({
        contentVersionId: contentVersion.id,
        targetType: contentVersion.targetType,
        purpose: grant.purpose
      }))
    ) {
      return { result: "rejected", errorCode: "CONTENT_NOT_VISIBLE" };
    }

    if (
      media.visibility !== "formal_private" ||
      media.accessPolicyVersion !== grant.accessPolicyVersion ||
      media.revokedAt
    ) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    return {
      result: "accepted",
      mediaAssetId: grant.mediaAssetId,
      granteeUserId: grant.granteeUserId,
      purpose: grant.purpose
    };
  }

  private async isCurrentVisibleContentVersion(input: {
    contentVersionId: string;
    targetType: string;
    purpose: string;
  }): Promise<boolean> {
    if (input.targetType === "item" && input.purpose === "item_image_view") {
      const item = await this.prisma.item.findFirst({
        where: {
          currentPublicVersionId: input.contentVersionId,
          status: "approved"
        },
        select: { id: true }
      });
      return Boolean(item);
    }

    if (
      input.targetType === "wanted_request" &&
      input.purpose === "wanted_image_view"
    ) {
      const wantedPost = await this.prisma.wantedPost.findFirst({
        where: {
          currentPublicVersionId: input.contentVersionId,
          status: "active"
        },
        select: { id: true }
      });
      return Boolean(wantedPost);
    }

    if (
      input.targetType === "wanted_response" &&
      input.purpose === "wanted_response_image_view"
    ) {
      const wantedResponse = await this.prisma.wantedResponse.findFirst({
        where: {
          currentPublicVersionId: input.contentVersionId,
          status: "approved",
          wantedPost: {
            status: "active"
          }
        },
        select: { id: true }
      });
      return Boolean(wantedResponse);
    }

    return false;
  }

  private async findContentVersionForMedia(mediaAssetId: string): Promise<{
    contentVersionId: string;
  } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ contentVersionId: string }>>`
      SELECT "contentVersionId"
      FROM "ContentVersionMedia"
      WHERE "mediaAssetId" = ${mediaAssetId}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}
