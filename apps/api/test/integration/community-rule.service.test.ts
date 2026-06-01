import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { CommunityRuleService } from "../../src/communities/community-rule.service.js";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
const rules = new CommunityRuleService(prisma);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T16:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login to succeed");
  }

  return login.userId;
}

async function createGuardian(label: string) {
  const token = unique(label);
  const userId = await createUser(token);
  const guardian = await onboarding.ensureGuardianProfile({
    userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "7788",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T16:01:00.000Z")
  });

  return {
    userId,
    guardianId: guardian.guardianId
  };
}

async function createPlatformAdmin(label: string) {
  const userId = await createUser(label);
  await prisma.adminProfile.create({
    data: {
      userId,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  return {
    userId
  };
}

async function createCommunityWithAdmins(label: string) {
  const creator = await createGuardian(`${label}_creator`);
  const activityAdmin = await createGuardian(`${label}_activity_admin`);
  const platformAdmin = await createPlatformAdmin(`${label}_platform_admin`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Rule Community ${unique(label)}`,
      creatorGuardianId: creator.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  await prisma.adminProfile.create({
    data: {
      userId: activityAdmin.userId,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active",
      communityScopes: {
        create: {
          communityId: community.id,
          status: "active"
        }
      }
    }
  });

  return {
    community,
    activityAdmin,
    platformAdmin
  };
}

describe("CommunityRuleService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps exactly one active rule version per community when activating a draft", async () => {
    const { community, activityAdmin, platformAdmin } =
      await createCommunityWithAdmins("one_active");
    const firstRule = await prisma.communityRuleVersion.create({
      data: {
        communityId: community.id,
        versionNo: 1,
        status: "active",
        rulesJson: {
          version: 1
        },
        effectiveAt: new Date("2026-05-31T16:02:00.000Z")
      }
    });

    const draft = await rules.createDraftRuleVersion({
      actorUserId: activityAdmin.userId,
      communityId: community.id,
      rulesJson: {
        version: 2
      },
      now: new Date("2026-05-31T16:03:00.000Z")
    });

    expect(draft).toEqual({
      result: "accepted",
      ruleVersionId: expect.any(String),
      communityId: community.id,
      versionNo: 2,
      status: "draft"
    });
    if (draft.result !== "accepted") {
      throw new Error("expected draft creation to succeed");
    }

    await expect(
      rules.activateRuleVersion({
        platformAdminUserId: platformAdmin.userId,
        communityId: community.id,
        ruleVersionId: draft.ruleVersionId,
        now: new Date("2026-05-31T16:04:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      ruleVersionId: draft.ruleVersionId,
      communityId: community.id,
      versionNo: 2,
      status: "active"
    });

    await expect(
      prisma.communityRuleVersion.findMany({
        where: {
          communityId: community.id
        },
        select: {
          id: true,
          status: true
        },
        orderBy: {
          versionNo: "asc"
        }
      })
    ).resolves.toEqual([
      {
        id: firstRule.id,
        status: "retired"
      },
      {
        id: draft.ruleVersionId,
        status: "active"
      }
    ]);
    await expect(
      prisma.communityRuleVersion.count({
        where: {
          communityId: community.id,
          status: "active"
        }
      })
    ).resolves.toBe(1);
  });

  it("keeps existing community member evidence bound to the original rule version", async () => {
    const { community, activityAdmin, platformAdmin } =
      await createCommunityWithAdmins("member_evidence");
    const guardian = await createGuardian("member_evidence_guardian");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: guardian.userId,
      guardianId: guardian.guardianId,
      displayName: `Rule Member Child ${unique("child")}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `rule_member_initial_${unique("child")}`,
      now: new Date("2026-05-31T16:10:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const firstRule = await prisma.communityRuleVersion.create({
      data: {
        communityId: community.id,
        versionNo: 1,
        status: "active",
        rulesJson: {
          version: 1
        },
        effectiveAt: new Date("2026-05-31T16:11:00.000Z")
      }
    });
    await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: child.childId,
        ruleVersionId: firstRule.id,
        status: "active",
        rosterVerificationStatus: "matched",
        joinedAt: new Date("2026-05-31T16:12:00.000Z")
      }
    });

    const draft = await rules.createDraftRuleVersion({
      actorUserId: activityAdmin.userId,
      communityId: community.id,
      rulesJson: {
        version: 2
      },
      now: new Date("2026-05-31T16:13:00.000Z")
    });

    if (draft.result !== "accepted") {
      throw new Error("expected draft creation to succeed");
    }

    await rules.activateRuleVersion({
      platformAdminUserId: platformAdmin.userId,
      communityId: community.id,
      ruleVersionId: draft.ruleVersionId,
      now: new Date("2026-05-31T16:14:00.000Z")
    });

    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: community.id,
            childId: child.childId
          }
        },
        select: {
          ruleVersionId: true
        }
      })
    ).resolves.toEqual({
      ruleVersionId: firstRule.id
    });
  });

  it("allocates draft rule version numbers safely under concurrent creation", async () => {
    const { community, activityAdmin } =
      await createCommunityWithAdmins("concurrent_drafts");
    await prisma.communityRuleVersion.create({
      data: {
        communityId: community.id,
        versionNo: 1,
        status: "active",
        rulesJson: {
          version: 1
        },
        effectiveAt: new Date("2026-05-31T16:20:00.000Z")
      }
    });

    const results = await Promise.all([
      rules.createDraftRuleVersion({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        rulesJson: {
          version: 2,
          label: "first concurrent draft"
        },
        now: new Date("2026-05-31T16:21:00.000Z")
      }),
      rules.createDraftRuleVersion({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        rulesJson: {
          version: 3,
          label: "second concurrent draft"
        },
        now: new Date("2026-05-31T16:21:00.000Z")
      })
    ]);

    expect(results.every((result) => result.result === "accepted")).toBe(true);
    const versionNumbers = results
      .map((result) => {
        if (result.result !== "accepted") {
          throw new Error("expected draft creation to succeed");
        }

        return result.versionNo;
      })
      .sort((left, right) => left - right);

    expect(versionNumbers).toEqual([2, 3]);
    await expect(
      prisma.communityRuleVersion.findMany({
        where: {
          communityId: community.id
        },
        select: {
          versionNo: true,
          status: true
        },
        orderBy: {
          versionNo: "asc"
        }
      })
    ).resolves.toEqual([
      {
        versionNo: 1,
        status: "active"
      },
      {
        versionNo: 2,
        status: "draft"
      },
      {
        versionNo: 3,
        status: "draft"
      }
    ]);
  });
});
