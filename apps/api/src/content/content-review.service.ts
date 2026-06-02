import type {
  ContentVersion,
  Item,
  ModerationTask,
  Prisma,
  PrismaClient,
  WantedPost,
  WantedResponse
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ChildParticipationService } from "../accounts/child-participation.service.js";
import type { CommunityAdminAuthorizationService } from "../communities/community-admin-authorization.service.js";
import type {
  ContentSafetyProvider,
  RiskLevel
} from "../providers/provider-contracts.js";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";

export type ItemImageInput = {
  mediaAssetId: string;
  mediaRole: ContentMediaRole;
  sortOrder: number;
};

export type ContentMediaRole = "front" | "back" | "side" | "detail" | "avatar";

export type SubmitItemInput = {
  actorUserId: string;
  childId: string;
  communityId: string;
  title: string;
  description: string;
  startPoints: number;
  minIncrementPoints: number;
  images: ItemImageInput[];
  idempotencyKey: string;
  now?: Date;
};

export type SubmitWantedPostInput = {
  actorUserId: string;
  childId: string;
  communityId: string;
  title: string;
  description: string;
  category?: string;
  images: ItemImageInput[];
  idempotencyKey: string;
  now?: Date;
};

export type EditWantedPostInput = SubmitWantedPostInput & {
  wantedPostId: string;
};

export type SubmitWantedResponseInput = {
  actorUserId: string;
  responderChildId: string;
  communityId: string;
  wantedPostId: string;
  title: string;
  description: string;
  images: ItemImageInput[];
  idempotencyKey: string;
  now?: Date;
};

export type SubmitItemResult =
  | {
      result: "accepted";
      itemId: string;
      itemStatus: "ai_reviewing";
      contentVersionId: string;
      contentVersionStatus: "pending_ai";
      moderationTaskId: string;
      moderationTaskStatus: "pending";
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "GUARDIAN_CONTROL_DISABLED"
        | "PUBLISH_NOT_ALLOWED"
        | "IMAGE_COUNT_INVALID"
        | "IMAGE_ROLES_INVALID"
        | "MEDIA_NOT_TEMP_PRIVATE"
        | "MEDIA_OWNER_INVALID"
        | "MEDIA_ALREADY_CONSUMED"
        | "POINTS_INVALID"
        | "IDEMPOTENCY_KEY_REQUIRED";
    };

export type SubmitWantedPostResult =
  | {
      result: "accepted";
      wantedPostId: string;
      wantedPostStatus: "ai_reviewing";
      contentVersionId: string;
      contentVersionStatus: "pending_ai";
      moderationTaskId: string;
      moderationTaskStatus: "pending";
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "GUARDIAN_CONTROL_DISABLED"
        | "PUBLISH_NOT_ALLOWED"
        | "IMAGE_COUNT_INVALID"
        | "IMAGE_ROLES_INVALID"
        | "MEDIA_NOT_TEMP_PRIVATE"
        | "MEDIA_OWNER_INVALID"
        | "MEDIA_ALREADY_CONSUMED"
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "WANTED_POST_NOT_FOUND"
        | "WANTED_POST_NOT_EDITABLE";
    };

export type SubmitWantedResponseResult =
  | {
      result: "accepted";
      wantedResponseId: string;
      wantedResponseStatus: "reviewing";
      contentVersionId: string;
      contentVersionStatus: "pending_ai";
      moderationTaskId: string;
      moderationTaskStatus: "pending";
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "GUARDIAN_CONTROL_DISABLED"
        | "PUBLISH_NOT_ALLOWED"
        | "IMAGE_COUNT_INVALID"
        | "IMAGE_ROLES_INVALID"
        | "MEDIA_NOT_TEMP_PRIVATE"
        | "MEDIA_OWNER_INVALID"
        | "MEDIA_ALREADY_CONSUMED"
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "WANTED_POST_NOT_VISIBLE";
    };

export type EditItemInput = Omit<
  SubmitItemInput,
  "startPoints" | "minIncrementPoints"
> & {
  itemId: string;
};

export type EditItemResult =
  | {
      result: "accepted";
      itemId: string;
      contentVersionId: string;
      versionNo: number;
      contentVersionStatus: "pending_ai";
      moderationTaskId: string;
      moderationTaskStatus: "pending";
    }
  | Extract<SubmitItemResult, { result: "rejected" }>
  | {
      result: "rejected";
      errorCode: "ITEM_NOT_FOUND" | "ITEM_NOT_EDITABLE";
    };

export type ReviewDecision = "approve" | "reject" | "escalate";
export type PlatformReviewDecision = "block" | "reject";

export type ModerationActionResult =
  | {
      result: "accepted";
      taskStatus: string;
      contentVersionStatus: string;
      errorCode?: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "MODERATION_TASK_NOT_FOUND"
        | "MODERATION_TASK_STATE_INVALID"
        | "COMMUNITY_ADMIN_REQUIRED"
        | "HIGH_RISK_REQUIRES_ESCALATION"
        | "FAILED_TASK_REQUIRES_RETRY"
        | "PLATFORM_ADMIN_REQUIRED"
        | "PLATFORM_DECISION_INVALID"
        | "REASON_REQUIRED";
    };

export type DelistItemResult =
  | {
      result: "accepted";
      itemId: string;
      itemStatus: "delisted";
    }
  | {
      result: "rejected";
      errorCode: "ITEM_NOT_FOUND" | "COMMUNITY_ADMIN_REQUIRED" | "REASON_REQUIRED";
    };

export type DelistWantedPostResult =
  | {
      result: "accepted";
      wantedPostId: string;
      wantedPostStatus: "delisted";
    }
  | {
      result: "rejected";
      errorCode:
        | "WANTED_POST_NOT_FOUND"
        | "COMMUNITY_ADMIN_REQUIRED"
        | "REASON_REQUIRED";
    };

export type CancelWantedResponseResult =
  | {
      result: "accepted";
      wantedResponseId: string;
      wantedResponseStatus: "cancelled";
    }
  | {
      result: "rejected";
      errorCode:
        | "WANTED_RESPONSE_NOT_FOUND"
        | "COMMUNITY_ADMIN_REQUIRED"
        | "REASON_REQUIRED";
    };

export type ContentReviewQueueResult =
  | {
      result: "accepted";
      tasks: Array<{
        key: string;
        taskId: string;
        contentVersionId: string;
        targetType: string;
        targetId: string;
        itemId?: string;
        wantedPostId?: string;
        wantedResponseId?: string;
        versionNo: number;
        title: string;
        taskStatus: string;
        riskLevel: string;
        createdAt: string;
      }>;
    }
  | {
      result: "rejected";
      errorCode: "COMMUNITY_ADMIN_REQUIRED";
    };

