import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
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
  new SessionTokenService("child-participation-test-signing-key")
);
const verificationCode = "135790";
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => verificationCode
);
const participation = new ChildParticipationService(prisma, sensitiveOperations);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = GuardianFixture & {
  childId: string;
  sessionId: string;
  deviceFingerprintHash: string;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createGuardianFixture(label: string): Promise<GuardianFixture> {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T13:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected guardian login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "8642",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T13:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

async function createChildFixture(label: string): Promise<ChildFixture> {
  const guardian = await createGuardianFixture(label);
  const token = unique(`child_${label}`);
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardian.userId,
    guardianId: guardian.guardianId,
    displayName: `Child ${token}`,
    gradeBand: "grade_3_4",
    idempotencyKey: `initial_${token}`,
    now: new Date("2026-05-31T13:02:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error("expected child creation to succeed");
  }

  const deviceFingerprintHash = `device_${token}`;
  const session = await sessions.createSession({
    userId: guardian.userId,
    deviceFingerprintHash,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T13:02:30.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected guardian session creation to succeed");
  }

  return {
    ...guardian,
    childId: child.childId,
    sessionId: session.sessionId,
    deviceFingerprintHash
  };
}

async function createActiveCommunityMembership(
  child: Pick<ChildFixture, "childId" | "guardianId">,
  label: string
) {
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Participation Community ${unique(label)}`,
      creatorGuardianId: child.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });

  await prisma.communityMember.create({
    data: {
      communityId: community.id,
      childId: child.childId,
      status: "active",
      guardianConfirmedAt: new Date("2026-05-31T13:29:00.000Z"),
      joinedAt: new Date("2026-05-31T13:29:30.000Z")
    }
  });

  return community.id;
}

async function createOpenAdmissionCommunity(
  child: Pick<ChildFixture, "guardianId" | "userId">,
  label: string
) {
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Join Community ${unique(label)}`,
      creatorGuardianId: child.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  const adminProfile = await prisma.adminProfile.create({
    data: {
      userId: child.userId,
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

  return community.id;
}

async function createPassedChallenge(input: {
  actorUserId: string;
  sessionId: string;
  operationType: string;
  childId: string;
  createdAt: Date;
  passedAt: Date;
}) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    operationType: input.operationType,
    targetType: "child_profile",
    targetId: input.childId,
    riskLabels: [],
    now: input.createdAt
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected challenge creation to succeed: ${challenge.errorCode}`);
  }

  await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    verificationCode,
    now: input.passedAt
  });

  return challenge.challengeId;
}

describe("ChildParticipationService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires an active primary guardian for join_community", async () => {
    const child = await createChildFixture("join_requires_primary");

    await prisma.guardianChildLink.updateMany({
      where: {
        childId: child.childId,
        role: "primary",
        guardianId: child.guardianId
      },
      data: {
        status: "revoked"
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T13:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
    });
  });

  it("requires the actor to represent the target child", async () => {
    const child = await createChildFixture("actor_boundary");
    const unrelatedGuardian = await createGuardianFixture("actor_boundary_other");

    await expect(
      participation.evaluateChildParticipation({
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T13:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ACTOR_NOT_AUTHORIZED"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: unrelatedGuardian.userId,
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T13:11:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ACTOR_NOT_AUTHORIZED"
    });
  });

  it("rejects child participation when the child profile is not active", async () => {
    const child = await createChildFixture("inactive_child");
    await prisma.childProfile.update({
      where: {
        id: child.childId
      },
      data: {
        status: "restricted"
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "join_community",
        now: new Date("2026-05-31T13:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "CHILD_NOT_ACTIVE"
    });
  });

  it("enforces browse membership and allows join_community when the community is open for admission", async () => {
    const child = await createChildFixture("browse_membership");
    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Browse Community ${unique("community")}`,
        creatorGuardianId: child.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    const joinCommunityId = await createOpenAdmissionCommunity(
      child,
      "browse_membership_join"
    );

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "join_community",
        communityId: joinCommunityId,
        now: new Date("2026-05-31T13:20:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "browse_community",
        communityId: community.id,
        now: new Date("2026-05-31T13:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_REQUIRED"
    });

    await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: child.childId,
        status: "active",
        guardianConfirmedAt: new Date("2026-05-31T13:22:00.000Z"),
        joinedAt: new Date("2026-05-31T13:22:30.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "browse_community",
        communityId: community.id,
        now: new Date("2026-05-31T13:23:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });
  });

  it("requires active community membership for community-scoped publish and bid", async () => {
    const child = await createChildFixture("community_scoped_actions");
    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Scoped Action Community ${unique("community")}`,
        creatorGuardianId: child.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });

    for (const action of ["publish", "bid"] as const) {
      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action,
          communityId: community.id,
          amountPoints: action === "bid" ? 10 : undefined,
          now: new Date("2026-05-31T13:24:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "COMMUNITY_MEMBER_REQUIRED"
      });
    }

    await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: child.childId,
        status: "active",
        guardianConfirmedAt: new Date("2026-05-31T13:25:00.000Z"),
        joinedAt: new Date("2026-05-31T13:25:30.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "publish",
        communityId: community.id,
        now: new Date("2026-05-31T13:26:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "bid",
        communityId: community.id,
        amountPoints: 10,
        now: new Date("2026-05-31T13:27:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });
  });

  it("rejects community-scoped actions when the community is suspended", async () => {
    const child = await createChildFixture("suspended_community");
    const communityId = await createActiveCommunityMembership(
      child,
      "suspended_community"
    );

    await prisma.auctionCommunity.update({
      where: {
        id: communityId
      },
      data: {
        status: "suspended"
      }
    });

    for (const action of ["join_community", "browse_community", "publish", "bid"] as const) {
      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action,
          communityId,
          amountPoints: action === "bid" ? 10 : undefined,
          now: new Date("2026-05-31T13:27:15.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "COMMUNITY_NOT_ACTIVE"
      });
    }
  });

  it("rejects community-scoped actions when the community id is missing", async () => {
    const child = await createChildFixture("missing_community_id");

    for (const action of ["join_community", "browse_community", "publish", "bid"] as const) {
      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action,
          amountPoints: action === "bid" ? 10 : undefined,
          now: new Date("2026-05-31T13:27:30.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "COMMUNITY_ID_REQUIRED"
      });
    }
  });

  it("rejects join_community when admission is not open", async () => {
    const child = await createChildFixture("join_admission_closed");
    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Closed Admission ${unique("community")}`,
        creatorGuardianId: child.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "join_community",
        communityId: community.id,
        now: new Date("2026-05-31T13:27:45.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });
  });

  it("enforces guardian controls, disputes, and risk restrictions for publish and bid", async () => {
    const publishChild = await createChildFixture("publish_controls");
    const publishCommunityId = await createActiveCommunityMembership(
      publishChild,
      "publish_controls"
    );

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: publishChild.userId,
        childId: publishChild.childId,
        action: "publish",
        communityId: publishCommunityId,
        now: new Date("2026-05-31T13:30:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await prisma.childGuardianSettings.update({
      where: {
        childId: publishChild.childId
      },
      data: {
        canPublish: false
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: publishChild.userId,
        childId: publishChild.childId,
        action: "publish",
        communityId: publishCommunityId,
        now: new Date("2026-05-31T13:31:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_CONTROL_DISABLED"
    });

    const frozenChild = await createChildFixture("publish_frozen");
    await prisma.guardianDispute.create({
      data: {
        childId: frozenChild.childId,
        submittingGuardianId: frozenChild.guardianId,
        type: "deletion",
        status: "frozen",
        frozenAt: new Date("2026-05-31T13:32:00.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: frozenChild.userId,
        childId: frozenChild.childId,
        action: "publish",
        now: new Date("2026-05-31T13:33:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const pendingDisputeChild = await createChildFixture("publish_pending_dispute");
    await prisma.guardianDispute.create({
      data: {
        childId: pendingDisputeChild.childId,
        submittingGuardianId: pendingDisputeChild.guardianId,
        type: "guardian_change",
        status: "pending_platform_review"
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: pendingDisputeChild.userId,
        childId: pendingDisputeChild.childId,
        action: "join_community",
        now: new Date("2026-05-31T13:33:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const bidChild = await createChildFixture("bid_limits");
    const bidCommunityId = await createActiveCommunityMembership(
      bidChild,
      "bid_limits"
    );
    await prisma.childGuardianSettings.update({
      where: {
        childId: bidChild.childId
      },
      data: {
        maxBidPoints: 30
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: bidChild.userId,
        childId: bidChild.childId,
        action: "bid",
        communityId: bidCommunityId,
        amountPoints: 25,
        now: new Date("2026-05-31T13:34:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: bidChild.userId,
        childId: bidChild.childId,
        action: "bid",
        communityId: bidCommunityId,
        amountPoints: 31,
        now: new Date("2026-05-31T13:35:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "MAX_BID_POINTS_EXCEEDED"
    });

    const restrictedChild = await createChildFixture("bid_risk");
    await prisma.riskRestriction.create({
      data: {
        type: "no_bid",
        scope: "child",
        targetId: restrictedChild.childId,
        childId: restrictedChild.childId,
        status: "active",
        reason: "contract_test_no_bid",
        startsAt: new Date("2026-05-31T13:36:00.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: restrictedChild.userId,
        childId: restrictedChild.childId,
        action: "bid",
        amountPoints: 10,
        now: new Date("2026-05-31T13:37:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });
  });

  it("maps risk restriction types to the matching child participation actions", async () => {
    const child = await createChildFixture("risk_mapping");
    const cases = [
      {
        type: "no_join" as const,
        action: "join_community" as const
      },
      {
        type: "no_publish" as const,
        action: "publish" as const
      },
      {
        type: "no_transaction_confirm" as const,
        action: "transaction_confirm" as const
      },
      {
        type: "no_export" as const,
        action: "export" as const
      },
      {
        type: "no_delete" as const,
        action: "delete" as const
      }
    ];

    for (const [index, testCase] of cases.entries()) {
      await prisma.riskRestriction.create({
        data: {
          type: testCase.type,
          scope: "child",
          targetId: child.childId,
          childId: child.childId,
          status: "active",
          reason: `contract_test_${testCase.type}`,
          startsAt: new Date("2026-05-31T13:38:00.000Z")
        }
      });

      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action: testCase.action,
          sessionId: child.sessionId,
          now: new Date(`2026-05-31T13:38:${String(index + 1).padStart(2, "0")}.000Z`)
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "RISK_RESTRICTED"
      });
    }
  });

  it("requires fresh sensitive challenges for transaction_confirm, export, and delete", async () => {
    const child = await createChildFixture("sensitive_actions");
    const cases = [
      {
        action: "transaction_confirm" as const,
        operationType: SensitiveOperationType.confirmTransaction
      },
      {
        action: "export" as const,
        operationType: SensitiveOperationType.exportChildData
      },
      {
        action: "delete" as const,
        operationType: SensitiveOperationType.deleteChildProfile
      }
    ];

    for (const testCase of cases) {
      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action: testCase.action,
          now: new Date("2026-05-31T13:40:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      });

      const challengeId = await createPassedChallenge({
        actorUserId: child.userId,
        sessionId: child.sessionId,
        operationType: testCase.operationType,
        childId: child.childId,
        createdAt: new Date("2026-05-31T13:41:00.000Z"),
        passedAt: new Date("2026-05-31T13:41:30.000Z")
      });

      await expect(
        participation.evaluateChildParticipation({
          actorUserId: child.userId,
          childId: child.childId,
          action: testCase.action,
          sensitiveChallengeId: challengeId,
          sessionId: child.sessionId,
          now: new Date("2026-05-31T13:42:00.000Z")
        })
      ).resolves.toEqual({
        result: "accepted"
      });
    }
  });

  it("rejects sensitive child actions when the device is no longer trusted", async () => {
    const child = await createChildFixture("sensitive_revoked_device");
    const challengeId = await createPassedChallenge({
      actorUserId: child.userId,
      sessionId: child.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      childId: child.childId,
      createdAt: new Date("2026-05-31T13:42:10.000Z"),
      passedAt: new Date("2026-05-31T13:42:20.000Z")
    });

    await prisma.trustedDevice.update({
      where: {
        userId_deviceFingerprintHash: {
          userId: child.userId,
          deviceFingerprintHash: child.deviceFingerprintHash
        }
      },
      data: {
        trustLevel: "revoked",
        revokedAt: new Date("2026-05-31T13:42:30.000Z")
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "export",
        sensitiveChallengeId: challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T13:42:40.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "DEVICE_NOT_TRUSTED"
    });
  });

  it("rejects sensitive child actions when the challenge belongs to another session or the session is revoked", async () => {
    const child = await createChildFixture("sensitive_session_bound");
    const otherSession = await sessions.createSession({
      userId: child.userId,
      deviceFingerprintHash: `device_other_${unique("sensitive")}`,
      ipHash: `ip_other_${unique("sensitive")}`,
      userAgentHash: `ua_other_${unique("sensitive")}`,
      now: new Date("2026-05-31T13:43:00.000Z")
    });

    if (otherSession.result !== "accepted") {
      throw new Error("expected secondary session creation to succeed");
    }

    const challengeId = await createPassedChallenge({
      actorUserId: child.userId,
      sessionId: child.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      childId: child.childId,
      createdAt: new Date("2026-05-31T13:43:10.000Z"),
      passedAt: new Date("2026-05-31T13:43:20.000Z")
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "export",
        sensitiveChallengeId: challengeId,
        sessionId: otherSession.sessionId,
        now: new Date("2026-05-31T13:44:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await sessions.revokeSession({
      actorUserId: child.userId,
      sessionId: child.sessionId,
      reason: "contract_test",
      now: new Date("2026-05-31T13:44:30.000Z")
    });

    await expect(
      participation.evaluateChildParticipation({
        actorUserId: child.userId,
        childId: child.childId,
        action: "export",
        sensitiveChallengeId: challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T13:45:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SESSION_REVOKED"
    });
  });
});
