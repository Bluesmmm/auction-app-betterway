import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const seedIds = {
  platformAdminUserId: "seed_user_stage2_platform_admin",
  guardianApplicantUserId: "seed_user_stage2_guardian_applicant",
  activityAdminUserId: "seed_user_stage2_activity_admin",
  pendingRequestId: "seed_request_stage2_pending",
  sampleCommunityId: "seed_community_stage2_sample",
  sampleRuleVersionId: "seed_rule_stage2_sample_active",
  sampleInviteCodeId: "seed_invite_stage2_sample"
};

const seedOpenids = {
  platformAdmin: "mock_openid_stage2_platform_admin",
  guardianApplicant: "mock_openid_stage2_guardian_applicant",
  activityAdmin: "mock_openid_stage2_activity_admin"
};

const seedTimestamps = {
  login: new Date("2026-05-31T08:00:00.000Z"),
  consent: new Date("2026-05-31T08:05:00.000Z"),
  communityCreated: new Date("2026-05-31T08:10:00.000Z"),
  ruleEffective: new Date("2026-05-31T08:15:00.000Z")
};

async function main() {
  const platformAdminUser = await upsertUserWithWechatIdentity({
    userId: seedIds.platformAdminUserId,
    openid: seedOpenids.platformAdmin,
    nickname: "Stage2 Platform Admin"
  });

  const guardianApplicantUser = await upsertUserWithWechatIdentity({
    userId: seedIds.guardianApplicantUserId,
    openid: seedOpenids.guardianApplicant,
    nickname: "Stage2 Guardian Applicant"
  });

  const activityAdminUser = await upsertUserWithWechatIdentity({
    userId: seedIds.activityAdminUserId,
    openid: seedOpenids.activityAdmin,
    nickname: "Stage2 Activity Admin Candidate"
  });

  const guardianApplicant = await prisma.guardianProfile.upsert({
    where: {
      userId: guardianApplicantUser.id
    },
    update: {
      phoneHash: "seed_stage2_guardian_phone_hash",
      phoneLast4: "2233",
      consentVersion: "guardian-consent-v1",
      consentedAt: seedTimestamps.consent,
      status: "active"
    },
    create: {
      userId: guardianApplicantUser.id,
      phoneHash: "seed_stage2_guardian_phone_hash",
      phoneLast4: "2233",
      consentVersion: "guardian-consent-v1",
      consentedAt: seedTimestamps.consent,
      status: "active"
    }
  });

  const activityAdminGuardian = await prisma.guardianProfile.upsert({
    where: {
      userId: activityAdminUser.id
    },
    update: {
      phoneHash: "seed_stage2_activity_admin_phone_hash",
      phoneLast4: "4455",
      consentVersion: "guardian-consent-v1",
      consentedAt: seedTimestamps.consent,
      status: "active"
    },
    create: {
      userId: activityAdminUser.id,
      phoneHash: "seed_stage2_activity_admin_phone_hash",
      phoneLast4: "4455",
      consentVersion: "guardian-consent-v1",
      consentedAt: seedTimestamps.consent,
      status: "active"
    }
  });

  await prisma.adminProfile.upsert({
    where: {
      userId: platformAdminUser.id
    },
    update: {
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    },
    create: {
      userId: platformAdminUser.id,
      role: "platform_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  const activityAdminProfile = await prisma.adminProfile.upsert({
    where: {
      userId: activityAdminUser.id
    },
    update: {
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    },
    create: {
      userId: activityAdminUser.id,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  const sampleCommunity = await prisma.auctionCommunity.upsert({
    where: {
      id: seedIds.sampleCommunityId
    },
    update: {
      name: "Stage2 Sample Community",
      description: "Approved Stage 2 sample community for miniprogram verification",
      creatorGuardianId: activityAdminGuardian.id,
      status: "active",
      defaultAuctionDurationMinutes: 1440,
      createdAt: seedTimestamps.communityCreated
    },
    create: {
      id: seedIds.sampleCommunityId,
      name: "Stage2 Sample Community",
      description: "Approved Stage 2 sample community for miniprogram verification",
      creatorGuardianId: activityAdminGuardian.id,
      status: "active",
      defaultAuctionDurationMinutes: 1440,
      createdAt: seedTimestamps.communityCreated
    }
  });

  await prisma.communityRuleVersion.upsert({
    where: {
      id: seedIds.sampleRuleVersionId
    },
    update: {
      communityId: sampleCommunity.id,
      versionNo: 1,
      status: "active",
      rulesJson: {
        version: 1,
        source: "stage2-seed",
        admission: "invite_then_guardian_then_admin"
      },
      effectiveAt: seedTimestamps.ruleEffective
    },
    create: {
      id: seedIds.sampleRuleVersionId,
      communityId: sampleCommunity.id,
      versionNo: 1,
      status: "active",
      rulesJson: {
        version: 1,
        source: "stage2-seed",
        admission: "invite_then_guardian_then_admin"
      },
      effectiveAt: seedTimestamps.ruleEffective
    }
  });

  await prisma.adminCommunityScope.upsert({
    where: {
      adminProfileId_communityId: {
        adminProfileId: activityAdminProfile.id,
        communityId: sampleCommunity.id
      }
    },
    update: {
      status: "active"
    },
    create: {
      adminProfileId: activityAdminProfile.id,
      communityId: sampleCommunity.id,
      status: "active"
    }
  });

  await prisma.communityInviteCode.upsert({
    where: {
      code: "STAGE2JOIN"
    },
    update: {
      id: seedIds.sampleInviteCodeId,
      communityId: sampleCommunity.id,
      ruleVersionId: seedIds.sampleRuleVersionId,
      status: "active",
      maxUses: 50,
      usedCount: 0
    },
    create: {
      id: seedIds.sampleInviteCodeId,
      communityId: sampleCommunity.id,
      ruleVersionId: seedIds.sampleRuleVersionId,
      code: "STAGE2JOIN",
      status: "active",
      maxUses: 50
    }
  });

  await prisma.communityCreationRequest.upsert({
    where: {
      id: seedIds.pendingRequestId
    },
    update: {
      applicantGuardianId: guardianApplicant.id,
      reviewedByUserId: null,
      approvedCommunityId: null,
      status: "pending_review",
      requestedName: "Stage2 Pending Community Request",
      requestedDescription:
        "Pending Stage 2 request seeded for onboarding and verification flows",
      requestedGradeBand: "grade_3_4",
      expectedMemberSize: 36,
      ruleDraftJson: {
        version: 1,
        source: "stage2-seed-draft",
        admission: "requires_platform_review"
      },
      reviewedAt: null,
      reviewNotes: null
    },
    create: {
      id: seedIds.pendingRequestId,
      applicantGuardianId: guardianApplicant.id,
      status: "pending_review",
      requestedName: "Stage2 Pending Community Request",
      requestedDescription:
        "Pending Stage 2 request seeded for onboarding and verification flows",
      requestedGradeBand: "grade_3_4",
      expectedMemberSize: 36,
      ruleDraftJson: {
        version: 1,
        source: "stage2-seed-draft",
        admission: "requires_platform_review"
      }
    }
  });
}

async function upsertUserWithWechatIdentity(input) {
  const user = await prisma.user.upsert({
    where: {
      id: input.userId
    },
    update: {
      status: "active"
    },
    create: {
      id: input.userId,
      status: "active"
    }
  });

  await prisma.wechatIdentity.upsert({
    where: {
      openid: input.openid
    },
    update: {
      userId: user.id,
      nickname: input.nickname,
      lastLoginAt: seedTimestamps.login
    },
    create: {
      userId: user.id,
      openid: input.openid,
      nickname: input.nickname,
      lastLoginAt: seedTimestamps.login
    }
  });

  return user;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