export type ContentReviewTaskDetailResult =
  | {
      result: "accepted";
      taskId: string;
      contentVersionId: string;
      targetType: string;
      targetId: string;
      itemId?: string;
      wantedPostId?: string;
      wantedResponseId?: string;
      parentWantedPostId?: string;
      versionNo: number;
      title: string;
      description: string;
      taskStatus: string;
      riskLevel: string;
      ruleTags: unknown;
      aiEvidence: Array<{
        provider: string;
        providerStatus: string;
        riskLevel: string | null;
        labels: unknown;
        ocrText: string | null;
        qrOrBarcodeDetected: boolean;
        metadataFindings: unknown;
        failureReason: string | null;
        createdAt: string;
      }>;
      originalImageGrants: Array<{
        mediaAssetId: string;
        mediaRole: string;
        sortOrder: number;
        url: string;
        expiresAt: string;
      }>;
      versionDiff: {
        previousApprovedVersion: {
          contentVersionId: string;
          versionNo: number;
          title: string;
          description: string;
          payload: unknown;
        } | null;
        currentSubmittedVersion: {
          contentVersionId: string;
          versionNo: number;
          title: string;
          description: string;
          payload: unknown;
        };
        changedFields: string[];
      };
      historyContext: Array<{
        targetType: string;
        targetId: string;
        contentVersionId: string;
        versionNo: number;
        title: string;
        status: string;
        riskLevel: string | null;
        createdAt: string;
      }>;
      images: Array<{
        mediaAssetId: string;
        mediaRole: string;
        sortOrder: number;
      }>;
    }
  | {
      result: "rejected";
      errorCode: "COMMUNITY_ADMIN_REQUIRED" | "MODERATION_TASK_NOT_FOUND";
    };

const itemImageRoles: ContentMediaRole[] = ["front", "back", "side", "detail"];
const highRiskLevels = new Set(["high", "severe"]);

type ModerationTaskWithVersion = ModerationTask & {
  contentVersion: ContentVersion;
};

type ReviewTarget =
  | { targetType: "item"; target: Item; communityId: string; status: string }
  | {
      targetType: "wanted_request";
      target: WantedPost;
      communityId: string;
      status: string;
    }
  | {
      targetType: "wanted_response";
      target: WantedResponse & { wantedPost: WantedPost };
      communityId: string;
      status: string;
    };

