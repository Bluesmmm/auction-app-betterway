import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { TransactionAppealService } from "../../src/auctions/transaction-appeal.service.js";
import { FakeContentSafetyProvider } from "../../src/providers/fake-providers.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const appeals = new TransactionAppealService(
  prisma,
  new FakeContentSafetyProvider(),
  "stage6-appeal-grant-key"
);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = {
  childId: string;
  guardianUserId: string;
  guardianId: string;
  pointAccountId: string;
};

type AppealTransactionFixture = {
  transactionId: string;
  communityId: string;
  buyer: ChildFixture;
  seller: ChildFixture;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TransactionAppealService integration tests require explicit DATABASE_URL"
    );
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "TransactionAppealService integration tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("TransactionAppealService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets transaction-side guardians submit text and private image appeal evidence", async () => {
    const fixture = await createAppealTransactionFixture("appeal_submit");
    const lowRiskImage = await createTempPrivateImage(
      fixture.buyer.guardianUserId,
      "appeal_low_risk"
    );
    const highRiskImage = await createTempPrivateImage(
      fixture.buyer.guardianUserId,
      "appeal_high_risk",
      "sha256:risk:high:ocr-contact"
    );

    const result = await appeals.createTransactionAppeal({
      actorUserId: fixture.buyer.guardianUserId,
      transactionId: fixture.transactionId,
      reason: "交付点没有找到对方",
      attachmentMediaAssetIds: [lowRiskImage.id, highRiskImage.id],
      now: new Date("2026-06-05T09:00:00.000Z")
    });

    expect(result).toEqual({
      result: "accepted",
      appealId: expect.any(String),
      status: "escalated_platform",
      attachmentCount: 2,
      idempotencyKey: null
    });
    if (result.result !== "accepted") {
      throw new Error("expected appeal creation to be accepted");
    }

    await expect(
      prisma.appeal.findUnique({
        where: {
          id: result.appealId
        },
        select: {
          targetType: true,
          targetId: true,
          transactionId: true,
          submittedByGuardianId: true,
          communityId: true,
          status: true,
          reason: true
        }
      })
    ).resolves.toEqual({
      targetType: "transaction",
      targetId: fixture.transactionId,
      transactionId: fixture.transactionId,
      submittedByGuardianId: fixture.buyer.guardianId,
      communityId: fixture.communityId,
      status: "escalated_platform",
      reason: "交付点没有找到对方"
    });
    await expect(
      prisma.appealAttachment.findMany({
        where: {
          appealId: result.appealId
        },
        orderBy: {
          sortOrder: "asc"
        },
        select: {
          mediaAssetId: true,
          status: true,
          sortOrder: true,
          riskLabelsJson: true
        }
      })
    ).resolves.toEqual([
      {
        mediaAssetId: lowRiskImage.id,
        status: "accepted",
        sortOrder: 1,
        riskLabelsJson: []
      },
      {
        mediaAssetId: highRiskImage.id,
        status: "escalated_platform",
        sortOrder: 2,
        riskLabelsJson: expect.arrayContaining(["ocr_contact"])
      }
    ]);
    await expect(
      prisma.guardianDispute.count({
        where: {
          childId: fixture.buyer.childId
        }
      })
    ).resolves.toBe(0);
  });

  it("rejects unrelated guardians, non-image media, non-temp-private media, and too many attachments", async () => {
    const fixture = await createAppealTransactionFixture("appeal_reject");
    const outsider = await createGuardian("appeal_outsider");
    const pdf = await createTempPrivateImage(
      fixture.buyer.guardianUserId,
      "appeal_pdf",
      "sha256:pdf",
      "application/pdf"
    );
    const formalImage = await createTempPrivateImage(
      fixture.buyer.guardianUserId,
      "appeal_formal"
    );
    await prisma.mediaAsset.update({
      where: {
        id: formalImage.id
      },
      data: {
        visibility: "formal_private"
      }
    });
    const images = await Promise.all(
      [1, 2, 3, 4, 5].map((index) =>
        createTempPrivateImage(
          fixture.buyer.guardianUserId,
          `appeal_too_many_${index}`
        )
      )
    );

    await expect(
      appeals.createTransactionAppeal({
        actorUserId: outsider.userId,
        transactionId: fixture.transactionId,
        reason: "旁观者不能申诉",
        attachmentMediaAssetIds: [],
        now: new Date("2026-06-05T10:00:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TRANSACTION_GUARDIAN_REQUIRED"
    });
    await expect(
      appeals.createTransactionAppeal({
        actorUserId: fixture.buyer.guardianUserId,
        transactionId: fixture.transactionId,
        reason: "附件太多",
        attachmentMediaAssetIds: images.map((image) => image.id),
        now: new Date("2026-06-05T10:05:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TOO_MANY_ATTACHMENTS"
    });
    await expect(
      appeals.createTransactionAppeal({
        actorUserId: fixture.buyer.guardianUserId,
        transactionId: fixture.transactionId,
        reason: "PDF 不允许",
        attachmentMediaAssetIds: [pdf.id],
        now: new Date("2026-06-05T10:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ATTACHMENT_NOT_PRIVATE_IMAGE"
    });
    await expect(
      appeals.createTransactionAppeal({
        actorUserId: fixture.buyer.guardianUserId,
        transactionId: fixture.transactionId,
        reason: "正式文件不能绑定",
        attachmentMediaAssetIds: [formalImage.id],
        now: new Date("2026-06-05T10:15:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ATTACHMENT_NOT_PRIVATE_IMAGE"
    });
  });

  it("creates appeal purpose read grants only for allowed guardians and admins", async () => {
    const fixture = await createAppealTransactionFixture("appeal_grant");
    const image = await createTempPrivateImage(
      fixture.seller.guardianUserId,
      "appeal_grant_image"
    );
    const created = await appeals.createTransactionAppeal({
      actorUserId: fixture.seller.guardianUserId,
      transactionId: fixture.transactionId,
      reason: "买方没有确认收到",
      attachmentMediaAssetIds: [image.id],
      now: new Date("2026-06-05T11:00:00.000Z")
    });
    if (created.result !== "accepted") {
      throw new Error("expected appeal creation to be accepted");
    }
    const attachment = await prisma.appealAttachment.findFirstOrThrow({
      where: {
        appealId: created.appealId
      }
    });
    const admin = await createActivityAdmin("appeal_admin", fixture.communityId);
    const outsider = await createGuardian("appeal_grant_outsider");

    await expect(
      appeals.createAppealImageGrant({
        actorUserId: fixture.seller.guardianUserId,
        appealAttachmentId: attachment.id,
        ttlSeconds: 300,
        now: new Date("2026-06-05T11:05:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      purpose: "appeal",
      mediaAssetId: image.id
    });
    await expect(
      appeals.createAppealImageGrant({
        actorUserId: admin.userId,
        appealAttachmentId: attachment.id,
        ttlSeconds: 300,
        now: new Date("2026-06-05T11:06:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      purpose: "appeal",
      mediaAssetId: image.id
    });
    await expect(
      appeals.createAppealImageGrant({
        actorUserId: outsider.userId,
        appealAttachmentId: attachment.id,
        ttlSeconds: 300,
        now: new Date("2026-06-05T11:07:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "APPEAL_ACCESS_DENIED"
    });
  });
});

async function createAppealTransactionFixture(
  label: string
): Promise<AppealTransactionFixture> {
  const seller = await createChildWithPrimaryGuardian(`${label}_seller`, 60, 0);
  const buyer = await createChildWithPrimaryGuardian(`${label}_buyer`, 80, 40);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Appeal Community ${unique(label)}`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 90
    }
  });
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 40,
      minIncrementPoints: 5
    }
  });
  const auction = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      idempotencyKey: unique(`${label}_auction`),
      status: "settled",
      startAt: new Date("2026-06-04T09:00:00.000Z"),
      endAt: new Date("2026-06-04T09:30:00.000Z"),
      startPoints: 40,
      minIncrementPoints: 5,
      currentPricePoints: 40,
      highestBidderChildId: buyer.childId,
      settledAt: new Date("2026-06-04T09:31:00.000Z")
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyer.pointAccountId,
      auctionSessionId: auction.id,
      amountPoints: 40,
      status: "active",
      createdAt: new Date("2026-06-04T09:10:00.000Z")
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auction.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 40,
      status: "disputed",
      guardianConfirmDeadlineAt: new Date("2026-06-06T09:31:00.000Z"),
      deliveryConfirmDeadlineAt: new Date("2026-06-07T09:31:00.000Z"),
      createdAt: new Date("2026-06-04T09:31:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    communityId: community.id,
    buyer,
    seller
  };
}

async function createChildWithPrimaryGuardian(
  label: string,
  availablePoints: number,
  frozenPoints: number
): Promise<ChildFixture> {
  const guardian = await createGuardian(label);
  const child = await prisma.childProfile.create({
    data: {
      displayName: `Appeal Child ${unique(label)}`,
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
      confirmedAt: new Date("2026-06-04T08:00:00.000Z")
    }
  });
  const account = await prisma.pointAccount.create({
    data: {
      childId: child.id,
      availablePoints,
      frozenPoints,
      totalEarnedPoints: availablePoints + frozenPoints,
      totalAwardedPoints: availablePoints + frozenPoints
    }
  });

  return {
    childId: child.id,
    guardianUserId: guardian.userId,
    guardianId: guardian.guardianId,
    pointAccountId: account.id
  };
}

async function createGuardian(label: string): Promise<GuardianFixture> {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  await prisma.wechatIdentity.create({
    data: {
      userId: user.id,
      openid: `mock_openid_${unique(label)}`
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId: user.id,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "1234",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-04T08:00:00.000Z"),
      status: "active"
    }
  });

  return {
    userId: user.id,
    guardianId: guardian.id
  };
}

async function createTempPrivateImage(
  ownerUserId: string,
  label: string,
  checksum = "sha256:risk:low",
  mimeType = "image/jpeg"
) {
  return prisma.mediaAsset.create({
    data: {
      ownerUserId,
      storageBucket: "private-stage6",
      storageKey: `appeals/${unique(label)}.jpg`,
      visibility: "temp_private",
      mimeType,
      sizeBytes: 100_000,
      checksum
    }
  });
}

async function createActivityAdmin(label: string, communityId: string) {
  const user = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  await prisma.wechatIdentity.create({
    data: {
      userId: user.id,
      openid: `mock_openid_${unique(label)}`
    }
  });
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId: user.id,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    }
  });
  await prisma.adminCommunityScope.create({
    data: {
      adminProfileId: adminProfile.id,
      communityId,
      status: "active"
    }
  });

  return {
    userId: user.id,
    adminProfileId: adminProfile.id
  };
}
