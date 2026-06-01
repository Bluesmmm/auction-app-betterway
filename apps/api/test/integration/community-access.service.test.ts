import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { RiskGovernanceService } from "../../src/accounts/risk-governance.service.js";
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

async function createPlatformAdmin(service: OnboardingService, label: string) {
  const login = await service.loginWithWechatCode({
    code: `mock_openid_${label}_${Date.now()}_${Math.random()}`,
    now: new Date("2026-05-27T14:00:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login to succeed");
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
    userId: login.userId
  };
}

async function grantCommunityAdminScope(
  actorUserId: string,
  communityId: string,
  mfaEnabled = true
) {
  return prisma.adminProfile.create({
    data: {
      userId: actorUserId,
      role: "activity_admin",
      mfaEnabled,
      status: "active",
      communityScopes: {
        create: {
          communityId,
          status: "active"
        }
      }
    }
  });
}

async function createActiveRuleVersion(communityId: string, versionNo = 1) {
  return prisma.communityRuleVersion.create({
    data: {
      communityId,
      versionNo,
      status: "active",
      rulesJson: {
        versionNo,
        source: "test"
      },
      effectiveAt: new Date("2026-05-27T13:59:00.000Z")
    }
  });
}

describe("CommunityAccessService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects invite creation until the community has an active MFA-enabled activity admin and active rule", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "invite_open_admin");
    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Invite Open Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });

    await expect(
      access.createInviteCode({
        actorUserId: admin.userId,
        communityId: community.id,
        code: `NOTOPEN${Date.now()}`,
        maxUses: 1
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });

    await grantCommunityAdminScope(admin.userId, community.id);

    await expect(
      access.createInviteCode({
        actorUserId: admin.userId,
        communityId: community.id,
        code: `NORULE${Date.now()}`,
        maxUses: 1
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ACTIVE_RULE_VERSION_REQUIRED"
    });
  });

  it("lets activity admins list only their scoped community member review queue", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const activityAdmin = await createGuardian(onboarding, "scoped_queue_admin");
    const childGuardian = await createGuardian(onboarding, "scoped_queue_child");
    const otherChildGuardian = await createGuardian(
      onboarding,
      "scoped_queue_other_child"
    );
    const pendingGuardian = await createGuardian(
      onboarding,
      "scoped_queue_pending_guardian"
    );
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Scoped Queue Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `scoped_queue_child_${Date.now()}`,
      now: new Date("2026-05-27T14:01:30.000Z")
    });
    const otherChild = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: otherChildGuardian.userId,
      guardianId: otherChildGuardian.guardianId,
      displayName: `Other Queue Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `scoped_queue_other_child_${Date.now()}`,
      now: new Date("2026-05-27T14:01:40.000Z")
    });
    const pendingGuardianChild = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: pendingGuardian.userId,
      guardianId: pendingGuardian.guardianId,
      displayName: `Pending Guardian Queue Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `scoped_queue_pending_guardian_child_${Date.now()}`,
      now: new Date("2026-05-27T14:01:50.000Z")
    });

    if (
      child.result !== "accepted" ||
      otherChild.result !== "accepted" ||
      pendingGuardianChild.result !== "accepted"
    ) {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Scoped Queue Community ${Date.now()}`,
        creatorGuardianId: activityAdmin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    const otherCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `Other Scoped Queue Community ${Date.now()}`,
        creatorGuardianId: activityAdmin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(activityAdmin.userId, community.id);

    const member = await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: child.childId,
        status: "pending_admin",
        rosterVerificationStatus: "matched",
        guardianConfirmedAt: new Date("2026-05-27T14:02:00.000Z")
      }
    });
    await prisma.communityMember.create({
      data: {
        communityId: otherCommunity.id,
        childId: otherChild.childId,
        status: "pending_admin",
        rosterVerificationStatus: "matched",
        guardianConfirmedAt: new Date("2026-05-27T14:02:10.000Z")
      }
    });
    await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: pendingGuardianChild.childId,
        status: "pending_guardian",
        rosterVerificationStatus: "matched"
      }
    });

    await expect(
      access.listScopedMemberReviewQueue({
        actorUserId: childGuardian.userId,
        communityId: community.id,
        now: new Date("2026-05-27T14:03:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_ADMIN_REQUIRED"
    });

    await expect(
      access.listScopedMemberReviewQueue({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        now: new Date("2026-05-27T14:03:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      members: [
        {
          key: member.id,
          communityId: community.id,
          childId: child.childId,
          guardianId: childGuardian.guardianId,
          memberStatus: "pending_admin",
          rosterVerificationStatus: "matched",
          riskState: "clear",
          requestedAt: "2026-05-27T14:02:00.000Z"
        }
      ]
    });

    await prisma.riskRestriction.create({
      data: {
        type: "no_join",
        scope: "guardian",
        targetId: childGuardian.guardianId,
        guardianId: childGuardian.guardianId,
        status: "active",
        reason: "queue_risk_state_guardian_scope",
        startsAt: new Date("2026-05-27T14:03:30.000Z")
      }
    });

    await expect(
      access.listScopedMemberReviewQueue({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        now: new Date("2026-05-27T14:04:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      members: [
        {
          key: member.id,
          communityId: community.id,
          childId: child.childId,
          guardianId: childGuardian.guardianId,
          memberStatus: "pending_admin",
          rosterVerificationStatus: "matched",
          riskState: "restricted",
          requestedAt: "2026-05-27T14:02:00.000Z"
        }
      ]
    });
  });

  it("turns rejected roster verification into a terminal member state", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const activityAdmin = await createGuardian(onboarding, "roster_reject_admin");
    const childGuardian = await createGuardian(onboarding, "roster_reject_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Roster Reject Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `roster_reject_child_${Date.now()}`,
      now: new Date("2026-05-27T14:04:30.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Roster Reject Community ${Date.now()}`,
        creatorGuardianId: activityAdmin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(activityAdmin.userId, community.id);
    const member = await prisma.communityMember.create({
      data: {
        communityId: community.id,
        childId: child.childId,
        status: "pending_admin",
        rosterVerificationStatus: "pending",
        guardianConfirmedAt: new Date("2026-05-27T14:05:00.000Z")
      }
    });

    await expect(
      access.recordRosterVerification({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        childId: child.childId,
        status: "rejected",
        evidenceJson: {
          rosterId: "not-in-pilot-roster"
        },
        now: new Date("2026-05-27T14:05:30.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: community.id,
      childId: child.childId,
      memberStatus: "removed"
    });

    await expect(
      access.listScopedMemberReviewQueue({
        actorUserId: activityAdmin.userId,
        communityId: community.id,
        now: new Date("2026-05-27T14:06:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      members: []
    });
    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          id: member.id
        },
        select: {
          status: true,
          rosterVerificationStatus: true
        }
      })
    ).resolves.toEqual({
      status: "removed",
      rosterVerificationStatus: "rejected"
    });
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
    await grantCommunityAdminScope(admin.userId, community.id);
    const activeRule = await createActiveRuleVersion(community.id);
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
    const inviteAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "community_invite_code.create",
        targetId: invite.inviteCodeId
      },
      select: {
        actorUserId: true,
        afterJson: true
      }
    });
    expect(inviteAudit).toEqual({
      actorUserId: admin.userId,
      afterJson: expect.objectContaining({
        communityId: community.id,
        ruleVersionId: activeRule.id,
        codeHash: expect.any(String),
        maxUses: 1,
        expiresAt: null,
        status: "active"
      })
    });
    expect(inviteAudit.afterJson).not.toEqual(
      expect.objectContaining({
        code: invite.code
      })
    );

    const requested = await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `join_request_${child.childId}`,
      now: new Date("2026-05-27T14:03:00.000Z")
    });

    expect(requested).toEqual(
      expect.objectContaining({
        result: "accepted",
        communityId: community.id,
        memberStatus: "pending_guardian"
      })
    );
    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: community.id,
            childId: child.childId
          }
        },
        select: {
          inviteCodeId: true,
          ruleVersionId: true
        }
      })
    ).resolves.toEqual({
      inviteCodeId: invite.inviteCodeId,
      ruleVersionId: activeRule.id
    });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "community_member.request_with_invite",
          targetId: (
            await prisma.communityMember.findUniqueOrThrow({
              where: {
                communityId_childId: {
                  communityId: community.id,
                  childId: child.childId
                }
              },
              select: {
                id: true
              }
            })
          ).id
        },
        select: {
          actorUserId: true,
          afterJson: true
        }
      })
    ).resolves.toEqual({
      actorUserId: childGuardian.userId,
      afterJson: expect.objectContaining({
        childId: child.childId,
        communityId: community.id,
        idempotencyKey: `join_request_${child.childId}`,
        requestHash: expect.any(String),
        requestedAt: "2026-05-27T14:03:00.000Z"
      })
    });

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
    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: community.id,
            childId: child.childId
          }
        },
        select: {
          guardianConfirmedAt: true
        }
      })
    ).resolves.toEqual({
      guardianConfirmedAt: new Date("2026-05-27T14:04:00.000Z")
    });

    await expect(
      access.approveCommunityMember({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        now: new Date("2026-05-27T14:04:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ROSTER_VERIFICATION_REQUIRED"
    });

    await expect(
      access.recordRosterVerification({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        status: "not_matched",
        evidenceJson: {
          rosterId: "class-3a"
        },
        now: new Date("2026-05-27T14:04:45.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        memberStatus: "pending_admin"
      })
    );
    await expect(
      access.approveCommunityMember({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        now: new Date("2026-05-27T14:04:50.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "ROSTER_VERIFICATION_REQUIRED"
    });

    await access.recordRosterVerification({
      actorUserId: admin.userId,
      communityId: community.id,
      childId: child.childId,
      status: "matched",
      evidenceJson: {
        rosterId: "class-3a",
        matched: true
      },
      now: new Date("2026-05-27T14:04:55.000Z")
    });

    const memberForRosterAudit = await prisma.communityMember.findUniqueOrThrow({
      where: {
        communityId_childId: {
          communityId: community.id,
          childId: child.childId
        }
      },
      select: {
        id: true
      }
    });
    const rosterAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "community_member.record_roster_verification",
        targetId: memberForRosterAudit.id
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        afterJson: true
      }
    });
    expect(rosterAudit.afterJson).toEqual(
      expect.objectContaining({
        rosterVerificationStatus: "matched",
        evidenceAudit: {
          recorded: true,
          kind: "object",
          sha256: expect.any(String)
        }
      })
    );
    expect(JSON.stringify(rosterAudit.afterJson)).not.toContain("class-3a");

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
    expect(persisted.adminReviewedByUserId).toBe(admin.userId);
    expect(persisted.adminReviewedAt?.toISOString()).toBe(
      "2026-05-27T14:05:00.000Z"
    );
    expect(persisted.rosterVerificationStatus).toBe("matched");
    expect(usedInvite.usedCount).toBe(1);
    expect(usedInvite.ruleVersionId).toBe(activeRule.id);
  });

  it("blocks community admission while a guardian dispute freezes the child", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "frozen_join_admin");
    const childGuardian = await createGuardian(onboarding, "frozen_join_guardian");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Frozen Join Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `frozen_join_child_${Date.now()}`,
      now: new Date("2026-05-27T14:02:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Frozen Join Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `FREEZE${Date.now()}`,
      maxUses: 1
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    await prisma.guardianDispute.create({
      data: {
        childId: child.childId,
        submittingGuardianId: childGuardian.guardianId,
        type: "consent",
        status: "frozen",
        frozenAt: new Date("2026-05-27T14:02:30.000Z")
      }
    });

    await expect(
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `frozen_join_request_${child.childId}`,
        now: new Date("2026-05-27T14:03:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GUARDIAN_DISPUTE_FROZEN"
    });
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
      idempotencyKey: `final_slot_first_initial_${Date.now()}`,
      now: new Date("2026-05-27T15:00:00.000Z")
    });
    const secondChild = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: secondGuardian.userId,
      guardianId: secondGuardian.guardianId,
      displayName: `Final Slot Second ${Date.now()}`,
      gradeBand: "grade_3_4",
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
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
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
        actorUserId: firstGuardian.userId,
        childId: firstChild.childId,
        code: invite.code,
        idempotencyKey: `final_slot_first_${firstChild.childId}`,
        now: new Date("2026-05-27T15:01:00.000Z")
      }),
      access.requestJoinWithInvite({
        actorUserId: secondGuardian.userId,
        childId: secondChild.childId,
        code: invite.code,
        idempotencyKey: `final_slot_second_${secondChild.childId}`,
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

  it("does not consume another invite slot when the same child repeats a join request", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "repeat_admin");
    const childGuardian = await createGuardian(onboarding, "repeat_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Repeat Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `repeat_child_initial_${Date.now()}`,
      now: new Date("2026-05-27T16:00:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Repeat Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `REPEAT${Date.now()}`,
      maxUses: 1
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const first = await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `repeat_join_${child.childId}`,
      now: new Date("2026-05-27T16:01:00.000Z")
    });
    const second = await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `repeat_join_${child.childId}`,
      now: new Date("2026-05-27T16:02:00.000Z")
    });

    expect(first.result).toBe("accepted");
    expect(second).toEqual(
      expect.objectContaining({
        result: "accepted",
        memberStatus: "pending_guardian"
      })
    );

    const usedInvite = await prisma.communityInviteCode.findUniqueOrThrow({
      where: {
        code: invite.code
      }
    });
    const idempotencyRecord = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        key_actorUserId_action_targetType_targetId: {
          key: `repeat_join_${child.childId}`,
          actorUserId: childGuardian.userId,
          action: "community_member.request_with_invite",
          targetType: "child_profile",
          targetId: child.childId
        }
      }
    });

    expect(usedInvite.usedCount).toBe(1);
    expect(idempotencyRecord.status).toBe("completed");
    expect(idempotencyRecord.responseJson).toEqual(
      expect.objectContaining({
        result: "accepted",
        communityId: community.id,
        childId: child.childId,
        memberStatus: "pending_guardian"
      })
    );
  });

  it("rejects removed or banned members instead of accepting a fresh invite retry", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "removed_retry_admin");
    const childGuardian = await createGuardian(onboarding, "removed_retry_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Removed Retry Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `removed_retry_child_initial_${Date.now()}`,
      now: new Date("2026-05-27T16:05:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Removed Retry Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `REMOVEDRETRY${Date.now()}`,
      maxUses: 2
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const first = await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `removed_retry_join_${child.childId}`,
      now: new Date("2026-05-27T16:06:00.000Z")
    });
    expect(first.result).toBe("accepted");

    await prisma.communityMember.update({
      where: {
        communityId_childId: {
          communityId: community.id,
          childId: child.childId
        }
      },
      data: {
        status: "removed"
      }
    });

    await expect(
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `removed_retry_again_${child.childId}`,
        now: new Date("2026-05-27T16:07:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
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
      usedCount: 1
    });

    await prisma.communityMember.update({
      where: {
        communityId_childId: {
          communityId: community.id,
          childId: child.childId
        }
      },
      data: {
        status: "banned"
      }
    });

    await expect(
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `banned_retry_again_${child.childId}`,
        now: new Date("2026-05-27T16:08:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
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
      usedCount: 1
    });
  });

  it("does not consume another invite slot when the same child repeats a join request concurrently", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "repeat_concurrent_admin");
    const childGuardian = await createGuardian(onboarding, "repeat_concurrent_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Repeat Concurrent Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `repeat_concurrent_child_initial_${Date.now()}`,
      now: new Date("2026-05-27T16:10:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Repeat Concurrent Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `REPEATCONCURRENT${Date.now()}`,
      maxUses: 2
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    const results = await Promise.all([
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `repeat_concurrent_join_${child.childId}`,
        now: new Date("2026-05-27T16:11:00.000Z")
      }),
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `repeat_concurrent_join_${child.childId}`,
        now: new Date("2026-05-27T16:11:00.000Z")
      })
    ]);

    expect(results).toEqual([
      {
        result: "accepted",
        communityId: community.id,
        childId: child.childId,
        memberStatus: "pending_guardian"
      },
      {
        result: "accepted",
        communityId: community.id,
        childId: child.childId,
        memberStatus: "pending_guardian"
      }
    ]);

    const usedInvite = await prisma.communityInviteCode.findUniqueOrThrow({
      where: {
        code: invite.code
      }
    });
    const members = await prisma.communityMember.findMany({
      where: {
        communityId: community.id,
        childId: child.childId
      }
    });

    expect(usedInvite.usedCount).toBe(1);
    expect(members).toHaveLength(1);
  });

  it("limits manual roster exceptions to platform admins and does not rewrite active members", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "manual_exception_admin");
    const platformAdmin = await createPlatformAdmin(
      onboarding,
      "manual_exception_platform_admin"
    );
    const childGuardian = await createGuardian(onboarding, "manual_exception_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Manual Exception Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `manual_exception_child_initial_${Date.now()}`,
      now: new Date("2026-05-27T16:20:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const community = await prisma.auctionCommunity.create({
      data: {
        name: `Manual Exception Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, community.id);
    await createActiveRuleVersion(community.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: community.id,
      code: `MANUALEXCEPTION${Date.now()}`,
      maxUses: 1
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: invite.code,
      idempotencyKey: `manual_exception_join_${child.childId}`,
      now: new Date("2026-05-27T16:21:00.000Z")
    });
    await access.confirmJoinByPrimaryGuardian({
      actorUserId: childGuardian.userId,
      communityId: community.id,
      childId: child.childId,
      now: new Date("2026-05-27T16:22:00.000Z")
    });

    await expect(
      access.recordRosterVerification({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        status: "manual_exception",
        evidenceJson: {
          reason: "activity admin attempted exception"
        },
        now: new Date("2026-05-27T16:23:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });

    await expect(
      access.recordRosterVerification({
        actorUserId: platformAdmin.userId,
        communityId: community.id,
        childId: child.childId,
        status: "manual_exception",
        evidenceJson: {
          reason: "platform-approved exception"
        },
        now: new Date("2026-05-27T16:24:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: community.id,
      childId: child.childId,
      memberStatus: "pending_admin"
    });

    await access.approveCommunityMember({
      actorUserId: admin.userId,
      communityId: community.id,
      childId: child.childId,
      now: new Date("2026-05-27T16:25:00.000Z")
    });

    await expect(
      access.recordRosterVerification({
        actorUserId: admin.userId,
        communityId: community.id,
        childId: child.childId,
        status: "not_matched",
        evidenceJson: {
          rosterId: "late-negative-roster"
        },
        now: new Date("2026-05-27T16:26:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
    });
    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: community.id,
            childId: child.childId
          }
        },
        select: {
          status: true,
          rosterVerificationStatus: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      rosterVerificationStatus: "manual_exception"
    });
  });

  it("requires separate guardian confirmation and admin review for a second community", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const access = new CommunityAccessService(prisma);
    const admin = await createGuardian(onboarding, "second_community_admin");
    const platformAdmin = await createPlatformAdmin(
      onboarding,
      "second_community_platform_admin"
    );
    const childGuardian = await createGuardian(onboarding, "second_community_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Second Community Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `second_community_initial_${Date.now()}`,
      now: new Date("2026-05-27T17:00:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const firstCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `First Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    const secondCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `Second Community ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, firstCommunity.id);
    await prisma.adminCommunityScope.create({
      data: {
        adminProfileId: (
          await prisma.adminProfile.findUniqueOrThrow({
            where: {
              userId: admin.userId
            }
          })
        ).id,
        communityId: secondCommunity.id,
        status: "active"
      }
    });
    await createActiveRuleVersion(firstCommunity.id);
    await createActiveRuleVersion(secondCommunity.id);

    const firstInvite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: firstCommunity.id,
      code: `FIRST${Date.now()}`,
      maxUses: 10
    });
    const secondInvite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: secondCommunity.id,
      code: `SECOND${Date.now()}`,
      maxUses: 10
    });

    if (firstInvite.result !== "accepted" || secondInvite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    await access.requestJoinWithInvite({
      actorUserId: childGuardian.userId,
      childId: child.childId,
      code: firstInvite.code,
      idempotencyKey: `first_community_join_${child.childId}`,
      now: new Date("2026-05-27T17:01:00.000Z")
    });
    await access.confirmJoinByPrimaryGuardian({
      actorUserId: childGuardian.userId,
      communityId: firstCommunity.id,
      childId: child.childId,
      now: new Date("2026-05-27T17:02:00.000Z")
    });
    await access.recordRosterVerification({
      actorUserId: admin.userId,
      communityId: firstCommunity.id,
      childId: child.childId,
      status: "matched",
      evidenceJson: {
        rosterId: "first-roster"
      },
      now: new Date("2026-05-27T17:03:00.000Z")
    });
    await access.approveCommunityMember({
      actorUserId: admin.userId,
      communityId: firstCommunity.id,
      childId: child.childId,
      now: new Date("2026-05-27T17:04:00.000Z")
    });

    await expect(
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: secondInvite.code,
        idempotencyKey: `second_community_join_${child.childId}`,
        now: new Date("2026-05-27T17:05:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: secondCommunity.id,
      childId: child.childId,
      memberStatus: "pending_guardian"
    });
    await expect(
      prisma.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: secondCommunity.id,
            childId: child.childId
          }
        },
        select: {
          guardianConfirmedAt: true,
          adminReviewedAt: true,
          status: true
        }
      })
    ).resolves.toEqual({
      guardianConfirmedAt: null,
      adminReviewedAt: null,
      status: "pending_guardian"
    });

    await access.confirmJoinByPrimaryGuardian({
      actorUserId: childGuardian.userId,
      communityId: secondCommunity.id,
      childId: child.childId,
      now: new Date("2026-05-27T17:06:00.000Z")
    });
    await access.recordRosterVerification({
      actorUserId: platformAdmin.userId,
      communityId: secondCommunity.id,
      childId: child.childId,
      status: "manual_exception",
      evidenceJson: {
        reason: "manual platform-approved exception"
      },
      now: new Date("2026-05-27T17:07:00.000Z")
    });
    await expect(
      access.approveCommunityMember({
        actorUserId: admin.userId,
        communityId: secondCommunity.id,
        childId: child.childId,
        now: new Date("2026-05-27T17:08:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      communityId: secondCommunity.id,
      childId: child.childId,
      memberStatus: "active"
    });
  });

  it("records abnormal join risk before allowing a child to request a third active community", async () => {
    const onboarding = new OnboardingService(prisma, new FakeWechatAuthProvider());
    const risks = new RiskGovernanceService(prisma);
    const access = new CommunityAccessService(prisma, undefined, risks);
    const admin = await createGuardian(onboarding, "abnormal_join_admin");
    const childGuardian = await createGuardian(onboarding, "abnormal_join_child");
    const child = await onboarding.createChildWithPrimaryGuardian({
      actorUserId: childGuardian.userId,
      guardianId: childGuardian.guardianId,
      displayName: `Abnormal Join Child ${Date.now()}`,
      gradeBand: "grade_3_4",
      idempotencyKey: `abnormal_join_initial_${Date.now()}`,
      now: new Date("2026-05-27T17:10:00.000Z")
    });

    if (child.result !== "accepted") {
      throw new Error("expected child creation to succeed");
    }

    const firstCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `Abnormal Join First ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440,
        members: {
          create: {
            childId: child.childId,
            status: "active"
          }
        }
      }
    });
    const secondCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `Abnormal Join Second ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440,
        members: {
          create: {
            childId: child.childId,
            status: "active"
          }
        }
      }
    });
    const targetCommunity = await prisma.auctionCommunity.create({
      data: {
        name: `Abnormal Join Target ${Date.now()}`,
        creatorGuardianId: admin.guardianId,
        status: "active",
        defaultAuctionDurationMinutes: 1440
      }
    });
    await grantCommunityAdminScope(admin.userId, targetCommunity.id);
    await createActiveRuleVersion(firstCommunity.id);
    await createActiveRuleVersion(secondCommunity.id);
    await createActiveRuleVersion(targetCommunity.id);
    const invite = await access.createInviteCode({
      actorUserId: admin.userId,
      communityId: targetCommunity.id,
      code: `ABNORMAL${Date.now()}`,
      maxUses: 2
    });

    if (invite.result !== "accepted") {
      throw new Error("expected invite creation to succeed");
    }

    await expect(
      access.requestJoinWithInvite({
        actorUserId: childGuardian.userId,
        childId: child.childId,
        code: invite.code,
        idempotencyKey: `abnormal_join_attempt_${child.childId}`,
        now: new Date("2026-05-27T17:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "RISK_RESTRICTED"
    });

    await expect(
      prisma.communityInviteCode.findUniqueOrThrow({
        where: {
          id: invite.inviteCodeId
        },
        select: {
          usedCount: true
        }
      })
    ).resolves.toEqual({
      usedCount: 0
    });
    await expect(
      prisma.communityMember.findUnique({
        where: {
          communityId_childId: {
            communityId: targetCommunity.id,
            childId: child.childId
          }
        }
      })
    ).resolves.toBeNull();

    const signal = await prisma.riskSignal.findFirstOrThrow({
      where: {
        type: "abnormal_join_pattern",
        scope: "child",
        targetId: child.childId,
        status: "under_review"
      },
      include: {
        restrictions: {
          select: {
            type: true,
            status: true
          },
          orderBy: {
            type: "asc"
          }
        }
      }
    });
    expect(signal.evidenceJson).toEqual(
      expect.objectContaining({
        attemptedCommunityId: targetCommunity.id,
        activeCommunityCount: 2,
        source: "community_member.request_with_invite"
      })
    );
    expect(signal.restrictions).toEqual([
      {
        type: "no_join",
        status: "active"
      },
      {
        type: "suspended",
        status: "active"
      }
    ]);
  });
});
