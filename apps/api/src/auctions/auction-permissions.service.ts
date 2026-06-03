import type { AdminRole, Prisma, PrismaClient } from "@prisma/client";

export type ManageCommunityAuctionResult =
  | {
      result: "accepted";
      adminProfileId: string;
      communityId: string;
      role: Extract<AdminRole, "activity_admin" | "platform_admin">;
    }
  | {
      result: "rejected";
      errorCode: "COMMUNITY_ADMIN_REQUIRED";
    };

export class AuctionPermissionsService {
  constructor(private readonly prisma: PrismaClient) {}

  async canManageCommunityAuction(
    input: {
      actorUserId: string;
      communityId: string;
    },
    client: PrismaClient | Prisma.TransactionClient = this.prisma
  ): Promise<ManageCommunityAuctionResult> {
    const admin = await client.adminProfile.findFirst({
      where: {
        userId: input.actorUserId,
        status: "active",
        mfaEnabled: true,
        OR: [
          {
            role: "platform_admin"
          },
          {
            role: "activity_admin",
            communityScopes: {
              some: {
                communityId: input.communityId,
                status: "active"
              }
            }
          }
        ]
      },
      select: {
        id: true,
        role: true
      }
    });

    if (!admin || (admin.role !== "platform_admin" && admin.role !== "activity_admin")) {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_ADMIN_REQUIRED"
      };
    }

    return {
      result: "accepted",
      adminProfileId: admin.id,
      communityId: input.communityId,
      role: admin.role
    };
  }
}
