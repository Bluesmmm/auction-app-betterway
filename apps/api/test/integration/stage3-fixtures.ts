import type { PrismaClient } from "@prisma/client";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import {
  FakeSensitiveOperationVerificationProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";

export type Stage3Fixture = Awaited<ReturnType<typeof createStage3Fixture>>;

export function uniqueStage3(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createStage3Fixture(prisma: PrismaClient) {
  const sessionTokens = new SessionTokenService("stage3-fixture-signing-key");
  const sessions = new SessionService(prisma, sessionTokens);
  const onboarding = new OnboardingService(
    prisma,
    new FakeWechatAuthProvider(),
    sessions
  );
  const sensitiveOperations = new SensitiveOperationService(
    prisma,
    sessions,
    new FakeSensitiveOperationVerificationProvider(),
    () => "112233"
  );
  const participation = new ChildParticipationService(
    prisma,
    sensitiveOperations
  );
  const adminAuthorizations = new CommunityAdminAuthorizationService(
    prisma,
    sensitiveOperations
  );

  const guardianLogin = await onboarding.loginWithWechatCodeAndCreateSession({
    code: `mock_openid_${uniqueStage3("guardian")}`,
    deviceFingerprintHash: uniqueStage3("device"),
    ipHash: uniqueStage3("ip"),
    userAgentHash: uniqueStage3("ua"),
    now: new Date("2026-06-02T11:00:00.000Z")
  });
  if (guardianLogin.result !== "accepted") {
    throw new Error("guardian login failed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: guardianLogin.userId,
    phoneHash: uniqueStage3("phone_hash"),
    phoneLast4: "7788",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-06-02T11:01:00.000Z")
  });

  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardianLogin.userId,
    guardianId: guardian.guardianId,
    displayName: `Stage3 Child ${uniqueStage3("display")}`,
    gradeBand: "grade_3_4",
    idempotencyKey: uniqueStage3("child"),
    now: new Date("2026-06-02T11:02:00.000Z")
  });
  if (child.result !== "accepted") {
    throw new Error("child creation failed");
  }

  await prisma.childGuardianSettings.upsert({
    where: {
      childId: child.childId
    },
    update: {
      canPublish: true,
      canBid: true
    },
    create: {
      childId: child.childId,
      canPublish: true,
      canBid: true
    }
  });

  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Stage3 Community ${uniqueStage3("community")}`,
      creatorGuardianId: guardian.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });

  await prisma.communityMember.create({
    data: {
      communityId: community.id,
      childId: child.childId,
      status: "active",
      rosterVerificationStatus: "matched",
      guardianConfirmedAt: new Date("2026-06-02T11:03:00.000Z"),
      adminReviewedAt: new Date("2026-06-02T11:04:00.000Z"),
      joinedAt: new Date("2026-06-02T11:05:00.000Z")
    }
  });

  const adminUser = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId: adminUser.id,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    }
  });
  await prisma.adminCommunityScope.create({
    data: {
      adminProfileId: adminProfile.id,
      communityId: community.id,
      status: "active"
    }
  });

  const platformAdminUser = await prisma.user.create({
    data: {
      status: "active"
    }
  });
  await prisma.adminProfile.create({
    data: {
      userId: platformAdminUser.id,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  return {
    guardianUserId: guardianLogin.userId,
    guardianId: guardian.guardianId,
    childId: child.childId,
    communityId: community.id,
    activityAdminUserId: adminUser.id,
    platformAdminUserId: platformAdminUser.id,
    participation,
    adminAuthorizations
  };
}

export async function createTempMediaSet(
  prisma: PrismaClient,
  ownerUserId: string,
  suffix: string
) {
  return Promise.all(
    ["front", "back", "side", "detail"].map((role) =>
      prisma.mediaAsset.create({
        data: {
          ownerUserId,
          storageBucket: "private-stage3",
          storageKey: `temp/${ownerUserId}/${suffix}-${role}.jpg`,
          visibility: "temp_private",
          mimeType: "image/jpeg",
          sizeBytes: 300_000,
          checksum: `sha256:${suffix}:${role}`
        }
      })
    )
  );
}
