import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import type { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { Stage7DiscoveryService } from "../../src/stage7/stage7-discovery.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const participation = new ChildParticipationService(
  prisma,
  {} as SensitiveOperationService
);
const discovery = new Stage7DiscoveryService(prisma, participation);
const targetPrefix = "stage7_search_favorites_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Stage 7 search tests require explicit DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Stage 7 search tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

describe("Stage7DiscoveryService search and favorites flow", () => {
  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("searches indexed content but filters stale invisible items from source", async () => {
    const fixture = await createSearchFixture("source_visibility", {
      canFavorite: true
    });
    await discovery.upsertSearchIndexDocument({
      targetType: "item",
      targetId: fixture.itemId
    });

    await expect(
      discovery.searchCommunityContent({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        query: "science",
        sort: "latest"
      })
    ).resolves.toMatchObject({
      result: "accepted",
      results: [
        expect.objectContaining({
          targetType: "item",
          targetId: fixture.itemId,
          title: "science kit",
          isFavorited: false
        })
      ]
    });

    await prisma.item.update({
      where: {
        id: fixture.itemId
      },
      data: {
        status: "delisted"
      }
    });

    await expect(
      discovery.searchCommunityContent({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        query: "science",
        sort: "latest"
      })
    ).resolves.toMatchObject({
      result: "accepted",
      results: []
    });
  });

  it("continues scanning when stale candidates fill the first search batch", async () => {
    const fixture = await createSearchFixture("pagination_stale_candidates", {
      canFavorite: true
    });
    await discovery.upsertSearchIndexDocument({
      targetType: "item",
      targetId: fixture.itemId
    });

    for (let index = 0; index < 4; index += 1) {
      const staleItemId = await createAdditionalSearchItem(fixture, {
        label: `pagination_stale_${index}`,
        title: `science stale ${index}`,
        createdAt: new Date(`2026-06-09T09:00:0${index}.000Z`)
      });
      await discovery.upsertSearchIndexDocument({
        targetType: "item",
        targetId: staleItemId
      });
      await prisma.item.update({
        where: {
          id: staleItemId
        },
        data: {
          status: "delisted"
        }
      });
    }

    await expect(
      discovery.searchCommunityContent({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        query: "science",
        sort: "latest",
        limit: 1
      })
    ).resolves.toMatchObject({
      result: "accepted",
      results: [
        expect.objectContaining({
          targetId: fixture.itemId,
          title: "science kit"
        })
      ],
      nextCursor: null
    });
  });

  it("continues scanning favorite candidates when the first batch is stale", async () => {
    const fixture = await createSearchFixture("favorite_stale_batch", {
      canFavorite: true
    });
    await prisma.itemFavorite.create({
      data: {
        id: unique("favorite_visible"),
        childId: fixture.childId,
        itemId: fixture.itemId,
        communityId: fixture.communityId,
        status: "active",
        createdAt: new Date("2026-06-09T08:00:00.000Z"),
        updatedAt: new Date("2026-06-09T08:00:00.000Z")
      }
    });

    for (let index = 0; index < 50; index += 1) {
      const staleFavoriteAt = new Date(
        `2026-06-09T10:${String(index).padStart(2, "0")}:00.000Z`
      );
      const staleItemId = await createAdditionalSearchItem(fixture, {
        label: `favorite_stale_${index}`,
        title: `science stale favorite ${index}`,
        createdAt: new Date(`2026-06-09T09:00:00.000Z`)
      });
      await prisma.itemFavorite.create({
        data: {
          id: unique(`favorite_stale_${index}`),
          childId: fixture.childId,
          itemId: staleItemId,
          communityId: fixture.communityId,
          status: "active",
          createdAt: staleFavoriteAt,
          updatedAt: staleFavoriteAt
        }
      });
      await prisma.item.update({
        where: {
          id: staleItemId
        },
        data: {
          status: "delisted"
        }
      });
    }

    await expect(
      discovery.listFavoriteItems({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId
      })
    ).resolves.toMatchObject({
      result: "accepted",
      favorites: [
        expect.objectContaining({
          targetId: fixture.itemId,
          title: "science kit",
          isFavorited: true
        })
      ]
    });
  });

  it("favorites visible items only when guardian settings allow favorites", async () => {
    const fixture = await createSearchFixture("favorite_allowed", {
      canFavorite: true
    });
    await discovery.upsertSearchIndexDocument({
      targetType: "item",
      targetId: fixture.itemId
    });

    await expect(
      discovery.favoriteItem({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        itemId: fixture.itemId
      })
    ).resolves.toMatchObject({
      result: "accepted",
      status: "active"
    });
    await expect(
      prisma.searchIndexDocument.findUnique({
        where: {
          targetType_targetId: {
            targetType: "item",
            targetId: fixture.itemId
          }
        },
        select: {
          favoriteCount: true
        }
      })
    ).resolves.toEqual({
      favoriteCount: 1
    });

    await prisma.childGuardianSettings.update({
      where: {
        childId: fixture.childId
      },
      data: {
        canFavorite: false
      }
    });

    await expect(
      discovery.favoriteItem({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        itemId: fixture.itemId
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "FAVORITE_NOT_ALLOWED"
    });
  });
});

async function createAdditionalSearchItem(
  fixture: {
    childId: string;
    communityId: string;
  },
  input: {
    label: string;
    title: string;
    createdAt: Date;
  }
) {
  const item = await prisma.item.create({
    data: {
      id: unique(`${input.label}_item`),
      communityId: fixture.communityId,
      sellerChildId: fixture.childId,
      status: "listed",
      startPoints: 10,
      minIncrementPoints: 1,
      createdAt: input.createdAt
    }
  });
  const version = await prisma.contentVersion.create({
    data: {
      id: unique(`${input.label}_version`),
      targetType: "item",
      targetId: item.id,
      versionNo: 1,
      status: "approved",
      title: input.title,
      description: "hands on experiment set",
      payloadJson: {}
    }
  });
  await prisma.item.update({
    where: {
      id: item.id
    },
    data: {
      currentPublicVersionId: version.id,
      latestVersionId: version.id
    }
  });
  await prisma.auctionSession.create({
    data: {
      id: unique(`${input.label}_auction`),
      itemId: item.id,
      idempotencyKey: unique(`${input.label}_auction_idem`),
      status: "active",
      startAt: new Date("2026-06-09T08:00:00.000Z"),
      endAt: new Date("2026-06-09T12:00:00.000Z"),
      startPoints: 10,
      minIncrementPoints: 1,
      currentPricePoints: 10,
      version: 1
    }
  });

  return item.id;
}

async function createSearchFixture(
  label: string,
  input: {
    canFavorite: boolean;
  }
) {
  const guardianUser = await prisma.user.create({
    data: {
      id: unique(`${label}_guardian_user`),
      status: "active"
    }
  });
  const guardian = await prisma.guardianProfile.create({
    data: {
      id: unique(`${label}_guardian`),
      userId: guardianUser.id,
      phoneHash: unique(`${label}_phone_hash`),
      phoneLast4: "1234",
      consentVersion: "v1",
      consentedAt: new Date("2026-06-09T08:00:00.000Z"),
      status: "active"
    }
  });
  const child = await prisma.childProfile.create({
    data: {
      id: unique(`${label}_child`),
      displayName: `${label} Child`,
      gradeBand: "3-4",
      status: "active",
      createdByGuardianId: guardian.id,
      guardianLinks: {
        create: {
          guardianId: guardian.id,
          role: "primary",
          status: "active",
          confirmedAt: new Date("2026-06-09T08:00:00.000Z")
        }
      },
      guardianSettings: {
        create: {
          canPublish: true,
          canFavorite: input.canFavorite,
          canBid: true,
          canUseGuardianArrangedDelivery: true
        }
      }
    }
  });
  const community = await prisma.auctionCommunity.create({
    data: {
      id: unique(`${label}_community`),
      name: `${label} community`,
      creatorGuardianId: guardian.id,
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
  await prisma.communityMember.create({
    data: {
      id: unique(`${label}_member`),
      communityId: community.id,
      childId: child.id,
      status: "active",
      joinedAt: new Date("2026-06-09T08:00:00.000Z")
    }
  });
  const item = await prisma.item.create({
    data: {
      id: unique(`${label}_item`),
      communityId: community.id,
      sellerChildId: child.id,
      status: "listed",
      startPoints: 10,
      minIncrementPoints: 1,
      createdAt: new Date("2026-06-09T08:00:00.000Z")
    }
  });
  const version = await prisma.contentVersion.create({
    data: {
      id: unique(`${label}_version`),
      targetType: "item",
      targetId: item.id,
      versionNo: 1,
      status: "approved",
      title: "science kit",
      description: "hands on experiment set",
      payloadJson: {}
    }
  });
  await prisma.item.update({
    where: {
      id: item.id
    },
    data: {
      currentPublicVersionId: version.id,
      latestVersionId: version.id
    }
  });
  await prisma.auctionSession.create({
    data: {
      id: unique(`${label}_auction`),
      itemId: item.id,
      idempotencyKey: unique(`${label}_auction_idem`),
      status: "active",
      startAt: new Date("2026-06-09T08:00:00.000Z"),
      endAt: new Date("2026-06-09T12:00:00.000Z"),
      startPoints: 10,
      minIncrementPoints: 1,
      currentPricePoints: 10,
      version: 1
    }
  });

  return {
    guardianUserId: guardianUser.id,
    childId: child.id,
    communityId: community.id,
    itemId: item.id
  };
}

async function cleanup() {
  await prisma.searchIndexDocument.deleteMany({
    where: {
      targetId: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.itemFavorite.deleteMany({
    where: {
      childId: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionSession.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.item.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.contentVersion.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.communityMember.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionCommunity.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.childGuardianSettings.deleteMany({
    where: {
      childId: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.guardianChildLink.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          childId: {
            startsWith: targetPrefix
          }
        },
        {
          guardianId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.childProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.guardianProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
}
