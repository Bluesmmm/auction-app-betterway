import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  ChildDataRetentionService,
  childDataRetentionCoverageComponents
} from "../../src/accounts/child-data-retention.service.js";
import { ContentFileAccessService } from "../../src/content/content-file-access.service.js";
import { PrivateObjectStorageService } from "../../src/storage/private-object-storage.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const retention = new ChildDataRetentionService(prisma);
const objectGrantSigningKey = "stage9-deletion-retention-object-grant-key";

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = {
  childId: string;
  childUserId: string | null;
  guardianUserId: string;
  guardianId: string;
  pointAccountId: string;
};

type RetentionFixture = ChildFixture & {
  communityId: string;
  itemId: string;
  contentVersionId: string;
  mediaAssetId: string;
  outboxEventId: string;
  notificationId: string;
  idempotencyRecordId: string;
  riskSignalId: string;
  riskRestrictionId: string;
  auditLogId: string;
  oldIdentityOpenid: string;
  oldGrantToken: string;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "ChildDataRetentionService integration tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "ChildDataRetentionService integration tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("ChildDataRetentionService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects child deletion while active business and governance facts are unresolved", async () => {
    const fixture = await createDeletionBlockerFixture("retention_blockers");

    const readiness = await retention.assessChildDeletionReadiness({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        result: "rejected",
        errorCode: "ACTIVE_AUCTION_EXISTS"
      })
    );
    if (readiness.result !== "rejected") {
      throw new Error("expected readiness rejection");
    }
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        "ACTIVE_AUCTION_EXISTS",
        "ACTIVE_POINT_HOLD_EXISTS",
        "UNRESOLVED_TRANSACTION_EXISTS",
        "OPEN_APPEAL_EXISTS",
        "ACTIVE_GUARDIAN_DISPUTE_EXISTS"
      ])
    );
  });

  it("closes child data and applies retention across database, search, media grants, notifications, outbox, cache, exports, and backups", async () => {
    const fixture = await createRetentionFixture("retention_close");
    const fileAccess = new ContentFileAccessService(prisma, objectGrantSigningKey);

    await expect(
      fileAccess.verifyItemImageGrant({
        grantToken: fixture.oldGrantToken,
        granteeUserId: fixture.guardianUserId,
        purpose: "item_image_view",
        now: new Date("2026-06-24T10:05:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        mediaAssetId: fixture.mediaAssetId
      })
    );

    const result = await retention.closeChildProfileAndApplyRetention({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      reason: "guardian deletion request",
      now: new Date("2026-06-24T10:15:00.000Z")
    });

    expect(result).toEqual(
      expect.objectContaining({
        result: "accepted",
        childId: fixture.childId,
        actorUserId: fixture.guardianUserId,
        closedChildUserId: fixture.childUserId
      })
    );
    if (result.result !== "accepted") {
      throw new Error("expected accepted deletion retention result");
    }
    expect(Object.keys(result.coverage).sort()).toEqual(
      [...childDataRetentionCoverageComponents].sort()
    );
    expect(result.coverage.object_storage.status).toBe("covered");
    expect(result.coverage.search_index.status).toBe("covered");
    expect(result.coverage.export_files.status).toBe("covered");
    expect(result.coverage.cache.status).toBe("covered");
    expect(result.coverage.backup_retention.status).toBe("covered");
    expect(result.retainedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "points_ledger" }),
        expect.objectContaining({ component: "transactions" }),
        expect.objectContaining({ component: "audit_logs" }),
        expect.objectContaining({ component: "backups" })
      ])
    );
    expect(result.counts).toEqual(
      expect.objectContaining({
        closedUsers: 1,
        anonymizedWechatIdentities: 1,
        revokedSessions: 1,
        revokedTrustedDevices: 1,
        expiredChallenges: 1,
        revokedGuardianLinks: 1,
        removedCommunityMemberships: 1,
        updatedGuardianSettings: 1,
        delistedItems: 1,
        blockedContentVersions: 1,
        redactedAiResults: 1,
        revokedMediaAssets: 1,
        hiddenSearchDocuments: 1,
        removedFavorites: 1,
        suppressedNotifications: 1,
        disabledNotificationPreferences: 1,
        redactedOutboxEvents: 1,
        cancelledPendingOutboxEvents: 1,
        redactedIdempotencyRecords: 1,
        redactedRiskSignals: 1,
        redactedRiskRestrictions: 1,
        redactedAuditLogs: 1
      })
    );

    await expect(
      prisma.childProfile.findUnique({
        where: { id: fixture.childId },
        select: {
          status: true,
          displayName: true,
          avatarAssetId: true
        }
      })
    ).resolves.toEqual({
      status: "closed",
      displayName: "Deleted child",
      avatarAssetId: null
    });
    await expect(
      prisma.user.findUnique({
        where: { id: fixture.childUserId ?? "" },
        select: { status: true }
      })
    ).resolves.toEqual({ status: "closed" });

    const identity = await prisma.wechatIdentity.findFirstOrThrow({
      where: { userId: fixture.childUserId ?? "" },
      select: {
        openid: true,
        unionid: true,
        avatarUrl: true,
        nickname: true,
        lastLoginAt: true
      }
    });
    expect(identity.openid).not.toBe(fixture.oldIdentityOpenid);
    expect(identity.openid).toMatch(/^closed:/);
    expect(identity).toEqual(
      expect.objectContaining({
        unionid: null,
        avatarUrl: null,
        nickname: null,
        lastLoginAt: null
      })
    );

    await expect(
      prisma.userSession.findFirst({
        where: { userId: fixture.childUserId ?? "" },
        select: { status: true, revokedAt: true }
      })
    ).resolves.toEqual({
      status: "revoked",
      revokedAt: new Date("2026-06-24T10:15:00.000Z")
    });
    await expect(
      prisma.trustedDevice.findFirst({
        where: { userId: fixture.childUserId ?? "" },
        select: { trustLevel: true, revokedAt: true }
      })
    ).resolves.toEqual({
      trustLevel: "revoked",
      revokedAt: new Date("2026-06-24T10:15:00.000Z")
    });
    await expect(
      prisma.sensitiveOperationChallenge.findFirst({
        where: { actorUserId: fixture.childUserId ?? "" },
        select: { status: true }
      })
    ).resolves.toEqual({ status: "expired" });

    await expect(
      prisma.guardianChildLink.findFirst({
        where: { childId: fixture.childId },
        select: { status: true }
      })
    ).resolves.toEqual({ status: "revoked" });
    await expect(
      prisma.communityMember.findFirst({
        where: { childId: fixture.childId },
        select: {
          status: true,
          rosterEvidenceJson: true
        }
      })
    ).resolves.toEqual({
      status: "removed",
      rosterEvidenceJson: null
    });
    await expect(
      prisma.childGuardianSettings.findUnique({
        where: { childId: fixture.childId },
        select: {
          canPublish: true,
          canBid: true,
          canUseCourier: true,
          canUseGuardianArrangedDelivery: true,
          canFavorite: true,
          maxBidPoints: true
        }
      })
    ).resolves.toEqual({
      canPublish: false,
      canBid: false,
      canUseCourier: false,
      canUseGuardianArrangedDelivery: false,
      canFavorite: false,
      maxBidPoints: null
    });

    await expect(
      prisma.item.findUnique({
        where: { id: fixture.itemId },
        select: {
          status: true,
          currentPublicVersionId: true
        }
      })
    ).resolves.toEqual({
      status: "delisted",
      currentPublicVersionId: null
    });
    await expect(
      prisma.contentVersion.findUnique({
        where: { id: fixture.contentVersionId },
        select: {
          status: true,
          title: true,
          description: true,
          payloadJson: true,
          riskLevel: true
        }
      })
    ).resolves.toEqual({
      status: "blocked",
      title: null,
      description: null,
      payloadJson: expect.objectContaining({ redacted: true }),
      riskLevel: null
    });
    await expect(
      prisma.aiReviewResult.findFirst({
        where: { contentVersionId: fixture.contentVersionId },
        select: {
          labelsJson: true,
          ocrText: true,
          metadataFindingsJson: true,
          rawResultRef: true,
          failureReason: true
        }
      })
    ).resolves.toEqual({
      labelsJson: null,
      ocrText: null,
      metadataFindingsJson: null,
      rawResultRef: null,
      failureReason: null
    });

    await expect(
      prisma.mediaAsset.findUnique({
        where: { id: fixture.mediaAssetId },
        select: {
          visibility: true,
          storageBucket: true,
          storageKey: true,
          sizeBytes: true,
          checksum: true,
          accessPolicyVersion: true,
          revokedAt: true
        }
      })
    ).resolves.toEqual({
      visibility: "deleted",
      storageBucket: "deleted",
      storageKey: "deleted/child-data",
      sizeBytes: 1,
      checksum: "deleted",
      accessPolicyVersion: 2,
      revokedAt: new Date("2026-06-24T10:15:00.000Z")
    });
    await expect(
      fileAccess.verifyItemImageGrant({
        grantToken: fixture.oldGrantToken,
        granteeUserId: fixture.guardianUserId,
        purpose: "item_image_view",
        now: new Date("2026-06-24T10:20:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "rejected"
      })
    );

    await expect(
      prisma.searchIndexDocument.findUnique({
        where: {
          targetType_targetId: {
            targetType: "item",
            targetId: fixture.itemId
          }
        },
        select: {
          visibilityStatus: true,
          searchPayload: true,
          searchText: true,
          category: true,
          sourceVersion: true
        }
      })
    ).resolves.toEqual({
      visibilityStatus: "hidden",
      searchPayload: expect.objectContaining({ redacted: true }),
      searchText: "",
      category: null,
      sourceVersion: 1
    });
    await expect(
      prisma.itemFavorite.findFirst({
        where: { childId: fixture.childId },
        select: {
          status: true,
          removedAt: true
        }
      })
    ).resolves.toEqual({
      status: "removed",
      removedAt: new Date("2026-06-24T10:15:00.000Z")
    });
    await expect(
      prisma.notification.findUnique({
        where: { id: fixture.notificationId },
        select: {
          title: true,
          body: true,
          relatedType: true,
          relatedId: true,
          actionType: true,
          targetVersion: true,
          deliveryStatus: true,
          readAt: true
        }
      })
    ).resolves.toEqual({
      title: "Child data removed",
      body: "This notification was redacted after child data deletion.",
      relatedType: "child_data_deleted",
      relatedId: fixture.childId,
      actionType: null,
      targetVersion: null,
      deliveryStatus: "suppressed",
      readAt: new Date("2026-06-24T10:15:00.000Z")
    });
    await expect(
      prisma.notificationPreference.findFirst({
        where: { childId: fixture.childId },
        select: {
          inAppEnabled: true,
          wechatSubscribeEnabled: true,
          childVisible: true
        }
      })
    ).resolves.toEqual({
      inAppEnabled: false,
      wechatSubscribeEnabled: false,
      childVisible: false
    });
    await expect(
      prisma.outboxEvent.findUnique({
        where: { id: fixture.outboxEventId },
        select: {
          status: true,
          payloadJson: true
        }
      })
    ).resolves.toEqual({
      status: "cancelled",
      payloadJson: expect.objectContaining({ redacted: true })
    });
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: { id: fixture.idempotencyRecordId },
        select: { responseJson: true }
      })
    ).resolves.toEqual({
      responseJson: expect.objectContaining({ redacted: true })
    });
    await expect(
      prisma.riskSignal.findUnique({
        where: { id: fixture.riskSignalId },
        select: {
          evidenceJson: true,
          resolutionText: true
        }
      })
    ).resolves.toEqual({
      evidenceJson: expect.objectContaining({ redacted: true }),
      resolutionText: null
    });
    await expect(
      prisma.riskRestriction.findUnique({
        where: { id: fixture.riskRestrictionId },
        select: { reason: true }
      })
    ).resolves.toEqual({
      reason: "redacted after child data deletion"
    });
    await expect(
      prisma.auditLog.findUnique({
        where: { id: fixture.auditLogId },
        select: {
          beforeJson: true,
          afterJson: true
        }
      })
    ).resolves.toEqual({
      beforeJson: expect.objectContaining({ redacted: true }),
      afterJson: expect.objectContaining({ redacted: true })
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "child_data_retention.closed",
          targetId: fixture.childId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.pointLedgerEntry.count({
        where: { childId: fixture.childId }
      })
    ).resolves.toBeGreaterThan(0);
  });
});

