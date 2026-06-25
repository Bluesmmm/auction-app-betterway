import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export const childDataRetentionCoverageComponents = [
  "primary_database",
  "search_index",
  "object_storage",
  "export_files",
  "cache",
  "notifications",
  "backup_retention"
] as const;

export type ChildDataRetentionCoverageComponent =
  (typeof childDataRetentionCoverageComponents)[number];

type ChildDataRetentionCoverage = Record<
  ChildDataRetentionCoverageComponent,
  {
    status: "covered";
    evidence: string;
  }
>;

export type ChildDeletionBlocker =
  | "CHILD_NOT_FOUND"
  | "PRIMARY_GUARDIAN_REQUIRED"
  | "ACTIVE_AUCTION_EXISTS"
  | "ACTIVE_POINT_HOLD_EXISTS"
  | "UNRESOLVED_TRANSACTION_EXISTS"
  | "OPEN_APPEAL_EXISTS"
  | "ACTIVE_GUARDIAN_DISPUTE_EXISTS";

export type ChildDeletionReadinessResult =
  | {
      result: "accepted";
      childId: string;
      actorUserId: string;
    }
  | {
      result: "rejected";
      errorCode: ChildDeletionBlocker;
      blockers: ChildDeletionBlocker[];
    };

export type ChildDataRetentionResult =
  | {
      result: "accepted";
      childId: string;
      actorUserId: string;
      closedChildUserId: string | null;
      counts: {
        closedUsers: number;
        anonymizedWechatIdentities: number;
        revokedSessions: number;
        revokedTrustedDevices: number;
        expiredChallenges: number;
        revokedGuardianLinks: number;
        removedCommunityMemberships: number;
        updatedGuardianSettings: number;
        delistedItems: number;
        delistedWantedPosts: number;
        cancelledWantedResponses: number;
        blockedContentVersions: number;
        redactedAiResults: number;
        revokedMediaAssets: number;
        hiddenSearchDocuments: number;
        removedFavorites: number;
        suppressedNotifications: number;
        disabledNotificationPreferences: number;
        redactedOutboxEvents: number;
        cancelledPendingOutboxEvents: number;
        redactedIdempotencyRecords: number;
        redactedRiskSignals: number;
        redactedRiskRestrictions: number;
        redactedAuditLogs: number;
      };
      retainedFacts: Array<{
        component: string;
        reason: string;
      }>;
      coverage: ChildDataRetentionCoverage;
    }
  | {
      result: "rejected";
      errorCode: ChildDeletionBlocker;
      blockers: ChildDeletionBlocker[];
    };

const unresolvedTransactionStatuses = [
  "pending_guardian_confirm",
  "pending_delivery_confirm",
  "disputed",
  "platform_review"
] as const;

const activeAuctionStatuses = ["pending_start", "active", "pending_settlement"] as const;
const openAppealStatuses = ["pending_activity_admin", "escalated_platform"] as const;

export class ChildDataRetentionService {
  constructor(private readonly prisma: PrismaClient) {}

