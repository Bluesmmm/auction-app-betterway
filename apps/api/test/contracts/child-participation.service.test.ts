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
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
const sessions = new SessionService(
  prisma,
  new SessionTokenService("child-participation-test-signing-key")
);
const sensitiveOperations = new SensitiveOperationService(prisma, sessions);
const participation = new ChildParticipationService(prisma, sessions);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = GuardianFixture & {
  childId: string;
  sessionId: string;
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
    initialPoints: 100,
    idempotencyKey: `initial_${token}`,
    now: new Date("2026-05-31T13:02:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error("expected child creation to succeed");
  }

  const session = await sessions.createSession({
    userId: guardian.userId,
    deviceFingerprintHash: `device_${token}`,
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
    sessionId: session.sessionId
  };
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

  it("enforces browse membership and allows join_community when the child is otherwise eligible", async () => {
    const child = await createChildFixture("browse_membership");
    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Browse Community ${unique("community")}`,
        creatorGuardianId: child.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });

    await expect(
      participation.evaluateChildParticipation({
        childId: child.childId,
        action: "join_community",
        communityId: community.id,
        now: new Date("2026-05-31T13:20:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
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
        childId: child.childId,
        action: "browse_community",
        communityId: community.id,
        now: new Date("2026-05-31T13:23:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });
  });

  it("enforces guardian controls, disputes, and risk restrictions for publish and bid", async () => {
    const publishChild = await createChildFixture("publish_controls");

    await expect(
      participation.evaluateChildParticipation({
        childId: publishChild.childId,
        action: "publish",
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
        childId: publishChild.childId,
        action: "publish",
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
        childId: frozenChild.childId,
        action: "publish",
        now: new Date("2026-05-31T13:33:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const bidChild = await createChildFixture("bid_limits");
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
        childId: bidChild.childId,
        action: "bid",
        amountPoints: 25,
        now: new Date("2026-05-31T13:34:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted"
    });

    await expect(
      participation.evaluateChildParticipation({
        childId: bidChild.childId,
        action: "bid",
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
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });
});