async function createDeletionBlockerFixture(label: string): Promise<ChildFixture> {
  const child = await createChildWithPrimaryGuardian(`${label}_child`, {
    withChildUser: false,
    availablePoints: 100,
    frozenPoints: 40
  });
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`, {
    withChildUser: false,
    availablePoints: 60,
    frozenPoints: 0
  });
  const community = await createCommunity(`${label}_community`, child.guardianId);

  await prisma.item
    .create({
      data: {
        communityId: community.id,
        sellerChildId: child.childId,
        status: "listed",
        startPoints: 10,
        minIncrementPoints: 1
      }
    })
    .then((item) =>
      prisma.auctionSession.create({
        data: {
          itemId: item.id,
          idempotencyKey: unique(`${label}_active_auction`),
          status: "active",
          startAt: new Date("2026-06-24T09:00:00.000Z"),
          endAt: new Date("2026-06-24T12:00:00.000Z"),
          startPoints: 10,
          minIncrementPoints: 1,
          currentPricePoints: 10
        }
      })
    );

  const transactionItem = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 40,
      minIncrementPoints: 5
    }
  });
  const settledAuction = await prisma.auctionSession.create({
    data: {
      itemId: transactionItem.id,
      idempotencyKey: unique(`${label}_settled_auction`),
      status: "settled",
      startAt: new Date("2026-06-24T07:00:00.000Z"),
      endAt: new Date("2026-06-24T08:00:00.000Z"),
      startPoints: 40,
      minIncrementPoints: 5,
      currentPricePoints: 40,
      highestBidderChildId: child.childId,
      settledAt: new Date("2026-06-24T08:01:00.000Z")
    }
  });
  const bid = await prisma.bid.create({
    data: {
      auctionSessionId: settledAuction.id,
      bidderChildId: child.childId,
      amountPoints: 40,
      status: "active",
      idempotencyKey: unique(`${label}_bid`),
      createdAt: new Date("2026-06-24T07:30:00.000Z")
    }
  });
  await prisma.auctionSession.update({
    where: { id: settledAuction.id },
    data: { highestBidId: bid.id }
  });
  const hold = await prisma.pointHold.create({
    data: {
      accountId: child.pointAccountId,
      auctionSessionId: settledAuction.id,
      bidId: bid.id,
      amountPoints: 40,
      status: "active"
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: settledAuction.id,
      buyerChildId: child.childId,
      sellerChildId: seller.childId,
      pointHoldId: hold.id,
      pointsAmount: 40,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-25T08:01:00.000Z")
    }
  });
  await prisma.appeal.create({
    data: {
      targetType: "transaction",
      targetId: transaction.id,
      transactionId: transaction.id,
      submittedByGuardianId: child.guardianId,
      communityId: community.id,
      status: "pending_activity_admin",
      reason: "appeal evidence pending"
    }
  });
  await prisma.guardianDispute.create({
    data: {
      childId: child.childId,
      submittingGuardianId: child.guardianId,
      type: "deletion",
      status: "frozen",
      frozenAt: new Date("2026-06-24T08:30:00.000Z")
    }
  });

  return child;
}

async function createRetentionFixture(label: string): Promise<RetentionFixture> {
  const child = await createChildWithPrimaryGuardian(`${label}_child`, {
    withChildUser: true,
    availablePoints: 100,
    frozenPoints: 0
  });
  if (!child.childUserId) {
    throw new Error("retention fixture requires child user");
  }
  const community = await createCommunity(`${label}_community`, child.guardianId);

  await prisma.communityMember.create({
    data: {
      communityId: community.id,
      childId: child.childId,
      status: "active",
      rosterVerificationStatus: "matched",
      guardianConfirmedAt: new Date("2026-06-24T09:01:00.000Z"),
      adminReviewedAt: new Date("2026-06-24T09:02:00.000Z"),
      joinedAt: new Date("2026-06-24T09:03:00.000Z"),
      rosterEvidenceJson: {
        importedName: "Child Name",
        classRoom: "3A"
      }
    }
  });

  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: child.childId,
      status: "approved",
      startPoints: 20,
      minIncrementPoints: 2
    }
  });
  const contentVersion = await prisma.contentVersion.create({
    data: {
      targetType: "item",
      targetId: item.id,
      versionNo: 1,
      status: "approved",
      title: "Child bicycle",
      description: "Blue bicycle with child pickup details",
      payloadJson: {
        privateNote: "child phone and pickup route"
      },
      riskLevel: "low",
      approvedAt: new Date("2026-06-24T09:10:00.000Z")
    }
  });
  await prisma.item.update({
    where: { id: item.id },
    data: {
      currentPublicVersionId: contentVersion.id,
      latestVersionId: contentVersion.id
    }
  });
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      ownerUserId: child.guardianUserId,
      storageBucket: "private-stage9",
      storageKey: `formal/${child.childId}/bicycle-front.jpg`,
      visibility: "formal_private",
      mimeType: "image/jpeg",
      sizeBytes: 128_000,
      checksum: `sha256:${unique(label)}`
    }
  });
  await prisma.contentVersionMedia.create({
    data: {
      contentVersionId: contentVersion.id,
      mediaAssetId: mediaAsset.id,
      mediaRole: "front",
      sortOrder: 1
    }
  });
  const task = await prisma.moderationTask.create({
    data: {
      contentVersionId: contentVersion.id,
      status: "approved",
      providerRiskLevel: "low",
      ruleTagsJson: ["safe"]
    }
  });
  await prisma.aiReviewResult.create({
    data: {
      taskId: task.id,
      contentVersionId: contentVersion.id,
      provider: "fake",
      providerStatus: "success",
      riskLevel: "low",
      labelsJson: ["toy"],
      ocrText: "Child pickup address",
      metadataFindingsJson: { gps: "removed" },
      rawResultRef: `raw://${unique(label)}`
    }
  });
  await prisma.searchIndexDocument.create({
    data: {
      targetType: "item",
      targetId: item.id,
      contentVersionId: contentVersion.id,
      communityId: community.id,
      visibilityStatus: "searchable",
      searchPayload: {
        title: "Child bicycle",
        sellerChildId: child.childId
      },
      searchText: "child bicycle pickup details",
      category: "bike",
      sourceVersion: 1,
      sourceCreatedAt: new Date("2026-06-24T09:00:00.000Z")
    }
  });
  await prisma.itemFavorite.create({
    data: {
      childId: child.childId,
      itemId: item.id,
      communityId: community.id,
      status: "active"
    }
  });

  const outbox = await prisma.outboxEvent.create({
    data: {
      eventType: "item.approved",
      targetType: "item",
      targetId: item.id,
      idempotencyKey: unique(`${label}_outbox`),
      payloadJson: {
        childName: "Child Name",
        itemTitle: "Child bicycle"
      },
      status: "pending"
    }
  });
  const notification = await prisma.notification.create({
    data: {
      recipientUserId: child.childUserId,
      recipientChildId: child.childId,
      type: "auction_bid_accepted",
      priority: "normal",
      mandatory: false,
      title: "Your item was published",
      body: "Child bicycle is visible in your community.",
      relatedType: "item",
      relatedId: item.id,
      eventId: outbox.id,
      targetVersion: 1,
      actionType: "open_search_result",
      deliveryStatus: "pending"
    }
  });
  await prisma.notificationPreference.create({
    data: {
      userId: child.childUserId,
      childId: child.childId,
      eventType: "item.approved",
      inAppEnabled: true,
      wechatSubscribeEnabled: true,
      childVisible: true
    }
  });
  const idempotency = await prisma.idempotencyRecord.create({
    data: {
      key: unique(`${label}_idem`),
      actorUserId: child.guardianUserId,
      action: "publish_item",
      targetType: "item",
      targetId: item.id,
      requestHash: unique(`${label}_hash`),
      status: "completed",
      responseJson: {
        childName: "Child Name",
        itemId: item.id
      }
    }
  });
  const riskSignal = await prisma.riskSignal.create({
    data: {
      type: "contact_inducement_suspected",
      scope: "child",
      targetId: child.childId,
      childId: child.childId,
      evidenceJson: {
        childName: "Child Name",
        text: "pickup details"
      },
      status: "open",
      resolutionText: "pending review"
    }
  });
  const riskRestriction = await prisma.riskRestriction.create({
    data: {
      type: "no_delete",
      scope: "child",
      targetId: child.childId,
      childId: child.childId,
      status: "active",
      reason: "contains child name and guardian contact"
    }
  });
  const auditLog = await prisma.auditLog.create({
    data: {
      actorUserId: child.childUserId,
      action: "item.publish",
      targetType: "item",
      targetId: item.id,
      reason: "test fixture",
      beforeJson: {
        childName: "Child Name"
      },
      afterJson: {
        itemTitle: "Child bicycle"
      }
    }
  });

  await prisma.userSession.create({
    data: {
      userId: child.childUserId,
      refreshTokenHash: unique(`${label}_refresh`),
      status: "active",
      deviceFingerprintHash: unique(`${label}_device`),
      ipHash: unique(`${label}_ip`),
      userAgentHash: unique(`${label}_ua`),
      expiresAt: new Date("2026-07-24T09:00:00.000Z")
    }
  });
  await prisma.trustedDevice.create({
    data: {
      userId: child.childUserId,
      deviceFingerprintHash: unique(`${label}_trusted_device`),
      deviceLabel: "Child tablet",
      trustLevel: "sensitive_allowed",
      trustedAt: new Date("2026-06-24T09:00:00.000Z")
    }
  });
  await prisma.sensitiveOperationChallenge.create({
    data: {
      actorUserId: child.childUserId,
      operation: "child.delete",
      targetType: "child_profile",
      targetId: child.childId,
      status: "pending",
      riskLabelsJson: ["child_data"],
      expiresAt: new Date("2026-06-24T11:00:00.000Z")
    }
  });

  const oldIdentity = await prisma.wechatIdentity.findFirstOrThrow({
    where: { userId: child.childUserId },
    select: { openid: true }
  });
  const grant = new PrivateObjectStorageService(objectGrantSigningKey).createReadGrant({
    mediaAssetId: mediaAsset.id,
    storageBucket: mediaAsset.storageBucket,
    storageKey: mediaAsset.storageKey,
    ownerUserId: mediaAsset.ownerUserId,
    granteeUserId: child.guardianUserId,
    purpose: "item_image_view",
    ttlSeconds: 900,
    accessPolicyVersion: mediaAsset.accessPolicyVersion,
    now: new Date("2026-06-24T10:00:00.000Z")
  });
  if (grant.result !== "accepted") {
    throw new Error(`failed to create object grant: ${grant.errorCode}`);
  }
  const grantToken = new URL(grant.url).searchParams.get("grant");
  if (!grantToken) {
    throw new Error("grant token missing from object grant url");
  }

  return {
    ...child,
    communityId: community.id,
    itemId: item.id,
    contentVersionId: contentVersion.id,
    mediaAssetId: mediaAsset.id,
    outboxEventId: outbox.id,
    notificationId: notification.id,
    idempotencyRecordId: idempotency.id,
    riskSignalId: riskSignal.id,
    riskRestrictionId: riskRestriction.id,
    auditLogId: auditLog.id,
    oldIdentityOpenid: oldIdentity.openid,
    oldGrantToken: grantToken
  };
}

