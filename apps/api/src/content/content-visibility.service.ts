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

export type VisibleWantedPostDetailResult =
  | {
      result: "accepted";
      wantedPostId: string;
      contentVersionId: string;
      versionNo: number;
      title: string;
      description: string;
      category: string | null;
      images: VisibleContentImage[];
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "WANTED_POST_NOT_VISIBLE"
        | "CONTENT_VERSION_NOT_VISIBLE"
        | "MEDIA_NOT_VISIBLE"
        | "PRIVATE_GRANT_FAILED";
    };

export type VisibleWantedResponseDetailResult =
  | {
      result: "accepted";
      wantedResponseId: string;
      wantedPostId: string;
      contentVersionId: string;
      versionNo: number;
      title: string;
      description: string;
      images: VisibleContentImage[];
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "WANTED_RESPONSE_NOT_VISIBLE"
        | "CONTENT_VERSION_NOT_VISIBLE"
        | "MEDIA_NOT_VISIBLE"
        | "PRIVATE_GRANT_FAILED";
    };

type VisibleContentImage = {
  mediaAssetId: string;
  mediaRole: string;
  sortOrder: number;
  url: string;
  expiresAt: string;
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

    const images = this.createImageGrants({
      media,
      actorUserId: input.actorUserId,
      purpose: "item_image_view",
      now: input.now
    });
    if (!images) {
      return { result: "rejected", errorCode: "PRIVATE_GRANT_FAILED" };
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

  async getVisibleWantedPostDetail(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    wantedPostId: string;
    now?: Date;
  }): Promise<VisibleWantedPostDetailResult> {
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
            : "WANTED_POST_NOT_VISIBLE"
      };
    }

    const wantedPost = await this.prisma.wantedPost.findUnique({
      where: { id: input.wantedPostId }
    });
    if (
      !wantedPost ||
      wantedPost.communityId !== input.communityId ||
      wantedPost.status !== "active" ||
      !wantedPost.currentPublicVersionId
    ) {
      return { result: "rejected", errorCode: "WANTED_POST_NOT_VISIBLE" };
    }

    const contentVersion = await this.prisma.contentVersion.findUnique({
      where: { id: wantedPost.currentPublicVersionId }
    });
    if (!contentVersion || contentVersion.status !== "approved") {
      return { result: "rejected", errorCode: "CONTENT_VERSION_NOT_VISIBLE" };
    }

    const media = await this.findVersionMedia(contentVersion.id);
    if (
      media.length !== 4 ||
      media.some((entry) => entry.visibility !== "formal_private")
    ) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const images = this.createImageGrants({
      media,
      actorUserId: input.actorUserId,
      purpose: "wanted_image_view",
      now: input.now
    });
    if (!images) {
      return { result: "rejected", errorCode: "PRIVATE_GRANT_FAILED" };
    }

    return {
      result: "accepted",
      wantedPostId: wantedPost.id,
      contentVersionId: contentVersion.id,
      versionNo: contentVersion.versionNo,
      title: contentVersion.title ?? "",
      description: contentVersion.description ?? "",
      category: wantedPost.category,
      images
    };
  }

  async getVisibleWantedResponseDetail(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    wantedResponseId: string;
    now?: Date;
  }): Promise<VisibleWantedResponseDetailResult> {
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
            : "WANTED_RESPONSE_NOT_VISIBLE"
      };
    }

    const wantedResponse = await this.prisma.wantedResponse.findUnique({
      where: { id: input.wantedResponseId },
      include: { wantedPost: true }
    });
    if (
      !wantedResponse ||
      wantedResponse.wantedPost.communityId !== input.communityId ||
      wantedResponse.wantedPost.status !== "active" ||
      wantedResponse.status !== "approved" ||
      !wantedResponse.currentPublicVersionId
    ) {
      return { result: "rejected", errorCode: "WANTED_RESPONSE_NOT_VISIBLE" };
    }

    const contentVersion = await this.prisma.contentVersion.findUnique({
      where: { id: wantedResponse.currentPublicVersionId }
    });
    if (!contentVersion || contentVersion.status !== "approved") {
      return { result: "rejected", errorCode: "CONTENT_VERSION_NOT_VISIBLE" };
    }

    const media = await this.findVersionMedia(contentVersion.id);
    if (
      media.length !== 4 ||
      media.some((entry) => entry.visibility !== "formal_private")
    ) {
      return { result: "rejected", errorCode: "MEDIA_NOT_VISIBLE" };
    }

    const images = this.createImageGrants({
      media,
      actorUserId: input.actorUserId,
      purpose: "wanted_response_image_view",
      now: input.now
    });
    if (!images) {
      return { result: "rejected", errorCode: "PRIVATE_GRANT_FAILED" };
    }

    return {
      result: "accepted",
      wantedResponseId: wantedResponse.id,
      wantedPostId: wantedResponse.wantedPostId,
      contentVersionId: contentVersion.id,
      versionNo: contentVersion.versionNo,
      title: contentVersion.title ?? "",
      description: contentVersion.description ?? "",
      images
    };
  }

  private createImageGrants(input: {
    media: Awaited<ReturnType<ContentVisibilityService["findVersionMedia"]>>;
    actorUserId: string;
    purpose: string;
    now?: Date;
  }): VisibleContentImage[] | null {
    const images: VisibleContentImage[] = [];
    for (const entry of input.media) {
      const grant = this.storage.createReadGrant({
        mediaAssetId: entry.mediaAssetId,
        storageBucket: entry.storageBucket,
        storageKey: entry.storageKey,
        ownerUserId: entry.ownerUserId,
        granteeUserId: input.actorUserId,
        purpose: input.purpose,
        ttlSeconds: 300,
        accessPolicyVersion: entry.accessPolicyVersion,
        now: input.now
      });
      if (grant.result === "rejected") {
        return null;
      }

      images.push({
        mediaAssetId: entry.mediaAssetId,
        mediaRole: entry.mediaRole,
        sortOrder: entry.sortOrder,
        url: grant.url,
        expiresAt: grant.expiresAt
      });
    }
    return images;
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
