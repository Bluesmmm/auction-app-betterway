import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";

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
      initialPoints: 100,
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
});
