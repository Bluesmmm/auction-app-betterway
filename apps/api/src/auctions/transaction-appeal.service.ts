import type {
  AdminRole,
  AppealAttachmentStatus,
  AppealStatus,
  DeliveryPointStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ContentSafetyProvider } from "../providers/provider-contracts.js";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";
import { AuctionPermissionsService } from "./auction-permissions.service.js";

type CreateTransactionAppealRejectedErrorCode =
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_GUARDIAN_REQUIRED"
  | "REASON_REQUIRED"
  | "TOO_MANY_ATTACHMENTS"
  | "ATTACHMENT_NOT_PRIVATE_IMAGE"
  | "CONTENT_SAFETY_UNAVAILABLE";

type CreateAppealImageGrantRejectedErrorCode =
  | "APPEAL_ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_NOT_AVAILABLE"
  | "APPEAL_ACCESS_DENIED"
  | "INVALID_TTL";

type DeliveryPointRejectedErrorCode =
  | "COMMUNITY_ADMIN_REQUIRED"
  | "DELIVERY_POINT_NOT_FOUND"
  | "DELIVERY_POINT_FIELD_REQUIRED";

type AppealAdminRejectedErrorCode =
  | "COMMUNITY_ADMIN_REQUIRED"
  | "PLATFORM_ADMIN_REQUIRED"
  | "APPEAL_NOT_FOUND"
  | "APPEAL_NOT_REVIEWABLE"
  | "APPEAL_RESOLUTION_REQUIRED";

export type CreateTransactionAppealResult =
  | {
      result: "accepted";
      appealId: string;
      status: AppealStatus;
      attachmentCount: number;
      idempotencyKey: null;
    }
  | {
      result: "rejected";
      errorCode: CreateTransactionAppealRejectedErrorCode;
    };

export type CreateAppealImageGrantResult =
  | {
      result: "accepted";
      mediaAssetId: string;
      purpose: "appeal";
      url: string;
      expiresAt: string;
      publicAccess: false;
    }
  | {
      result: "rejected";
      errorCode: CreateAppealImageGrantRejectedErrorCode;
    };