export class ContentReviewService {
  private readonly reviewStorage: PrivateObjectStorageService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly participation: ChildParticipationService,
    private readonly adminAuthorizations: CommunityAdminAuthorizationService,
    private readonly contentSafety: ContentSafetyProvider,
    reviewGrantSigningKey = "stage3-object-grant-key"
  ) {
    this.reviewStorage = new PrivateObjectStorageService(reviewGrantSigningKey);
  }

  async listModerationQueue(input: {
    actorUserId: string;
    communityId: string;
  }): Promise<ContentReviewQueueResult> {
    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: input.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const tasks = await this.prisma.moderationTask.findMany({
      where: {
        status: { in: ["needs_manual_review", "failed", "escalated"] }
      },
      include: { contentVersion: true },
      orderBy: { id: "asc" }
    });

    const scopedTasks = [];
    for (const task of tasks) {
      const target = await this.resolveReviewTarget(task.contentVersion);
      if (target?.communityId === input.communityId) {
        scopedTasks.push({ task, target });
      }
    }

    return {
      result: "accepted",
      tasks: scopedTasks
        .map(({ task, target }) => ({
          key: task.id,
          taskId: task.id,
          contentVersionId: task.contentVersionId,
          targetType: task.contentVersion.targetType,
          targetId: task.contentVersion.targetId,
          ...this.targetIdentityFields(target),
          versionNo: task.contentVersion.versionNo,
          title: task.contentVersion.title ?? "",
          taskStatus: task.status,
          riskLevel:
            task.providerRiskLevel ?? task.contentVersion.riskLevel ?? "unknown",
          createdAt: task.contentVersion.createdAt.toISOString()
        }))
    };
  }

  async getModerationTask(input: {
    actorUserId: string;
    taskId: string;
  }): Promise<ContentReviewTaskDetailResult> {
    const task = await this.prisma.moderationTask.findUnique({
      where: { id: input.taskId },
      include: { contentVersion: true }
    });
    if (!task) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    const target = await this.resolveReviewTarget(task.contentVersion);
    if (!target) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: target.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const images = await this.findVersionMediaForDetail(task.contentVersionId);
    return {
      result: "accepted",
      taskId: task.id,
      contentVersionId: task.contentVersionId,
      targetType: task.contentVersion.targetType,
      targetId: task.contentVersion.targetId,
      ...this.targetIdentityFields(target),
      versionNo: task.contentVersion.versionNo,
      title: task.contentVersion.title ?? "",
      description: task.contentVersion.description ?? "",
      taskStatus: task.status,
      riskLevel:
        task.providerRiskLevel ?? task.contentVersion.riskLevel ?? "unknown",
      ruleTags: task.ruleTagsJson,
      aiEvidence: await this.findAiEvidence(task.id),
      originalImageGrants: await this.createReviewImageGrants({
        media: await this.findVersionMediaForReview(task.contentVersionId),
        granteeUserId: input.actorUserId
      }),
      versionDiff: await this.buildVersionDiff(task.contentVersion),
      historyContext: await this.findHistoryContext({
        target,
        currentContentVersionId: task.contentVersionId
      }),
      images
    };
  }

  async submitItem(input: SubmitItemInput): Promise<SubmitItemResult> {
    const now = input.now ?? new Date();
    const participation = await this.ensureCanPublish(input, now);
    if (participation.result === "rejected") {
      return participation;
    }

    const imageValidation = await this.validateItemImages({
      actorUserId: input.actorUserId,
      images: input.images
    });
    if (imageValidation.result === "rejected") {
      return imageValidation;
    }
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }
    if (input.startPoints <= 0 || input.minIncrementPoints <= 0) {
      return { result: "rejected", errorCode: "POINTS_INVALID" };
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          communityId: input.communityId,
          sellerChildId: input.childId,
          status: "ai_reviewing",
          startPoints: input.startPoints,
          minIncrementPoints: input.minIncrementPoints
        }
      });
      const contentVersion = await tx.contentVersion.create({
        data: {
          targetType: "item",
          targetId: item.id,
          versionNo: 1,
          status: "pending_ai",
          title: input.title,
          description: input.description,
          payloadJson: {
            title: input.title,
            description: input.description,
            startPoints: input.startPoints,
            minIncrementPoints: input.minIncrementPoints
          }
        }
      });
      await insertContentVersionMedia(tx, contentVersion.id, input.images);
      const task = await tx.moderationTask.create({
        data: {
          contentVersionId: contentVersion.id,
          status: "pending"
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          latestVersionId: contentVersion.id
        }
      });

      return {
        result: "accepted",
        itemId: item.id,
        itemStatus: "ai_reviewing",
        contentVersionId: contentVersion.id,
        contentVersionStatus: "pending_ai",
        moderationTaskId: task.id,
        moderationTaskStatus: "pending"
      };
    });
  }

  async editItem(input: EditItemInput): Promise<EditItemResult> {
    const now = input.now ?? new Date();
    const item = await this.prisma.item.findUnique({
      where: { id: input.itemId }
    });
    if (!item || item.communityId !== input.communityId || item.sellerChildId !== input.childId) {
      return { result: "rejected", errorCode: "ITEM_NOT_FOUND" };
    }
    if (item.status === "delisted" || item.status === "withdrawn") {
      return { result: "rejected", errorCode: "ITEM_NOT_EDITABLE" };
    }

    const participation = await this.ensureCanPublish(input, now);
    if (participation.result === "rejected") {
      return participation;
    }
    const imageValidation = await this.validateItemImages({
      actorUserId: input.actorUserId,
      images: input.images
    });
    if (imageValidation.result === "rejected") {
      return imageValidation;
    }
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    const version = await this.prisma.contentVersion.aggregate({
      where: {
        targetType: "item",
        targetId: item.id
      },
      _max: {
        versionNo: true
      }
    });
    const versionNo = (version._max.versionNo ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const contentVersion = await tx.contentVersion.create({
        data: {
          targetType: "item",
          targetId: item.id,
          versionNo,
          status: "pending_ai",
          title: input.title,
          description: input.description,
          payloadJson: {
            title: input.title,
            description: input.description
          }
        }
      });
      await insertContentVersionMedia(tx, contentVersion.id, input.images);
      const task = await tx.moderationTask.create({
        data: {
          contentVersionId: contentVersion.id,
          status: "pending"
        }
      });
      await tx.item.update({
        where: { id: item.id },
        data: {
          latestVersionId: contentVersion.id,
          status: item.currentPublicVersionId ? item.status : "ai_reviewing"
        }
      });

      return {
        result: "accepted",
        itemId: item.id,
        contentVersionId: contentVersion.id,
        versionNo,
        contentVersionStatus: "pending_ai",
        moderationTaskId: task.id,
        moderationTaskStatus: "pending"
      };
    });
  }

  async submitWantedPost(
    input: SubmitWantedPostInput
  ): Promise<SubmitWantedPostResult> {
    const now = input.now ?? new Date();
    const participation = await this.ensureCanPublish(input, now);
    if (participation.result === "rejected") {
      return participation;
    }

    const imageValidation = await this.validateItemImages({
      actorUserId: input.actorUserId,
      images: input.images
    });
    if (imageValidation.result === "rejected") {
      return imageValidation;
    }
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    return this.prisma.$transaction(async (tx) => {
      const wantedPost = await tx.wantedPost.create({
        data: {
          communityId: input.communityId,
          childId: input.childId,
          category: input.category,
          status: "ai_reviewing"
        }
      });
      const contentVersion = await tx.contentVersion.create({
        data: {
          targetType: "wanted_request",
          targetId: wantedPost.id,
          versionNo: 1,
          status: "pending_ai",
          title: input.title,
          description: input.description,
          payloadJson: {
            title: input.title,
            description: input.description,
            category: input.category ?? null
          }
        }
      });
      await insertContentVersionMedia(tx, contentVersion.id, input.images);
      const task = await tx.moderationTask.create({
        data: {
          contentVersionId: contentVersion.id,
          status: "pending"
        }
      });
      await tx.wantedPost.update({
        where: { id: wantedPost.id },
        data: {
          latestVersionId: contentVersion.id
        }
      });

      return {
        result: "accepted",
        wantedPostId: wantedPost.id,
        wantedPostStatus: "ai_reviewing",
        contentVersionId: contentVersion.id,
        contentVersionStatus: "pending_ai",
        moderationTaskId: task.id,
        moderationTaskStatus: "pending"
      };
    });
  }

  async editWantedPost(
    input: EditWantedPostInput
  ): Promise<SubmitWantedPostResult> {
    const now = input.now ?? new Date();
    const wantedPost = await this.prisma.wantedPost.findUnique({
      where: { id: input.wantedPostId }
    });
    if (
      !wantedPost ||
      wantedPost.communityId !== input.communityId ||
      wantedPost.childId !== input.childId
    ) {
      return { result: "rejected", errorCode: "WANTED_POST_NOT_FOUND" };
    }
    if (wantedPost.status === "delisted" || wantedPost.status === "closed") {
      return { result: "rejected", errorCode: "WANTED_POST_NOT_EDITABLE" };
    }

    const participation = await this.ensureCanPublish(input, now);
    if (participation.result === "rejected") {
      return participation;
    }
    const imageValidation = await this.validateItemImages({
      actorUserId: input.actorUserId,
      images: input.images
    });
    if (imageValidation.result === "rejected") {
      return imageValidation;
    }
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    const version = await this.prisma.contentVersion.aggregate({
      where: {
        targetType: "wanted_request",
        targetId: wantedPost.id
      },
      _max: {
        versionNo: true
      }
    });
    const versionNo = (version._max.versionNo ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const contentVersion = await tx.contentVersion.create({
        data: {
          targetType: "wanted_request",
          targetId: wantedPost.id,
          versionNo,
          status: "pending_ai",
          title: input.title,
          description: input.description,
          payloadJson: {
            title: input.title,
            description: input.description,
            category: input.category ?? null
          }
        }
      });
      await insertContentVersionMedia(tx, contentVersion.id, input.images);
      const task = await tx.moderationTask.create({
        data: {
          contentVersionId: contentVersion.id,
          status: "pending"
        }
      });
      await tx.wantedPost.update({
        where: { id: wantedPost.id },
        data: {
          latestVersionId: contentVersion.id,
          status: wantedPost.currentPublicVersionId
            ? wantedPost.status
            : "ai_reviewing"
        }
      });

      return {
        result: "accepted",
        wantedPostId: wantedPost.id,
        wantedPostStatus: "ai_reviewing",
        contentVersionId: contentVersion.id,
        contentVersionStatus: "pending_ai",
        moderationTaskId: task.id,
        moderationTaskStatus: "pending"
      };
    });
  }

  async submitWantedResponse(
    input: SubmitWantedResponseInput
  ): Promise<SubmitWantedResponseResult> {
    const now = input.now ?? new Date();
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

    const participation = await this.ensureCanPublish(
      {
        actorUserId: input.actorUserId,
        childId: input.responderChildId,
        communityId: input.communityId
      },
      now
    );
    if (participation.result === "rejected") {
      return participation;
    }
    const imageValidation = await this.validateItemImages({
      actorUserId: input.actorUserId,
      images: input.images
    });
    if (imageValidation.result === "rejected") {
      return imageValidation;
    }
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    return this.prisma.$transaction(async (tx) => {
      const wantedResponse = await tx.wantedResponse.create({
        data: {
          wantedPostId: wantedPost.id,
          responderChildId: input.responderChildId,
          status: "reviewing"
        }
      });
      const contentVersion = await tx.contentVersion.create({
        data: {
          targetType: "wanted_response",
          targetId: wantedResponse.id,
          versionNo: 1,
          status: "pending_ai",
          title: input.title,
          description: input.description,
          payloadJson: {
            title: input.title,
            description: input.description,
            wantedPostId: wantedPost.id
          }
        }
      });
      await insertContentVersionMedia(tx, contentVersion.id, input.images);
      const task = await tx.moderationTask.create({
        data: {
          contentVersionId: contentVersion.id,
          status: "pending"
        }
      });
      await tx.wantedResponse.update({
        where: { id: wantedResponse.id },
        data: {
          latestVersionId: contentVersion.id
        }
      });

      return {
        result: "accepted",
        wantedResponseId: wantedResponse.id,
        wantedResponseStatus: "reviewing",
        contentVersionId: contentVersion.id,
        contentVersionStatus: "pending_ai",
        moderationTaskId: task.id,
        moderationTaskStatus: "pending"
      };
    });
  }

  async processModerationTask(input: {
    taskId: string;
    now?: Date;
  }): Promise<ModerationActionResult> {
    const now = input.now ?? new Date();
    const task = await this.prisma.moderationTask.findUnique({
      where: { id: input.taskId },
      include: {
        contentVersion: true
      }
    });
    if (!task) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    if (task.status !== "pending") {
      return { result: "rejected", errorCode: "MODERATION_TASK_STATE_INVALID" };
    }
    const target = await this.resolveReviewTarget(task.contentVersion);
    if (!target) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }

    await this.prisma.moderationTask.update({
      where: { id: task.id },
      data: { status: "processing" }
    });

    const review = await this.contentSafety.reviewContent({
      text: [
        task.contentVersion.title ?? "",
        task.contentVersion.description ?? "",
        JSON.stringify(task.contentVersion.payloadJson)
      ].join("\n"),
      media: (await this.findVersionMedia(task.contentVersionId)).map((entry) => ({
        mediaAssetId: entry.mediaAssetId,
        checksum: entry.checksum
      }))
    });

    if (!review.ok) {
      await this.prisma.$transaction(async (tx) => {
        await tx.moderationTask.update({
          where: { id: task.id },
          data: {
            status: "failed",
            failureReason: review.errorCode
          }
        });
        await tx.aiReviewResult.create({
          data: {
            taskId: task.id,
            contentVersionId: task.contentVersionId,
            provider: "fake_content_safety",
            providerStatus: providerStatusFromError(review.errorCode),
            failureReason: review.errorCode,
            labelsJson: [],
            createdAt: now
          }
        });
      });
      return {
        result: "accepted",
        taskStatus: "failed",
        contentVersionStatus: task.contentVersion.status,
        errorCode: review.errorCode
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiReviewResult.create({
        data: {
          taskId: task.id,
          contentVersionId: task.contentVersionId,
          provider: "fake_content_safety",
          providerStatus: "success",
          riskLevel: review.riskLevel,
          labelsJson: review.labels,
          ocrText: review.ocrText ?? null,
          qrOrBarcodeDetected: review.qrOrBarcodeDetected ?? false,
          metadataFindingsJson: review.metadataFindings ?? [],
          rawResultRef: `fake:${task.id}:${now.toISOString()}`,
          createdAt: now
        }
      });
      await tx.contentVersion.update({
        where: { id: task.contentVersionId },
        data: {
          status: "pending_manual",
          riskLevel: review.riskLevel
        }
      });
      await tx.moderationTask.update({
        where: { id: task.id },
        data: {
          status: "needs_manual_review",
          providerRiskLevel: review.riskLevel,
          ruleTagsJson: review.labels
        }
      });
      await this.markTargetManualReview(tx, target);
    });

    return {
      result: "accepted",
      taskStatus: "needs_manual_review",
      contentVersionStatus: "pending_manual"
    };
  }

  async retryModerationTask(input: {
    actorUserId: string;
    taskId: string;
    now?: Date;
  }): Promise<ModerationActionResult> {
    const task = await this.prisma.moderationTask.findUnique({
      where: { id: input.taskId },
      include: { contentVersion: true }
    });
    if (!task) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    if (task.status !== "failed") {
      return { result: "rejected", errorCode: "MODERATION_TASK_STATE_INVALID" };
    }

    const target = await this.resolveReviewTarget(task.contentVersion);
    if (!target) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: target.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    await this.prisma.$transaction([
      this.prisma.moderationTask.update({
        where: { id: task.id },
        data: { status: "pending", failureReason: null }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "moderation_task.retry",
          targetType: "moderation_task",
          targetId: task.id,
          reason: "retry failed content safety task",
          createdAt: input.now ?? new Date()
        }
      })
    ]);

    return {
      result: "accepted",
      taskStatus: "pending",
      contentVersionStatus: task.contentVersion.status
    };
  }

  async reviewModerationTask(input: {
    actorUserId: string;
    taskId: string;
    decision: ReviewDecision;
    reason: string;
    now?: Date;
  }): Promise<ModerationActionResult> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "REASON_REQUIRED" };
    }

    const task = await this.prisma.moderationTask.findUnique({
      where: { id: input.taskId },
      include: { contentVersion: true }
    });
    if (!task) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    if (task.status === "failed") {
      return { result: "rejected", errorCode: "FAILED_TASK_REQUIRES_RETRY" };
    }
    if (task.status !== "needs_manual_review") {
      return { result: "rejected", errorCode: "MODERATION_TASK_STATE_INVALID" };
    }

    const target = await this.resolveReviewTarget(task.contentVersion);
    if (!target) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }

    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: target.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const risk = task.providerRiskLevel ?? task.contentVersion.riskLevel ?? "low";
    if (input.decision === "approve" && highRiskLevels.has(risk)) {
      return { result: "rejected", errorCode: "HIGH_RISK_REQUIRES_ESCALATION" };
    }

    if (input.decision === "approve") {
      await this.approveContentVersion({
        task,
        target,
        actorUserId: input.actorUserId,
        reason: input.reason,
        now
      });
      return {
        result: "accepted",
        taskStatus: "approved",
        contentVersionStatus: "approved"
      };
    }

    const nextTaskStatus = input.decision === "reject" ? "rejected" : "escalated";
    const nextVersionStatus = input.decision === "reject" ? "rejected" : "escalated";
    await this.prisma.$transaction(async (tx) => {
      await tx.moderationTask.update({
        where: { id: task.id },
        data: {
          status: nextTaskStatus,
          reviewerUserId: input.actorUserId,
          reviewedAt: now,
          failureReason: input.reason
        }
      });
      await tx.contentVersion.update({
        where: { id: task.contentVersionId },
        data: { status: nextVersionStatus }
      });
      await this.markTargetReviewOutcome(tx, target, input.decision);
      await tx.manualReviewRecord.create({
        data: {
          taskId: task.id,
          contentVersionId: task.contentVersionId,
          reviewerUserId: input.actorUserId,
          decision: input.decision,
          reason: input.reason,
          createdAt: now
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `moderation_task.${input.decision}`,
          targetType: "content_version",
          targetId: task.contentVersionId,
          reason: input.reason,
          createdAt: now
        }
      });
    });

    return {
      result: "accepted",
      taskStatus: nextTaskStatus,
      contentVersionStatus: nextVersionStatus
    };
  }

  async platformReviewModerationTask(input: {
    actorUserId: string;
    taskId: string;
    decision: PlatformReviewDecision;
    reason: string;
    now?: Date;
  }): Promise<ModerationActionResult> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "REASON_REQUIRED" };
    }
    if (!["block", "reject"].includes(input.decision)) {
      return { result: "rejected", errorCode: "PLATFORM_DECISION_INVALID" };
    }
    if (!(await this.isActivePlatformAdmin(input.actorUserId))) {
      return { result: "rejected", errorCode: "PLATFORM_ADMIN_REQUIRED" };
    }

    const task = await this.prisma.moderationTask.findUnique({
      where: { id: input.taskId },
      include: { contentVersion: true }
    });
    if (!task) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    if (task.status !== "escalated") {
      return { result: "rejected", errorCode: "MODERATION_TASK_STATE_INVALID" };
    }

    const target = await this.resolveReviewTarget(task.contentVersion);
    if (!target) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }

    const risk = task.providerRiskLevel ?? task.contentVersion.riskLevel ?? "low";
    if (!highRiskLevels.has(risk)) {
      return { result: "rejected", errorCode: "MODERATION_TASK_STATE_INVALID" };
    }

    const nextTaskStatus = input.decision === "block" ? "blocked" : "rejected";
    const nextVersionStatus = input.decision === "block" ? "blocked" : "rejected";
    await this.prisma.$transaction(async (tx) => {
      await tx.moderationTask.update({
        where: { id: task.id },
        data: {
          status: nextTaskStatus,
          reviewerUserId: input.actorUserId,
          reviewedAt: now,
          failureReason: input.reason
        }
      });
      await tx.contentVersion.update({
        where: { id: task.contentVersionId },
        data: { status: nextVersionStatus }
      });
      if (input.decision === "block") {
        await this.markTargetBlocked(tx, target);
      } else {
        await this.markTargetReviewOutcome(tx, target, "reject");
      }
      await tx.manualReviewRecord.create({
        data: {
          taskId: task.id,
          contentVersionId: task.contentVersionId,
          reviewerUserId: input.actorUserId,
          decision: input.decision,
          reason: input.reason,
          createdAt: now
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `moderation_task.platform_${input.decision}`,
          targetType: "content_version",
          targetId: task.contentVersionId,
          reason: input.reason,
          createdAt: now
        }
      });
    });

    return {
      result: "accepted",
      taskStatus: nextTaskStatus,
      contentVersionStatus: nextVersionStatus
    };
  }

  async delistItem(input: {
    actorUserId: string;
    itemId: string;
    reason: string;
    now?: Date;
  }): Promise<DelistItemResult> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "REASON_REQUIRED" };
    }

    const item = await this.prisma.item.findUnique({
      where: { id: input.itemId }
    });
    if (!item) {
      return { result: "rejected", errorCode: "ITEM_NOT_FOUND" };
    }

    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: item.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const mediaIds = item.currentPublicVersionId
      ? await this.findVersionMediaIds(item.currentPublicVersionId)
      : [];

    await this.prisma.$transaction([
      this.prisma.item.update({
        where: { id: item.id },
        data: { status: "delisted" }
      }),
      this.prisma.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { accessPolicyVersion: { increment: 1 } }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "item.delist",
          targetType: "item",
          targetId: item.id,
          reason: input.reason,
          createdAt: now
        }
      })
    ]);

    return {
      result: "accepted",
      itemId: item.id,
      itemStatus: "delisted"
    };
  }

  async delistWantedPost(input: {
    actorUserId: string;
    wantedPostId: string;
    reason: string;
    now?: Date;
  }): Promise<DelistWantedPostResult> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "REASON_REQUIRED" };
    }

    const wantedPost = await this.prisma.wantedPost.findUnique({
      where: { id: input.wantedPostId }
    });
    if (!wantedPost) {
      return { result: "rejected", errorCode: "WANTED_POST_NOT_FOUND" };
    }

    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: wantedPost.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const mediaIds = wantedPost.currentPublicVersionId
      ? await this.findVersionMediaIds(wantedPost.currentPublicVersionId)
      : [];

    await this.prisma.$transaction([
      this.prisma.wantedPost.update({
        where: { id: wantedPost.id },
        data: { status: "delisted" }
      }),
      this.prisma.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { accessPolicyVersion: { increment: 1 } }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "wanted_post.delist",
          targetType: "wanted_request",
          targetId: wantedPost.id,
          reason: input.reason,
          createdAt: now
        }
      })
    ]);

    return {
      result: "accepted",
      wantedPostId: wantedPost.id,
      wantedPostStatus: "delisted"
    };
  }

  async cancelWantedResponse(input: {
    actorUserId: string;
    wantedResponseId: string;
    reason: string;
    now?: Date;
  }): Promise<CancelWantedResponseResult> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "REASON_REQUIRED" };
    }

    const wantedResponse = await this.prisma.wantedResponse.findUnique({
      where: { id: input.wantedResponseId },
      include: { wantedPost: true }
    });
    if (!wantedResponse) {
      return { result: "rejected", errorCode: "WANTED_RESPONSE_NOT_FOUND" };
    }

    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: wantedResponse.wantedPost.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    const mediaIds = wantedResponse.currentPublicVersionId
      ? await this.findVersionMediaIds(wantedResponse.currentPublicVersionId)
      : [];

    await this.prisma.$transaction([
      this.prisma.wantedResponse.update({
        where: { id: wantedResponse.id },
        data: { status: "cancelled" }
      }),
      this.prisma.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { accessPolicyVersion: { increment: 1 } }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "wanted_response.cancel",
          targetType: "wanted_response",
          targetId: wantedResponse.id,
          reason: input.reason,
          createdAt: now
        }
      })
    ]);

    return {
      result: "accepted",
      wantedResponseId: wantedResponse.id,
      wantedResponseStatus: "cancelled"
    };
  }

  private async ensureCanPublish(
    input: Pick<SubmitItemInput, "actorUserId" | "childId" | "communityId">,
    now: Date
  ): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode:
          | "GUARDIAN_CONTROL_DISABLED"
          | "COMMUNITY_MEMBER_REQUIRED"
          | "PUBLISH_NOT_ALLOWED";
      }
  > {
    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.childId,
      communityId: input.communityId,
      action: "publish",
      now
    });
    if (participation.result === "accepted") {
      return participation;
    }

    return {
      result: "rejected",
      errorCode:
        participation.errorCode === "GUARDIAN_CONTROL_DISABLED"
          ? "GUARDIAN_CONTROL_DISABLED"
          : participation.errorCode === "COMMUNITY_MEMBER_REQUIRED"
            ? "COMMUNITY_MEMBER_REQUIRED"
            : "PUBLISH_NOT_ALLOWED"
    };
  }

  private async validateItemImages(input: {
    actorUserId: string;
    images: ItemImageInput[];
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode:
          | "IMAGE_COUNT_INVALID"
          | "IMAGE_ROLES_INVALID"
          | "MEDIA_NOT_TEMP_PRIVATE"
          | "MEDIA_OWNER_INVALID"
          | "MEDIA_ALREADY_CONSUMED";
      }
  > {
    if (input.images.length !== 4) {
      return { result: "rejected", errorCode: "IMAGE_COUNT_INVALID" };
    }

    const roles = new Set(input.images.map((image) => image.mediaRole));
    if (itemImageRoles.some((role) => !roles.has(role)) || roles.size !== 4) {
      return { result: "rejected", errorCode: "IMAGE_ROLES_INVALID" };
    }

    const media = await this.prisma.mediaAsset.findMany({
      where: { id: { in: input.images.map((image) => image.mediaAssetId) } }
    });
    if (media.length !== 4) {
      return { result: "rejected", errorCode: "MEDIA_NOT_TEMP_PRIVATE" };
    }

    for (const asset of media) {
      if (asset.ownerUserId !== input.actorUserId) {
        return { result: "rejected", errorCode: "MEDIA_OWNER_INVALID" };
      }
      if (asset.visibility !== "temp_private") {
        return { result: "rejected", errorCode: "MEDIA_NOT_TEMP_PRIVATE" };
      }
      if (await this.isMediaConsumed(asset.id)) {
        return { result: "rejected", errorCode: "MEDIA_ALREADY_CONSUMED" };
      }
    }

    return { result: "accepted" };
  }

  private async approveContentVersion(input: {
    task: ModerationTaskWithVersion;
    target: ReviewTarget;
    actorUserId: string;
    reason: string;
    now: Date;
  }) {
    const mediaIds = await this.findVersionMediaIds(input.task.contentVersionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.contentVersion.update({
        where: { id: input.task.contentVersionId },
        data: {
          status: "approved",
          approvedAt: input.now
        }
      });
      await tx.moderationTask.update({
        where: { id: input.task.id },
        data: {
          status: "approved",
          reviewerUserId: input.actorUserId,
          reviewedAt: input.now
        }
      });
      await this.markTargetApproved(
        tx,
        input.target,
        input.task.contentVersionId
      );
      await tx.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { visibility: "formal_private" }
      });
      await tx.manualReviewRecord.create({
        data: {
          taskId: input.task.id,
          contentVersionId: input.task.contentVersionId,
          reviewerUserId: input.actorUserId,
          decision: "approve",
          reason: input.reason,
          createdAt: input.now
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "moderation_task.approve",
          targetType: "content_version",
          targetId: input.task.contentVersionId,
          reason: input.reason,
          createdAt: input.now
        }
      });
    });
  }

  private async resolveReviewTarget(
    contentVersion: ContentVersion
  ): Promise<ReviewTarget | null> {
    if (contentVersion.targetType === "item") {
      const item = await this.prisma.item.findUnique({
        where: { id: contentVersion.targetId }
      });
      return item
        ? {
            targetType: "item",
            target: item,
            communityId: item.communityId,
            status: item.status
          }
        : null;
    }

    if (contentVersion.targetType === "wanted_request") {
      const wantedPost = await this.prisma.wantedPost.findUnique({
        where: { id: contentVersion.targetId }
      });
      return wantedPost
        ? {
            targetType: "wanted_request",
            target: wantedPost,
            communityId: wantedPost.communityId,
            status: wantedPost.status
          }
        : null;
    }

    if (contentVersion.targetType === "wanted_response") {
      const wantedResponse = await this.prisma.wantedResponse.findUnique({
        where: { id: contentVersion.targetId },
        include: { wantedPost: true }
      });
      return wantedResponse
        ? {
            targetType: "wanted_response",
            target: wantedResponse,
            communityId: wantedResponse.wantedPost.communityId,
            status: wantedResponse.status
          }
        : null;
    }

    return null;
  }

  private targetIdentityFields(target: ReviewTarget) {
    if (target.targetType === "item") {
      return { itemId: target.target.id };
    }
    if (target.targetType === "wanted_request") {
      return { wantedPostId: target.target.id };
    }
    return {
      wantedResponseId: target.target.id,
      parentWantedPostId: target.target.wantedPostId
    };
  }

  private async markTargetManualReview(
    tx: Prisma.TransactionClient,
    target: ReviewTarget
  ) {
    if (target.targetType === "item" && !target.target.currentPublicVersionId) {
      await tx.item.update({
        where: { id: target.target.id },
        data: { status: "manual_reviewing" }
      });
      return;
    }
    if (
      target.targetType === "wanted_request" &&
      !target.target.currentPublicVersionId
    ) {
      await tx.wantedPost.update({
        where: { id: target.target.id },
        data: { status: "manual_reviewing" }
      });
      return;
    }
    if (target.targetType === "wanted_response") {
      await tx.wantedResponse.update({
        where: { id: target.target.id },
        data: { status: "reviewing" }
      });
    }
  }

  private async markTargetApproved(
    tx: Prisma.TransactionClient,
    target: ReviewTarget,
    contentVersionId: string
  ) {
    if (target.targetType === "item") {
      await tx.item.update({
        where: { id: target.target.id },
        data: {
          currentPublicVersionId: contentVersionId,
          latestVersionId: contentVersionId,
          status: "approved"
        }
      });
      return;
    }
    if (target.targetType === "wanted_request") {
      await tx.wantedPost.update({
        where: { id: target.target.id },
        data: {
          currentPublicVersionId: contentVersionId,
          latestVersionId: contentVersionId,
          status: "active"
        }
      });
      return;
    }
    await tx.wantedResponse.update({
      where: { id: target.target.id },
      data: {
        currentPublicVersionId: contentVersionId,
        latestVersionId: contentVersionId,
        status: "approved"
      }
    });
  }

  private async markTargetReviewOutcome(
    tx: Prisma.TransactionClient,
    target: ReviewTarget,
    decision: ReviewDecision
  ) {
    if (decision !== "reject") {
      return;
    }
    if (target.targetType === "item" && !target.target.currentPublicVersionId) {
      await tx.item.update({
        where: { id: target.target.id },
        data: { status: "rejected" }
      });
      return;
    }
    if (
      target.targetType === "wanted_request" &&
      !target.target.currentPublicVersionId
    ) {
      await tx.wantedPost.update({
        where: { id: target.target.id },
        data: { status: "rejected" }
      });
      return;
    }
    if (
      target.targetType === "wanted_response" &&
      !target.target.currentPublicVersionId
    ) {
      await tx.wantedResponse.update({
        where: { id: target.target.id },
        data: { status: "rejected" }
      });
    }
  }

  private async markTargetBlocked(
    tx: Prisma.TransactionClient,
    target: ReviewTarget
  ) {
    if (target.targetType === "item") {
      if (target.target.currentPublicVersionId) {
        await incrementVersionMediaPolicy(tx, target.target.currentPublicVersionId);
      }
      await tx.item.update({
        where: { id: target.target.id },
        data: {
          status: target.target.currentPublicVersionId ? "delisted" : "rejected"
        }
      });
      return;
    }
    if (target.targetType === "wanted_request") {
      if (target.target.currentPublicVersionId) {
        await incrementVersionMediaPolicy(tx, target.target.currentPublicVersionId);
      }
      await tx.wantedPost.update({
        where: { id: target.target.id },
        data: {
          status: target.target.currentPublicVersionId ? "delisted" : "rejected"
        }
      });
      return;
    }
    if (target.target.currentPublicVersionId) {
      await incrementVersionMediaPolicy(tx, target.target.currentPublicVersionId);
    }
    await tx.wantedResponse.update({
      where: { id: target.target.id },
      data: {
        status: target.target.currentPublicVersionId ? "cancelled" : "rejected"
      }
    });
  }

  private async isActivePlatformAdmin(actorUserId: string): Promise<boolean> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId: actorUserId,
        role: "platform_admin",
        status: "active",
        mfaEnabled: true
      },
      select: { id: true }
    });
    return Boolean(admin);
  }

  private async findHistoryContext(input: {
    target: ReviewTarget;
    currentContentVersionId: string;
  }): Promise<
    Array<{
      targetType: string;
      targetId: string;
      contentVersionId: string;
      versionNo: number;
      title: string;
      status: string;
      riskLevel: string | null;
      createdAt: string;
    }>
  > {
    const context = await this.reviewTargetChildCommunity(input.target);
    if (!context) return [];

    const [items, wantedPosts, wantedResponses] = await Promise.all([
      this.prisma.item.findMany({
        where: {
          communityId: context.communityId,
          sellerChildId: context.childId
        },
        select: { id: true }
      }),
      this.prisma.wantedPost.findMany({
        where: {
          communityId: context.communityId,
          childId: context.childId
        },
        select: { id: true }
      }),
      this.prisma.wantedResponse.findMany({
        where: {
          responderChildId: context.childId,
          wantedPost: { communityId: context.communityId }
        },
        select: { id: true }
      })
    ]);

    const versions = await this.prisma.contentVersion.findMany({
      where: {
        id: { not: input.currentContentVersionId },
        status: { in: ["rejected", "escalated", "blocked"] },
        OR: [
          {
            targetType: "item",
            targetId: { in: items.map((item) => item.id) }
          },
          {
            targetType: "wanted_request",
            targetId: { in: wantedPosts.map((post) => post.id) }
          },
          {
            targetType: "wanted_response",
            targetId: { in: wantedResponses.map((response) => response.id) }
          }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 5
    });

    return versions.map((version) => ({
      targetType: version.targetType,
      targetId: version.targetId,
      contentVersionId: version.id,
      versionNo: version.versionNo,
      title: version.title ?? "",
      status: version.status,
      riskLevel: version.riskLevel,
      createdAt: version.createdAt.toISOString()
    }));
  }

  private async reviewTargetChildCommunity(
    target: ReviewTarget
  ): Promise<{ childId: string; communityId: string } | null> {
    if (target.targetType === "item") {
      return {
        childId: target.target.sellerChildId,
        communityId: target.target.communityId
      };
    }
    if (target.targetType === "wanted_request") {
      return {
        childId: target.target.childId,
        communityId: target.target.communityId
      };
    }
    return {
      childId: target.target.responderChildId,
      communityId: target.target.wantedPost.communityId
    };
  }

  private async findVersionMediaIds(contentVersionId: string): Promise<string[]> {
    const media = await this.prisma.$queryRaw<Array<{ mediaAssetId: string }>>`
      SELECT "mediaAssetId"
      FROM "ContentVersionMedia"
      WHERE "contentVersionId" = ${contentVersionId}
    `;

    return media.map((entry) => entry.mediaAssetId);
  }

  private async findVersionMedia(contentVersionId: string): Promise<
    Array<{
      mediaAssetId: string;
      checksum: string;
    }>
  > {
    return this.prisma.$queryRaw`
      SELECT cvm."mediaAssetId", ma."checksum"
      FROM "ContentVersionMedia" cvm
      INNER JOIN "MediaAsset" ma ON ma."id" = cvm."mediaAssetId"
      WHERE cvm."contentVersionId" = ${contentVersionId}
      ORDER BY cvm."sortOrder" ASC
    `;
  }

  private async findVersionMediaForDetail(contentVersionId: string): Promise<
    Array<{
      mediaAssetId: string;
      mediaRole: string;
      sortOrder: number;
    }>
  > {
    return this.prisma.$queryRaw`
      SELECT
        "mediaAssetId",
        "mediaRole"::text AS "mediaRole",
        "sortOrder"
      FROM "ContentVersionMedia"
      WHERE "contentVersionId" = ${contentVersionId}
      ORDER BY "sortOrder" ASC
    `;
  }

  private async findAiEvidence(taskId: string): Promise<
    Array<{
      provider: string;
      providerStatus: string;
      riskLevel: string | null;
      labels: unknown;
      ocrText: string | null;
      qrOrBarcodeDetected: boolean;
      metadataFindings: unknown;
      failureReason: string | null;
      createdAt: string;
    }>
  > {
    const rows = await this.prisma.aiReviewResult.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" }
    });

    return rows.map((row) => ({
      provider: row.provider,
      providerStatus: row.providerStatus,
      riskLevel: row.riskLevel,
      labels: row.labelsJson,
      ocrText: row.ocrText,
      qrOrBarcodeDetected: row.qrOrBarcodeDetected,
      metadataFindings: row.metadataFindingsJson,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString()
    }));
  }

  private async createReviewImageGrants(input: {
    media: Array<{
      mediaAssetId: string;
      mediaRole: string;
      sortOrder: number;
      ownerUserId: string;
      storageBucket: string;
      storageKey: string;
      accessPolicyVersion: number;
    }>;
    granteeUserId: string;
    now?: Date;
  }): Promise<
    Array<{
      mediaAssetId: string;
      mediaRole: string;
      sortOrder: number;
      url: string;
      expiresAt: string;
    }>
  > {
    const grants = [];
    for (const entry of input.media) {
      const grant = this.reviewStorage.createReadGrant({
        mediaAssetId: entry.mediaAssetId,
        storageBucket: entry.storageBucket,
        storageKey: entry.storageKey,
        ownerUserId: entry.ownerUserId,
        granteeUserId: input.granteeUserId,
        purpose: "content_review_original",
        ttlSeconds: 300,
        accessPolicyVersion: entry.accessPolicyVersion,
        now: input.now
      });
      if (grant.result === "accepted") {
        grants.push({
          mediaAssetId: entry.mediaAssetId,
          mediaRole: entry.mediaRole,
          sortOrder: entry.sortOrder,
          url: grant.url,
          expiresAt: grant.expiresAt
        });
      }
    }
    return grants;
  }

  private async findVersionMediaForReview(contentVersionId: string): Promise<
    Array<{
      mediaAssetId: string;
      mediaRole: string;
      sortOrder: number;
      ownerUserId: string;
      storageBucket: string;
      storageKey: string;
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
        ma."accessPolicyVersion"
      FROM "ContentVersionMedia" cvm
      INNER JOIN "MediaAsset" ma ON ma."id" = cvm."mediaAssetId"
      WHERE cvm."contentVersionId" = ${contentVersionId}
      ORDER BY cvm."sortOrder" ASC
    `;
  }

  private async buildVersionDiff(contentVersion: ContentVersion): Promise<{
    previousApprovedVersion: {
      contentVersionId: string;
      versionNo: number;
      title: string;
      description: string;
      payload: unknown;
    } | null;
    currentSubmittedVersion: {
      contentVersionId: string;
      versionNo: number;
      title: string;
      description: string;
      payload: unknown;
    };
    changedFields: string[];
  }> {
    const previous = await this.prisma.contentVersion.findFirst({
      where: {
        targetType: contentVersion.targetType,
        targetId: contentVersion.targetId,
        status: "approved",
        versionNo: { lt: contentVersion.versionNo }
      },
      orderBy: { versionNo: "desc" }
    });
    const currentSummary = summarizeContentVersion(contentVersion);
    const previousSummary = previous ? summarizeContentVersion(previous) : null;

    return {
      previousApprovedVersion: previousSummary,
      currentSubmittedVersion: currentSummary,
      changedFields: previousSummary
        ? changedFields(previousSummary, currentSummary)
        : []
    };
  }

  private async isMediaConsumed(mediaAssetId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ mediaAssetId: string }>>`
      SELECT "mediaAssetId"
      FROM "ContentVersionMedia"
      WHERE "mediaAssetId" = ${mediaAssetId}
      LIMIT 1
    `;

    return rows.length > 0;
  }
}

async function insertContentVersionMedia(
  tx: Prisma.TransactionClient,
  contentVersionId: string,
  images: ItemImageInput[]
) {
  for (const image of images) {
    await tx.$executeRaw`
      INSERT INTO "ContentVersionMedia" (
        "id",
        "contentVersionId",
        "mediaAssetId",
        "mediaRole",
        "sortOrder"
      )
      VALUES (
        ${`cvm_${randomUUID()}`},
        ${contentVersionId},
        ${image.mediaAssetId},
        ${image.mediaRole}::"ContentMediaRole",
        ${image.sortOrder}
      )
    `;
  }
}

async function incrementVersionMediaPolicy(
  tx: Prisma.TransactionClient,
  contentVersionId: string
) {
  const rows = await tx.$queryRaw<Array<{ mediaAssetId: string }>>`
    SELECT "mediaAssetId"
    FROM "ContentVersionMedia"
    WHERE "contentVersionId" = ${contentVersionId}
  `;
  if (rows.length === 0) return;

  await tx.mediaAsset.updateMany({
    where: { id: { in: rows.map((row) => row.mediaAssetId) } },
    data: { accessPolicyVersion: { increment: 1 } }
  });
}

function summarizeContentVersion(contentVersion: ContentVersion) {
  return {
    contentVersionId: contentVersion.id,
    versionNo: contentVersion.versionNo,
    title: contentVersion.title ?? "",
    description: contentVersion.description ?? "",
    payload: contentVersion.payloadJson
  };
}

function changedFields(
  previous: ReturnType<typeof summarizeContentVersion>,
  current: ReturnType<typeof summarizeContentVersion>
): string[] {
  const fields = [];
  if (previous.title !== current.title) fields.push("title");
  if (previous.description !== current.description) fields.push("description");
  if (stableStringify(previous.payload) !== stableStringify(current.payload)) {
    fields.push("payload");
  }
  return fields;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys((value ?? {}) as object).sort());
}

function providerStatusFromError(
  errorCode: string
): "timeout" | "failed" | "invalid_response" {
  if (errorCode.includes("TIMEOUT")) return "timeout";
  if (errorCode.includes("INVALID") || errorCode.includes("UNPARSABLE")) {
    return "invalid_response";
  }
  return "failed";
}
