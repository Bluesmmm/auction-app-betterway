import type { PrismaClient } from "@prisma/client";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";

export type VerifyItemImageGrantResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      granteeUserId: string;
      purpose: string;
      contentVersionId?: string;
      moderationTaskId?: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "INVALID_GRANT"
        | "GRANT_EXPIRED"
        | "MEDIA_NOT_VISIBLE"
        | "CONTENT_NOT_VISIBLE"
        | "REVIEW_TASK_NOT_ACTIVE"
        | "COMMUNITY_ADMIN_REQUIRED"
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

    if (grant.purpose === "content_review_original") {
      return this.verifyContentReviewOriginalGrant({
        mediaAssetId: grant.mediaAssetId,
        granteeUserId: grant.granteeUserId,
        accessPolicyVersion: grant.accessPolicyVersion
      });
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

  private async verifyContentReviewOriginalGrant(input: {
    mediaAssetId: string;
    granteeUserId: string;
    accessPolicyVersion: number;
  }): Promise<VerifyItemImageGrantResult> {
    const media = await this.prisma.mediaAsset.findUnique({
      where: { id: input.mediaAssetId }
    });
    if (!media || media.accessPolicyVersion !== input.accessPolicyVersion || media.revokedAt) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const contentVersionBinding = await this.findContentVersionForMedia(media.id);
    if (!contentVersionBinding) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const contentVersion = await this.prisma.contentVersion.findUnique({
      where: { id: contentVersionBinding.contentVersionId },
      include: { task: true }
    });
    if (!contentVersion || !contentVersion.task) {
      return { result: "rejected", errorCode: "CONTENT_NOT_VISIBLE" };
    }

    if (
      !["pending_ai", "pending_manual", "escalated"].includes(
        contentVersion.status
      ) ||
      !["needs_manual_review", "failed", "escalated"].includes(
        contentVersion.task.status
      )
    ) {
      return { result: "rejected", errorCode: "REVIEW_TASK_NOT_ACTIVE" };
    }

    const communityId = await this.findContentVersionCommunityId({
      targetType: contentVersion.targetType,
      targetId: contentVersion.targetId
    });
    if (
      !communityId ||
      !(await this.canAdminReviewCommunity({
        actorUserId: input.granteeUserId,
        communityId
      }))
    ) {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    return {
      result: "accepted",
      mediaAssetId: input.mediaAssetId,
      granteeUserId: input.granteeUserId,
      purpose: "content_review_original",
      contentVersionId: contentVersion.id,
      moderationTaskId: contentVersion.task.id
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

  private async findContentVersionCommunityId(input: {
    targetType: string;
    targetId: string;
  }): Promise<string | null> {
    if (input.targetType === "item") {
      const item = await this.prisma.item.findUnique({
        where: { id: input.targetId },
        select: { communityId: true }
      });
      return item?.communityId ?? null;
    }
    if (input.targetType === "wanted_request") {
      const wantedPost = await this.prisma.wantedPost.findUnique({
        where: { id: input.targetId },
        select: { communityId: true }
      });
      return wantedPost?.communityId ?? null;
    }
    if (input.targetType === "wanted_response") {
      const wantedResponse = await this.prisma.wantedResponse.findUnique({
        where: { id: input.targetId },
        select: { wantedPost: { select: { communityId: true } } }
      });
      return wantedResponse?.wantedPost.communityId ?? null;
    }
    return null;
  }

  private async canAdminReviewCommunity(input: {
    actorUserId: string;
    communityId: string;
  }): Promise<boolean> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId: input.actorUserId,
        status: "active",
        mfaEnabled: true,
        OR: [
          { role: "platform_admin" },
          {
            role: "activity_admin",
            communityScopes: {
              some: {
                communityId: input.communityId,
                status: "active"
              }
            }
          }
        ]
      },
      select: { id: true }
    });
    return Boolean(admin);
  }
}
