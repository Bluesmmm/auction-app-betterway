import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
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
  new SessionTokenService("sensitive-operation-contract-signing-key")
);
const verificationCode = "246810";
const verificationProvider = new FakeSensitiveOperationVerificationProvider();
const service = new SensitiveOperationService(
  prisma,
  sessions,
  verificationProvider,
  () => verificationCode
);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = GuardianFixture & {
  childId: string;
  pointAccountId: string;
};

async function createGuardianFixture(label: string): Promise<GuardianFixture> {
  const unique = `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${unique}`,
    now: new Date("2026-05-31T11:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected guardian login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${unique}`,
    phoneLast4: "2468",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T11:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

async function createChildFixture(label: string): Promise<ChildFixture> {
  const guardian = await createGuardianFixture(label);
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardian.userId,
    guardianId: guardian.guardianId,
    displayName: `Child ${label} ${Date.now()}`,
    gradeBand: "grade_3_4",
    initialPoints: 100,
    idempotencyKey: `child_initial_${label}_${Date.now()}`,
    now: new Date("2026-05-31T11:02:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error("expected child creation to succeed");
  }

  const pointAccount = await prisma.pointAccount.findUniqueOrThrow({
    where: {
      childId: child.childId
    }
  });

  return {
    ...guardian,
    childId: child.childId,
    pointAccountId: pointAccount.id
  };
}

async function createAuthorizedActor(label: string) {
  const actor = await createChildFixture(label);
  const deviceFingerprintHash = `device_${label}_${Date.now()}`;
  const session = await sessions.createSession({
    userId: actor.userId,
    deviceFingerprintHash,
    ipHash: `ip_${label}_${Date.now()}`,
    userAgentHash: `ua_${label}_${Date.now()}`,
    now: new Date("2026-05-31T11:03:00.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected actor session creation to succeed");
  }

  return {
    ...actor,
    sessionId: session.sessionId,
    deviceFingerprintHash
  };
}

async function createTransactionFixture(label: string) {
  const seller = await createChildFixture(`${label}_seller`);
  const buyer = await createChildFixture(`${label}_buyer`);
  const community = await prisma.auctionCommunity.create({
    data: {
      name: `Txn Community ${label} ${Date.now()}`,
      creatorGuardianId: seller.guardianId,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });
  const item = await prisma.item.create({
    data: {
      communityId: community.id,
      sellerChildId: seller.childId,
      status: "listed",
      startPoints: 20,
      minIncrementPoints: 5
    }
  });
  const auctionSession = await prisma.auctionSession.create({
    data: {
      itemId: item.id,
      status: "active",
      startAt: new Date("2026-05-31T11:04:00.000Z"),
      endAt: new Date("2026-05-31T11:34:00.000Z"),
      startPoints: 20,
      minIncrementPoints: 5,
      currentPricePoints: 50,
      highestBidderChildId: buyer.childId
    }
  });
  const pointHold = await prisma.pointHold.create({
    data: {
      accountId: buyer.pointAccountId,
      auctionSessionId: auctionSession.id,
      amountPoints: 50,
      status: "active"
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      auctionSessionId: auctionSession.id,
      buyerChildId: buyer.childId,
      sellerChildId: seller.childId,
      pointHoldId: pointHold.id,
      pointsAmount: 50,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-05-31T12:00:00.000Z")
    }
  });

  return {
    transactionId: transaction.id,
    communityId: community.id,
    sellerChildId: seller.childId,
    buyerChildId: buyer.childId
  };
}

async function createAcceptedChallenge(
  input: Parameters<SensitiveOperationService["createChallenge"]>[0]
) {
  const challenge = await service.createChallenge(input);
  if (challenge.result !== "accepted") {
    throw new Error(`expected challenge creation to succeed: ${challenge.errorCode}`);
  }

  return challenge;
}

describe("SensitiveOperationService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a challenge for create_community, export_child_data, delete_child_profile, confirm_transaction, and change_child_permissions", async () => {
    const actor = await createAuthorizedActor("required_ops_actor");
    const secondaryChild = await createChildFixture("required_ops_target");
    const transaction = await createTransactionFixture("required_ops_txn");
    const targets = [
      {
        operationType: SensitiveOperationType.createCommunity,
        targetType: "guardian_profile",
        targetId: actor.guardianId
      },
      {
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId
      },
      {
        operationType: SensitiveOperationType.deleteChildProfile,
        targetType: "child_profile",
        targetId: secondaryChild.childId
      },
      {
        operationType: SensitiveOperationType.confirmTransaction,
        targetType: "transaction",
        targetId: transaction.transactionId
      },
      {
        operationType: SensitiveOperationType.changeChildPermissions,
        targetType: "child_profile",
        targetId: actor.childId
      }
    ] as const;

    for (const target of targets) {
      await expect(
        service.authorize({
          actorUserId: actor.userId,
          operationType: target.operationType,
          targetType: target.targetType,
          targetId: target.targetId,
          sessionId: actor.sessionId,
          now: new Date("2026-05-31T11:05:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      });
    }
  });

  it("a passed challenge authorizes the matching operation and target until expiry", async () => {
    const actor = await createAuthorizedActor("passed_challenge_actor");
    const created = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: ["manual_review"],
      now: new Date("2026-05-31T11:10:00.000Z")
    });

    const passed = await service.markPassed({
      challengeId: created.challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:10:30.000Z")
    });

    expect(passed.result).toBe("accepted");
    await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: ["step_up_again"],
      now: new Date("2026-05-31T11:11:00.000Z")
    });
    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:14:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId
      })
    );
    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:16:01.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
    });
  });

  it("does not mark a challenge passed without the out-of-band verification code", async () => {
    const actor = await createAuthorizedActor("wrong_verification_code_actor");
    const created = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: ["manual_review"],
      now: new Date("2026-05-31T11:17:00.000Z")
    });

    await expect(
      service.markPassed({
        challengeId: created.challengeId,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        verificationCode: "000000",
        now: new Date("2026-05-31T11:17:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_VERIFICATION_FAILED"
    });

    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:18:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });

  it("fails closed when out-of-band verification delivery fails", async () => {
    const failingService = new SensitiveOperationService(
      prisma,
      sessions,
      new FakeSensitiveOperationVerificationProvider({ mode: "failure" }),
      () => verificationCode
    );
    const actor = await createAuthorizedActor("verification_delivery_actor");

    await expect(
      failingService.createChallenge({
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        riskLabels: ["manual_review"],
        now: new Date("2026-05-31T11:18:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_DELIVERY_FAILED"
    });

    await expect(
      prisma.sensitiveOperationChallenge.findFirst({
        where: {
          actorUserId: actor.userId,
          operation: SensitiveOperationType.exportChildData,
          targetType: "child_profile",
          targetId: actor.childId
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "failed"
    });
  });

  it("a passed challenge does not authorize a different target", async () => {
    const actor = await createAuthorizedActor("different_target_actor");
    const otherChild = await createChildFixture("different_target_other_child");
    const created = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.changeChildPermissions,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:20:00.000Z")
    });

    await service.markPassed({
      challengeId: created.challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:20:10.000Z")
    });

    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.changeChildPermissions,
        targetType: "child_profile",
        targetId: otherChild.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:21:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });

  it("a passed challenge is bound to the session that created it", async () => {
    const actor = await createAuthorizedActor("session_bound_actor");
    const otherSession = await sessions.createSession({
      userId: actor.userId,
      deviceFingerprintHash: `device_other_${Date.now()}`,
      ipHash: `ip_other_${Date.now()}`,
      userAgentHash: `ua_other_${Date.now()}`,
      now: new Date("2026-05-31T11:22:00.000Z")
    });

    if (otherSession.result !== "accepted") {
      throw new Error("expected secondary session creation to succeed");
    }

    const otherActor = await createAuthorizedActor("session_bound_other_actor");
    await expect(
      service.createChallenge({
        actorUserId: actor.userId,
        sessionId: otherActor.sessionId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        riskLabels: [],
        now: new Date("2026-05-31T11:22:05.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SESSION_REVOKED"
    });

    const created = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:22:10.000Z")
    });

    await expect(
      service.markPassed({
        challengeId: created.challengeId,
        actorUserId: actor.userId,
        sessionId: otherSession.sessionId,
        verificationCode,
        now: new Date("2026-05-31T11:22:15.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await service.markPassed({
      challengeId: created.challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:22:20.000Z")
    });

    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: otherSession.sessionId,
        now: new Date("2026-05-31T11:23:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });

  it("rejects sensitive operations from a revoked or missing trusted device even after challenge verification", async () => {
    const actor = await createAuthorizedActor("revoked_device_actor");
    const created = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: ["new_device"],
      now: new Date("2026-05-31T11:23:10.000Z")
    });

    await service.markPassed({
      challengeId: created.challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:23:20.000Z")
    });
    await prisma.trustedDevice.update({
      where: {
        userId_deviceFingerprintHash: {
          userId: actor.userId,
          deviceFingerprintHash: actor.deviceFingerprintHash
        }
      },
      data: {
        trustLevel: "revoked",
        revokedAt: new Date("2026-05-31T11:23:25.000Z")
      }
    });

    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:23:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "DEVICE_NOT_TRUSTED"
    });
  });

  it("does not let failed or cooling-down challenges become passed", async () => {
    const actor = await createAuthorizedActor("challenge_state_actor");
    const failed = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:25:00.000Z")
    });
    const coolingDown = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.deleteChildProfile,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:25:00.000Z")
    });

    await prisma.sensitiveOperationChallenge.update({
      where: { id: failed.challengeId },
      data: { status: "failed" }
    });
    await prisma.sensitiveOperationChallenge.update({
      where: { id: coolingDown.challengeId },
      data: { status: "cooling_down" }
    });

    await expect(
      service.markPassed({
        challengeId: failed.challengeId,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        verificationCode,
        now: new Date("2026-05-31T11:25:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
    await expect(
      service.markPassed({
        challengeId: coolingDown.challengeId,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        verificationCode,
        now: new Date("2026-05-31T11:25:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await expect(
      prisma.sensitiveOperationChallenge.findMany({
        where: {
          id: {
            in: [failed.challengeId, coolingDown.challengeId]
          }
        },
        select: {
          status: true
        },
        orderBy: {
          id: "asc"
        }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        { status: "failed" },
        { status: "cooling_down" }
      ])
    );
  });

  it("only hard-rejects risk restrictions matching the sensitive operation", async () => {
    const actor = await createAuthorizedActor("risk_type_actor");
    const challenge = await createAcceptedChallenge({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: actor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:27:00.000Z")
    });

    await service.markPassed({
      challengeId: challenge.challengeId,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:27:10.000Z")
    });
    await prisma.riskRestriction.create({
      data: {
        type: "no_join",
        scope: "child",
        targetId: actor.childId,
        childId: actor.childId,
        status: "active",
        reason: "contract_test",
        startsAt: new Date("2026-05-31T11:27:20.000Z")
      }
    });

    await expect(
      service.authorize({
        actorUserId: actor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: actor.childId,
        sessionId: actor.sessionId,
        now: new Date("2026-05-31T11:28:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        challengeId: challenge.challengeId
      })
    );
  });

  it("guardian dispute, risk restriction, or session revocation invalidates the authorization decision", async () => {
    const disputeActor = await createAuthorizedActor("dispute_actor");
    const disputeChallenge = await createAcceptedChallenge({
      actorUserId: disputeActor.userId,
      sessionId: disputeActor.sessionId,
      operationType: SensitiveOperationType.deleteChildProfile,
      targetType: "child_profile",
      targetId: disputeActor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:30:00.000Z")
    });
    await service.markPassed({
      challengeId: disputeChallenge.challengeId,
      actorUserId: disputeActor.userId,
      sessionId: disputeActor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:30:10.000Z")
    });
    await prisma.guardianDispute.create({
      data: {
        childId: disputeActor.childId,
        submittingGuardianId: disputeActor.guardianId,
        type: "deletion",
        status: "frozen",
        frozenAt: new Date("2026-05-31T11:31:00.000Z")
      }
    });

    await expect(
      service.authorize({
        actorUserId: disputeActor.userId,
        operationType: SensitiveOperationType.deleteChildProfile,
        targetType: "child_profile",
        targetId: disputeActor.childId,
        sessionId: disputeActor.sessionId,
        now: new Date("2026-05-31T11:31:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const restrictedActor = await createAuthorizedActor("risk_actor");
    const riskChallenge = await createAcceptedChallenge({
      actorUserId: restrictedActor.userId,
      sessionId: restrictedActor.sessionId,
      operationType: SensitiveOperationType.exportChildData,
      targetType: "child_profile",
      targetId: restrictedActor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:35:00.000Z")
    });
    await service.markPassed({
      challengeId: riskChallenge.challengeId,
      actorUserId: restrictedActor.userId,
      sessionId: restrictedActor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:35:10.000Z")
    });
    await prisma.riskRestriction.create({
      data: {
        type: "no_export",
        scope: "child",
        targetId: restrictedActor.childId,
        childId: restrictedActor.childId,
        status: "active",
        reason: "contract_test",
        startsAt: new Date("2026-05-31T11:35:20.000Z")
      }
    });

    await expect(
      service.authorize({
        actorUserId: restrictedActor.userId,
        operationType: SensitiveOperationType.exportChildData,
        targetType: "child_profile",
        targetId: restrictedActor.childId,
        sessionId: restrictedActor.sessionId,
        now: new Date("2026-05-31T11:36:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });

    const revokedActor = await createAuthorizedActor("revoked_actor");
    const revokeChallenge = await createAcceptedChallenge({
      actorUserId: revokedActor.userId,
      sessionId: revokedActor.sessionId,
      operationType: SensitiveOperationType.changeChildPermissions,
      targetType: "child_profile",
      targetId: revokedActor.childId,
      riskLabels: [],
      now: new Date("2026-05-31T11:40:00.000Z")
    });
    await service.markPassed({
      challengeId: revokeChallenge.challengeId,
      actorUserId: revokedActor.userId,
      sessionId: revokedActor.sessionId,
      verificationCode,
      now: new Date("2026-05-31T11:40:10.000Z")
    });
    await sessions.revokeSession({
      actorUserId: revokedActor.userId,
      sessionId: revokedActor.sessionId,
      reason: "contract_test",
      now: new Date("2026-05-31T11:41:00.000Z")
    });

    await expect(
      service.authorize({
        actorUserId: revokedActor.userId,
        operationType: SensitiveOperationType.changeChildPermissions,
        targetType: "child_profile",
        targetId: revokedActor.childId,
        sessionId: revokedActor.sessionId,
        now: new Date("2026-05-31T11:41:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SESSION_REVOKED"
    });
  });
});
