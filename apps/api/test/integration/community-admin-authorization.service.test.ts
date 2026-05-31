import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
const adminAuth = new CommunityAdminAuthorizationService(prisma);
const access = new CommunityAccessService(prisma);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T15:00:00.000Z")
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
    phoneLast4: "3344",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T15:01:00.000Z")
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

async function createActiveCommunity(label: string) {
  const creator = await createGuardian(`${label}_creator`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Community ${unique(label)}`,
      creatorGuardianId: creator.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });

  return {
    ...community,
    creatorUserId: creator.userId
  };
}

describe("CommunityAdminAuthorizationService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows only active MFA platform admins to grant activity-admin authorization", async () => {
    const community = await createActiveCommunity("grant_only_platform");
    const nonAdmin = await createUser("grant_non_admin");
    const targetUserId = await createUser("grant_target");

    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: nonAdmin,
        targetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:05:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    const platformAdmin = await createPlatformAdmin("grant_platform_admin");

    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        targetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:06:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      adminProfileId: expect.any(String),
      communityId: community.id,
      scopeStatus: "active"
    });
  });

  it("does not reactivate or scope an existing non-activity admin profile", async () => {
    const community = await createActiveCommunity("grant_non_activity_admin");
    const platformAdmin = await createPlatformAdmin(
      "grant_non_activity_platform_admin"
    );
    const targetUserId = await createUser("grant_existing_platform_admin");
    const existingProfile = await prisma.adminProfile.create({
      data: {
        userId: targetUserId,
        role: "platform_admin",
        mfaEnabled: true,
        status: "restricted"
      }
    });

    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        targetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:07:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TARGET_ADMIN_ROLE_INVALID"
    });

    await expect(
      prisma.adminProfile.findUniqueOrThrow({
        where: {
          id: existingProfile.id
        },
        select: {
          role: true,
          status: true,
          communityScopes: {
            select: {
              id: true
            }
          }
        }
      })
    ).resolves.toEqual({
      role: "platform_admin",
      status: "restricted",
      communityScopes: []
    });
  });

  it("requires an active MFA activity admin before a community is open for admission", async () => {
    const community = await createActiveCommunity("mfa_open");
    const platformAdmin = await createPlatformAdmin("mfa_open_platform_admin");
    const targetUserId = await createUser("mfa_open_target");

    await adminAuth.grantActivityAdmin({
      platformAdminUserId: platformAdmin.userId,
      targetUserId,
      communityId: community.id,
      now: new Date("2026-05-31T15:10:00.000Z")
    });

    await expect(
      adminAuth.assertCommunityOpenForAdmission({
        communityId: community.id
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });

    await prisma.adminProfile.update({
      where: {
        userId: targetUserId
      },
      data: {
        mfaEnabled: true
      }
    });

    await expect(
      adminAuth.assertCommunityOpenForAdmission({
        communityId: community.id
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: community.id
    });
  });

  it("does not let community approval alone create invite authority", async () => {
    const community = await createActiveCommunity("approval_alone");

    await expect(
      access.createInviteCode({
        actorUserId: community.creatorUserId,
        communityId: community.id,
        code: `JOIN${Date.now()}`,
        maxUses: 10
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
  });

  it("revoking the last active activity-admin authorization closes new admission", async () => {
    const community = await createActiveCommunity("revoke_closes");
    const platformAdmin = await createPlatformAdmin("revoke_platform_admin");
    const targetUserId = await createUser("revoke_target");
    await adminAuth.grantActivityAdmin({
      platformAdminUserId: platformAdmin.userId,
      targetUserId,
      communityId: community.id,
      now: new Date("2026-05-31T15:20:00.000Z")
    });
    await prisma.adminProfile.update({
      where: {
        userId: targetUserId
      },
      data: {
        mfaEnabled: true
      }
    });

    await expect(
      adminAuth.assertCommunityOpenForAdmission({
        communityId: community.id
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: community.id
    });

    await expect(
      adminAuth.revokeActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        targetUserId,
        communityId: community.id,
        reason: "operator rotation",
        now: new Date("2026-05-31T15:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      adminProfileId: expect.any(String),
      communityId: community.id,
      scopeStatus: "revoked"
    });

    await expect(
      adminAuth.assertCommunityOpenForAdmission({
        communityId: community.id
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });
  });

  it("keeps activity-admin scope limited to the authorized community", async () => {
    const firstCommunity = await createActiveCommunity("scope_first");
    const secondCommunity = await createActiveCommunity("scope_second");
    const platformAdmin = await createPlatformAdmin("scope_platform_admin");
    const targetUserId = await createUser("scope_target");
    await adminAuth.grantActivityAdmin({
      platformAdminUserId: platformAdmin.userId,
      targetUserId,
      communityId: firstCommunity.id,
      now: new Date("2026-05-31T15:30:00.000Z")
    });
    await prisma.adminProfile.update({
      where: {
        userId: targetUserId
      },
      data: {
        mfaEnabled: true
      }
    });

    await expect(
      adminAuth.findActiveScopedActivityAdmin({
        actorUserId: targetUserId,
        communityId: firstCommunity.id
      })
    ).resolves.toEqual({
      result: "accepted",
      adminProfileId: expect.any(String),
      communityId: firstCommunity.id
    });

    await expect(
      adminAuth.findActiveScopedActivityAdmin({
        actorUserId: targetUserId,
        communityId: secondCommunity.id
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });
  });
});
