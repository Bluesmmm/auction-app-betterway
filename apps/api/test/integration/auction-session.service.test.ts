import type { ContentVersionStatus, ItemStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { AuctionPermissionsService } from "../../src/auctions/auction-permissions.service.js";
import { AuctionSessionService } from "../../src/auctions/auction-session.service.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const permissions = new AuctionPermissionsService(prisma);
const auctions = new AuctionSessionService(prisma, permissions);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("AuctionSessionService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an active auction session for a scoped activity admin and persists audit and outbox facts", async () => {
    const fixture = await createAuctionFixture("activity_admin_success", 180);
    const now = new Date("2026-06-03T09:00:00.000Z");
    const idempotencyKey = unique("auction_create");

    const created = await auctions.createAuctionSession({
      actorUserId: fixture.activityAdminUserId,
      communityId: fixture.community.id,
      itemId: fixture.item.id,
      idempotencyKey,
      now
    });

    expect(created).toEqual({
      result: "accepted",
      auctionSessionId: expect.any(String),
      itemId: fixture.item.id,
      communityId: fixture.community.id,
      status: "active",
      startAt: now.toISOString(),
      endAt: new Date(now.getTime() + 180 * 60_000).toISOString(),
      startPoints: fixture.item.startPoints,
      minIncrementPoints: fixture.item.minIncrementPoints,
      idempotencyKey
    });

    if (created.result !== "accepted") {
      throw new Error(`expected auction creation to succeed: ${created.errorCode}`);
    }

    const persistedAuction = await prisma.auctionSession.findUnique({
      where: {
        id: created.auctionSessionId
      }
    });
    expect(persistedAuction).toEqual(
      expect.objectContaining({
        itemId: fixture.item.id,
        status: "active",
        createdByUserId: fixture.activityAdminUserId,
        idempotencyKey: expect.stringMatching(/^auction_session\.create:/),
        startAt: now,
        endAt: new Date(now.getTime() + 180 * 60_000),
        startPoints: fixture.item.startPoints,
        minIncrementPoints: fixture.item.minIncrementPoints
      })
    );
    expect(persistedAuction?.idempotencyKey).not.toBe(idempotencyKey);

    await expect(
      prisma.auditLog.findFirst({
        where: {
          action: "auction_session.create",
          targetType: "auction_session",
          targetId: created.auctionSessionId
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        actorUserId: fixture.activityAdminUserId,
        action: "auction_session.create",
        targetType: "auction_session",
        targetId: created.auctionSessionId,
        afterJson: expect.objectContaining({
          itemId: fixture.item.id,
          communityId: fixture.community.id,
          status: "active",
          startAt: now.toISOString(),
          endAt: new Date(now.getTime() + 180 * 60_000).toISOString(),
          startPoints: fixture.item.startPoints,
          minIncrementPoints: fixture.item.minIncrementPoints,
          auctionSessionIdempotencyKey: persistedAuction?.idempotencyKey,
          clientIdempotencyKeyHash: expect.any(String)
        })
      })
    );

    const outbox = await prisma.outboxEvent.findFirst({
      where: {
        eventType: "auction.session_created",
        targetId: created.auctionSessionId
      }
    });
    expect(outbox).toEqual(
      expect.objectContaining({
        eventType: "auction.session_created",
        targetType: "auction_session",
        targetId: created.auctionSessionId,
        idempotencyKey: expect.stringMatching(/^auction\.session_created:/),
        payloadJson: expect.objectContaining({
          auctionSessionId: created.auctionSessionId,
          itemId: fixture.item.id,
          communityId: fixture.community.id,
          status: "active",
          startAt: now.toISOString(),
          endAt: new Date(now.getTime() + 180 * 60_000).toISOString(),
          startPoints: fixture.item.startPoints,
          minIncrementPoints: fixture.item.minIncrementPoints,
          createdByUserId: fixture.activityAdminUserId
        })
      })
    );
    expect(outbox?.idempotencyKey).not.toContain(idempotencyKey);
  });

  it("rejects non-admin actors from creating auction sessions", async () => {
    const fixture = await createAuctionFixture("non_admin_rejected");

    await expect(
      auctions.createAuctionSession({
        actorUserId: fixture.outsiderUserId,
        communityId: fixture.community.id,
        itemId: fixture.item.id,
        idempotencyKey: unique("auction_non_admin"),
        now: new Date("2026-06-03T09:05:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
  });

  it("creates an active auction session for a platform admin", async () => {
    const fixture = await createAuctionFixture("platform_admin_success", 60);
    const now = new Date("2026-06-03T09:07:00.000Z");
    const idempotencyKey = unique("auction_platform_admin");

    const created = await auctions.createAuctionSession({
      actorUserId: fixture.platformAdminUserId,
      communityId: fixture.community.id,
      itemId: fixture.item.id,
      idempotencyKey,
      now
    });

    expect(created).toEqual({
      result: "accepted",
      auctionSessionId: expect.any(String),
      itemId: fixture.item.id,
      communityId: fixture.community.id,
      status: "active",
      startAt: now.toISOString(),
      endAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      startPoints: fixture.item.startPoints,
      minIncrementPoints: fixture.item.minIncrementPoints,
      idempotencyKey
    });

    if (created.result !== "accepted") {
      throw new Error(`expected platform admin auction creation to succeed: ${created.errorCode}`);
    }

    await expect(
      prisma.auctionSession.findUnique({
        where: {
          id: created.auctionSessionId
        },
        select: {
          createdByUserId: true
        }
      })
    ).resolves.toEqual({
      createdByUserId: fixture.platformAdminUserId
    });
  });

  it("rejects items that do not have an approved current public version", async () => {
    const fixture = await createAuctionFixture("item_not_ready", 120, {
      currentPublicVersionStatus: "pending_manual"
    });

    await expect(
      auctions.createAuctionSession({
        actorUserId: fixture.activityAdminUserId,
        communityId: fixture.community.id,
        itemId: fixture.item.id,
        idempotencyKey: unique("auction_not_ready"),
        now: new Date("2026-06-03T09:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ITEM_NOT_READY_FOR_AUCTION"
    });
  });

  it("rejects duplicate auction creation for the same item when a different idempotency key is used", async () => {
    const fixture = await createAuctionFixture("duplicate_auction");
    const first = await auctions.createAuctionSession({
      actorUserId: fixture.activityAdminUserId,
      communityId: fixture.community.id,
      itemId: fixture.item.id,
      idempotencyKey: unique("auction_first"),
      now: new Date("2026-06-03T09:15:00.000Z")
    });

    if (first.result !== "accepted") {
      throw new Error(`expected first auction creation to succeed: ${first.errorCode}`);
    }

    await expect(
      auctions.createAuctionSession({
        actorUserId: fixture.activityAdminUserId,
        communityId: fixture.community.id,
        itemId: fixture.item.id,
        idempotencyKey: unique("auction_second"),
        now: new Date("2026-06-03T09:16:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "AUCTION_ALREADY_EXISTS"
    });
  });

  it("scopes persisted auction idempotency keys so the same client key can be reused for different items", async () => {
    const firstFixture = await createAuctionFixture("same_client_key_first");
    const secondItem = await createReadyItemForCommunity("same_client_key_second", {
      communityId: firstFixture.community.id
    });
    const idempotencyKey = unique("shared_client_key");

    const first = await auctions.createAuctionSession({
      actorUserId: firstFixture.activityAdminUserId,
      communityId: firstFixture.community.id,
      itemId: firstFixture.item.id,
      idempotencyKey,
      now: new Date("2026-06-03T09:17:00.000Z")
    });
    const second = await auctions.createAuctionSession({
      actorUserId: firstFixture.activityAdminUserId,
      communityId: firstFixture.community.id,
      itemId: secondItem.id,
      idempotencyKey,
      now: new Date("2026-06-03T09:18:00.000Z")
    });

    expect(first).toMatchObject({
      result: "accepted",
      idempotencyKey
    });
    expect(second).toMatchObject({
      result: "accepted",
      idempotencyKey
    });

    if (first.result !== "accepted" || second.result !== "accepted") {
      throw new Error("expected both auction creations to succeed");
    }

    const persisted = await prisma.auctionSession.findMany({
      where: {
        id: {
          in: [first.auctionSessionId, second.auctionSessionId]
        }
      },
      select: {
        idempotencyKey: true
      }
    });

    expect(persisted).toHaveLength(2);
    expect(new Set(persisted.map((row) => row.idempotencyKey)).size).toBe(2);
    for (const row of persisted) {
      expect(row.idempotencyKey).toMatch(/^auction_session\.create:/);
      expect(row.idempotencyKey).not.toContain(idempotencyKey);
    }
  });

  it("returns a stable result instead of throwing when the same idempotency key is used concurrently", async () => {
    const fixture = await createAuctionFixture("concurrent_same_key");
    const idempotencyKey = unique("auction_concurrent");
    const now = new Date("2026-06-03T09:19:00.000Z");

    const attempts = await Promise.allSettled([
      auctions.createAuctionSession({
        actorUserId: fixture.activityAdminUserId,
        communityId: fixture.community.id,
        itemId: fixture.item.id,
        idempotencyKey,
        now
      }),
      auctions.createAuctionSession({
        actorUserId: fixture.activityAdminUserId,
        communityId: fixture.community.id,
        itemId: fixture.item.id,
        idempotencyKey,
        now
      })
    ]);

    expect(attempts.every((attempt) => attempt.status === "fulfilled")).toBe(
      true
    );

    const results = attempts.map((attempt) => {
      if (attempt.status === "rejected") {
        throw attempt.reason;
      }

      return attempt.value;
    });
    expect(
      results.every(
        (result) =>
          result.result === "accepted" ||
          result.errorCode === "IDEMPOTENCY_CONFLICT"
      )
    ).toBe(true);

    const accepted = results.filter((result) => result.result === "accepted");
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(
      new Set(
        accepted.map((result) =>
          result.result === "accepted" ? result.auctionSessionId : ""
        )
      ).size
    ).toBe(1);
    await expect(
      prisma.auctionSession.count({
        where: {
          itemId: fixture.item.id
        }
      })
    ).resolves.toBe(1);
  });

  it("replays the original auction response for the same idempotency key and does not duplicate side effects", async () => {
    const fixture = await createAuctionFixture("idempotency_replay");
    const idempotencyKey = unique("auction_replay");
    const firstNow = new Date("2026-06-03T09:20:00.000Z");
    const first = await auctions.createAuctionSession({
      actorUserId: fixture.activityAdminUserId,
      communityId: fixture.community.id,
      itemId: fixture.item.id,
      idempotencyKey,
      now: firstNow
    });

    if (first.result !== "accepted") {
      throw new Error(`expected first auction creation to succeed: ${first.errorCode}`);
    }

    const replay = await auctions.createAuctionSession({
      actorUserId: fixture.activityAdminUserId,
      communityId: fixture.community.id,
      itemId: fixture.item.id,
      idempotencyKey,
      now: new Date("2026-06-03T09:25:00.000Z")
    });

    expect(replay).toEqual(first);
    await expect(
      prisma.auctionSession.count({
        where: {
          itemId: fixture.item.id
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "auction.session_created",
          targetId: first.auctionSessionId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "auction_session.create",
          targetType: "auction_session",
          targetId: first.auctionSessionId
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.idempotencyRecord.findUnique({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: idempotencyKey,
            actorUserId: fixture.activityAdminUserId,
            action: "auction_session.create",
            targetType: "item",
            targetId: fixture.item.id
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: first
    });
  });
});

async function createAuctionFixture(
  label: string,
  defaultAuctionDurationMinutes = 90,
  itemOptions?: {
    itemStatus?: ItemStatus;
    currentPublicVersionStatus?: ContentVersionStatus;
    withCurrentPublicVersion?: boolean;
  }
) {
  const creator = await createGuardian(label);
  const sellerChild = await createChild(`${label}_seller`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Auction Community ${unique(label)}`,
      creatorGuardianId: creator.guardianId,
      status: "active",
      defaultAuctionDurationMinutes
    }
  });
  const activityAdmin = await createActivityAdmin(`${label}_activity_admin`, community.id);
  const platformAdmin = await createPlatformAdmin(`${label}_platform_admin`);
  const outsiderUserId = await createUser(`${label}_outsider`);
  const item = await createItem(`${label}_item`, {
    communityId: community.id,
    sellerChildId: sellerChild.id,
    itemStatus: itemOptions?.itemStatus ?? "listed",
    currentPublicVersionStatus: itemOptions?.currentPublicVersionStatus ?? "approved",
    withCurrentPublicVersion: itemOptions?.withCurrentPublicVersion ?? true
  });

  return {
    community,
    item,
    activityAdminUserId: activityAdmin.userId,
    platformAdminUserId: platformAdmin.userId,
    outsiderUserId
  };
}

async function createReadyItemForCommunity(
  label: string,
  input: {
    communityId: string;
  }
) {
  const sellerChild = await createChild(`${label}_seller`);
  return createItem(`${label}_item`, {
    communityId: input.communityId,
    sellerChildId: sellerChild.id,
    itemStatus: "listed",
    currentPublicVersionStatus: "approved",
    withCurrentPublicVersion: true
  });
}

async function createUser(label: string) {
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

  return user.id;
}

async function createGuardian(label: string) {
  const userId = await createUser(`${label}_guardian`);
  const guardian = await prisma.guardianProfile.create({
    data: {
      userId,
      phoneHash: `phone_hash_${unique(label)}`,
      phoneLast4: "5566",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-06-03T08:55:00.000Z"),
      status: "active"
    }
  });

  return {
    userId,
    guardianId: guardian.id
  };
}

async function createChild(label: string) {
  return prisma.childProfile.create({
    data: {
      displayName: `Child ${unique(label)}`,
      gradeBand: "grade_3_4",
      status: "active"
    }
  });
}

async function createActivityAdmin(label: string, communityId: string) {
  const userId = await createUser(label);
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId,
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
    userId,
    adminProfileId: adminProfile.id
  };
}

async function createPlatformAdmin(label: string) {
  const userId = await createUser(label);
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  return {
    userId,
    adminProfileId: adminProfile.id
  };
}

async function createItem(
  label: string,
  input: {
    communityId: string;
    sellerChildId: string;
    itemStatus: ItemStatus;
    currentPublicVersionStatus: ContentVersionStatus;
    withCurrentPublicVersion: boolean;
  }
) {
  const created = await prisma.item.create({
    data: {
      communityId: input.communityId,
      sellerChildId: input.sellerChildId,
      status: input.itemStatus,
      startPoints: 25,
      minIncrementPoints: 5
    }
  });

  if (!input.withCurrentPublicVersion) {
    return created;
  }

  const contentVersion = await prisma.contentVersion.create({
    data: {
      targetType: "item",
      targetId: created.id,
      versionNo: 1,
      status: input.currentPublicVersionStatus,
      title: `Auction Item ${unique(label)}`,
      description: "Ready for auction session tests",
      payloadJson: {
        label,
        condition: "good"
      },
      approvedAt:
        input.currentPublicVersionStatus === "approved"
          ? new Date("2026-06-03T08:58:00.000Z")
          : undefined
    }
  });

  return prisma.item.update({
    where: {
      id: created.id
    },
    data: {
      currentPublicVersionId: contentVersion.id,
      latestVersionId: contentVersion.id
    }
  });
}
