import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();

async function createGuardian(service: OnboardingService, label: string) {
  const login = await service.loginWithWechatCode({
    code: `mock_openid_${label}_${Date.now()}_${Math.random()}`,
    now: new Date("2026-05-27T14:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login to succeed");
  }

  const guardian = await service.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${label}_${Date.now()}`,
    phoneLast4: "5678",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-05-27T14:01:00.000Z")
  });

  return {
    userId: login.userId,
    guardianId: guardian.guardianId
  };
}

describe("CommunityAccessService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps invite validation, guardian confirmation, and admin approval separate", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "community_admin");
    const childGuardian = await createGuardian(onboarding, "child_guardian");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Community Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      initialPoints: 100,
      idempotencyKey: `community_child_initial_${Date.now()}`,
      now: new Date("2026-05-27T14:02:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Stage2 Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `JOIN${Date.now()}`,
      maxUses: 1
    });

    expect(invite.result).toBe("accepted");
    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const requested = await access.requestJoinWithInvite({
      childId: child.childId,
      code: invite.code,
      now: new Date("2026-05-27T14:03:00.000Z")
    });

    expect(requested).toEqual(
      expect.objectContaining({
        result: "accepted",
        communityId: community.id,
        memberStatus: "pending_guardian"
      })
    );

    const confirmed = await access.confirmJoinByPrimaryGuardian({
      actorUserId: childGuardian.userId,
      communityId: community.id,
      childId: child.childId,
      now: new Date("2026-05-27T14:04:00.000Z")
    });

    expect(confirmed).toEqual(
      expect.objectContaining({
        result: "accepted",
        memberStatus: "pending_admin"
      })
    );

    const approved = await access.approveCommunityMember({
      actorUserId: admin.userId,
      communityId: community.id,
      childId: child.childId,
      now: new Date("2026-05-27T14:05:00.000Z")
    });

    expect(approved).toEqual(
      expect.objectContaining({
        result: "accepted",
        memberStatus: "active"
      })
    );

    const persisted = await prisma.communityMember.findUniqueOrThrow({
      where: {
        communityId_childId: {
          communityId: community.id,
          childId: child.childId
        }
      }
    });
    const usedInvite = await prisma.communityInviteCode.findUniqueOrThrow({
      where: {
        code: invite.code
      }
    });

    expect(persisted.status).toBe("active");
    expect(persisted.joinedAt?.toISOString()).toBe("2026-05-27T14:05:00.000Z");
    expect(usedInvite.usedCount).toBe(1);
  });

  it("allows only one child to consume the final invite slot under concurrency", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "final_slot_admin");
    const firstGuardian = await createGuardian(onboarding, "final_slot_first");
    const secondGuardian = await createGuardian(onboarding, "final_slot_second");
    const firstChild = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: firstGuardian.userId,
      guardianId: firstGuardian.guardianId,
      displayName: `Final Slot First ${Date.now()}`,
      gradeBand: "grade_3_4",
      initialPoints: 100,
      idempotencyKey: `final_slot_first_initial_${Date.now()}`,
      now: new Date("2026-05-27T15:00:00.000Z")
    });
    const secondChild = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: secondGuardian.userId,
      guardianId: secondGuardian.guardianId,
      displayName: `Final Slot Second ${Date.now()}`,
      gradeBand: "grade_3_4",
      initialPoints: 100,
      idempotencyKey: `final_slot_second_initial_${Date.now()}`,
      now: new Date("2026-05-27T15:00:00.000Z")
    });

    if (firstChild.result !== "accepted" || secondChild.result !== "accepted") {
      throw new Error("expected both children to be created");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Final Slot Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `LAST${Date.now()}`,
      maxUses: 1
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const results = await Promise.all([
      access.requestJoinWithInvite({
        childId: firstChild.childId,
        code: invite.code,
        now: new Date("2026-05-27T15:01:00.000Z")
      }),
      access.requestJoinWithInvite({
        childId: secondChild.childId,
        code: invite.code,
        now: new Date("2026-05-27T15:01:00.000Z")
      })
    ]);

    expect(results.filter((result) => result.result === "accepted")).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.result === "rejected" &&
          result.errorCode === "INVITE_CODE_UNAVAILABLE"
      )
    ).toHaveLength(1);

    const usedInvite = await prisma.communityInviteCode.findUniqueOrThrow({
      where: {
        code: invite.code
      }
    });
    const members = await prisma.communityMember.findMany({
      where: {
        communityId: community.id
      }
    });

    expect(usedInvite.usedCount).toBe(1);
    expect(members).toHaveLength(1);
  });
});
