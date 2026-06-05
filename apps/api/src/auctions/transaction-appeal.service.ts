import type {
  AppealAttachmentStatus,
  AppealStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type { ContentSafetyProvider } from "../providers/provider-contracts.js";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service.js";

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
    appealGrantSigningKey = "stage6-appeal-grant-key"
  ) {
    this.storage = new PrivateObjectStorageService(appealGrantSigningKey);
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
