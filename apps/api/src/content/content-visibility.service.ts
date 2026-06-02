import type { PrismaClient } from "@prisma/client";
import type { ChildParticipationService } from "../accounts/child-participation.service.js";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";

export type VisibleItemDetailResult =
  | {
      result: "accepted";
      itemId: string;
      contentVersionId: string;
      versionNo: number;
      title: string;
      description: string;
      images: Array<{
        mediaAssetId: string;
        mediaRole: string;
        sortOrder: number;
        url: string;
        expiresAt: string;
      }>;
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "ITEM_NOT_VISIBLE"
        | "CONTENT_VERSION_NOT_VISIBLE"
        | "MEDIA_NOT_VISIBLE"
        | "PRIVATE_GRANT_FAILED";
    };

export class ContentVisibilityService {
  private readonly storage: PrivateObjectStorageService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly participation: ChildParticipationService,
    signingKey: string
  ) {
    this.storage = new PrivateObjectStorageService(signingKey);
  }

  async getVisibleItemDetail(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    itemId: string;
    now?: Date;
  }): Promise<VisibleItemDetailResult> {
    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.childId,
      communityId: input.communityId,
      action: "browse_community",
      now: input.now
    });
    if (participation.result === "rejected") {
      return {
        result: "rejected",
        errorCode:
          participation.errorCode === "COMMUNITY_MEMBER_REQUIRED"
            ? "COMMUNITY_MEMBER_REQUIRED"
            : "ITEM_NOT_VISIBLE"
      };
    }

    const item = await this.prisma.item.findUnique({
      where: { id: input.itemId }
    });

    if (
      !item ||
      item.communityId !== input.communityId ||
      item.status !== "approved" ||
      !item.currentPublicVersionId
    ) {
      return { result: "rejected", errorCode: "ITEM_NOT_VISIBLE" };
    }

    const contentVersion = await this.prisma.contentVersion.findUnique({
      where: { id: item.currentPublicVersionId }
    });
    if (!contentVersion) {
      return { result: "rejected", errorCode: "CONTENT_VERSION_NOT_VISIBLE" };
    }
    if (contentVersion.status !== "approved") {
      return { result: "rejected", errorCode: "CONTENT_VERSION_NOT_VISIBLE" };
    }

    const media = await this.findVersionMedia(contentVersion.id);
    if (
      media.length !== 4 ||
      media.some((entry) => entry.visibility !== "formal_private")
    ) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const images = [];
    for (const entry of media) {
      const grant = this.storage.createReadGrant({
        mediaAssetId: entry.mediaAssetId,
        storageBucket: entry.storageBucket,
        storageKey: entry.storageKey,
        ownerUserId: entry.ownerUserId,
        granteeUserId: input.actorUserId,
        purpose: "item_image_view",
        ttlSeconds: 300,
        accessPolicyVersion: entry.accessPolicyVersion,
        now: input.now
      });
      if (grant.result === "rejected") {
        return { result: "rejected", errorCode: "PRIVATE_GRANT_FAILED" };
      }

      images.push({
        mediaAssetId: entry.mediaAssetId,
        mediaRole: entry.mediaRole,
        sortOrder: entry.sortOrder,
        url: grant.url,
        expiresAt: grant.expiresAt
      });
    }

    return {
      result: "accepted",
      itemId: item.id,
      contentVersionId: contentVersion.id,
      versionNo: contentVersion.versionNo,
      title: contentVersion.title ?? "",
      description: contentVersion.description ?? "",
      images
    };
  }

  private async findVersionMedia(contentVersionId: string): Promise<
    Array<{
      mediaAssetId: string;
      mediaRole: string;
      sortOrder: number;
      ownerUserId: string;
      storageBucket: string;
      storageKey: string;
      visibility: string;
      accessPolicyVersion: number;
    }>
  > {
    return this.prisma.$queryRaw`
      SELECT
        cvm."mediaAssetId",
        cvm."mediaRole"::text AS "mediaRole",
        cvm."sortOrder",
        ma."ownerUserId",
        ma."storageBucket",
        ma."storageKey",
        ma."visibility"::text AS "visibility",
        ma."accessPolicyVersion"
      FROM "ContentVersionMedia" cvm
      INNER JOIN "MediaAsset" ma ON ma."id" = cvm."mediaAssetId"
      WHERE cvm."contentVersionId" = ${contentVersionId}
      ORDER BY cvm."sortOrder" ASC
    `;
  }
}
