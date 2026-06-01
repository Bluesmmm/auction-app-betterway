import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import {
  ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE,
  buildAdminCommunityScopeChallengeTargetId,
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { CommunityApplicationService } from "../../src/communities/community-application.service.js";
import {
  FakeSensitiveOperationVerificationProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const sessions = new SessionService(
  prisma,
  new SessionTokenService("stage2-accounts-community-flow-signing-key")
);
const onboarding = new OnboardingService(
  prisma,
  new FakeWechatAuthProvider(),
  sessions
);
const verificationCode = "112233";
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => verificationCode
);
const applications = new CommunityApplicationService(prisma, sensitiveOperations);
const adminAuthorizations = new CommunityAdminAuthorizationService(
  prisma,
  sensitiveOperations
);
const access = new CommunityAccessService(prisma, adminAuthorizations);
const participation = new ChildParticipationService(prisma, sensitiveOperations);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createGuardianWithSession(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCodeAndCreateSession({
    code: `mock_openid_${token}`,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T14:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected guardian login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "8899",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T14:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId,
    sessionId: login.sessionId
  };
}

async function createPlatformAdmin(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCodeAndCreateSession({
    code: `mock_openid_${token}`,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T14:02:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected platform admin login to succeed");
  }

  await prisma.adminProfile.create({
    data: {
      userId: login.userId,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  return {
    userId: login.userId,
    sessionId: login.sessionId
  };
}

async function createUser(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T14:03:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected user login to succeed");
  }

  return {
    userId: login.userId
  };
}

describe("Stage 2 accounts-community flow", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps community approval, activity-admin authorization, admission evidence, and scoped participation separated", async () => {
    const applicant = await createGuardianWithSession("stage2_flow_applicant");
    const platformAdmin = await createPlatformAdmin("stage2_flow_platform_admin");
    const activityAdminCandidate = await createUser("stage2_flow_activity_admin");

    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: applicant.userId,
      guardianId: applicant.guardianId,
      displayName: `Stage2 Flow Child ${unique("display")}`,
      gradeBand: "grade_3_4",
      idempotencyKey: unique("stage2_flow_child"),
      now: new Date("2026-05-31T14:05:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const challenge = await sensitiveOperations.createChallenge({
      actorUserId: applicant.userId,
      sessionId: applicant.sessionId,
      operationType: SensitiveOperationType.createCommunity,
      targetType: "guardian_profile",
      targetId: applicant.guardianId,
      riskLabels: ["stage2_flow"],
      now: new Date("2026-05-31T14:06:00.000Z")
    });

    if (challenge.result !== "accepted") {
      throw new Error("expected challenge creation to succeed");
    }

    const passedChallenge = await sensitiveOperations.markPassed({
      challengeId: challenge.challengeId,
      actorUserId: applicant.userId,
      sessionId: applicant.sessionId,
      verificationCode,
      now: new Date("2026-05-31T14:06:30.000Z")
    });

    expect(passedChallenge).toEqual(
      expect.objectContaining({
        result: "accepted",
        challengeId: challenge.challengeId,
        status: "passed"
      })
    );

    const request = await applications.submitCreationRequest({
      actorUserId: applicant.userId,
      sessionId: applicant.sessionId,
      guardianId: applicant.guardianId,
      name: `Stage2 Flow Community ${unique("community")}`,
      description: "full flow",
      gradeBand: "grade_3_4",
      expectedChildCount: 32,
      ruleDraftJson: {
        version: 1,
        source: "stage2-flow-test"
      },
      challengeId: challenge.challengeId,
      now: new Date("2026-05-31T14:07:00.000Z")
    });

    expect(request).toEqual(
      expect.objectContaining({
        result: "accepted",
        requestStatus: "pending_review"
      })
    );
    if (request.result !== "accepted") {
      throw new Error("expected creation request to succeed");
    }

    const approved = await applications.approveCreationRequest({
      platformAdminUserId: platformAdmin.userId,
      requestId: request.requestId,
      defaultAuctionDurationMinutes: 1440,
      now: new Date("2026-05-31T14:08:00.000Z")
    });

    expect(approved).toEqual(
      expect.objectContaining({
        result: "accepted",
        requestId: request.requestId,
        requestStatus: "approved",
        communityId: expect.any(String)
      })
    );
    if (approved.result !== "accepted" || !approved.communityId) {
      throw new Error("expected community approval to succeed");
    }

    await expect(
      adminAuthorizations.findActiveScopedActivityAdmin({
        actorUserId: applicant.userId,
        communityId: approved.communityId
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });

    await expect(
      access.createInviteCode({
        actorUserId: applicant.userId,
        communityId: approved.communityId,
        code: unique("invite_before_auth"),
        maxUses: 1
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });

    const grantChallenge = await sensitiveOperations.createChallenge({
      actorUserId: platformAdmin.userId,
      sessionId: platformAdmin.sessionId,
      operationType: SensitiveOperationType.grantActivityAdmin,
      targetType: ADMIN_COMMUNITY_SCOPE_CHALLENGE_TARGET_TYPE,
      targetId: buildAdminCommunityScopeChallengeTargetId(
        approved.communityId,
        activityAdminCandidate.userId
      ),
      riskLabels: [],
      now: new Date("2026-05-31T14:08:30.000Z")
    });

    if (grantChallenge.result !== "accepted") {
      throw new Error("expected activity admin grant challenge creation");
    }
    await sensitiveOperations.markPassed({
      challengeId: grantChallenge.challengeId,
      actorUserId: platformAdmin.userId,
      sessionId: platformAdmin.sessionId,
      verificationCode,
      now: new Date("2026-05-31T14:08:45.000Z")
    });

    const grantedAdmin = await adminAuthorizations.grantActivityAdmin({
      platformAdminUserId: platformAdmin.userId,
      sessionId: platformAdmin.sessionId,
      challengeId: grantChallenge.challengeId,
      targetUserId: activityAdminCandidate.userId,
      communityId: approved.communityId,
      now: new Date("2026-05-31T14:09:00.000Z")
    });

    expect(grantedAdmin).toEqual(
      expect.objectContaining({
        result: "accepted",
        communityId: approved.communityId,
        scopeStatus: "active"
      })
    );

    await prisma.adminProfile.update({
      where: {
        userId: activityAdminCandidate.userId
      },
      data: {
        mfaEnabled: true
      }
    });

    const activeRule = await prisma.communityRuleVersion.findFirstOrThrow({
      where: {
        communityId: approved.communityId,
        status: "active"
      },
      orderBy: {
        versionNo: "desc"
      }
    });

    const invite = await access.createInviteCode({
      actorUserId: activityAdminCandidate.userId,
      communityId: approved.communityId,
      code: unique("invite_active"),
      maxUses: 1
    });

    expect(invite).toEqual(
      expect.objectContaining({
        result: "accepted",
        status: "active"
      })
    );
    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const joinRequest = await access.requestJoinWithInvite({
      actorUserId: applicant.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: unique("join_request"),
      now: new Date("2026-05-31T14:10:00.000Z")
    });

    expect(joinRequest).toEqual({
      result: "accepted",
      communityId: approved.communityId,
      childId: child.childId,
      memberStatus: "pending_guardian"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: applicant.userId,
        childId: child.childId,
        action: "publish",
        communityId: approved.communityId,
        now: new Date("2026-05-31T14:10:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_REQUIRED"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: applicant.userId,
        childId: child.childId,
        action: "bid",
        communityId: approved.communityId,
        amountPoints: 25,
        now: new Date("2026-05-31T14:10:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_REQUIRED"
    });

    await expect(
      access.confirmJoinByPrimaryGuardian({
        actorUserId: applicant.userId,
        communityId: approved.communityId,
        childId: child.childId,
        now: new Date("2026-05-31T14:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: approved.communityId,
      childId: child.childId,
      memberStatus: "pending_admin"
    });

    const rosterEvidence = {
      rosterId: "grade-3-4-a",
      matchedBy: "coach",
      source: "manual-check"
    };

    await expect(
      access.recordRosterVerification({
        actorUserId: activityAdminCandidate.userId,
        communityId: approved.communityId,
        childId: child.childId,
        status: "matched",
        evidenceJson: rosterEvidence,
        now: new Date("2026-05-31T14:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: approved.communityId,
      childId: child.childId,
      memberStatus: "pending_admin"
    });

    await expect(
      access.approveCommunityMember({
        actorUserId: activityAdminCandidate.userId,
        communityId: approved.communityId,
        childId: child.childId,
        now: new Date("2026-05-31T14:13:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: approved.communityId,
      childId: child.childId,
      memberStatus: "active"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: applicant.userId,
        childId: child.childId,
        action: "publish",
        communityId: approved.communityId,
        now: new Date("2026-05-31T14:13:30.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: applicant.userId,
        childId: child.childId,
        action: "bid",
        communityId: approved.communityId,
        amountPoints: 25,
        now: new Date("2026-05-31T14:13:30.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: approved.communityId,
            childId: child.childId
          }
        },
        select: {
          status: true,
          inviteCodeId: true,
          ruleVersionId: true,
          guardianConfirmedAt: true,
          rosterVerificationStatus: true,
          rosterEvidenceJson: true,
          adminReviewedByUserId: true,
          adminReviewedAt: true,
          joinedAt: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      inviteCodeId: invite.inviteCodeId,
      ruleVersionId: activeRule.id,
      guardianConfirmedAt: new Date("2026-05-31T14:11:00.000Z"),
      rosterVerificationStatus: "matched",
      rosterEvidenceJson: rosterEvidence,
      adminReviewedByUserId: activityAdminCandidate.userId,
      adminReviewedAt: new Date("2026-05-31T14:13:00.000Z"),
      joinedAt: new Date("2026-05-31T14:13:00.000Z")
    });
  });
});
