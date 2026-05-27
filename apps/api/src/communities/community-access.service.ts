import type {
  CommunityMemberStatus,
  InviteCodeStatus,
  PrismaClient
} from "@prisma/client";

export type CreateInviteCodeInput = {
  actorUserId: string;
  communityId: string;
  code: string;
  maxUses?: number;
  expiresAt?: Date;
};

export type CreateInviteCodeResult =
  | {
      result: "accepted";
      inviteCodeId: string;
      code: string;
      status: InviteCodeStatus;
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_NOT_ACTIVE"
        | "COMMUNITY_ADMIN_REQUIRED"
        | "INVITE_MAX_USES_INVALID";
    };

export type RequestJoinWithInviteInput = {
  childId: string;
  code: string;
  now?: Date;
};

export type CommunityMemberTransitionResult =
  | {
      result: "accepted";
      communityId: string;
      childId: string;
      memberStatus: CommunityMemberStatus;
    }
  | {
      result: "rejected";
      errorCode:
        | "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        | "INVITE_CODE_UNAVAILABLE"
        | "COMMUNITY_MEMBER_STATE_INVALID"
        | "COMMUNITY_ADMIN_REQUIRED";
    };

export type ConfirmJoinByPrimaryGuardianInput = {
  actorUserId: string;
  communityId: string;
  childId: string;
  now?: Date;
};

export type ApproveCommunityMemberInput = {
  actorUserId: string;
  communityId: string;
  childId: string;
  now?: Date;
};

type ConsumedInviteCode = {
  id: string;
  communityId: string;
};

export class CommunityAccessService {
  constructor(private readonly prisma: PrismaClient) {}

  async createInviteCode(
    input: CreateInviteCodeInput
  ): Promise<CreateInviteCodeResult> {
    if (
      input.maxUses !== undefined &&
      (!Number.isInteger(input.maxUses) || input.maxUses <= 0)
    ) {
      return {
        result: "rejected",
        errorCode: "INVITE_MAX_USES_INVALID"
      };
    }

    const community = await this.prisma.auctionCommunity.findUnique({
      where: {
        id: input.communityId
      }
    });

    if (!community || community.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_NOT_ACTIVE"
      };
    }

    const creator = await this.prisma.guardianProfile.findUnique({
      where: {
        id: community.creatorGuardianId
      }
    });

    if (!creator || creator.userId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_ADMIN_REQUIRED"
      };
    }

    const inviteCode = await this.prisma.communityInviteCode.create({
      data: {
        communityId: community.id,
        code: input.code,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
        status: "active"
      }
    });

    return {
      result: "accepted",
      inviteCodeId: inviteCode.id,
      code: inviteCode.code,
      status: inviteCode.status
    };
  }

  async requestJoinWithInvite(
    input: RequestJoinWithInviteInput
  ): Promise<CommunityMemberTransitionResult> {
    const now = input.now ?? new Date();

    const activePrimaryGuardian = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId: input.childId,
        role: "primary",
        status: "active",
        child: {
          status: "active"
        },
        guardian: {
          status: "active"
        }
      }
    });

    if (!activePrimaryGuardian) {
      return {
        result: "rejected",
        errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const inviteCodes = await tx.$queryRaw<ConsumedInviteCode[]>`
        UPDATE "CommunityInviteCode"
        SET "usedCount" = "usedCount" + 1
        WHERE "code" = ${input.code}
          AND "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
          AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
        RETURNING "id", "communityId"
      `;
      const inviteCode = inviteCodes[0];

      if (!inviteCode) {
        return {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        };
      }

      const existingMember = await tx.communityMember.findUnique({
        where: {
          communityId_childId: {
            communityId: inviteCode.communityId,
            childId: input.childId
          }
        }
      });

      if (existingMember) {
        return {
          result: "accepted",
          communityId: existingMember.communityId,
          childId: existingMember.childId,
          memberStatus: existingMember.status
        };
      }

      const member = await tx.communityMember.create({
        data: {
          communityId: inviteCode.communityId,
          childId: input.childId,
          status: "pending_guardian"
        }
      });

      await tx.auditLog.create({
        data: {
          action: "community_member.request_with_invite",
          targetType: "community_member",
          targetId: member.id,
          afterJson: {
            inviteCodeId: inviteCode.id,
            communityId: inviteCode.communityId,
            childId: input.childId
          }
        }
      });

      return {
        result: "accepted",
        communityId: member.communityId,
        childId: member.childId,
        memberStatus: member.status
      };
    });
  }

  async confirmJoinByPrimaryGuardian(
    input: ConfirmJoinByPrimaryGuardianInput
  ): Promise<CommunityMemberTransitionResult> {
    const now = input.now ?? new Date();
    const primaryGuardian = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId: input.childId,
        role: "primary",
        status: "active",
        guardian: {
          userId: input.actorUserId,
          status: "active"
        }
      }
    });

    if (!primaryGuardian) {
      return {
        result: "rejected",
        errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communityMember.updateMany({
        where: {
          communityId: input.communityId,
          childId: input.childId,
          status: "pending_guardian"
        },
        data: {
          status: "pending_admin"
        }
      });

      if (updated.count !== 1) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
        };
      }

      const member = await tx.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: input.communityId,
            childId: input.childId
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "community_member.guardian_confirm",
          targetType: "community_member",
          targetId: member.id,
          afterJson: {
            confirmedAt: now.toISOString(),
            status: member.status
          }
        }
      });

      return {
        result: "accepted",
        communityId: member.communityId,
        childId: member.childId,
        memberStatus: member.status
      };
    });
  }

  async approveCommunityMember(
    input: ApproveCommunityMemberInput
  ): Promise<CommunityMemberTransitionResult> {
    const now = input.now ?? new Date();
    const community = await this.prisma.auctionCommunity.findUnique({
      where: {
        id: input.communityId
      }
    });

    if (!community || community.status !== "active") {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
      };
    }

    const creator = await this.prisma.guardianProfile.findUnique({
      where: {
        id: community.creatorGuardianId
      }
    });

    if (!creator || creator.userId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "COMMUNITY_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communityMember.updateMany({
        where: {
          communityId: input.communityId,
          childId: input.childId,
          status: "pending_admin"
        },
        data: {
          status: "active",
          joinedAt: now
        }
      });

      if (updated.count !== 1) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
        };
      }

      const member = await tx.communityMember.findUniqueOrThrow({
        where: {
          communityId_childId: {
            communityId: input.communityId,
            childId: input.childId
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "community_member.admin_approve",
          targetType: "community_member",
          targetId: member.id,
          afterJson: {
            approvedAt: now.toISOString(),
            status: member.status
          }
        }
      });

      return {
        result: "accepted",
        communityId: member.communityId,
        childId: member.childId,
        memberStatus: member.status
      };
    });
  }
}
