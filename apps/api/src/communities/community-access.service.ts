import type {
  CommunityMemberStatus,
  InviteCodeStatus,
  Prisma,
  PrismaClient,
  RosterVerificationStatus
} from "@prisma/client";
import { CommunityAdminAuthorizationService } from "./community-admin-authorization.service.js";

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
        | "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
        | "COMMUNITY_ADMIN_REQUIRED"
        | "INVITE_MAX_USES_INVALID"
        | "ACTIVE_RULE_VERSION_REQUIRED";
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
        | "COMMUNITY_ADMIN_REQUIRED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
        | "ROSTER_VERIFICATION_REQUIRED";
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

export type RecordRosterVerificationInput = {
  actorUserId: string;
  communityId: string;
  childId: string;
  status: RosterVerificationStatus;
  evidenceJson: Prisma.InputJsonValue;
  now?: Date;
};

type ConsumedInviteCode = {
  id: string;
  communityId: string;
  ruleVersionId: string | null;
};

type InviteCodeCandidate = {
  id: string;
  communityId: string;
  ruleVersionId: string | null;
};

export class CommunityAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuthorizations = new CommunityAdminAuthorizationService(
      prisma
    )
  ) {}

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

    const inviteCode = await this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, input.communityId);

      const admission = await isCommunityOpenForAdmission(tx, input.communityId);
      if (!admission) {
        const community = await tx.auctionCommunity.findUnique({
          where: {
            id: input.communityId
          },
          select: {
            status: true
          }
        });

        const errorCode:
          | "COMMUNITY_NOT_ACTIVE"
          | "COMMUNITY_NOT_OPEN_FOR_ADMISSION" =
          !community || community.status !== "active"
            ? "COMMUNITY_NOT_ACTIVE"
            : "COMMUNITY_NOT_OPEN_FOR_ADMISSION";

        return {
          result: "rejected" as const,
          errorCode
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

      const activeRuleVersion = await findSingleActiveRuleVersion(
        tx,
        input.communityId
      );
      if (!activeRuleVersion) {
        return {
          result: "rejected" as const,
          errorCode: "ACTIVE_RULE_VERSION_REQUIRED" as const
        };
      }

      const created = await tx.communityInviteCode.create({
        data: {
          communityId: input.communityId,
          ruleVersionId: activeRuleVersion.id,
          code: input.code,
          maxUses: input.maxUses,
          expiresAt: input.expiresAt,
          status: "active"
        }
      });

      return {
        result: "accepted" as const,
        inviteCodeId: created.id,
        code: created.code,
        status: created.status
      };
    });

    if (inviteCode.result === "rejected") {
      return inviteCode;
    }

    return {
      result: "accepted",
      inviteCodeId: inviteCode.inviteCodeId,
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
      await lockChild(tx, input.childId);

      const inviteCandidates = await tx.$queryRaw<InviteCodeCandidate[]>`
        SELECT "id", "communityId", "ruleVersionId"
        FROM "CommunityInviteCode"
        WHERE "code" = ${input.code}
          AND "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      `;
      const inviteCandidate = inviteCandidates[0];

      if (!inviteCandidate) {
        return {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        };
      }

      if (
        !(await isCommunityOpenForAdmission(tx, inviteCandidate.communityId))
      ) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
        };
      }

      if (!inviteCandidate.ruleVersionId) {
        return {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        };
      }

      const existingMember = await tx.communityMember.findUnique({
        where: {
          communityId_childId: {
            communityId: inviteCandidate.communityId,
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

      const inviteCodes = await tx.$queryRaw<ConsumedInviteCode[]>`
        UPDATE "CommunityInviteCode"
        SET "usedCount" = "usedCount" + 1
        WHERE "id" = ${inviteCandidate.id}
          AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
        RETURNING "id", "communityId", "ruleVersionId"
      `;
      const inviteCode = inviteCodes[0];

      if (!inviteCode) {
        return {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        };
      }

      const member = await tx.communityMember.create({
        data: {
          communityId: inviteCode.communityId,
          childId: input.childId,
          inviteCodeId: inviteCode.id,
          ruleVersionId: inviteCode.ruleVersionId,
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
          status: "pending_admin",
          guardianConfirmedAt: now
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

    const scopedAdmin =
      await this.adminAuthorizations.findActiveScopedActivityAdmin({
        actorUserId: input.actorUserId,
        communityId: community.id
      });
    if (scopedAdmin.result === "rejected") {
      return scopedAdmin;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.communityMember.updateMany({
        where: {
          communityId: input.communityId,
          childId: input.childId,
          status: "pending_admin",
          rosterVerificationStatus: {
            in: ["matched", "manual_exception"]
          }
        },
        data: {
          status: "active",
          adminReviewedByUserId: input.actorUserId,
          adminReviewedAt: now,
          joinedAt: now
        }
      });

      if (updated.count !== 1) {
        return {
          result: "rejected",
          errorCode: "ROSTER_VERIFICATION_REQUIRED"
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
            rosterVerificationStatus: member.rosterVerificationStatus,
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

  async recordRosterVerification(
    input: RecordRosterVerificationInput
  ): Promise<CommunityMemberTransitionResult> {
    const now = input.now ?? new Date();
    if (input.status === "manual_exception") {
      if (!(await this.isActiveMfaPlatformAdmin(input.actorUserId))) {
        return {
          result: "rejected",
          errorCode: "PLATFORM_ADMIN_REQUIRED"
        };
      }
    } else {
      const scopedAdmin =
        await this.adminAuthorizations.findActiveScopedActivityAdmin({
          actorUserId: input.actorUserId,
          communityId: input.communityId
        });
      if (scopedAdmin.result === "rejected") {
        return scopedAdmin;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.status === "manual_exception") {
        await lockCommunity(tx, input.communityId);
      } else if (
        !(await findActiveScopedActivityAdmin(
          tx,
          input.actorUserId,
          input.communityId
        ))
      ) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_ADMIN_REQUIRED"
        };
      }

      const updated = await tx.communityMember.updateMany({
        where: {
          communityId: input.communityId,
          childId: input.childId,
          status: "pending_admin"
        },
        data: {
          rosterVerificationStatus: input.status,
          rosterEvidenceJson: input.evidenceJson
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
          action: "community_member.record_roster_verification",
          targetType: "community_member",
          targetId: member.id,
          afterJson: {
            status: member.status,
            rosterVerificationStatus: member.rosterVerificationStatus,
            evidenceJson: input.evidenceJson,
            recordedAt: now.toISOString()
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

async function lockChild(tx: Prisma.TransactionClient, childId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ChildProfile"
    WHERE "id" = ${childId}
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

async function findSingleActiveRuleVersion(
  tx: Prisma.TransactionClient,
  communityId: string
) {
  const activeRuleVersions = await tx.communityRuleVersion.findMany({
    where: {
      communityId,
      status: "active"
    },
    orderBy: {
      versionNo: "desc"
    },
    take: 2
  });

  return activeRuleVersions.length === 1 ? activeRuleVersions[0] : null;
}

async function isCommunityOpenForAdmission(
  tx: Prisma.TransactionClient,
  communityId: string
): Promise<boolean> {
  const community = await tx.auctionCommunity.findUnique({
    where: {
      id: communityId
    },
    select: {
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

  return Boolean(
    community &&
      community.status === "active" &&
      community.adminScopes.length > 0
  );
}
