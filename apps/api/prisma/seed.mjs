import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const openid = "mock_openid_guardian_seed";
  const existingIdentity = await prisma.wechatIdentity.findUnique({
    where: { openid },
    include: {
      user: {
        include: {
          guardianProfile: true
        }
      }
    }
  });

  const user =
    existingIdentity?.user ??
    (await prisma.user.create({
      data: {
        wechatIdentities: {
          create: {
            openid,
            nickname: "Local Dev Guardian",
            lastLoginAt: new Date()
          }
        },
        guardianProfile: {
          create: {
            phoneHash: "seed_phone_hash",
            phoneLast4: "0000",
            consentVersion: "local-dev-v1",
            consentedAt: new Date()
          }
        }
      },
      include: {
        guardianProfile: true
      }
    }));

  if (!user.guardianProfile) {
    throw new Error("Seed guardian profile was not created");
  }

  const community = await prisma.auctionCommunity.upsert({
    where: {
      id: "seed_community_betterway"
    },
    update: {
      name: "Betterway Local Dev Community",
      creatorGuardianId: user.guardianProfile.id,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    },
    create: {
      id: "seed_community_betterway",
      name: "Betterway Local Dev Community",
      creatorGuardianId: user.guardianProfile.id,
      status: "active",
      defaultAuctionDurationMinutes: 1440
    }
  });

  const adminProfile = await prisma.adminProfile.upsert({
    where: {
      userId: user.id
    },
    update: {
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    },
    create: {
      userId: user.id,
      role: "activity_admin",
      mfaEnabled: true,
      status: "active"
    }
  });

  await prisma.adminCommunityScope.upsert({
    where: {
      adminProfileId_communityId: {
        adminProfileId: adminProfile.id,
        communityId: community.id
      }
    },
    update: {
      status: "active"
    },
    create: {
      adminProfileId: adminProfile.id,
      communityId: community.id,
      status: "active"
    }
  });

  await prisma.communityInviteCode.upsert({
    where: {
      code: "LOCALDEV"
    },
    update: {
      communityId: community.id,
      status: "active",
      maxUses: 100
    },
    create: {
      communityId: community.id,
      code: "LOCALDEV",
      status: "active",
      maxUses: 100
    }
  });
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
