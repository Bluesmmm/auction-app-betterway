import type {
  CommunityRuleVersionStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";

export type CommunityRuleVersionResult =
  | {
      result: "accepted";
      ruleVersionId: string;
      communityId: string;
      versionNo: number;
      status: CommunityRuleVersionStatus;
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_ADMIN_REQUIRED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "COMMUNITY_NOT_ACTIVE"
        | "RULE_VERSION_NOT_FOUND"
        | "ACTIVE_RULE_VERSION_REQUIRED";
    };

export class CommunityRuleService {
  constructor(private readonly prisma: PrismaClient) {}

  async createDraftRuleVersion(input: {
    actorUserId: string;
    communityId: string;
    rulesJson: Prisma.InputJsonValue;
    now?: Date;
  }): Promise<CommunityRuleVersionResult> {
    const now = input.now ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, input.communityId);

      const community = await tx.auctionCommunity.findUnique({
        where: {
          id: input.communityId
        },
        select: {
          status: true,
          ruleVersions: {
            select: {
              versionNo: true
            },
            orderBy: {
              versionNo: "desc"
            },
            take: 1
          }
        }
      });

      if (!community || community.status !== "active") {
        return {
          result: "rejected" as const,
          errorCode: "COMMUNITY_NOT_ACTIVE" as const
        };
      }

      const scopedAdmin = await findActiveScopedActivityAdmin(
        tx,
        input.actorUserId,
        input.communityId
      );
      if (!scopedAdmin) {
        return {
          result: "rejected" as const,
          errorCode: "COMMUNITY_ADMIN_REQUIRED" as const
        };
      }

      const versionNo = (community.ruleVersions[0]?.versionNo ?? 0) + 1;
      const ruleVersion = await tx.communityRuleVersion.create({
        data: {
          communityId: input.communityId,
          versionNo,
          status: "draft",
          rulesJson: input.rulesJson
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "community_rule_version.create_draft",
          targetType: "community_rule_version",
          targetId: ruleVersion.id,
          afterJson: {
            communityId: input.communityId,
            versionNo,
            createdAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted" as const,
        ruleVersionId: ruleVersion.id,
        communityId: ruleVersion.communityId,
        versionNo: ruleVersion.versionNo,
        status: ruleVersion.status
      };
    });
  }

  async activateRuleVersion(input: {
    platformAdminUserId: string;
    communityId: string;
    ruleVersionId: string;
    now?: Date;
  }): Promise<CommunityRuleVersionResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, input.communityId);

      const community = await tx.auctionCommunity.findUnique({
        where: {
          id: input.communityId
        },
        select: {
          status: true
        }
      });

      if (!community || community.status !== "active") {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_NOT_ACTIVE"
        };
      }

      const ruleVersion = await tx.communityRuleVersion.findFirst({
        where: {
          id: input.ruleVersionId,
          communityId: input.communityId
        }
      });

      if (!ruleVersion) {
        return {
          result: "rejected",
          errorCode: "RULE_VERSION_NOT_FOUND"
        };
      }

      await tx.communityRuleVersion.updateMany({
        where: {
          communityId: input.communityId,
          status: "active",
          id: {
            not: input.ruleVersionId
          }
        },
        data: {
          status: "retired"
        }
      });

      const activatedCount = await tx.communityRuleVersion.updateMany({
        where: {
          id: input.ruleVersionId,
          communityId: input.communityId
        },
        data: {
          status: "active",
          effectiveAt: now
        }
      });

      if (activatedCount.count !== 1) {
        return {
          result: "rejected",
          errorCode: "RULE_VERSION_NOT_FOUND"
        };
      }

      const activated = await tx.communityRuleVersion.findUniqueOrThrow({
        where: {
          id: input.ruleVersionId
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "community_rule_version.activate",
          targetType: "community_rule_version",
          targetId: activated.id,
          afterJson: {
            communityId: input.communityId,
            versionNo: activated.versionNo,
            effectiveAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        ruleVersionId: activated.id,
        communityId: activated.communityId,
        versionNo: activated.versionNo,
        status: activated.status
      };
    });
  }

  async findActiveRuleVersionOrReject(
    communityId: string
  ): Promise<CommunityRuleVersionResult> {
    const ruleVersions = await this.prisma.communityRuleVersion.findMany({
      where: {
        communityId,
        status: "active"
      },
      orderBy: {
        versionNo: "desc"
      },
      take: 2
    });
    const ruleVersion = ruleVersions[0];

    if (!ruleVersion || ruleVersions.length !== 1) {
      return {
        result: "rejected",
        errorCode: "ACTIVE_RULE_VERSION_REQUIRED"
      };
    }

    return {
      result: "accepted",
      ruleVersionId: ruleVersion.id,
      communityId: ruleVersion.communityId,
      versionNo: ruleVersion.versionNo,
      status: ruleVersion.status
    };
  }

  private async isActiveMfaPlatformAdmin(userId: string): Promise<boolean> {
    const platformAdmin = await this.prisma.adminProfile.findUnique({
      where: {
        userId
      },
      select: {
        role: true,
        status: true,
        mfaEnabled: true
      }
    });

    return Boolean(
      platformAdmin &&
        platformAdmin.role === "platform_admin" &&
        platformAdmin.status === "active" &&
        platformAdmin.mfaEnabled
    );
  }
}

async function lockCommunity(tx: Prisma.TransactionClient, communityId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "AuctionCommunity"
    WHERE "id" = ${communityId}
    FOR UPDATE
  `;
}

async function findActiveScopedActivityAdmin(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  communityId: string
) {
  return tx.adminProfile.findFirst({
    where: {
      userId: actorUserId,
      role: "activity_admin",
      status: "active",
      mfaEnabled: true,
      communityScopes: {
        some: {
          communityId,
          status: "active"
        }
      }
    },
    select: {
      id: true
    }
  });
}
