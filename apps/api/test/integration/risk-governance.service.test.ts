import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { RiskGovernanceService } from "../../src/accounts/risk-governance.service.js";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
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
  new SessionTokenService("risk-governance-test-signing-key")
);
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider()
);
const participation = new ChildParticipationService(prisma, sessions);
const access = new CommunityAccessService(prisma);
const riskGovernance = new RiskGovernanceService(prisma);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createGuardian(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T18:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected guardian login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "2468",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T18:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

async function createChild(label: string) {
  const guardian = await createGuardian(label);
  const token = unique(`child_${label}`);
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardian.userId,
    guardianId: guardian.guardianId,
    displayName: `Risk Child ${token}`,
    gradeBand: "grade_3_4",
    initialPoints: 100,
    idempotencyKey: `risk_child_initial_${token}`,
    now: new Date("2026-05-31T18:02:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error("expected child creation to succeed");
  }

  const session = await sessions.createSession({
    userId: guardian.userId,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T18:03:00.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected session creation to succeed");
  }

  return {
    ...guardian,
    childId: child.childId,
    sessionId: session.sessionId
  };
}

async function createPlatformAdmin(label: string) {
  const user = await createGuardian(label);
  await prisma.adminProfile.create({
    data: {
      userId: user.userId,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  return user;
}

async function createCommunityWithAdmin(label: string) {
  const admin = await createGuardian(`${label}_admin`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Risk Community ${unique(label)}`,
      creatorGuardianId: admin.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  await prisma.adminProfile.create({
    data: {
      userId: admin.userId,
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
  await prisma.communityRuleVersion.create({
    data: {
      communityId: community.id,
      versionNo: 1,
      status: "active",
      rulesJson: {
        source: "risk-governance-test"
      },
      effectiveAt: new Date("2026-05-31T18:04:00.000Z")
    }
  });

  return {
    admin,
    community
  };
}

describe("RiskGovernanceService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records adult-impersonation risk, restricts child actions, and requires platform review to release", async () => {
    const child = await createChild("adult_impersonation");
    const platformAdmin = await createPlatformAdmin("adult_impersonation_admin");
    const nonPlatformReviewer = await createGuardian("adult_impersonation_non_admin");

    const signal = await riskGovernance.recordRiskSignal({
      actorUserId: platformAdmin.userId,
      type: "adult_impersonation_suspected",
      scope: "child",
      targetId: child.childId,
      evidenceJson: {
        classifier: "age_language_mismatch",
        score: 0.91
      },
      now: new Date("2026-05-31T18:10:00.000Z")
    });

    expect(signal).toEqual({
      result: "accepted",
      signalId: expect.any(String),
      status: "under_review",
      restrictionIds: [expect.any(String)]
    });
    if (signal.result !== "accepted") {
      throw new Error("expected risk signal creation to succeed");
    }

    await expect(
      prisma.$queryRaw<Array<{ riskSignalId: string | null }>>`
        SELECT "riskSignalId"
        FROM "RiskRestriction"
        WHERE "id" IN (${Prisma.join(signal.restrictionIds)})
      `
    ).resolves.toEqual([{ riskSignalId: signal.signalId }]);

    const decoyRestriction = await prisma.riskRestriction.create({
      data: {
        type: "no_bid",
        scope: "child",
        targetId: child.childId,
        childId: child.childId,
        status: "active",
        reason: `risk_signal:${signal.signalId}:manual_decoy`,
        startsAt: new Date("2026-05-31T18:10:30.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T18:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });

    await expect(
      sensitiveOperations.authorize({
        actorUserId: child.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: child.childId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T18:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });

    await expect(
      riskGovernance.reviewRiskSignal({
        platformAdminUserId: nonPlatformReviewer.userId,
        signalId: signal.signalId,
        decision: "dismissed",
        resolutionText: "not a platform admin",
        now: new Date("2026-05-31T18:13:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    await expect(
      riskGovernance.reviewRiskSignal({
        platformAdminUserId: platformAdmin.userId,
        signalId: signal.signalId,
        decision: "dismissed",
        resolutionText: "verified by platform admin",
        now: new Date("2026-05-31T18:14:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      signalId: signal.signalId,
      status: "dismissed",
      resolvedRestrictionCount: 1
    });

    await expect(
      prisma.riskRestriction.findUniqueOrThrow({
        where: {
          id: decoyRestriction.id
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });

    await expect(
      participation.evaluateChildParticipation({
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T18:15:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });
  });

  it("rejects ordinary users who try to create risk signals", async () => {
    const child = await createChild("ordinary_risk_target");
    const ordinaryGuardian = await createGuardian("ordinary_risk_actor");

    await expect(
      riskGovernance.recordRiskSignal({
        actorUserId: ordinaryGuardian.userId,
        type: "adult_impersonation_suspected",
        scope: "child",
        targetId: child.childId,
        evidenceJson: {
          attemptedBy: "ordinary_user"
        },
        now: new Date("2026-05-31T18:16:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_SIGNAL_ACTOR_NOT_AUTHORIZED"
    });

    await expect(
      prisma.riskRestriction.findMany({
        where: {
          childId: child.childId,
          status: "active"
        }
      })
    ).resolves.toEqual([]);
  });

  it("blocks restricted children before invite consumption and before admin member approval", async () => {
    const { admin, community } = await createCommunityWithAdmin("join_risk");
    const child = await createChild("join_risk_child");
    const platformAdmin = await createPlatformAdmin("join_risk_platform_admin");
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `RISKBLOCK${Date.now()}`,
      maxUses: 3
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const joinRisk = await riskGovernance.recordRiskSignal({
      actorUserId: platformAdmin.userId,
      type: "abnormal_join_pattern",
      scope: "child",
      targetId: child.childId,
      evidenceJson: {
        recentInviteAttempts: 7
      },
      now: new Date("2026-05-31T18:20:00.000Z")
    });

    if (joinRisk.result !== "accepted") {
      throw new Error("expected join risk signal creation to succeed");
    }

    await expect(
      access.requestJoinWithInvite({
        actorUserId: child.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `risk_blocked_join_${child.childId}`,
        now: new Date("2026-05-31T18:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });
    await expect(
      prisma.communityInviteCode.findUniqueOrThrow({
        where: {
          code: invite.code
        },
        select: {
          usedCount: true
        }
      })
    ).resolves.toEqual({
      usedCount: 0
    });

    await riskGovernance.reviewRiskSignal({
      platformAdminUserId: platformAdmin.userId,
      signalId: joinRisk.signalId,
      decision: "resolved",
      resolutionText: "cleared for pilot admission",
      now: new Date("2026-05-31T18:22:00.000Z")
    });

    await access.requestJoinWithInvite({
      actorUserId: child.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `risk_allowed_join_${child.childId}`,
      now: new Date("2026-05-31T18:23:00.000Z")
    });
    await access.confirmJoinByPrimaryGuardian({
      actorUserId: child.userId,
      communityId: community.id,
      childId: child.childId,
      now: new Date("2026-05-31T18:24:00.000Z")
    });
    await access.recordRosterVerification({
      actorUserId: admin.userId,
      communityId: community.id,
      childId: child.childId,
      status: "matched",
      evidenceJson: {
        rosterId: "risk-roster"
      },
      now: new Date("2026-05-31T18:25:00.000Z")
    });

    const member = await prisma.communityMember.findUniqueOrThrow({
      where: {
        communityId_childId: {
          communityId: community.id,
          childId: child.childId
        }
      }
    });
    const memberRisk = await riskGovernance.recordRiskSignal({
      actorUserId: admin.userId,
      type: "cross_community_anomaly",
      scope: "community_member",
      targetId: member.id,
      evidenceJson: {
        communitiesJoinedIn24h: 4
      },
      now: new Date("2026-05-31T18:26:00.000Z")
    });

    expect(memberRisk).toEqual({
      result: "accepted",
      signalId: expect.any(String),
      status: "under_review",
      restrictionIds: [expect.any(String), expect.any(String), expect.any(String)]
    });
    if (memberRisk.result !== "accepted") {
      throw new Error("expected member risk signal creation to succeed");
    }

    const otherChild = await createChild("join_risk_other_child");
    const otherJoin = await access.requestJoinWithInvite({
      actorUserId: otherChild.userId,
      childId: otherChild.childId,
      code: invite.code,
      idempotencyKey: `risk_unaffected_join_${otherChild.childId}`,
      now: new Date("2026-05-31T18:26:30.000Z")
    });
    expect(otherJoin).toEqual({
      result: "accepted",
      communityId: community.id,
      childId: otherChild.childId,
      memberStatus: "pending_guardian"
    });

    await expect(
      access.approveCommunityMember({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        now: new Date("2026-05-31T18:27:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });

    await riskGovernance.reviewRiskSignal({
      platformAdminUserId: platformAdmin.userId,
      signalId: memberRisk.signalId,
      decision: "resolved",
      resolutionText: "manual review approved membership",
      now: new Date("2026-05-31T18:28:00.000Z")
    });

    await expect(
      access.approveCommunityMember({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        now: new Date("2026-05-31T18:29:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: community.id,
      childId: child.childId,
      memberStatus: "active"
    });
  });

  it("treats guardian account takeover as a full account restriction before platform review", async () => {
    const child = await createChild("guardian_takeover");
    const platformAdmin = await createPlatformAdmin("guardian_takeover_admin");

    const signal = await riskGovernance.recordRiskSignal({
      actorUserId: platformAdmin.userId,
      type: "guardian_account_takeover_suspected",
      scope: "guardian",
      targetId: child.guardianId,
      evidenceJson: {
        abnormalLogin: true,
        newDeviceCount: 2
      },
      now: new Date("2026-05-31T18:40:00.000Z")
    });

    expect(signal).toEqual({
      result: "accepted",
      signalId: expect.any(String),
      status: "under_review",
      restrictionIds: [
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      ]
    });

    await expect(
      sensitiveOperations.authorize({
        actorUserId: child.userId,
        operationType: SensitiveOperationType.changeChildPermissions,
        targetType: "child_profile",
        targetId: child.childId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T18:41:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });
  });
});
