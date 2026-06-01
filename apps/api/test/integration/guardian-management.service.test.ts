import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import { GuardianManagementService } from "../../src/accounts/guardian-management.service.js";
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
  new SessionTokenService("guardian-management-test-signing-key")
);
const verificationCode = "975310";
const sensitiveOperations = new SensitiveOperationService(
  prisma,
  sessions,
  new FakeSensitiveOperationVerificationProvider(),
  () => verificationCode
);
const guardians = new GuardianManagementService(prisma, sensitiveOperations);
const participation = new ChildParticipationService(prisma, sensitiveOperations);

type GuardianFixture = {
  userId: string;
  guardianId: string;
};

type ChildFixture = GuardianFixture & {
  childId: string;
  sessionId: string;
};

type AdminFixture = GuardianFixture & {
  sessionId: string;
};

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createGuardianFixture(label: string): Promise<GuardianFixture> {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-05-31T12:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected guardian login to succeed");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "1357",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-31T12:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

async function createChildFixture(label: string): Promise<ChildFixture> {
  const guardian = await createGuardianFixture(label);
  return createChildWithGuardian(guardian, label);
}

async function createChildWithGuardian(
  guardian: GuardianFixture,
  label: string
): Promise<ChildFixture> {
  const token = unique(`child_${label}`);
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: guardian.userId,
    guardianId: guardian.guardianId,
    displayName: `Child ${token}`,
    gradeBand: "grade_3_4",
    idempotencyKey: `initial_${token}`,
    now: new Date("2026-05-31T12:02:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error("expected child creation to succeed");
  }

  const session = await sessions.createSession({
    userId: guardian.userId,
    deviceFingerprintHash: `device_${token}`,
    ipHash: `ip_${token}`,
    userAgentHash: `ua_${token}`,
    now: new Date("2026-05-31T12:02:30.000Z")
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

async function createPassedChildChallenge(
  child: ChildFixture,
  operationType: SensitiveOperationType,
  sessionId = child.sessionId,
  now = new Date("2026-05-31T12:45:00.000Z")
) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: child.userId,
    sessionId,
    operationType,
    targetType: "child_profile",
    targetId: child.childId,
    riskLabels: [],
    now
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected challenge creation to succeed: ${challenge.errorCode}`);
  }

  await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: child.userId,
    sessionId,
    verificationCode,
    now: new Date(now.getTime() + 10_000)
  });

  return challenge.challengeId;
}

async function createPassedSettingsChallenge(
  child: ChildFixture,
  sessionId = child.sessionId
) {
  return createPassedChildChallenge(
    child,
    SensitiveOperationType.changeChildPermissions,
    sessionId
  );
}

async function createPassedManageGuardiansChallenge(
  child: ChildFixture,
  sessionId = child.sessionId,
  now = new Date("2026-05-31T12:45:00.000Z")
) {
  return createPassedChildChallenge(
    child,
    SensitiveOperationType.manageChildGuardians,
    sessionId,
    now
  );
}

async function createPlatformAdmin(
  label: string,
  input?: { mfaEnabled?: boolean; status?: "active" | "restricted" | "closed" }
): Promise<AdminFixture> {
  const user = await createGuardianFixture(label);
  const session = await sessions.createSession({
    userId: user.userId,
    deviceFingerprintHash: `device_admin_${unique(label)}`,
    ipHash: `ip_admin_${unique(label)}`,
    userAgentHash: `ua_admin_${unique(label)}`,
    now: new Date("2026-05-31T12:54:00.000Z")
  });

  if (session.result !== "accepted") {
    throw new Error("expected platform admin session creation to succeed");
  }

  await prisma.adminProfile.create({
    data: {
      userId: user.userId,
      role: "platform_admin",
      mfaEnabled: input?.mfaEnabled ?? true,
      status: input?.status ?? "active"
    }
  });

  return {
    ...user,
    sessionId: session.sessionId
  };
}

async function createPassedDisputeResolutionChallenge(
  admin: AdminFixture,
  disputeId: string
) {
  const challenge = await sensitiveOperations.createChallenge({
    actorUserId: admin.userId,
    sessionId: admin.sessionId,
    operationType: SensitiveOperationType.resolveGuardianDispute,
    targetType: "guardian_dispute",
    targetId: disputeId,
    riskLabels: [],
    now: new Date("2026-05-31T12:56:40.000Z")
  });

  if (challenge.result !== "accepted") {
    throw new Error(`expected dispute challenge creation to succeed: ${challenge.errorCode}`);
  }

  await sensitiveOperations.markPassed({
    challengeId: challenge.challengeId,
    actorUserId: admin.userId,
    sessionId: admin.sessionId,
    verificationCode,
    now: new Date("2026-05-31T12:56:45.000Z")
  });

  return challenge.challengeId;
}

describe("GuardianManagementService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates default server-enforced guardian controls when a child is created", async () => {
    const child = await createChildFixture("defaults");
    const settings = await prisma.childGuardianSettings.findUniqueOrThrow({
      where: {
        childId: child.childId
      }
    });

    expect(settings).toEqual(
      expect.objectContaining({
        childId: child.childId,
        canPublish: true,
        canBid: true,
        maxBidPoints: null,
        bidRequiresGuardianConfirmation: false,
        canUseCourier: false,
        canUseGuardianArrangedDelivery: true,
        canFavorite: true
      })
    );
  });

  it("lets the active primary guardian invite a secondary guardian and keeps it pending until confirmed", async () => {
    const child = await createChildFixture("secondary_pending");
    const secondaryGuardian = await createGuardianFixture("secondary_pending_guardian");
    const challengeId = await createPassedManageGuardiansChallenge(
      child,
      child.sessionId,
      new Date("2026-05-31T12:09:00.000Z")
    );

    const invited = await guardians.inviteSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondaryGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:10:00.000Z")
    });

    expect(invited).toEqual({
      result: "accepted",
      childId: child.childId,
      guardianId: secondaryGuardian.guardianId,
      role: "secondary",
      status: "pending",
      confirmedAt: null
    });

    const pendingLink = await prisma.guardianChildLink.findUniqueOrThrow({
      where: {
        guardianId_childId: {
          guardianId: secondaryGuardian.guardianId,
          childId: child.childId
        }
      }
    });
    expect(pendingLink.status).toBe("pending");
    expect(pendingLink.confirmedAt).toBeNull();

    const confirmed = await guardians.confirmSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondaryGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:11:00.000Z")
    });

    expect(confirmed).toEqual({
      result: "accepted",
      childId: child.childId,
      guardianId: secondaryGuardian.guardianId,
      role: "secondary",
      status: "active",
      confirmedAt: "2026-05-31T12:11:00.000Z"
    });
  });

  it("requires a sensitive challenge for secondary guardian management", async () => {
    const child = await createChildFixture("secondary_sensitive_required");
    const secondaryGuardian = await createGuardianFixture(
      "secondary_sensitive_required_guardian"
    );
    const challengeId = await createPassedManageGuardiansChallenge(
      child,
      child.sessionId,
      new Date("2026-05-31T12:14:00.000Z")
    );

    await expect(
      guardians.inviteSecondaryGuardian({
        actorUserId: child.userId,
        childId: child.childId,
        secondaryGuardianId: secondaryGuardian.guardianId,
        now: new Date("2026-05-31T12:15:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await guardians.inviteSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondaryGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:15:30.000Z")
    });

    await expect(
      guardians.confirmSecondaryGuardian({
        actorUserId: child.userId,
        childId: child.childId,
        secondaryGuardianId: secondaryGuardian.guardianId,
        now: new Date("2026-05-31T12:16:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });
  });

  it("rejects a third active guardian for the same child", async () => {
    const child = await createChildFixture("guardian_limit_child");
    const secondGuardian = await createGuardianFixture("guardian_limit_second");
    const thirdGuardian = await createGuardianFixture("guardian_limit_third");
    const challengeId = await createPassedManageGuardiansChallenge(
      child,
      child.sessionId,
      new Date("2026-05-31T12:19:00.000Z")
    );

    await guardians.inviteSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:20:00.000Z")
    });
    await guardians.confirmSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:21:00.000Z")
    });

    await expect(
      guardians.inviteSecondaryGuardian({
        actorUserId: child.userId,
        childId: child.childId,
        secondaryGuardianId: thirdGuardian.guardianId,
        challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T12:22:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "CHILD_ACTIVE_GUARDIAN_LIMIT_EXCEEDED"
    });
  });

  it("rejects linking a guardian to a fourth active child with GUARDIAN_CHILD_LIMIT_EXCEEDED", async () => {
    const cappedGuardian = await createGuardianFixture("capped_guardian");
    await createChildWithGuardian(cappedGuardian, "capped_1");
    await createChildWithGuardian(cappedGuardian, "capped_2");
    await createChildWithGuardian(cappedGuardian, "capped_3");

    const anotherChild = await createChildFixture("fourth_child_target");
    const challengeId = await createPassedManageGuardiansChallenge(
      anotherChild,
      anotherChild.sessionId,
      new Date("2026-05-31T12:29:00.000Z")
    );

    await expect(
      guardians.inviteSecondaryGuardian({
        actorUserId: anotherChild.userId,
        childId: anotherChild.childId,
        secondaryGuardianId: cappedGuardian.guardianId,
        challengeId,
        sessionId: anotherChild.sessionId,
        now: new Date("2026-05-31T12:30:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
    });
  });

  it("rejects creating a fourth active primary child for the same guardian", async () => {
    const cappedGuardian = await createGuardianFixture("primary_capped_guardian");
    await createChildWithGuardian(cappedGuardian, "primary_capped_1");
    await createChildWithGuardian(cappedGuardian, "primary_capped_2");
    await createChildWithGuardian(cappedGuardian, "primary_capped_3");

    await expect(
      onboarding.createChildWithPrimaryGuardian({
        actorUserId: cappedGuardian.userId,
        guardianId: cappedGuardian.guardianId,
        displayName: `Child ${unique("primary_capped_4")}`,
        gradeBand: "grade_3_4",
        idempotencyKey: `initial_${unique("primary_capped_4")}`,
        now: new Date("2026-05-31T12:31:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_CHILD_LIMIT_EXCEEDED"
    });
  });

  it("does not treat an existing primary link as a secondary invite", async () => {
    const child = await createChildFixture("primary_not_secondary");
    const challengeId = await createPassedManageGuardiansChallenge(
      child,
      child.sessionId,
      new Date("2026-05-31T12:34:00.000Z")
    );

    await expect(
      guardians.inviteSecondaryGuardian({
        actorUserId: child.userId,
        childId: child.childId,
        secondaryGuardianId: child.guardianId,
        challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T12:35:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SECONDARY_GUARDIAN_INVITE_NOT_PENDING"
    });

    await expect(
      guardians.confirmSecondaryGuardian({
        actorUserId: child.userId,
        childId: child.childId,
        secondaryGuardianId: child.guardianId,
        challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T12:35:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SECONDARY_GUARDIAN_INVITE_NOT_PENDING"
    });
  });

  it("blocks a non-primary guardian from confirming a secondary guardian", async () => {
    const child = await createChildFixture("confirm_secondary");
    const secondaryGuardian = await createGuardianFixture("confirm_secondary_pending");
    const challengeId = await createPassedManageGuardiansChallenge(
      child,
      child.sessionId,
      new Date("2026-05-31T12:39:00.000Z")
    );

    await guardians.inviteSecondaryGuardian({
      actorUserId: child.userId,
      childId: child.childId,
      secondaryGuardianId: secondaryGuardian.guardianId,
      challengeId,
      sessionId: child.sessionId,
      now: new Date("2026-05-31T12:40:00.000Z")
    });

    await expect(
      guardians.confirmSecondaryGuardian({
        actorUserId: secondaryGuardian.userId,
        childId: child.childId,
        secondaryGuardianId: secondaryGuardian.guardianId,
        now: new Date("2026-05-31T12:41:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
    });
  });

  it("requires a current-session sensitive challenge to update guardian controls", async () => {
    const child = await createChildFixture("settings_challenge");
    const otherSession = await sessions.createSession({
      userId: child.userId,
      deviceFingerprintHash: `device_other_${unique("settings")}`,
      ipHash: `ip_other_${unique("settings")}`,
      userAgentHash: `ua_other_${unique("settings")}`,
      now: new Date("2026-05-31T12:44:00.000Z")
    });

    if (otherSession.result !== "accepted") {
      throw new Error("expected secondary session creation to succeed");
    }

    const challengeId = await createPassedSettingsChallenge(child);

    await expect(
      guardians.updateChildGuardianSettings({
        actorUserId: child.userId,
        childId: child.childId,
        patch: {
          canPublish: false
        },
        challengeId,
        sessionId: otherSession.sessionId,
        now: new Date("2026-05-31T12:46:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await expect(
      guardians.updateChildGuardianSettings({
        actorUserId: child.userId,
        childId: child.childId,
        patch: {
          canPublish: false
        },
        challengeId,
        sessionId: child.sessionId,
        now: new Date("2026-05-31T12:46:30.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        childId: child.childId,
        challengeId,
        settings: expect.objectContaining({
          canPublish: false
        })
      })
    );
  });

  it("creates a guardian dispute that freezes the child", async () => {
    const child = await createChildFixture("freeze_child");
    const opened = await guardians.openGuardianDispute({
      actorUserId: child.userId,
      childId: child.childId,
      disputeType: "guardian_change",
      reason: "contract_test_freeze",
      now: new Date("2026-05-31T12:50:00.000Z")
    });

    expect(opened).toEqual({
      result: "accepted",
      disputeId: expect.any(String),
      childId: child.childId,
      status: "frozen",
      frozenAt: "2026-05-31T12:50:00.000Z",
      resolvedAt: null,
      resolutionSummary: null
    });

    const frozenDecision = await participation.evaluateChildParticipation({
      actorUserId: child.userId,
      childId: child.childId,
      action: "publish",
      now: new Date("2026-05-31T12:51:00.000Z")
    });

    expect(frozenDecision).toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });
  });

  it("blocks guardian settings and guardian-link writes while a dispute is open", async () => {
    const settingsChild = await createChildFixture("freeze_settings_child");
    const settingsChallengeId = await createPassedChildChallenge(
      settingsChild,
      SensitiveOperationType.changeChildPermissions,
      settingsChild.sessionId,
      new Date("2026-05-31T12:50:30.000Z")
    );
    await guardians.openGuardianDispute({
      actorUserId: settingsChild.userId,
      childId: settingsChild.childId,
      disputeType: "consent",
      reason: "freeze settings",
      now: new Date("2026-05-31T12:51:30.000Z")
    });

    await expect(
      guardians.updateChildGuardianSettings({
        actorUserId: settingsChild.userId,
        childId: settingsChild.childId,
        patch: {
          canPublish: false
        },
        challengeId: settingsChallengeId,
        sessionId: settingsChild.sessionId,
        now: new Date("2026-05-31T12:52:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const inviteChild = await createChildFixture("freeze_invite_child");
    const invitedGuardian = await createGuardianFixture("freeze_invite_guardian");
    const inviteChallengeId = await createPassedManageGuardiansChallenge(
      inviteChild,
      inviteChild.sessionId,
      new Date("2026-05-31T12:51:30.000Z")
    );
    await guardians.openGuardianDispute({
      actorUserId: inviteChild.userId,
      childId: inviteChild.childId,
      disputeType: "guardian_change",
      reason: "freeze invite",
      now: new Date("2026-05-31T12:52:30.000Z")
    });

    await expect(
      guardians.inviteSecondaryGuardian({
        actorUserId: inviteChild.userId,
        childId: inviteChild.childId,
        secondaryGuardianId: invitedGuardian.guardianId,
        challengeId: inviteChallengeId,
        sessionId: inviteChild.sessionId,
        now: new Date("2026-05-31T12:53:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });

    const confirmChild = await createChildFixture("freeze_confirm_child");
    const confirmedGuardian = await createGuardianFixture("freeze_confirm_guardian");
    const confirmChallengeId = await createPassedManageGuardiansChallenge(
      confirmChild,
      confirmChild.sessionId,
      new Date("2026-05-31T12:52:30.000Z")
    );
    await guardians.inviteSecondaryGuardian({
      actorUserId: confirmChild.userId,
      childId: confirmChild.childId,
      secondaryGuardianId: confirmedGuardian.guardianId,
      challengeId: confirmChallengeId,
      sessionId: confirmChild.sessionId,
      now: new Date("2026-05-31T12:53:30.000Z")
    });
    await guardians.openGuardianDispute({
      actorUserId: confirmChild.userId,
      childId: confirmChild.childId,
      disputeType: "guardian_change",
      reason: "freeze confirm",
      now: new Date("2026-05-31T12:54:00.000Z")
    });

    await expect(
      guardians.confirmSecondaryGuardian({
        actorUserId: confirmChild.userId,
        childId: confirmChild.childId,
        secondaryGuardianId: confirmedGuardian.guardianId,
        challengeId: confirmChallengeId,
        sessionId: confirmChild.sessionId,
        now: new Date("2026-05-31T12:54:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });
  });

  it("serializes duplicate guardian dispute open attempts for the same child", async () => {
    const child = await createChildFixture("duplicate_dispute");
    const [first, second] = await Promise.all([
      guardians.openGuardianDispute({
        actorUserId: child.userId,
        childId: child.childId,
        disputeType: "guardian_change",
        reason: "contract_test_duplicate_1",
        now: new Date("2026-05-31T12:52:00.000Z")
      }),
      guardians.openGuardianDispute({
        actorUserId: child.userId,
        childId: child.childId,
        disputeType: "guardian_change",
        reason: "contract_test_duplicate_2",
        now: new Date("2026-05-31T12:52:00.000Z")
      })
    ]);

    expect(first.result).toBe("accepted");
    expect(second.result).toBe("accepted");
    if (first.result !== "accepted" || second.result !== "accepted") {
      throw new Error("expected both duplicate dispute opens to return accepted");
    }
    expect(first.disputeId).toBe(second.disputeId);
    await expect(
      prisma.guardianDispute.count({
        where: {
          childId: child.childId,
          status: {
            in: ["pending_platform_review", "frozen"]
          }
        }
      })
    ).resolves.toBe(1);
  });

  it("requires an active MFA platform admin to resolve a guardian dispute", async () => {
    const child = await createChildFixture("resolve_dispute");
    const opened = await guardians.openGuardianDispute({
      actorUserId: child.userId,
      childId: child.childId,
      disputeType: "guardian_change",
      reason: "contract_test_resolve",
      now: new Date("2026-05-31T12:55:00.000Z")
    });

    if (opened.result !== "accepted") {
      throw new Error("expected dispute to open");
    }

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: child.userId,
        sessionId: child.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "not an admin"
        },
        now: new Date("2026-05-31T12:56:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    const noMfaAdmin = await createPlatformAdmin("resolve_dispute_no_mfa", {
      mfaEnabled: false
    });

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: noMfaAdmin.userId,
        sessionId: noMfaAdmin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "no mfa"
        },
        now: new Date("2026-05-31T12:56:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    const inactiveAdmin = await createPlatformAdmin("resolve_dispute_inactive", {
      status: "restricted"
    });

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: inactiveAdmin.userId,
        sessionId: inactiveAdmin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "inactive admin"
        },
        now: new Date("2026-05-31T12:56:35.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    const admin = await createPlatformAdmin("resolve_dispute_admin");

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: admin.userId,
        sessionId: admin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "missing challenge"
        },
        now: new Date("2026-05-31T12:56:50.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await createPassedDisputeResolutionChallenge(admin, opened.disputeId);

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: admin.userId,
        sessionId: admin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "reviewed by platform admin"
        },
        now: new Date("2026-05-31T12:57:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        disputeId: opened.disputeId,
        childId: child.childId,
        status: "resolved",
        resolvedAt: "2026-05-31T12:57:00.000Z",
        resolutionSummary: "reviewed by platform admin"
      })
    );

    const noChallengeAdmin = await createPlatformAdmin(
      "resolve_dispute_no_challenge_after_resolved"
    );

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: noChallengeAdmin.userId,
        sessionId: noChallengeAdmin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "rejected",
          summary: "status probe"
        },
        now: new Date("2026-05-31T12:57:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
    });

    await createPassedDisputeResolutionChallenge(admin, opened.disputeId);

    await expect(
      guardians.resolveGuardianDispute({
        platformAdminUserId: admin.userId,
        sessionId: admin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "rejected",
          summary: "late overwrite"
        },
        now: new Date("2026-05-31T12:58:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "DISPUTE_ALREADY_RESOLVED"
    });
  });

  it("prevents concurrent guardian dispute resolutions from overwriting each other", async () => {
    const child = await createChildFixture("concurrent_resolve");
    const opened = await guardians.openGuardianDispute({
      actorUserId: child.userId,
      childId: child.childId,
      disputeType: "guardian_change",
      reason: "contract_test_concurrent_resolve",
      now: new Date("2026-05-31T12:59:00.000Z")
    });

    if (opened.result !== "accepted") {
      throw new Error("expected dispute to open");
    }

    const firstAdmin = await createPlatformAdmin("concurrent_resolve_first");
    const secondAdmin = await createPlatformAdmin("concurrent_resolve_second");
    await createPassedDisputeResolutionChallenge(firstAdmin, opened.disputeId);
    await createPassedDisputeResolutionChallenge(secondAdmin, opened.disputeId);

    const results = await Promise.all([
      guardians.resolveGuardianDispute({
        platformAdminUserId: firstAdmin.userId,
        sessionId: firstAdmin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "resolved",
          summary: "first decision"
        },
        now: new Date("2026-05-31T12:59:30.000Z")
      }),
      guardians.resolveGuardianDispute({
        platformAdminUserId: secondAdmin.userId,
        sessionId: secondAdmin.sessionId,
        disputeId: opened.disputeId,
        resolution: {
          status: "rejected",
          summary: "second decision"
        },
        now: new Date("2026-05-31T12:59:31.000Z")
      })
    ]);

    const accepted = results.filter((result) => result.result === "accepted");
    const rejected = results.filter((result) => result.result === "rejected");
    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([
      {
        result: "rejected",
        errorCode: "DISPUTE_ALREADY_RESOLVED"
      }
    ]);

    const finalDispute = await prisma.guardianDispute.findUniqueOrThrow({
      where: {
        id: opened.disputeId
      }
    });
    expect(finalDispute.status).toBe(accepted[0].status);
    expect(finalDispute.resolutionSummary).toBe(accepted[0].resolutionSummary);
  });
});