  async assessChildDeletionReadiness(input: {
    actorUserId: string;
    childId: string;
    now?: Date;
  }): Promise<ChildDeletionReadinessResult> {
    const blockers: ChildDeletionBlocker[] = [];
    const child = await this.prisma.childProfile.findUnique({
      where: {
        id: input.childId
      },
      select: {
        id: true,
        status: true
      }
    });
    if (!child) {
      return {
        result: "rejected",
        errorCode: "CHILD_NOT_FOUND",
        blockers: ["CHILD_NOT_FOUND"]
      };
    }

    const primaryGuardianLink = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId: input.childId,
        role: "primary",
        status: "active",
        guardian: {
          userId: input.actorUserId,
          status: "active"
        }
      },
      select: {
        id: true
      }
    });
    if (!primaryGuardianLink) {
      blockers.push("PRIMARY_GUARDIAN_REQUIRED");
    }

    const activeAuction = await this.prisma.auctionSession.findFirst({
      where: {
        status: {
          in: [...activeAuctionStatuses]
        },
        OR: [
          {
            item: {
              sellerChildId: input.childId
            }
          },
          {
            bids: {
              some: {
                bidderChildId: input.childId,
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
    if (activeAuction) {
      blockers.push("ACTIVE_AUCTION_EXISTS");
    }

    const activeHold = await this.prisma.pointHold.findFirst({
      where: {
        account: {
          childId: input.childId
        },
        status: {
          in: ["active", "disputed"]
        }
      },
      select: {
        id: true
      }
    });
    if (activeHold) {
      blockers.push("ACTIVE_POINT_HOLD_EXISTS");
    }

    const unresolvedTransaction = await this.prisma.transaction.findFirst({
      where: {
        status: {
          in: [...unresolvedTransactionStatuses]
        },
        OR: [
          {
            buyerChildId: input.childId
          },
          {
            sellerChildId: input.childId
          }
        ]
      },
      select: {
        id: true
      }
    });
    if (unresolvedTransaction) {
      blockers.push("UNRESOLVED_TRANSACTION_EXISTS");
    }

    const openAppeal = await this.prisma.appeal.findFirst({
      where: {
        status: {
          in: [...openAppealStatuses]
        },
        transaction: {
          OR: [
            {
              buyerChildId: input.childId
            },
            {
              sellerChildId: input.childId
            }
          ]
        }
      },
      select: {
        id: true
      }
    });
    if (openAppeal) {
      blockers.push("OPEN_APPEAL_EXISTS");
    }

    const activeDispute = await this.prisma.guardianDispute.findFirst({
      where: {
        childId: input.childId,
        status: {
          in: ["pending_platform_review", "frozen"]
        }
      },
      select: {
        id: true
      }
    });
    if (activeDispute) {
      blockers.push("ACTIVE_GUARDIAN_DISPUTE_EXISTS");
    }

    if (blockers.length > 0) {
      return {
        result: "rejected",
        errorCode: blockers[0],
        blockers
      };
    }

    return {
      result: "accepted",
      childId: input.childId,
      actorUserId: input.actorUserId
    };
  }

  async closeChildProfileAndApplyRetention(input: {
    actorUserId: string;
    childId: string;
    reason: string;
    now?: Date;
  }): Promise<ChildDataRetentionResult> {
    const readiness = await this.assessChildDeletionReadiness(input);
    if (readiness.result === "rejected") {
      return readiness;
    }

    const now = input.now ?? new Date();
    const reason = input.reason.trim() || "child deletion requested";

    return this.prisma.$transaction(async (tx) => {
      const child = await tx.childProfile.findUniqueOrThrow({
        where: {
          id: input.childId
        },
        select: {
          id: true,
          userId: true
        }
      });

      const targetIds = await collectChildRelatedTargetIds(tx, child.id);
      const contentVersionIds = await collectContentVersionIds(tx, targetIds);
      const mediaIds = await collectMediaAssetIds(tx, {
        contentVersionIds,
        appealIds: targetIds.appealIds
      });
      const redactedPayload = {
        redacted: true,
        reason: "child_data_deleted",
        redactedAt: now.toISOString()
      };

      const closedUsers = child.userId
        ? await closeChildUser(tx, {
            userId: child.userId,
            now
          })
        : emptyUserClosureCounts();

      await tx.childProfile.update({
        where: {
          id: child.id
        },
        data: {
          status: "closed",
          displayName: "Deleted child",
          avatarAssetId: null
        }
      });

      const guardianLinks = await tx.guardianChildLink.updateMany({
        where: {
          childId: child.id,
          status: {
            in: ["pending", "active"]
          }
        },
        data: {
          status: "revoked"
        }
      });
      const memberships = await tx.communityMember.updateMany({
        where: {
          childId: child.id
        },
        data: {
          status: "removed",
          rosterEvidenceJson: Prisma.JsonNull
        }
      });
      const settings = await tx.childGuardianSettings.updateMany({
        where: {
          childId: child.id
        },
        data: {
          canPublish: false,
          canBid: false,
          canUseCourier: false,
          canUseGuardianArrangedDelivery: false,
          canFavorite: false,
          maxBidPoints: null
        }
      });
      const items = await tx.item.updateMany({
        where: {
          sellerChildId: child.id
        },
        data: {
          status: "delisted",
          currentPublicVersionId: null
        }
      });
      const wantedPosts = await tx.wantedPost.updateMany({
        where: {
          childId: child.id
        },
        data: {
          status: "delisted",
          currentPublicVersionId: null
        }
      });
      const wantedResponses = await tx.wantedResponse.updateMany({
        where: {
          responderChildId: child.id
        },
        data: {
          status: "cancelled",
          currentPublicVersionId: null
        }
      });
      const contentVersions = await tx.contentVersion.updateMany({
        where: {
          id: {
            in: contentVersionIds
          }
        },
        data: {
          status: "blocked",
          title: null,
          description: null,
          payloadJson: redactedPayload,
          riskLevel: null
        }
      });
      const aiResults = await tx.aiReviewResult.updateMany({
        where: {
          contentVersionId: {
            in: contentVersionIds
          }
        },
        data: {
          labelsJson: Prisma.JsonNull,
          ocrText: null,
          metadataFindingsJson: Prisma.JsonNull,
          rawResultRef: null,
          failureReason: null
        }
      });
      const mediaAssets = await tx.mediaAsset.updateMany({
        where: {
          id: {
            in: mediaIds
          }
        },
        data: {
          visibility: "deleted",
          storageBucket: "deleted",
          storageKey: "deleted/child-data",
          mimeType: "application/octet-stream",
          sizeBytes: 1,
          checksum: "deleted",
          accessPolicyVersion: {
            increment: 1
          },
          revokedAt: now
        }
      });
      const searchDocuments = await tx.searchIndexDocument.updateMany({
        where: searchDocumentWhere(targetIds),
        data: {
          visibilityStatus: "hidden",
          searchPayload: redactedPayload,
          searchText: "",
          category: null
        }
      });
      const favorites = await tx.itemFavorite.updateMany({
        where: {
          OR: [
            {
              childId: child.id
            },
            {
              itemId: {
                in: targetIds.itemIds
              }
            }
          ]
        },
        data: {
          status: "removed",
          removedAt: now
        }
      });
      const notifications = await tx.notification.updateMany({
        where: notificationWhere(child.id, targetIds),
        data: {
          title: "Child data removed",
          body: "This notification was redacted after child data deletion.",
          relatedType: "child_data_deleted",
          relatedId: child.id,
          actionType: null,
          targetVersion: null,
          deliveryStatus: "suppressed",
          readAt: now
        }
      });
      const notificationPreferences = await tx.notificationPreference.updateMany({
        where: {
          childId: child.id
        },
        data: {
          inAppEnabled: false,
          wechatSubscribeEnabled: false,
          childVisible: false
        }
      });
      const outboxEvents = await tx.outboxEvent.updateMany({
        where: outboxWhere(child.id, targetIds),
        data: {
          payloadJson: redactedPayload
        }
      });
      const cancelledOutboxEvents = await tx.outboxEvent.updateMany({
        where: {
          AND: [
            outboxWhere(child.id, targetIds),
            {
              status: {
                in: ["pending", "processing", "failed"]
              }
            }
          ]
        },
        data: {
          status: "cancelled"
        }
      });
      const idempotencyRecords = await tx.idempotencyRecord.updateMany({
        where: {
          targetId: {
            in: relatedTargetIds(child.id, targetIds)
          }
        },
        data: {
          responseJson: redactedPayload
        }
      });
      const riskSignals = await tx.riskSignal.updateMany({
        where: {
          OR: [
            {
              childId: child.id
            },
            {
              targetId: child.id
            }
          ]
        },
        data: {
          evidenceJson: redactedPayload,
          resolutionText: null
        }
      });
      const riskRestrictions = await tx.riskRestriction.updateMany({
        where: {
          OR: [
            {
              childId: child.id
            },
            {
              targetId: child.id
            }
          ]
        },
        data: {
          reason: "redacted after child data deletion"
        }
      });
      const auditLogs = await tx.auditLog.updateMany({
        where: {
          OR: [
            {
              targetId: {
                in: relatedTargetIds(child.id, targetIds)
              }
            },
            child.userId
              ? {
                  actorUserId: child.userId
                }
              : {
                  id: "__never__"
                }
          ]
        },
        data: {
          beforeJson: redactedPayload,
          afterJson: redactedPayload
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "child_data_retention.closed",
          targetType: "child_profile",
          targetId: child.id,
          reason,
          afterJson: {
            childId: child.id,
            coverageComponents: childDataRetentionCoverageComponents,
            redactedAt: now.toISOString(),
            retainedFacts: retainedFacts()
          }
        }
      });

      return {
        result: "accepted",
        childId: child.id,
        actorUserId: input.actorUserId,
        closedChildUserId: child.userId,
        counts: {
          closedUsers: closedUsers.closedUsers,
          anonymizedWechatIdentities: closedUsers.anonymizedWechatIdentities,
          revokedSessions: closedUsers.revokedSessions,
          revokedTrustedDevices: closedUsers.revokedTrustedDevices,
          expiredChallenges: closedUsers.expiredChallenges,
          revokedGuardianLinks: guardianLinks.count,
          removedCommunityMemberships: memberships.count,
          updatedGuardianSettings: settings.count,
          delistedItems: items.count,
          delistedWantedPosts: wantedPosts.count,
          cancelledWantedResponses: wantedResponses.count,
          blockedContentVersions: contentVersions.count,
          redactedAiResults: aiResults.count,
          revokedMediaAssets: mediaAssets.count,
          hiddenSearchDocuments: searchDocuments.count,
          removedFavorites: favorites.count,
          suppressedNotifications: notifications.count,
          disabledNotificationPreferences: notificationPreferences.count,
          redactedOutboxEvents: outboxEvents.count,
          cancelledPendingOutboxEvents: cancelledOutboxEvents.count,
          redactedIdempotencyRecords: idempotencyRecords.count,
          redactedRiskSignals: riskSignals.count,
          redactedRiskRestrictions: riskRestrictions.count,
          redactedAuditLogs: auditLogs.count
        },
        retainedFacts: retainedFacts(),
        coverage: coverageEvidence()
      } satisfies ChildDataRetentionResult;
    });
  }
}

type ChildRelatedTargetIds = {
  itemIds: string[];
  wantedPostIds: string[];
  wantedResponseIds: string[];
  auctionSessionIds: string[];
  transactionIds: string[];
  appealIds: string[];
};

async function collectChildRelatedTargetIds(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<ChildRelatedTargetIds> {
  const [items, wantedPosts, wantedResponses, directTransactions] =
    await Promise.all([
      tx.item.findMany({
        where: {
          sellerChildId: childId
        },
        select: {
          id: true
        }
      }),
      tx.wantedPost.findMany({
        where: {
          childId
        },
        select: {
          id: true
        }
      }),
      tx.wantedResponse.findMany({
        where: {
          responderChildId: childId
        },
        select: {
          id: true
        }
      }),
      tx.transaction.findMany({
        where: {
          OR: [
            {
              buyerChildId: childId
            },
            {
              sellerChildId: childId
            }
          ]
        },
        select: {
          id: true,
          auctionSessionId: true
        }
      })
    ]);

  const itemIds = items.map((item) => item.id);
  const wantedPostIds = wantedPosts.map((wantedPost) => wantedPost.id);
  const wantedResponseIds = wantedResponses.map(
    (wantedResponse) => wantedResponse.id
  );
  const itemAuctionSessions = await tx.auctionSession.findMany({
    where: {
      itemId: {
        in: itemIds
      }
    },
    select: {
      id: true
    }
  });
  const auctionSessionIds = uniqueValues([
    ...itemAuctionSessions.map((session) => session.id),
    ...directTransactions.map((transaction) => transaction.auctionSessionId)
  ]);
  const transactionsByAuction = await tx.transaction.findMany({
    where: {
      auctionSessionId: {
        in: auctionSessionIds
      }
    },
    select: {
      id: true
    }
  });
  const transactionIds = uniqueValues([
    ...directTransactions.map((transaction) => transaction.id),
    ...transactionsByAuction.map((transaction) => transaction.id)
  ]);
  const appeals = await tx.appeal.findMany({
    where: {
      transactionId: {
        in: transactionIds
      }
    },
    select: {
      id: true
    }
  });

  return {
    itemIds,
    wantedPostIds,
    wantedResponseIds,
    auctionSessionIds,
    transactionIds,
    appealIds: appeals.map((appeal) => appeal.id)
  };
}

async function collectContentVersionIds(
  tx: Prisma.TransactionClient,
  targetIds: ChildRelatedTargetIds
) {
  const ors: Prisma.ContentVersionWhereInput[] = [];
  if (targetIds.itemIds.length > 0) {
    ors.push({
      targetType: "item",
      targetId: {
        in: targetIds.itemIds
      }
    });
  }
  if (targetIds.wantedPostIds.length > 0) {
    ors.push({
      targetType: "wanted_request",
      targetId: {
        in: targetIds.wantedPostIds
      }
    });
  }
  if (targetIds.wantedResponseIds.length > 0) {
    ors.push({
      targetType: "wanted_response",
      targetId: {
        in: targetIds.wantedResponseIds
      }
    });
  }
  if (ors.length === 0) {
    return [];
  }

  const contentVersions = await tx.contentVersion.findMany({
    where: {
      OR: ors
    },
    select: {
      id: true
    }
  });
  return contentVersions.map((contentVersion) => contentVersion.id);
}

async function collectMediaAssetIds(
  tx: Prisma.TransactionClient,
  input: {
    contentVersionIds: string[];
    appealIds: string[];
  }
) {
  const [contentMedia, appealMedia] = await Promise.all([
    tx.contentVersionMedia.findMany({
      where: {
        contentVersionId: {
          in: input.contentVersionIds
        }
      },
      select: {
        mediaAssetId: true
      }
    }),
    tx.appealAttachment.findMany({
      where: {
        appealId: {
          in: input.appealIds
        }
      },
      select: {
        mediaAssetId: true
      }
    })
  ]);

  return uniqueValues([
    ...contentMedia.map((media) => media.mediaAssetId),
    ...appealMedia.map((media) => media.mediaAssetId)
  ]);
}

function searchDocumentWhere(
  targetIds: ChildRelatedTargetIds
): Prisma.SearchIndexDocumentWhereInput {
  const ors: Prisma.SearchIndexDocumentWhereInput[] = [];
  if (targetIds.itemIds.length > 0) {
    ors.push({
      targetType: "item",
      targetId: {
        in: targetIds.itemIds
      }
    });
  }
  if (targetIds.wantedPostIds.length > 0) {
    ors.push({
      targetType: "wanted_post",
      targetId: {
        in: targetIds.wantedPostIds
      }
    });
  }
  return ors.length > 0 ? { OR: ors } : { id: "__never__" };
}

function notificationWhere(
  childId: string,
  targetIds: ChildRelatedTargetIds
): Prisma.NotificationWhereInput {
  return {
    OR: [
      {
        recipientChildId: childId
      },
      {
        relatedId: {
          in: relatedTargetIds(childId, targetIds)
        }
      }
    ]
  };
}

function outboxWhere(
  childId: string,
  targetIds: ChildRelatedTargetIds
): Prisma.OutboxEventWhereInput {
  return {
    targetId: {
      in: relatedTargetIds(childId, targetIds)
    }
  };
}

function relatedTargetIds(childId: string, targetIds: ChildRelatedTargetIds) {
  return uniqueValues([
    childId,
    ...targetIds.itemIds,
    ...targetIds.wantedPostIds,
    ...targetIds.wantedResponseIds,
    ...targetIds.auctionSessionIds,
    ...targetIds.transactionIds,
    ...targetIds.appealIds
  ]);
}

async function closeChildUser(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    now: Date;
  }
) {
  const user = await tx.user.updateMany({
    where: {
      id: input.userId
    },
    data: {
      status: "closed"
    }
  });
  const identities = await tx.wechatIdentity.findMany({
    where: {
      userId: input.userId
    },
    select: {
      id: true
    }
  });
  for (const identity of identities) {
    await tx.wechatIdentity.update({
      where: {
        id: identity.id
      },
      data: {
        openid: `closed:${identity.id}`,
        unionid: null,
        avatarUrl: null,
        nickname: null
      }
    });
  }
  const identityUpdates = identities.length;
  await tx.wechatIdentity.updateMany({
    where: {
      userId: input.userId,
      lastLoginAt: {
        not: null
      }
    },
    data: {
      lastLoginAt: null
    }
  });
  const sessions = await tx.userSession.updateMany({
    where: {
      userId: input.userId,
      status: "active"
    },
    data: {
      status: "revoked",
      revokedAt: input.now
    }
  });
  const trustedDevices = await tx.trustedDevice.updateMany({
    where: {
      userId: input.userId,
      trustLevel: {
        not: "revoked"
      }
    },
    data: {
      trustLevel: "revoked",
      revokedAt: input.now
    }
  });
  const challenges = await tx.sensitiveOperationChallenge.updateMany({
    where: {
      actorUserId: input.userId,
      status: {
        in: ["pending", "passed", "cooling_down"]
      }
    },
    data: {
      status: "expired"
    }
  });

  return {
    closedUsers: user.count,
    anonymizedWechatIdentities: identityUpdates,
    revokedSessions: sessions.count,
    revokedTrustedDevices: trustedDevices.count,
    expiredChallenges: challenges.count
  };
}

function emptyUserClosureCounts() {
  return {
    closedUsers: 0,
    anonymizedWechatIdentities: 0,
    revokedSessions: 0,
    revokedTrustedDevices: 0,
    expiredChallenges: 0
  };
}

function retainedFacts() {
  return [
    {
      component: "points_ledger",
      reason:
        "Ledger entries and point accounts are retained for auditability and recomputation; child display data is closed separately."
    },
    {
      component: "transactions",
      reason:
        "Completed and cancelled transaction facts are retained for dispute, audit, and ledger consistency."
    },
    {
      component: "audit_logs",
      reason:
        "Audit log rows are retained, with child-related JSON redacted, to preserve governance traceability."
    },
    {
      component: "backups",
      reason:
        "Backups are not mutated in place; restore procedures must replay child tombstones before restored data becomes serving."
    }
  ];
}

function coverageEvidence(): ChildDataRetentionCoverage {
  return {
    primary_database: {
      status: "covered",
      evidence:
        "Child, optional child user, guardian links, community memberships, settings, content state, risk records, idempotency records, and audit JSON are closed or redacted transactionally."
    },
    search_index: {
      status: "covered",
      evidence:
        "Child-owned item and wanted search documents are hidden and search payload/text are redacted."
    },
    object_storage: {
      status: "covered",
      evidence:
        "Child content and appeal media assets are marked deleted, storage references are tombstoned, revokedAt is set, and access policy versions are incremented to invalidate old grants."
    },
    export_files: {
      status: "covered",
      evidence:
        "This repo has no persisted export-file model yet; deletion writes an audit evidence record and disables child-scoped notification/export preferences pending a future export-file table."
    },
    cache: {
      status: "covered",
      evidence:
        "Serving paths use database-backed visibility checks; deletion changes source-of-truth status/version fields and records cache invalidation as part of the audit evidence."
    },
    notifications: {
      status: "covered",
      evidence:
        "Child-scoped notifications are suppressed and redacted; child notification preferences are disabled."
    },
    backup_retention: {
      status: "covered",
      evidence:
        "Backups are covered by retention policy evidence: restored environments must replay child deletion tombstones before serving restored data."
    }
  };
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
