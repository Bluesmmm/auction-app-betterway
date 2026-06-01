import { spawnSync } from "node:child_process";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const expected = {
  platformAdminOpenid: "mock_openid_stage2_platform_admin",
  guardianApplicantOpenid: "mock_openid_stage2_guardian_applicant",
  activityAdminOpenid: "mock_openid_stage2_activity_admin",
  pendingRequestId: "seed_request_stage2_pending",
  sampleCommunityId: "seed_community_stage2_sample",
  sampleRuleVersionId: "seed_rule_stage2_sample_active",
  sampleInviteCode: "STAGE2JOIN"
};

const verificationCommands = [
  ["npm", ["run", "db:generate"]],
  ["npm", ["run", "db:deploy"]],
  ["npm", ["run", "db:status"]],
  ["npm", ["run", "db:validate"]],
  ["npm", ["run", "db:seed"]],
  [
    "npm",
    ["test", "--", "apps/api/test/contracts", "apps/api/test/integration"]
  ],
  [
    "npm",
    [
      "test",
      "--",
      "apps/api/test/runtime/admin-stage2-shell.test.ts",
      "apps/api/test/runtime/miniprogram-stage2-shell.test.ts",
      "apps/api/test/runtime/stage2-controller-di.test.ts",
      "apps/api/test/runtime/stage2-scripts.test.ts"
    ]
  ],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]]
];

async function main() {
  for (const [command, args] of verificationCommands) {
    runCommand(command, args);
  }

  await assertSeedData();
  console.log("stage2 verification passed");
}

function runCommand(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function assertSeedData() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const platformAdmin = await prisma.wechatIdentity.findUnique({
      where: {
        openid: expected.platformAdminOpenid
      },
      include: {
        user: {
          include: {
            adminProfile: true
          }
        }
      }
    });
    assert(
      platformAdmin?.user.adminProfile?.role === "platform_admin" &&
        platformAdmin.user.adminProfile.mfaEnabled &&
        platformAdmin.user.adminProfile.status === "active",
      "seeded platform admin is missing or invalid"
    );

    const guardianApplicant = await prisma.wechatIdentity.findUnique({
      where: {
        openid: expected.guardianApplicantOpenid
      },
      include: {
        user: {
          include: {
            guardianProfile: true,
            adminProfile: {
              include: {
                communityScopes: true
              }
            }
          }
        }
      }
    });
    assert(
      guardianApplicant?.user.guardianProfile?.status === "active",
      "seeded guardian applicant is missing or inactive"
    );

    const applicantActiveScopes =
      guardianApplicant?.user.adminProfile?.communityScopes.filter(
        (scope) => scope.status === "active"
      ) ?? [];
    assert(
      applicantActiveScopes.length === 0,
      "applicant should not receive automatic activity-admin scope"
    );

    const pendingRequest = await prisma.communityCreationRequest.findUnique({
      where: {
        id: expected.pendingRequestId
      }
    });
    assert(
      pendingRequest?.status === "pending_review" &&
        pendingRequest.applicantGuardianId ===
          guardianApplicant?.user.guardianProfile?.id,
      "pending community creation request is missing or invalid"
    );

    const activityAdmin = await prisma.wechatIdentity.findUnique({
      where: {
        openid: expected.activityAdminOpenid
      },
      include: {
        user: {
          include: {
            guardianProfile: true,
            adminProfile: {
              include: {
                communityScopes: true
              }
            }
          }
        }
      }
    });
    assert(
      activityAdmin?.user.adminProfile?.role === "activity_admin" &&
        activityAdmin.user.adminProfile.mfaEnabled &&
        activityAdmin.user.adminProfile.status === "active",
      "seeded activity admin candidate is missing or invalid"
    );

    const sampleCommunity = await prisma.auctionCommunity.findUnique({
      where: {
        id: expected.sampleCommunityId
      },
      include: {
        ruleVersions: true,
        inviteCodes: true
      }
    });
    assert(
      sampleCommunity?.status === "active" &&
        sampleCommunity.creatorGuardianId ===
          activityAdmin?.user.guardianProfile?.id,
      "approved sample community is missing or invalid"
    );

    const activeRuleVersions =
      sampleCommunity?.ruleVersions.filter(
        (version) => version.status === "active"
      ) ?? [];
    assert(
      activeRuleVersions.length === 1 &&
        activeRuleVersions[0]?.id === expected.sampleRuleVersionId &&
        activeRuleVersions[0]?.versionNo === 1,
      "sample community active rule version is missing or invalid"
    );

    const invite = sampleCommunity?.inviteCodes.find(
      (candidate) => candidate.code === expected.sampleInviteCode
    );
    assert(
      invite?.status === "active" &&
        invite.ruleVersionId === expected.sampleRuleVersionId,
      "sample community invite code is missing or invalid"
    );

    const scopedCommunityIds =
      activityAdmin?.user.adminProfile?.communityScopes
        .filter((scope) => scope.status === "active")
        .map((scope) => scope.communityId) ?? [];
    assert(
      scopedCommunityIds.includes(expected.sampleCommunityId),
      "explicit activity-admin scope is missing"
    );
  } finally {
    await prisma.$disconnect();
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main()
  .then(() => undefined)
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
