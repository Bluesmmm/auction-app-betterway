import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();

describe("OnboardingService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores mock WeChat login on the unified user record and reuses it", async () => {
    const service = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const openid = `mock_openid_login_${Date.now()}`;

    const first = await service.loginWithWechatCode({
      code: openid,
      now: new Date("2026-05-27T12:00:00.000Z")
    });
    const second = await service.loginWithWechatCode({
      code: openid,
      now: new Date("2026-05-27T12:05:00.000Z")
    });

    expect(first.result).toBe("accepted");
    if (first.result !== "accepted" || second.result !== "accepted") {
      throw new Error("expected both logins to succeed");
    }
    expect(first.isNewUser).toBe(true);
    expect(second.result).toBe("accepted");
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);

    const identities = await prisma.wechatIdentity.findMany({
      where: { openid },
      include: { user: true }
    });

    expect(identities).toHaveLength(1);
    expect(identities[0]?.user.id).toBe(first.userId);
    expect(identities[0]?.user.status).toBe("active");
    expect(identities[0]?.lastLoginAt?.toISOString()).toBe(
      "2026-05-27T12:05:00.000Z"
    );
  });

  it("can complete WeChat login and issue an access/refresh token session grant", async () => {
    const sessions = new SessionService(
      prisma,
      new SessionTokenService("onboarding-session-contract-signing-key")
    );
    const service = new OnboardingService(
      prisma,
      new FakeWechatAuthProvider(),
      sessions
    );
    const suffix = Date.now();
    const deviceFingerprintHash = `device_login_grant_${suffix}`;

    const grant = await service.loginWithWechatCodeAndCreateSession({
      code: `mock_openid_login_grant_${suffix}`,
      deviceFingerprintHash,
      ipHash: `ip_login_grant_${suffix}`,
      userAgentHash: `ua_login_grant_${suffix}`,
      now: new Date("2026-05-27T12:10:00.000Z")
    });

    expect(grant).toEqual(
      expect.objectContaining({
        result: "accepted",
        userId: expect.any(String),
        openid: `mock_openid_login_grant_${suffix}`,
        isNewUser: true,
        sessionId: expect.any(String),
        accessToken: expect.any(String),
        accessTokenExpiresAt: "2026-05-27T12:25:00.000Z",
        refreshToken: expect.any(String),
        refreshTokenExpiresAt: "2026-06-26T12:10:00.000Z"
      })
    );

    if (grant.result !== "accepted") {
      throw new Error("expected login grant to succeed");
    }

    await expect(
      prisma.trustedDevice.findUniqueOrThrow({
        where: {
          userId_deviceFingerprintHash: {
            userId: grant.userId,
            deviceFingerprintHash
          }
        },
        select: {
          trustLevel: true,
          lastSeenAt: true
        }
      })
    ).resolves.toEqual({
      trustLevel: "normal",
      lastSeenAt: new Date("2026-05-27T12:10:00.000Z")
    });
  });

  it("creates an active child with a primary guardian and one initial grant", async () => {
    const service = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const suffix = Date.now();
    const login = await service.loginWithWechatCode({
      code: `mock_openid_guardian_${suffix}`,
      now: new Date("2026-05-27T13:00:00.000Z")
    });

    if (login.result !== "accepted") {
      throw new Error("expected login to succeed");
    }

    const guardian = await service.ensureGuardianProfile({
      userId: login.userId,
      phoneHash: `phone_hash_${suffix}`,
      phoneLast4: "1234",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-27T13:01:00.000Z")
    });
    const child = await service.createChildWithPrimaryGuardian({
      actorUserId: login.userId,
      guardianId: guardian.guardianId,
      displayName: `Stage2 Child ${suffix}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `initial_child_points_${suffix}`,
      now: new Date("2026-05-27T13:02:00.000Z")
    });

    expect(child.result).toBe("accepted");
    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }
    expect(child.childStatus).toBe("active");
    expect(child.availablePoints).toBe(100);

    const persistedChild = await prisma.childProfile.findUniqueOrThrow({
      where: { id: child.childId },
      include: {
        guardianLinks: true,
        pointAccount: {
          include: {
            ledgerEntries: true
          }
        }
      }
    });

    expect(persistedChild.status).toBe("active");
    expect(persistedChild.initialPointsGrantedAt?.toISOString()).toBe(
      "2026-05-27T13:02:00.000Z"
    );
    expect(persistedChild.guardianLinks).toEqual([
      expect.objectContaining({
        guardianId: guardian.guardianId,
        role: "primary",
        status: "active"
      })
    ]);
    expect(persistedChild.pointAccount?.availablePoints).toBe(100);
    expect(persistedChild.pointAccount?.frozenPoints).toBe(0);
    expect(persistedChild.pointAccount?.ledgerEntries).toEqual([
      expect.objectContaining({
        type: "initial_grant",
        childId: child.childId,
        amountPoints: 100,
        availableAfter: 100,
        frozenAfter: 0,
        idempotencyKey: `initial_child_points_${suffix}`,
        reason: "initial_child_points",
        createdByUserId: login.userId
      })
    ]);
  });

  it("does not reactivate restricted guardian profiles during profile refresh", async () => {
    const service = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const suffix = Date.now();
    const login = await service.loginWithWechatCode({
      code: `mock_openid_restricted_guardian_refresh_${suffix}`,
      now: new Date("2026-05-27T13:03:00.000Z")
    });

    if (login.result !== "accepted") {
      throw new Error("expected login to succeed");
    }

    const guardian = await service.ensureGuardianProfile({
      userId: login.userId,
      phoneHash: `restricted_phone_hash_${suffix}`,
      phoneLast4: "3456",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-27T13:03:30.000Z")
    });

    await prisma.guardianProfile.update({
      where: {
        id: guardian.guardianId
      },
      data: {
        status: "restricted"
      }
    });

    const refreshed = await service.ensureGuardianProfile({
      userId: login.userId,
      phoneHash: `restricted_phone_hash_refreshed_${suffix}`,
      phoneLast4: "3456",
      consentVersion: "guardian-consent-v2",
      consentedAt: new Date("2026-05-27T13:04:00.000Z")
    });

    expect(refreshed).toEqual({
      result: "accepted",
      guardianId: guardian.guardianId,
      guardianStatus: "restricted"
    });
    await expect(
      service.createChildWithPrimaryGuardian({
        actorUserId: login.userId,
        guardianId: guardian.guardianId,
        displayName: `Restricted Guardian Child ${suffix}`,
        gradeBand: "grade_3_4",
        idempotencyKey: `restricted_guardian_child_${suffix}`,
        now: new Date("2026-05-27T13:04:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_NOT_ACTIVE"
    });
  });

  it("replays child creation retries and rejects same-key different payloads", async () => {
    const service = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const suffix = Date.now();
    const login = await service.loginWithWechatCode({
      code: `mock_openid_idempotent_child_${suffix}`,
      now: new Date("2026-05-27T13:05:00.000Z")
    });

    if (login.result !== "accepted") {
      throw new Error("expected login to succeed");
    }

    const guardian = await service.ensureGuardianProfile({
      userId: login.userId,
      phoneHash: `idempotent_phone_hash_${suffix}`,
      phoneLast4: "5678",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-27T13:05:30.000Z")
    });
    const input = {
      actorUserId: login.userId,
      guardianId: guardian.guardianId,
      displayName: `Idempotent Child ${suffix}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `idempotent_child_create_${suffix}`,
      now: new Date("2026-05-27T13:06:00.000Z")
    };

    const first = await service.createChildWithPrimaryGuardian(input);
    const replay = await service.createChildWithPrimaryGuardian({
      ...input,
      now: new Date("2026-05-27T13:06:30.000Z")
    });
    const conflict = await service.createChildWithPrimaryGuardian({
      ...input,
      displayName: `Different Child ${suffix}`,
      now: new Date("2026-05-27T13:07:00.000Z")
    });

    expect(first).toEqual({
      result: "accepted",
      childId: expect.any(String),
      childStatus: "active",
      availablePoints: 100
    });
    expect(replay).toEqual(first);
    expect(conflict).toEqual({
      result: "rejected",
      errorCode: "IDEMPOTENCY_CONFLICT"
    });
    await expect(
      prisma.childProfile.count({
        where: {
          createdByGuardianId: guardian.guardianId,
          displayName: {
            in: [`Idempotent Child ${suffix}`, `Different Child ${suffix}`]
          }
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.idempotencyRecord.findUniqueOrThrow({
        where: {
          key_actorUserId_action_targetType_targetId: {
            key: input.idempotencyKey,
            actorUserId: login.userId,
            action: "child_profile.create_with_primary_guardian",
            targetType: "guardian_profile",
            targetId: guardian.guardianId
          }
        },
        select: {
          status: true,
          responseJson: true
        }
      })
    ).resolves.toEqual({
      status: "completed",
      responseJson: first
    });
  });

  it("rejects a second active primary guardian at the database boundary", async () => {
    const service = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const suffix = Date.now();
    const firstLogin = await service.loginWithWechatCode({
      code: `mock_openid_primary_guardian_${suffix}`,
      now: new Date("2026-05-27T13:10:00.000Z")
    });
    const secondLogin = await service.loginWithWechatCode({
      code: `mock_openid_second_primary_guardian_${suffix}`,
      now: new Date("2026-05-27T13:10:00.000Z")
    });

    if (firstLogin.result !== "accepted" || secondLogin.result !== "accepted") {
      throw new Error("expected both logins to succeed");
    }

    const firstGuardian = await service.ensureGuardianProfile({
      userId: firstLogin.userId,
      phoneHash: `primary_phone_hash_${suffix}`,
      phoneLast4: "1111",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-27T13:11:00.000Z")
    });
    const secondGuardian = await service.ensureGuardianProfile({
      userId: secondLogin.userId,
      phoneHash: `second_primary_phone_hash_${suffix}`,
      phoneLast4: "2222",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-27T13:11:00.000Z")
    });
    const child = await service.createChildWithPrimaryGuardian({
      actorUserId: firstLogin.userId,
      guardianId: firstGuardian.guardianId,
      displayName: `Primary Guarded Child ${suffix}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `primary_guarded_child_initial_${suffix}`,
      now: new Date("2026-05-27T13:12:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    await expect(
      prisma.guardianChildLink.create({
        data: {
          guardianId: secondGuardian.guardianId,
          childId: child.childId,
          role: "primary",
          status: "active",
          confirmedAt: new Date("2026-05-27T13:13:00.000Z")
        }
      })
    ).rejects.toThrow();
  });
});