async function createChildWithPrimaryGuardian(
  label: string,
  input: {
    withChildUser: boolean;
    availablePoints: number;
    frozenPoints: number;
  }
): Promise<ChildFixture> {
  const guardian = await createGuardian(label);
  const childUser = input.withChildUser
    ? await prisma.user.create({
        data: {
          status: "active",
          wechatIdentities: {
            create: {
              openid: `child_openid_${unique(label)}`,
              unionid: `union_${unique(label)}`,
              avatarUrl: "https://private.local/avatar.jpg",
              nickname: "Child Nickname",
              lastLoginAt: new Date("2026-06-24T08:59:00.000Z")
            }
          }
        }
      })
    : null;
  const child = await prisma.childProfile.create({
    data: {
      userId: childUser?.id,
      displayName: `Stage9 Child ${unique(label)}`,
      gradeBand: "grade_3_4",
      status: "active",
      createdByGuardianId: guardian.guardianId
    }
  });
  await prisma.guardianChildLink.create({
    data: {
      guardianId: guardian.guardianId,
      childId: child.id,
      role: "primary",
      status: "active",
      confirmedAt: new Date("2026-06-24T09:00:00.000Z")
    }
  });
  await prisma.childGuardianSettings.create({
    data: {
      childId: child.id,
      canPublish: true,
      canBid: true,
      canUseCourier: true,
      canUseGuardianArrangedDelivery: true,
      canFavorite: true,
      bidRequiresGuardianConfirmation: true,
      maxBidPoints: 50
    }
  });
  const totalPoints = input.availablePoints + input.frozenPoints;
  const account = await prisma.pointAccount.create({
    data: {
      childId: child.id,
      availablePoints: input.availablePoints,
      frozenPoints: input.frozenPoints,
      totalEarnedPoints: totalPoints,
      totalAwardedPoints: totalPoints
    }
  });
  await prisma.pointLedgerEntry.create({
    data: {
      accountId: account.id,
      childId: child.id,
      type: "initial_grant",
      amountPoints: totalPoints,
      availableAfter: totalPoints,
      frozenAfter: 0,
      relatedType: "child_profile",
      relatedId: child.id,
      idempotencyKey: unique(`${label}_initial_grant`),
      reason: "initial_child_points",
      createdByUserId: guardian.userId,
      createdAt: new Date("2026-06-24T09:00:00.000Z")
    }
  });

  return {
    childId: child.id,
    childUserId: childUser?.id ?? null,
    guardianUserId: guardian.userId,
    guardianId: guardian.guardianId,
    pointAccountId: account.id
  };
}

async function createGuardian(label: string): Promise<GuardianFixture> {
  const user = await prisma.user.create({
    data: {
      status: "active",
      wechatIdentities: {
        create: {
          openid: `guardian_openid_${unique(label)}`
        }
      }
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId: user.id,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "1234",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-24T09:00:00.000Z"),
      status: "active"
    }
  });

  return {
    userId: user.id,
    guardianId: guardian.id
  };
}

function createCommunity(label: string, creatorGuardianId: string) {
  return prisma.auctionCommunity.create({
    data: {
      name: `Stage9 Community ${unique(label)}`,
      creatorGuardianId,
      status: "active",
      defaultAuctionDurationMinutes: 90
    }
  });
}
