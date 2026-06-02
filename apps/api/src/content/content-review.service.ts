import type {
  ContentVersion,
  Item,
  ModerationTask,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ChildParticipationService } from "../accounts/child-participation.service.js";
import type { CommunityAdminAuthorizationService } from "../communities/community-admin-authorization.service.js";
import type {
  ContentSafetyProvider,
  RiskLevel
} from "../providers/provider-contracts.js";

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

export type ContentReviewQueueResult =
  | {
      result: "accepted";
      tasks: Array<{
        key: string;
        taskId: string;
        contentVersionId: string;
        itemId: string;
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
      itemId: string;
      versionNo: number;
      title: string;
      description: string;
      taskStatus: string;
      riskLevel: string;
      ruleTags: unknown;
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

export class ContentReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly participation: ChildParticipationService,
    private readonly adminAuthorizations: CommunityAdminAuthorizationService,
    private readonly contentSafety: ContentSafetyProvider
  ) {}

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

    const items = await this.prisma.item.findMany({
      where: { communityId: input.communityId },
      select: { id: true }
    });
    const itemIds = new Set(items.map((item) => item.id));
    const tasks = await this.prisma.moderationTask.findMany({
      where: {
        status: { in: ["needs_manual_review", "failed", "escalated"] }
      },
      include: { contentVersion: true },
      orderBy: { id: "asc" }
    });

    return {
      result: "accepted",
      tasks: tasks
        .filter((task) => itemIds.has(task.contentVersion.targetId))
        .map((task) => ({
          key: task.id,
          taskId: task.id,
          contentVersionId: task.contentVersionId,
          itemId: task.contentVersion.targetId,
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
    const item = await this.prisma.item.findUnique({
      where: { id: task.contentVersion.targetId }
    });
    if (!item) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }
    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: item.communityId
    });
    if (scoped.result === "rejected") {
      return { result: "rejected", errorCode: "COMMUNITY_ADMIN_REQUIRED" };
    }

    return {
      result: "accepted",
      taskId: task.id,
      contentVersionId: task.contentVersionId,
      itemId: task.contentVersion.targetId,
      versionNo: task.contentVersion.versionNo,
      title: task.contentVersion.title ?? "",
      description: task.contentVersion.description ?? "",
      taskStatus: task.status,
      riskLevel:
        task.providerRiskLevel ?? task.contentVersion.riskLevel ?? "unknown",
      ruleTags: task.ruleTagsJson,
      images: await this.findVersionMediaForDetail(task.contentVersionId)
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

  async processModerationTask(input: {
    taskId: string;
    now?: Date;
  }): Promise<ModerationActionResult> {
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
      await this.prisma.moderationTask.update({
        where: { id: task.id },
        data: {
          status: "failed",
          failureReason: review.errorCode
        }
      });
      return {
        result: "accepted",
        taskStatus: "failed",
        contentVersionStatus: task.contentVersion.status,
        errorCode: review.errorCode
      };
    }

    await this.prisma.$transaction([
      this.prisma.contentVersion.update({
        where: { id: task.contentVersionId },
        data: {
          status: "pending_manual",
          riskLevel: review.riskLevel
        }
      }),
      this.prisma.moderationTask.update({
        where: { id: task.id },
        data: {
          status: "needs_manual_review",
          providerRiskLevel: review.riskLevel,
          ruleTagsJson: review.labels
        }
      })
    ]);

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

    const communityId = await this.findTaskCommunityId(task.contentVersion.targetId);
    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId
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

    const item = await this.prisma.item.findUnique({
      where: { id: task.contentVersion.targetId }
    });
    if (!item) {
      return { result: "rejected", errorCode: "MODERATION_TASK_NOT_FOUND" };
    }

    const scoped = await this.adminAuthorizations.findActiveScopedActivityAdmin({
      actorUserId: input.actorUserId,
      communityId: item.communityId
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
        item,
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
    await this.prisma.$transaction([
      this.prisma.moderationTask.update({
        where: { id: task.id },
        data: {
          status: nextTaskStatus,
          reviewerUserId: input.actorUserId,
          reviewedAt: now,
          failureReason: input.reason
        }
      }),
      this.prisma.contentVersion.update({
        where: { id: task.contentVersionId },
        data: { status: nextVersionStatus }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `moderation_task.${input.decision}`,
          targetType: "content_version",
          targetId: task.contentVersionId,
          reason: input.reason,
          createdAt: now
        }
      })
    ]);

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

  private async ensureCanPublish(
    input: Pick<SubmitItemInput, "actorUserId" | "childId" | "communityId">,
    now: Date
  ): Promise<{ result: "accepted" } | Extract<SubmitItemResult, { result: "rejected" }>> {
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
  }): Promise<{ result: "accepted" } | Extract<SubmitItemResult, { result: "rejected" }>> {
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

  private async findTaskCommunityId(itemId: string): Promise<string> {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { communityId: true }
    });
    return item?.communityId ?? "";
  }

  private async approveContentVersion(input: {
    task: ModerationTaskWithVersion;
    item: Item;
    actorUserId: string;
    reason: string;
    now: Date;
  }) {
    const mediaIds = await this.findVersionMediaIds(input.task.contentVersionId);

    await this.prisma.$transaction([
      this.prisma.contentVersion.update({
        where: { id: input.task.contentVersionId },
        data: {
          status: "approved",
          approvedAt: input.now
        }
      }),
      this.prisma.moderationTask.update({
        where: { id: input.task.id },
        data: {
          status: "approved",
          reviewerUserId: input.actorUserId,
          reviewedAt: input.now
        }
      }),
      this.prisma.item.update({
        where: { id: input.item.id },
        data: {
          currentPublicVersionId: input.task.contentVersionId,
          latestVersionId: input.task.contentVersionId,
          status: "approved"
        }
      }),
      this.prisma.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { visibility: "formal_private" }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "moderation_task.approve",
          targetType: "content_version",
          targetId: input.task.contentVersionId,
          reason: input.reason,
          createdAt: input.now
        }
      })
    ]);
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
