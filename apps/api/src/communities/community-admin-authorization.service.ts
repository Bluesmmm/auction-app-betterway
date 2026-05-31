import type { AdminScopeStatus, Prisma, PrismaClient } from "@prisma/client";

export type GrantActivityAdminResult =
  | {
      result: "accepted";
      adminProfileId: string;
      communityId: string;
      scopeStatus: AdminScopeStatus;
    }
  | {
      result: "rejected";
      errorCode:
        | "PLATFORM_ADMIN_REQUIRED"
        | "COMMUNITY_NOT_ACTIVE"
        | "TARGET_ADMIN_ROLE_INVALID"
        | "TARGET_ADMIN_NOT_ACTIVE";
    };

export type RevokeActivityAdminResult =
  | {
      result: "accepted";
      adminProfileId: string;
      communityId: string;
      scopeStatus: "revoked";
    }
  | {
      result: "rejected";
      errorCode:
        | "PLATFORM_ADMIN_REQUIRED"
        | "COMMUNITY_ADMIN_SCOPE_NOT_FOUND";
    };

export type CommunityAdmissionOpenResult =
  | {
      result: "accepted";
      communityId: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_NOT_ACTIVE"
        | "COMMUNITY_NOT_OPEN_FOR_ADMISSION";
    };

export type ActiveScopedActivityAdminResult =
  | {
      result: "accepted";
      adminProfileId: string;
      communityId: string;
    }
  | {
      result: "rejected";
      errorCode: "COMMUNITY_ADMIN_REQUIRED";
    };

export class CommunityAdminAuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async grantActivityAdmin(input: {
    platformAdminUserId: string;
    targetUserId: string;
    communityId: string;
    now?: Date;
  }): Promise<GrantActivityAdminResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    const community = await this.prisma.auctionCommunity.findUnique({
      where: {
        id: input.communityId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!community || community.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_NOT_ACTIVE"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, input.communityId);

      const existingAdminProfile = await tx.adminProfile.findUnique({
        where: {
          userId: input.targetUserId
        }
      });

      if (
        existingAdminProfile &&
        existingAdminProfile.role !== "activity_admin"
      ) {
        return {
          result: "rejected",
          errorCode: "TARGET_ADMIN_ROLE_INVALID"
        };
      }

      if (
        existingAdminProfile &&
        existingAdminProfile.status !== "active"
      ) {
        return {
          result: "rejected",
          errorCode: "TARGET_ADMIN_NOT_ACTIVE"
        };
      }

      const adminProfile =
        existingAdminProfile ??
        (await tx.adminProfile.create({
          data: {
            userId: input.targetUserId,
            role: "activity_admin",
            mfaEnabled: false,
            status: "active"
          }
        }));

      const scope = await tx.adminCommunityScope.upsert({
        where: {
          adminProfileId_communityId: {
            adminProfileId: adminProfile.id,
            communityId: input.communityId
          }
        },
        update: {
          status: "active"
        },
        create: {
          adminProfileId: adminProfile.id,
          communityId: input.communityId,
          status: "active"
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "admin_community_scope.grant_activity_admin",
          targetType: "admin_community_scope",
          targetId: scope.id,
          afterJson: {
            targetUserId: input.targetUserId,
            communityId: input.communityId,
            status: scope.status,
            grantedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        adminProfileId: adminProfile.id,
        communityId: input.communityId,
        scopeStatus: scope.status
      };
    });
  }

  async revokeActivityAdmin(input: {
    platformAdminUserId: string;
    targetUserId: string;
    communityId: string;
    reason: string;
    now?: Date;
  }): Promise<RevokeActivityAdminResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, input.communityId);

      const adminProfile = await tx.adminProfile.findUnique({
        where: {
          userId: input.targetUserId
        },
        select: {
          id: true
        }
      });

      if (!adminProfile) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_ADMIN_SCOPE_NOT_FOUND"
        };
      }

      const updated = await tx.adminCommunityScope.updateMany({
        where: {
          adminProfileId: adminProfile.id,
          communityId: input.communityId,
          status: "active"
        },
        data: {
          status: "revoked"
        }
      });

      if (updated.count !== 1) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_ADMIN_SCOPE_NOT_FOUND"
        };
      }

      const scope = await tx.adminCommunityScope.findUniqueOrThrow({
        where: {
          adminProfileId_communityId: {
            adminProfileId: adminProfile.id,
            communityId: input.communityId
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "admin_community_scope.revoke_activity_admin",
          targetType: "admin_community_scope",
          targetId: scope.id,
          reason: input.reason,
          afterJson: {
            targetUserId: input.targetUserId,
            communityId: input.communityId,
            status: scope.status,
            revokedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        adminProfileId: adminProfile.id,
        communityId: input.communityId,
        scopeStatus: "revoked"
      };
    });
  }

  async assertCommunityOpenForAdmission(input: {
    communityId: string;
  }): Promise<CommunityAdmissionOpenResult> {
    const community = await this.prisma.auctionCommunity.findUnique({
      where: {
        id: input.communityId
      },
      select: {
        id: true,
        status: true,
        adminScopes: {
          where: {
            status: "active",
            adminProfile: {
              role: "activity_admin",
              status: "active",
              mfaEnabled: true
            }
          },
          select: {
            id: true
          },
          take: 1
        }
      }
    });

    if (!community || community.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_NOT_ACTIVE"
      };
    }

    if (community.adminScopes.length === 0) {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
      };
    }

    return {
      result: "accepted",
      communityId: community.id
    };
  }

  async findActiveScopedActivityAdmin(input: {
    actorUserId: string;
    communityId: string;
  }): Promise<ActiveScopedActivityAdminResult> {
    const admin = await this.prisma.adminProfile.findFirst({
      where: {
        userId: input.actorUserId,
        role: "activity_admin",
        status: "active",
        mfaEnabled: true,
        communityScopes: {
          some: {
            communityId: input.communityId,
            status: "active"
          }
        }
      },
      select: {
        id: true
      }
    });

    if (!admin) {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_ADMIN_REQUIRED"
      };
    }

    return {
      result: "accepted",
      adminProfileId: admin.id,
      communityId: input.communityId
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
