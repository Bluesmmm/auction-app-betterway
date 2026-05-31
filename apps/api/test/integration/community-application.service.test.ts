import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityApplicationService } from "../../src/communities/community-application.service.js";
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
  new SessionTokenService("community-application-test-signing-key")
);
const verificationCode = "864209";
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => verificationCode
);
const applications = new CommunityApplicationService(
  prisma,
  sensitiveOperations
);

type GuardianFixture = {
  userId: string;
  guardianId: string;
  sessionId: string;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T14:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login to succeed");
  }

  return login.userId;
}

async function createGuardianFixture(label: string): Promise<GuardianFixture> {
  const token = unique(label);
  const userId = await createUser(token);
  const guardian = await onboarding.ensureGuardianProfile({
    userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "1122",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T14:01:00.000Z")
  });
  const session = await sessions.createSession({
    userId,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T14:01:30.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected session creation to succeed");
  }

  return {
    userId,
    guardianId: guardian.guardianId,
    sessionId: session.sessionId
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

async function createPassedCommunityCreationChallenge(
  guardian: GuardianFixture
) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: guardian.userId,
    sessionId: guardian.sessionId,
    operationType: SensitiveOperationType.createCommunity,
    targetType: "guardian_profile",
    targetId: guardian.guardianId,
    riskLabels: [],
    now: new Date("2026-05-31T14:02:00.000Z")
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected challenge creation to succeed: ${challenge.errorCode}`);
  }

  await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: guardian.userId,
    sessionId: guardian.sessionId,
    verificationCode,
    now: new Date("2026-05-31T14:02:10.000Z")
  });

  return challenge.challengeId;
}

async function submitRequest(guardian: GuardianFixture, label: string) {
  const challengeId = await createPassedCommunityCreationChallenge(guardian);
  return applications.submitCreationRequest({
    actorUserId: guardian.userId,
    sessionId: guardian.sessionId,
    guardianId: guardian.guardianId,
    name: `Community ${unique(label)}`,
    description: `Description ${label}`,
    gradeBand: "grade_3_4",
    expectedChildCount: 24,
    ruleDraftJson: {
      version: 1,
      allowedGrades: ["grade_3_4"]
    },
    challengeId,
    now: new Date("2026-05-31T14:03:00.000Z")
  });
}

describe("CommunityApplicationService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a fresh sensitive challenge to submit a community creation request", async () => {
    const guardian = await createGuardianFixture("submit_requires_challenge");

    await expect(
      applications.submitCreationRequest({
        actorUserId: guardian.userId,
        sessionId: guardian.sessionId,
        guardianId: guardian.guardianId,
        name: `Community ${unique("missing_challenge")}`,
        gradeBand: "grade_3_4",
        expectedChildCount: 20,
        ruleDraftJson: {
          version: 1
        },
        challengeId: "missing_challenge",
        now: new Date("2026-05-31T14:05:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });

  it("rejects restricted guardians and guardians with frozen children", async () => {
    const restrictedGuardian = await createGuardianFixture("restricted_guardian");
    const restrictedChallenge = await createPassedCommunityCreationChallenge(
      restrictedGuardian
    );
    await prisma.guardianProfile.update({
      where: {
        id: restrictedGuardian.guardianId
      },
      data: {
        status: "restricted"
      }
    });

    await expect(
      applications.submitCreationRequest({
        actorUserId: restrictedGuardian.userId,
        sessionId: restrictedGuardian.sessionId,
        guardianId: restrictedGuardian.guardianId,
        name: `Community ${unique("restricted")}`,
        gradeBand: "grade_3_4",
        expectedChildCount: 20,
        ruleDraftJson: {
          version: 1
        },
        challengeId: restrictedChallenge,
        now: new Date("2026-05-31T14:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_NOT_ACTIVE"
    });

    const frozenGuardian = await createGuardianFixture("frozen_guardian");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: frozenGuardian.userId,
      guardianId: frozenGuardian.guardianId,
      displayName: `Child ${unique("frozen")}`,
      gradeBand: "grade_3_4",
      initialPoints: 100,
      idempotencyKey: `initial_${unique("frozen")}`,
      now: new Date("2026-05-31T14:03:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    await prisma.guardianDispute.create({
      data: {
        childId: child.childId,
        submittingGuardianId: frozenGuardian.guardianId,
        type: "guardian_change",
        status: "frozen",
        frozenAt: new Date("2026-05-31T14:03:30.000Z")
      }
    });
    const frozenChallenge = await createPassedCommunityCreationChallenge(
      frozenGuardian
    );

    await expect(
      applications.submitCreationRequest({
        actorUserId: frozenGuardian.userId,
        sessionId: frozenGuardian.sessionId,
        guardianId: frozenGuardian.guardianId,
        name: `Community ${unique("frozen")}`,
        gradeBand: "grade_3_4",
        expectedChildCount: 20,
        ruleDraftJson: {
          version: 1
        },
        challengeId: frozenChallenge,
        now: new Date("2026-05-31T14:04:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });
  });

  it("lets a platform admin approve a request and create a community without activity-admin scope", async () => {
    const guardian = await createGuardianFixture("approve_request");
    const submitted = await submitRequest(guardian, "approve_request");
    const platformAdmin = await createPlatformAdmin("approve_request_admin");

    if (submitted.result !== "accepted") {
      throw new Error("expected request submission to succeed");
    }

    const approved = await applications.approveCreationRequest({
      platformAdminUserId: platformAdmin.userId,
      requestId: submitted.requestId,
      defaultAuctionDurationMinutes: 1440,
      now: new Date("2026-05-31T14:20:00.000Z")
    });

    expect(approved).toEqual({
      result: "accepted",
      requestId: submitted.requestId,
      requestStatus: "approved",
      communityId: expect.any(String)
    });
    if (approved.result !== "accepted" || !approved.communityId) {
      throw new Error("expected request approval to create a community");
    }

    await expect(
      prisma.auctionCommunity.findUniqueOrThrow({
        where: {
          id: approved.communityId
        },
        select: {
          status: true,
          creatorGuardianId: true,
          ruleVersions: {
            select: {
              versionNo: true,
              status: true,
              effectiveAt: true
            }
          },
          adminScopes: {
            select: {
              id: true
            }
          }
        }
      })
    ).resolves.toEqual({
      status: "active",
      creatorGuardianId: guardian.guardianId,
      ruleVersions: [
        {
          versionNo: 1,
          status: "active",
          effectiveAt: new Date("2026-05-31T14:20:00.000Z")
        }
      ],
      adminScopes: []
    });
  });

  it("serializes concurrent creation request reviews without orphan communities", async () => {
    const duplicateGuardian = await createGuardianFixture("duplicate_approve");
    const duplicateSubmission = await submitRequest(
      duplicateGuardian,
      "duplicate_approve"
    );
    const firstAdmin = await createPlatformAdmin("duplicate_approve_admin_1");
    const secondAdmin = await createPlatformAdmin("duplicate_approve_admin_2");

    if (duplicateSubmission.result !== "accepted") {
      throw new Error("expected request submission to succeed");
    }

    const duplicateRequest =
      await prisma.communityCreationRequest.findUniqueOrThrow({
        where: {
          id: duplicateSubmission.requestId
        },
        select: {
          requestedName: true
        }
      });
    const duplicateResults = await Promise.all([
      applications.approveCreationRequest({
        platformAdminUserId: firstAdmin.userId,
        requestId: duplicateSubmission.requestId,
        defaultAuctionDurationMinutes: 1440,
        now: new Date("2026-05-31T14:22:00.000Z")
      }),
      applications.approveCreationRequest({
        platformAdminUserId: secondAdmin.userId,
        requestId: duplicateSubmission.requestId,
        defaultAuctionDurationMinutes: 1440,
        now: new Date("2026-05-31T14:22:01.000Z")
      })
    ]);

    expect(
      duplicateResults.filter((result) => result.result === "accepted")
    ).toHaveLength(1);
    expect(
      duplicateResults.filter((result) => result.result === "rejected")
    ).toEqual([
      {
        result: "rejected",
        errorCode: "CREATION_REQUEST_STATE_INVALID"
      }
    ]);
    await expect(
      prisma.auctionCommunity.count({
        where: {
          name: duplicateRequest.requestedName
        }
      })
    ).resolves.toBe(1);

    const raceGuardian = await createGuardianFixture("approve_reject_race");
    const raceSubmission = await submitRequest(raceGuardian, "approve_reject_race");
    const approveAdmin = await createPlatformAdmin("approve_reject_admin_1");
    const rejectAdmin = await createPlatformAdmin("approve_reject_admin_2");

    if (raceSubmission.result !== "accepted") {
      throw new Error("expected request submission to succeed");
    }

    const raceRequest = await prisma.communityCreationRequest.findUniqueOrThrow({
      where: {
        id: raceSubmission.requestId
      },
      select: {
        requestedName: true
      }
    });
    const raceResults = await Promise.all([
      applications.approveCreationRequest({
        platformAdminUserId: approveAdmin.userId,
        requestId: raceSubmission.requestId,
        defaultAuctionDurationMinutes: 1440,
        now: new Date("2026-05-31T14:23:00.000Z")
      }),
      applications.rejectCreationRequest({
        platformAdminUserId: rejectAdmin.userId,
        requestId: raceSubmission.requestId,
        reason: "not ready",
        now: new Date("2026-05-31T14:23:01.000Z")
      })
    ]);

    expect(
      raceResults.filter((result) => result.result === "accepted")
    ).toHaveLength(1);
    expect(
      raceResults.filter((result) => result.result === "rejected")
    ).toEqual([
      {
        result: "rejected",
        errorCode: "CREATION_REQUEST_STATE_INVALID"
      }
    ]);

    const finalRequest = await prisma.communityCreationRequest.findUniqueOrThrow({
      where: {
        id: raceSubmission.requestId
      },
      select: {
        status: true,
        approvedCommunityId: true
      }
    });
    const raceCommunityCount = await prisma.auctionCommunity.count({
      where: {
        name: raceRequest.requestedName
      }
    });

    if (finalRequest.status === "approved") {
      expect(finalRequest.approvedCommunityId).toEqual(expect.any(String));
      expect(raceCommunityCount).toBe(1);
    } else {
      expect(finalRequest).toEqual({
        status: "rejected",
        approvedCommunityId: null
      });
      expect(raceCommunityCount).toBe(0);
    }
  });

  it("stores rejection reason and reviewer for rejected creation requests", async () => {
    const guardian = await createGuardianFixture("reject_request");
    const submitted = await submitRequest(guardian, "reject_request");
    const platformAdmin = await createPlatformAdmin("reject_request_admin");

    if (submitted.result !== "accepted") {
      throw new Error("expected request submission to succeed");
    }

    await expect(
      applications.rejectCreationRequest({
        platformAdminUserId: platformAdmin.userId,
        requestId: submitted.requestId,
        reason: "pilot roster not ready",
        now: new Date("2026-05-31T14:30:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      requestId: submitted.requestId,
      requestStatus: "rejected",
      communityId: null
    });

    await expect(
      prisma.communityCreationRequest.findUniqueOrThrow({
        where: {
          id: submitted.requestId
        },
        select: {
          status: true,
          reviewedByUserId: true,
          reviewedAt: true,
          reviewNotes: true
        }
      })
    ).resolves.toEqual({
      status: "rejected",
      reviewedByUserId: platformAdmin.userId,
      reviewedAt: new Date("2026-05-31T14:30:00.000Z"),
      reviewNotes: "pilot roster not ready"
    });
  });
});