export type DeliveryPointRow = {
  id: string;
  communityId: string;
  name: string;
  addressText: string;
  availableTimeText: string;
  status: DeliveryPointStatus;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryPointCommandResult =
  | {
      result: "accepted";
      point: DeliveryPointRow;
    }
  | {
      result: "rejected";
      errorCode: DeliveryPointRejectedErrorCode;
    };

export type ListDeliveryPointsResult =
  | {
      result: "accepted";
      points: DeliveryPointRow[];
    }
  | {
      result: "rejected";
      errorCode: Extract<DeliveryPointRejectedErrorCode, "COMMUNITY_ADMIN_REQUIRED">;
    };

export type AppealQueueRow = {
  id: string;
  targetType: "transaction";
  targetId: string;
  transactionId: string | null;
  submittedByGuardianId: string;
  communityId: string;
  status: AppealStatus;
  reason: string;
  resolution: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  attachmentCount: number;
};

export type AppealDetailResult =
  | {
      result: "accepted";
      appeal: AppealQueueRow & {
        attachments: Array<{
          id: string;
          mediaAssetId: string;
          status: AppealAttachmentStatus;
          sortOrder: number;
          riskLabelsJson: Prisma.JsonValue | null;
          rejectionReason: string | null;
          createdAt: string;
          reviewedAt: string | null;
        }>;
      };
    }
  | {
      result: "rejected";
      errorCode:
        | Extract<AppealAdminRejectedErrorCode, "COMMUNITY_ADMIN_REQUIRED">
        | "APPEAL_NOT_FOUND";
    };

export type ListAppealsResult =
  | {
      result: "accepted";
      appeals: AppealQueueRow[];
    }
  | {
      result: "rejected";
      errorCode:
        | Extract<
            AppealAdminRejectedErrorCode,
            "COMMUNITY_ADMIN_REQUIRED" | "PLATFORM_ADMIN_REQUIRED"
          >;
    };

export type ReviewAppealResult =
  | {
      result: "accepted";
      appealId: string;
      status: AppealStatus;
      reviewedByUserId: string;
      resolution: string;
    }
  | {
      result: "rejected";
      errorCode: AppealAdminRejectedErrorCode;
    };

type TransactionForAppeal = {
  id: string;
  buyerChildId: string;
  sellerChildId: string;
  auctionSession: {
    item: {
      communityId: string;
    };
  };
};

const allowedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class TransactionAppealService {
  private readonly storage: PrivateObjectStorageService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly contentSafety: ContentSafetyProvider,
    appealGrantSigningKey = "stage6-appeal-grant-key",
    private readonly permissions = new AuctionPermissionsService(prisma)
  ) {
    this.storage = new PrivateObjectStorageService(appealGrantSigningKey);
  }

  async listDeliveryPoints(input: {
    actorUserId: string;
    communityId: string;
  }): Promise<ListDeliveryPointsResult> {
    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: input.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const points = await this.prisma.deliveryPoint.findMany({
      where: {
        communityId: input.communityId
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }]
    });

    return {
      result: "accepted",
      points: points.map(serializeDeliveryPoint)
    };
  }

  async createDeliveryPoint(input: {
    actorUserId: string;
    communityId: string;
    name: string;
    addressText: string;
    availableTimeText: string;
    now?: Date;
  }): Promise<DeliveryPointCommandResult> {
    const normalized = normalizeDeliveryPointFields(input);
    if (!normalized) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_POINT_FIELD_REQUIRED"
      };
    }

    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: input.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const now = input.now ?? new Date();
    const point = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryPoint.create({
        data: {
          communityId: input.communityId,
          name: normalized.name,
          addressText: normalized.addressText,
          availableTimeText: normalized.availableTimeText,
          status: "active",
          createdAt: now
        }
      });
      await writeDeliveryPointAuditAndOutbox(tx, {
        actorUserId: input.actorUserId,
        action: "delivery_point.create",
        eventType: "delivery_point.created",
        point: created,
        now
      });

      return created;
    });

    return {
      result: "accepted",
      point: serializeDeliveryPoint(point)
    };
  }

  async updateDeliveryPoint(input: {
    actorUserId: string;
    deliveryPointId: string;
    name?: string;
    addressText?: string;
    availableTimeText?: string;
    now?: Date;
  }): Promise<DeliveryPointCommandResult> {
    const existing = await this.prisma.deliveryPoint.findUnique({
      where: {
        id: input.deliveryPointId
      }
    });
    if (!existing) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_POINT_NOT_FOUND"
      };
    }

    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: existing.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const patch = normalizeDeliveryPointPatch(input);
    if (!patch) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_POINT_FIELD_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const point = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliveryPoint.update({
        where: {
          id: existing.id
        },
        data: patch
      });
      await writeDeliveryPointAuditAndOutbox(tx, {
        actorUserId: input.actorUserId,
        action: "delivery_point.update",
        eventType: "delivery_point.updated",
        point: updated,
        now,
        before: existing
      });

      return updated;
    });

    return {
      result: "accepted",
      point: serializeDeliveryPoint(point)
    };
  }

  async disableDeliveryPoint(input: {
    actorUserId: string;
    deliveryPointId: string;
    reason: string;
    now?: Date;
  }): Promise<DeliveryPointCommandResult> {
    const existing = await this.prisma.deliveryPoint.findUnique({
      where: {
        id: input.deliveryPointId
      }
    });
    if (!existing) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_POINT_NOT_FOUND"
      };
    }

    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: existing.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const reason = input.reason.trim();
    if (!reason) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_POINT_FIELD_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const point = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliveryPoint.update({
        where: {
          id: existing.id
        },
        data: {
          status: "disabled"
        }
      });
      await writeDeliveryPointAuditAndOutbox(tx, {
        actorUserId: input.actorUserId,
        action: "delivery_point.disable",
        eventType: "delivery_point.disabled",
        point: updated,
        now,
        before: existing,
        reason
      });

      return updated;
    });

    return {
      result: "accepted",
      point: serializeDeliveryPoint(point)
    };
  }

  async listAppeals(input: {
    actorUserId: string;
    communityId?: string;
    status?: AppealStatus;
  }): Promise<ListAppealsResult> {
    if (input.communityId) {
      const authorization = await this.permissions.canManageCommunityAuction({
        actorUserId: input.actorUserId,
        communityId: input.communityId
      });
      if (authorization.result === "rejected") {
        return authorization;
      }

      const appeals = await this.prisma.appeal.findMany({
        where: {
          communityId: input.communityId,
          ...(input.status ? { status: input.status } : {})
        },
        include: {
          _count: {
            select: {
              attachments: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return {
        result: "accepted",
        appeals: appeals.map(serializeAppealRow)
      };
    }

    if (!(await isPlatformAdmin(this.prisma, input.actorUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const appeals = await this.prisma.appeal.findMany({
      where: {
        status: input.status ?? "escalated_platform"
      },
      include: {
        _count: {
          select: {
            attachments: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return {
      result: "accepted",
      appeals: appeals.map(serializeAppealRow)
    };
  }

  async getAppealDetail(input: {
    actorUserId: string;
    appealId: string;
  }): Promise<AppealDetailResult> {
    const appeal = await this.prisma.appeal.findUnique({
      where: {
        id: input.appealId
      },
      include: {
        attachments: {
          orderBy: {
            sortOrder: "asc"
          }
        },
        _count: {
          select: {
            attachments: true
          }
        }
      }
    });
    if (!appeal) {
      return {
        result: "rejected",
        errorCode: "APPEAL_NOT_FOUND"
      };
    }

    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: appeal.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    return {
      result: "accepted",
      appeal: {
        ...serializeAppealRow(appeal),
        attachments: appeal.attachments.map((attachment) => ({
          id: attachment.id,
          mediaAssetId: attachment.mediaAssetId,
          status: attachment.status,
          sortOrder: attachment.sortOrder,
          riskLabelsJson: attachment.riskLabelsJson,
          rejectionReason: attachment.rejectionReason,
          createdAt: attachment.createdAt.toISOString(),
          reviewedAt: attachment.reviewedAt?.toISOString() ?? null
        }))
      }
    };
  }

  async reviewAppeal(input: {
    actorUserId: string;
    appealId: string;
    action: "resolve" | "reject" | "escalate_platform" | "platform_resolve";
    resolution: string;
    now?: Date;
  }): Promise<ReviewAppealResult> {
    const resolution = input.resolution.trim();
    if (!resolution) {
      return {
        result: "rejected",
        errorCode: "APPEAL_RESOLUTION_REQUIRED"
      };
    }

    const appeal = await this.prisma.appeal.findUnique({
      where: {
        id: input.appealId
      }
    });
    if (!appeal) {
      return {
        result: "rejected",
        errorCode: "APPEAL_NOT_FOUND"
      };
    }

    const authorization = await this.permissions.canManageCommunityAuction({
      actorUserId: input.actorUserId,
      communityId: appeal.communityId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const nextStatus = resolveAppealStatus(appeal.status, input.action, authorization.role);
    if (!nextStatus) {
      return {
        result: "rejected",
        errorCode: "APPEAL_NOT_REVIEWABLE"
      };
    }

    const now = input.now ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.appeal.update({
        where: {
          id: appeal.id
        },
        data: {
          status: nextStatus,
          resolution,
          reviewedByUserId: input.actorUserId,
          resolvedAt:
            nextStatus === "resolved" || nextStatus === "platform_resolved"
              ? now
              : null
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `appeal.${input.action}`,
          targetType: "appeal",
          targetId: appeal.id,
          reason: resolution,
          beforeJson: {
            status: appeal.status
          },
          afterJson: {
            status: nextStatus,
            communityId: appeal.communityId,
            transactionId: appeal.transactionId
          },
          createdAt: now
        }
      });
    });

    return {
      result: "accepted",
      appealId: appeal.id,
      status: nextStatus,
      reviewedByUserId: input.actorUserId,
      resolution
    };
  }

  async createTransactionAppeal(input: {
    actorUserId: string;
    transactionId: string;
    reason: string;
    attachmentMediaAssetIds?: string[];
    now?: Date;
  }): Promise<CreateTransactionAppealResult> {
    const reason = input.reason.trim();
    if (!reason) {
      return {
        result: "rejected",
        errorCode: "REASON_REQUIRED"
      };
    }

    const attachmentMediaAssetIds = input.attachmentMediaAssetIds ?? [];
    if (
      attachmentMediaAssetIds.length > 4 ||
      new Set(attachmentMediaAssetIds).size !== attachmentMediaAssetIds.length
    ) {
      return {
        result: "rejected",
        errorCode: "TOO_MANY_ATTACHMENTS"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await loadTransactionForAppeal(tx, input.transactionId);
      if (!transaction) {
        return {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        };
      }

      const guardian = await loadTransactionGuardian(tx, {
        actorUserId: input.actorUserId,
        transaction
      });
      if (!guardian) {
        return {
          result: "rejected",
          errorCode: "TRANSACTION_GUARDIAN_REQUIRED"
        };
      }

      const media = await tx.mediaAsset.findMany({
        where: {
          id: {
            in: attachmentMediaAssetIds
          }
        },
        select: {
          id: true,
          ownerUserId: true,
          visibility: true,
          mimeType: true,
          checksum: true
        }
      });
      if (media.length !== attachmentMediaAssetIds.length) {
        return {
          result: "rejected",
          errorCode: "ATTACHMENT_NOT_PRIVATE_IMAGE"
        };
      }

      const mediaById = new Map(media.map((asset) => [asset.id, asset]));
      const orderedMedia = attachmentMediaAssetIds.map((id) => mediaById.get(id));
      if (
        orderedMedia.some(
          (asset) =>
            !asset ||
            asset.ownerUserId !== input.actorUserId ||
            asset.visibility !== "temp_private" ||
            !allowedImageMimeTypes.has(asset.mimeType)
        )
      ) {
        return {
          result: "rejected",
          errorCode: "ATTACHMENT_NOT_PRIVATE_IMAGE"
        };
      }

      const attachmentReviews = [];
      let appealStatus: AppealStatus = "pending_activity_admin";
      for (const asset of orderedMedia) {
        if (!asset) {
          return {
            result: "rejected" as const,
            errorCode: "ATTACHMENT_NOT_PRIVATE_IMAGE" as const
          };
        }

        const review = await this.contentSafety.reviewContent({
          text: reason,
          media: [
            {
              mediaAssetId: asset.id,
              checksum: asset.checksum
            }
          ]
        });
        if (!review.ok) {
          return {
            result: "rejected",
            errorCode: "CONTENT_SAFETY_UNAVAILABLE"
          };
        }

        const status = attachmentStatusFromRisk(review.riskLevel);
        if (status === "escalated_platform") {
          appealStatus = "escalated_platform";
        }
        attachmentReviews.push({
          mediaAssetId: asset.id,
          status,
          riskLabels: review.labels
        });
      }

      const now = input.now ?? new Date();
      const appeal = await tx.appeal.create({
        data: {
          targetType: "transaction",
          targetId: transaction.id,
          transactionId: transaction.id,
          submittedByGuardianId: guardian.guardianId,
          communityId: transaction.auctionSession.item.communityId,
          status: appealStatus,
          reason,
          createdAt: now
        },
        select: {
          id: true,
          status: true
        }
      });

      if (attachmentReviews.length > 0) {
        await tx.appealAttachment.createMany({
          data: attachmentReviews.map((attachment, index) => ({
            appealId: appeal.id,
            mediaAssetId: attachment.mediaAssetId,
            status: attachment.status,
            sortOrder: index + 1,
            riskLabelsJson: attachment.riskLabels,
            createdAt: now,
            ...(attachment.status !== "pending_scan"
              ? { reviewedAt: now }
              : {})
          }))
        });
      }

      return {
        result: "accepted",
        appealId: appeal.id,
        status: appeal.status,
        attachmentCount: attachmentReviews.length,
        idempotencyKey: null
      };
    });
  }

  async createAppealImageGrant(input: {
    actorUserId: string;
    appealAttachmentId: string;
    ttlSeconds: number;
    now?: Date;
  }): Promise<CreateAppealImageGrantResult> {
    const attachment = await this.prisma.appealAttachment.findUnique({
      where: {
        id: input.appealAttachmentId
      },
      include: {
        mediaAsset: true,
        appeal: {
          include: {
            submittedByGuardian: true
          }
        }
      }
    });
    if (!attachment) {
      return {
        result: "rejected",
        errorCode: "APPEAL_ATTACHMENT_NOT_FOUND"
      };
    }

    if (
      attachment.status !== "accepted" ||
      attachment.mediaAsset.visibility !== "temp_private" ||
      attachment.mediaAsset.revokedAt
    ) {
      return {
        result: "rejected",
        errorCode: "ATTACHMENT_NOT_AVAILABLE"
      };
    }

    if (
      !(await canAccessAppeal(this.prisma, {
        actorUserId: input.actorUserId,
        submittedByGuardianUserId: attachment.appeal.submittedByGuardian.userId,
        communityId: attachment.appeal.communityId
      }))
    ) {
      return {
        result: "rejected",
        errorCode: "APPEAL_ACCESS_DENIED"
      };
    }

    const grant = this.storage.createReadGrant({
      mediaAssetId: attachment.mediaAsset.id,
      storageBucket: attachment.mediaAsset.storageBucket,
      storageKey: attachment.mediaAsset.storageKey,
      ownerUserId: attachment.mediaAsset.ownerUserId,
      granteeUserId: input.actorUserId,
      purpose: "appeal",
      ttlSeconds: input.ttlSeconds,
      accessPolicyVersion: attachment.mediaAsset.accessPolicyVersion,
      now: input.now
    });
    if (grant.result === "rejected") {
      return {
        result: "rejected",
        errorCode: "INVALID_TTL"
      };
    }

    return {
      result: "accepted",
      mediaAssetId: grant.mediaAssetId,
      purpose: "appeal",
      url: grant.url,
      expiresAt: grant.expiresAt,
      publicAccess: false
    };
  }
}

function attachmentStatusFromRisk(riskLevel: string): AppealAttachmentStatus {
  if (riskLevel === "high" || riskLevel === "severe") {
    return "escalated_platform";
  }

  return "accepted";
}

function serializeDeliveryPoint(point: {
  id: string;
  communityId: string;
  name: string;
  addressText: string;
  availableTimeText: string;
  status: DeliveryPointStatus;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryPointRow {
  return {
    id: point.id,
    communityId: point.communityId,
    name: point.name,
    addressText: point.addressText,
    availableTimeText: point.availableTimeText,
    status: point.status,
    createdAt: point.createdAt.toISOString(),
    updatedAt: point.updatedAt.toISOString()
  };
}

function serializeAppealRow(appeal: {
  id: string;
  targetType: "transaction";
  targetId: string;
  transactionId: string | null;
  submittedByGuardianId: string;
  communityId: string;
  status: AppealStatus;
  reason: string;
  resolution: string | null;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  _count: {
    attachments: number;
  };
}): AppealQueueRow {
  return {
    id: appeal.id,
    targetType: appeal.targetType,
    targetId: appeal.targetId,
    transactionId: appeal.transactionId,
    submittedByGuardianId: appeal.submittedByGuardianId,
    communityId: appeal.communityId,
    status: appeal.status,
    reason: appeal.reason,
    resolution: appeal.resolution,
    reviewedByUserId: appeal.reviewedByUserId,
    createdAt: appeal.createdAt.toISOString(),
    updatedAt: appeal.updatedAt.toISOString(),
    resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
    attachmentCount: appeal._count.attachments
  };
}

function normalizeDeliveryPointFields(input: {
  name: string;
  addressText: string;
  availableTimeText: string;
}) {
  const name = input.name.trim();
  const addressText = input.addressText.trim();
  const availableTimeText = input.availableTimeText.trim();
  if (!name || !addressText || !availableTimeText) {
    return null;
  }

  return {
    name,
    addressText,
    availableTimeText
  };
}

function normalizeDeliveryPointPatch(input: {
  name?: string;
  addressText?: string;
  availableTimeText?: string;
}) {
  const patch: {
    name?: string;
    addressText?: string;
    availableTimeText?: string;
  } = {};

  for (const field of ["name", "addressText", "availableTimeText"] as const) {
    if (input[field] !== undefined) {
      const value = input[field]?.trim();
      if (!value) {
        return null;
      }
      patch[field] = value;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function resolveAppealStatus(
  currentStatus: AppealStatus,
  action: "resolve" | "reject" | "escalate_platform" | "platform_resolve",
  role: Extract<AdminRole, "activity_admin" | "platform_admin">
): AppealStatus | null {
  if (
    currentStatus === "pending_activity_admin" &&
    action === "resolve" &&
    (role === "activity_admin" || role === "platform_admin")
  ) {
    return "resolved";
  }

  if (
    currentStatus === "pending_activity_admin" &&
    action === "escalate_platform" &&
    (role === "activity_admin" || role === "platform_admin")
  ) {
    return "escalated_platform";
  }

  if (
    currentStatus === "escalated_platform" &&
    action === "platform_resolve" &&
    role === "platform_admin"
  ) {
    return "platform_resolved";
  }

  if (
    (currentStatus === "pending_activity_admin" ||
      currentStatus === "escalated_platform") &&
    action === "reject" &&
    role === "platform_admin"
  ) {
    return "rejected";
  }

  return null;
}

async function isPlatformAdmin(prisma: PrismaClient, actorUserId: string) {
  const admin = await prisma.adminProfile.findFirst({
    where: {
      userId: actorUserId,
      role: "platform_admin",
      status: "active",
      mfaEnabled: true
    },
    select: {
      id: true
    }
  });

  return Boolean(admin);
}

async function writeDeliveryPointAuditAndOutbox(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    action: string;
    eventType: string;
    point: {
      id: string;
      communityId: string;
      name: string;
      addressText: string;
      availableTimeText: string;
      status: DeliveryPointStatus;
    };
    now: Date;
    before?: {
      name: string;
      addressText: string;
      availableTimeText: string;
      status: DeliveryPointStatus;
    };
    reason?: string;
  }
) {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "delivery_point",
      targetId: input.point.id,
      reason: input.reason,
      beforeJson: input.before
        ? {
            name: input.before.name,
            addressText: input.before.addressText,
            availableTimeText: input.before.availableTimeText,
            status: input.before.status
          }
        : undefined,
      afterJson: {
        deliveryPointId: input.point.id,
        communityId: input.point.communityId,
        name: input.point.name,
        addressText: input.point.addressText,
        availableTimeText: input.point.availableTimeText,
        status: input.point.status
      },
      createdAt: input.now
    }
  });

  await tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      targetType: "delivery_point",
      targetId: input.point.id,
      idempotencyKey: `${input.eventType}:${input.point.id}:${randomUUID()}`,
      payloadJson: {
        deliveryPointId: input.point.id,
        communityId: input.point.communityId,
        status: input.point.status
      },
      availableAt: input.now
    }
  });
}

async function loadTransactionForAppeal(
  tx: Prisma.TransactionClient,
  transactionId: string
): Promise<TransactionForAppeal | null> {
  return tx.transaction.findUnique({
    where: {
      id: transactionId
    },
    select: {
      id: true,
      buyerChildId: true,
      sellerChildId: true,
      auctionSession: {
        select: {
          item: {
            select: {
              communityId: true
            }
          }
        }
      }
    }
  });
}

async function loadTransactionGuardian(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    transaction: TransactionForAppeal;
  }
) {
  return tx.guardianChildLink.findFirst({
    where: {
      childId: {
        in: [input.transaction.buyerChildId, input.transaction.sellerChildId]
      },
      status: "active",
      child: {
        status: "active"
      },
      guardian: {
        userId: input.actorUserId,
        status: "active"
      }
    },
    select: {
      guardianId: true
    }
  });
}

async function canAccessAppeal(
  prisma: PrismaClient,
  input: {
    actorUserId: string;
    submittedByGuardianUserId: string;
    communityId: string;
  }
) {
  if (input.actorUserId === input.submittedByGuardianUserId) {
    return true;
  }

  const admin = await prisma.adminProfile.findFirst({
    where: {
      userId: input.actorUserId,
      status: "active",
      mfaEnabled: true,
      OR: [
        {
          role: "platform_admin"
        },
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
    select: {
      id: true
    }
  });

  return Boolean(admin);
}
