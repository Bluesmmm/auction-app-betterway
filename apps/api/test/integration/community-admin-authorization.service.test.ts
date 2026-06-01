import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import {
  ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE,
  buildAdminCommunityScopeChallengeTargetId,
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import {
  FakeSensitiveOperationVerificationProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
const sessions = new SessionService(
  prisma,
  new SessionTokenService("community-admin-authorization-test-signing-key")
);
const verificationCode = "246810";
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => verificationCode
);
const adminAuth = new CommunityAdminAuthorizationService(
  prisma,
  sensitiveOperations
);
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

  const session = await sessions.createSession({
    userId,
    deviceFingerprintHash: `device_${unique(label)}`,
    ipHash: `ip_${unique(label)}`,
    userAgentHash: `ua_${unique(label)}`,
    now: new Date("2026-05-31T15:02:00.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected platform admin session creation to succeed");
  }

  return {
    userId,
    sessionId: session.sessionId
  };
}

async function createPassedAdminChallenge(input: {
  actorUserId: string;
  sessionId: string;
  operationType: string;
  communityId: string;
  targetUserId: string;
  now: Date;
}) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    operationType: input.operationType,
    targetType: ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE,
    targetId: buildAdminCommunityScopeChallengeTargetId(
      input.communityId,
      input.targetUserId
    ),
    riskLabels: [],
    now: input.now
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected admin challenge creation to succeed: ${challenge.errorCode}`);
  }

  await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    verificationCode,
    now: new Date(input.now.getTime() + 1_000)
  });

  return challenge.challengeId;
}

async function grantActivityAdminWithChallenge(input: {
  platformAdmin: { userId: string; sessionId: string };
  targetUserId: string;
  communityId: string;
  now: Date;
}) {
  const challengeId = await createPassedAdminChallenge({
    actorUserId: input.platformAdmin.userId,
    sessionId: input.platformAdmin.sessionId,
    operationType: SensitiveOperationType.grantActivityAdmin,
    communityId: input.communityId,
    targetUserId: input.targetUserId,
    now: new Date(input.now.getTime() - 2_000)
  });

  return adminAuth.grantActivityAdmin({
    platformAdminUserId: input.platformAdmin.userId,
    sessionId: input.platformAdmin.sessionId,
    challengeId,
    targetUserId: input.targetUserId,
    communityId: input.communityId,
    now: input.now
  });
}

async function revokeActivityAdminWithChallenge(input: {
  platformAdmin: { userId: string; sessionId: string };
  targetUserId: string;
  communityId: string;
  reason: string;
  now: Date;
}) {
  const challengeId = await createPassedAdminChallenge({
    actorUserId: input.platformAdmin.userId,
    sessionId: input.platformAdmin.sessionId,
    operationType: SensitiveOperationType.revokeActivityAdmin,
    communityId: input.communityId,
    targetUserId: input.targetUserId,
    now: new Date(input.now.getTime() - 2_000)
  });

  return adminAuth.revokeActivityAdmin({
    platformAdminUserId: input.platformAdmin.userId,
    sessionId: input.platformAdmin.sessionId,
    challengeId,
    targetUserId: input.targetUserId,
    communityId: input.communityId,
    reason: input.reason,
    now: input.now
  });
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
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await expect(
      grantActivityAdminWithChallenge({
        platformAdmin,
        targetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:06:10.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      adminProfileId: expect.any(String),
      communityId: community.id,
      scopeStatus: "active"
    });
  });

  it("rejects activity-admin grants for missing or inactive target users", async () => {
    const community = await createActiveCommunity("grant_inactive_target");
    const platformAdmin = await createPlatformAdmin(
      "grant_inactive_target_platform_admin"
    );
    const restrictedTargetUserId = await createUser("grant_restricted_target");
    await prisma.user.update({
      where: {
        id: restrictedTargetUserId
      },
      data: {
        status: "restricted"
      }
    });

    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        targetUserId: restrictedTargetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:06:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TARGET_ADMIN_NOT_ACTIVE"
    });
    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        targetUserId: `missing_target_${Date.now()}`,
        communityId: community.id,
        now: new Date("2026-05-31T15:06:45.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "TARGET_ADMIN_NOT_ACTIVE"
    });
    await expect(
      prisma.adminProfile.findUnique({
        where: {
          userId: restrictedTargetUserId
        }
      })
    ).resolves.toBeNull();
  });

  it("binds high-risk activity-admin challenges to the target user", async () => {
    const community = await createActiveCommunity("grant_target_bound");
    const platformAdmin = await createPlatformAdmin("grant_target_bound_admin");
    const firstTargetUserId = await createUser("grant_target_bound_first");
    const secondTargetUserId = await createUser("grant_target_bound_second");
    const firstChallengeId = await createPassedAdminChallenge({
      actorUserId: platformAdmin.userId,
      sessionId: platformAdmin.sessionId,
      operationType: SensitiveOperationType.grantActivityAdmin,
      communityId: community.id,
      targetUserId: firstTargetUserId,
      now: new Date("2026-05-31T15:06:20.000Z")
    });

    await expect(
      adminAuth.grantActivityAdmin({
        platformAdminUserId: platformAdmin.userId,
        sessionId: platformAdmin.sessionId,
        challengeId: firstChallengeId,
        targetUserId: secondTargetUserId,
        communityId: community.id,
        now: new Date("2026-05-31T15:06:25.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
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

    await grantActivityAdminWithChallenge({
      platformAdmin,
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
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });
  });

  it("revoking the last active activity-admin authorization closes new admission", async () => {
    const community = await createActiveCommunity("revoke_closes");
    const platformAdmin = await createPlatformAdmin("revoke_platform_admin");
    const targetUserId = await createUser("revoke_target");
    await grantActivityAdminWithChallenge({
      platformAdmin,
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
        reason: "missing challenge",
        now: new Date("2026-05-31T15:20:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await expect(
      revokeActivityAdminWithChallenge({
        platformAdmin,
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
    await grantActivityAdminWithChallenge({
      platformAdmin,
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
