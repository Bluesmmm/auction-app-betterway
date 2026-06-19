import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Stage8GovernanceService,
  type Stage8AdminOperation
} from "../../src/stage8/stage8-governance.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const governance = new Stage8GovernanceService(prisma);
const targetPrefix = "stage8_governance_";

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

describe("Stage8GovernanceService", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects activity admins outside their community scope", async () => {
    const scopedCommunity = await createCommunity("scoped");
    const otherCommunity = await createCommunity("other");
    const admin = await createAdmin("activity", "activity_admin", true);
    await prisma.adminCommunityScope.create({
      data: {
        id: unique("scope"),
        adminProfileId: admin.adminProfileId,
        communityId: scopedCommunity.id,
        status: "active"
      }
    });

    await expect(
      governance.getGovernanceOverview({
        actorUserId: admin.userId,
        communityId: otherCommunity.id
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_SCOPE_FORBIDDEN"
    });
  });

  it("returns platform governance queues and pilot metrics", async () => {
    const community = await createCommunity("platform_metrics");
    const admin = await createAdmin("platform", "platform_admin", true);
    await prisma.outboxEvent.createMany({
      data: [
        {
          id: unique("outbox_pending"),
          eventType: "stage8.test",
          targetType: "auction_community",
          targetId: community.id,
          idempotencyKey: unique("outbox_pending_idem"),
          payloadJson: {},
          status: "pending"
        },
        {
          id: unique("outbox_failed"),
          eventType: "stage8.test",
          targetType: "auction_community",
          targetId: community.id,
          idempotencyKey: unique("outbox_failed_idem"),
          payloadJson: {},
          status: "failed"
        }
      ]
    });
    await prisma.ledgerCheckRun.create({
      data: {
        id: unique("ledger_check"),
        status: "failed",
        ledgerDiffCount: 2,
        idempotencyKey: unique("ledger_check_idem"),
        startedAt: new Date("2026-06-10T10:00:00.000Z"),
        finishedAt: new Date("2026-06-10T10:01:00.000Z")
      }
    });

    const overview = await governance.getGovernanceOverview({
      actorUserId: admin.userId
    });
    expect(overview).toMatchObject({
      result: "accepted",
      adminScope: {
        role: "platform_admin",
        platformWide: true,
        mfaEnabled: true
      }
    });
    if (overview.result !== "accepted") {
      throw new Error("expected platform governance overview to be accepted");
    }
    expect(overview.systemSummary.pendingOutboxEvents).toBeGreaterThanOrEqual(1);
    expect(overview.systemSummary.failedOutboxEvents).toBeGreaterThanOrEqual(1);
    expect(overview.systemSummary.latestLedgerCheck).toEqual(
      expect.objectContaining({
        status: "failed",
        ledgerDiffCount: 2
      })
    );
    expect(overview.pilotMetrics.activeCommunities).toBeGreaterThanOrEqual(1);
  });

  it("records dangerous operation previews without mutating business state", async () => {
    const community = await createCommunity("preview");
    const admin = await createAdmin("preview_platform", "platform_admin", true);
    const child = await prisma.childProfile.create({
      data: {
        id: unique("child"),
        displayName: "Preview Child",
        gradeBand: "3-4",
        status: "active"
      }
    });
    const item = await prisma.item.create({
      data: {
        id: unique("item"),
        communityId: community.id,
        sellerChildId: child.id,
        status: "listed",
        startPoints: 10,
        minIncrementPoints: 1
      }
    });

    await expect(
      governance.createAdminOperationPreview({
        actorUserId: admin.userId,
        operation: "export_child_data" satisfies Stage8AdminOperation,
        targetType: "child",
        targetId: unique("missing_child")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TARGET_NOT_FOUND"
    });

    await expect(
      governance.createAdminOperationPreview({
        actorUserId: admin.userId,
        operation: "force_delist" satisfies Stage8AdminOperation,
        targetType: "item",
        targetId: item.id,
        reason: "suspected prohibited item",
        now: new Date("2026-06-10T12:00:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      operation: "force_delist",
      targetType: "item",
      targetId: item.id,
      communityId: community.id,
      confirmationRequired: true,
      mutatesBusinessState: false,
      impactSummary: {
        counts: {
          activeFavoriteCount: 0
        }
      }
    });
    await expect(
      prisma.item.findUnique({
        where: {
          id: item.id
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "listed"
    });
    await expect(
      prisma.auditLog.findFirst({
        where: {
          actorUserId: admin.userId,
          action: "stage8.admin_operation_preview",
          targetType: "item",
          targetId: item.id
        },
        select: {
          reason: true,
          afterJson: true
        }
      })
    ).resolves.toMatchObject({
      reason: "suspected prohibited item",
      afterJson: expect.objectContaining({
        operation: "force_delist",
        mutatesBusinessState: false
      })
    });
  });

  it("requires existing preview targets and returns scoped activity-admin audit evidence", async () => {
    const community = await createCommunity("activity_preview");
    const admin = await createAdmin("activity_preview", "activity_admin", true);
    await prisma.adminCommunityScope.create({
      data: {
        id: unique("activity_preview_scope"),
        adminProfileId: admin.adminProfileId,
        communityId: community.id,
        status: "active"
      }
    });
    const child = await prisma.childProfile.create({
      data: {
        id: unique("activity_child"),
        displayName: "Activity Child",
        gradeBand: "3-4",
        status: "active"
      }
    });
    const item = await prisma.item.create({
      data: {
        id: unique("activity_item"),
        communityId: community.id,
        sellerChildId: child.id,
        status: "listed",
        startPoints: 10,
        minIncrementPoints: 1
      }
    });

    await expect(
      governance.createAdminOperationPreview({
        actorUserId: admin.userId,
        operation: "force_delist" satisfies Stage8AdminOperation,
        targetType: "item",
        targetId: unique("missing_item"),
        communityId: community.id
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TARGET_NOT_FOUND"
    });

    await expect(
      governance.createAdminOperationPreview({
        actorUserId: admin.userId,
        operation: "force_delist" satisfies Stage8AdminOperation,
        targetType: "item",
        targetId: item.id,
        communityId: community.id,
        reason: "activity admin preview evidence",
        now: new Date("2026-06-10T12:30:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted"
    });

    await expect(
      governance.getGovernanceOverview({
        actorUserId: admin.userId,
        communityId: community.id
      })
    ).resolves.toMatchObject({
      result: "accepted",
      recentAuditLogs: [
        expect.objectContaining({
          action: "stage8.admin_operation_preview",
          targetType: "item",
          targetId: item.id,
          reason: "activity admin preview evidence"
        })
      ]
    });
  });
});

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Stage 8 governance tests require DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Stage 8 governance tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

async function createAdmin(
  label: string,
  role: "activity_admin" | "platform_admin",
  mfaEnabled: boolean
) {
  const user = await prisma.user.create({
    data: {
      id: unique(`${label}_user`),
      status: "active"
    }
  });
  const admin = await prisma.adminProfile.create({
    data: {
      id: unique(`${label}_admin`),
      userId: user.id,
      role,
      status: "active",
      mfaEnabled
    }
  });

  return {
    userId: user.id,
    adminProfileId: admin.id
  };
}

function createCommunity(label: string) {
  return prisma.auctionCommunity.create({
    data: {
      id: unique(`${label}_community`),
      name: `${label} community`,
      creatorGuardianId: unique(`${label}_guardian`),
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
}

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          actorUserId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.outboxEvent.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.ledgerCheckRun.deleteMany({
    where: {
      id: {
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
  await prisma.childProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.adminCommunityScope.deleteMany({
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
  await prisma.adminProfile.deleteMany({
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
