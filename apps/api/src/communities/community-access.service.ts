import type {
  CommunityMemberStatus,
  InviteCodeStatus,
  Prisma,
  PrismaClient,
  RosterVerificationStatus
} from "@prisma/client";
import { createHash } from "node:crypto";
import { RiskGovernanceService } from "../accounts/risk-governance.service.js";
import { CommunityAdminAuthorizationService } from "./community-admin-authorization.service.js";

const ABNORMAL_JOIN_ACTIVE_COMMUNITY_THRESHOLD = 2;

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
  actorUserId: string;
  childId: string;
  code: string;
  idempotencyKey: string;
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
        | "RISK_RESTRICTED"
        | "JOIN_ACTOR_NOT_AUTHORIZED"
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "IDEMPOTENCY_CONFLICT"
        | "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
        | "ROSTER_VERIFICATION_REQUIRED"
        | "GUARDIAN_DISPUTE_FROZEN";
    };

type CommunityMemberTransitionErrorCode = Extract<
  CommunityMemberTransitionResult,
  { result: "rejected" }
>["errorCode"];

type MemberReviewQueueRow = {
  key: string;
  communityId: string;
  childId: string;
  guardianId: string;
  memberStatus: CommunityMemberStatus;
  rosterVerificationStatus: RosterVerificationStatus;
  riskState: "clear" | "restricted";
  requestedAt: string;
};

type MemberReviewQueueAcceptedResult = {
  result: "accepted";
  members: MemberReviewQueueRow[];
};

export type ListMemberReviewQueueResult =
  | MemberReviewQueueAcceptedResult
  | {
      result: "rejected";
      errorCode: "PLATFORM_ADMIN_REQUIRED";
    };

export type ListScopedMemberReviewQueueResult =
  | {
      result: "accepted";
      members: MemberReviewQueueRow[];
    }
  | {
      result: "rejected";
      errorCode: "COMMUNITY_ADMIN_REQUIRED";
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

type JoinRequestIdempotencyReservation =
  | {
      result: "reserved";
      id: string;
    }
  | {
      result: "replay";
      response: CommunityMemberTransitionResult;
    }
  | {
      result: "conflict";
    };

export class CommunityAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuthorizations = new CommunityAdminAuthorizationService(
      prisma
    ),
    private readonly riskGovernance = new RiskGovernanceService(prisma)
  ) {}

  async listMemberReviewQueue(input: {
    platformAdminUserId: string;
    now?: Date;
  }): Promise<ListMemberReviewQueueResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return {
      result: "accepted",
      members: await this.listPendingMemberReviewRows({
        now
      })
    };
  }

  async listScopedMemberReviewQueue(input: {
    actorUserId: string;
    communityId: string;
    now?: Date;
  }): Promise<ListScopedMemberReviewQueueResult> {
    const now = input.now ?? new Date();
    const scopedAdmin =
      await this.adminAuthorizations.findActiveScopedActivityAdmin({
        actorUserId: input.actorUserId,
        communityId: input.communityId
      });
    if (scopedAdmin.result === "rejected") {
      return scopedAdmin;
    }

    return {
      result: "accepted",
      members: await this.listPendingMemberReviewRows({
        communityId: input.communityId,
        now
      })
    };
  }

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

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "community_invite_code.create",
          targetType: "community_invite_code",
          targetId: created.id,
          afterJson: {
            communityId: input.communityId,
            ruleVersionId: activeRuleVersion.id,
            codeHash: createStableHash({ code: input.code }),
            maxUses: input.maxUses ?? null,
            expiresAt: input.expiresAt?.toISOString() ?? null,
            status: created.status
          }
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

    if (!input.idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

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
      },
      select: {
        guardianId: true,
        child: {
          select: {
            userId: true
          }
        },
        guardian: {
          select: {
            userId: true
          }
        }
      }
    });

    if (!activePrimaryGuardian) {
      return {
        result: "rejected",
        errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
      };
    }

    const childActorUserId = activePrimaryGuardian.child.userId;
    if (
      input.actorUserId !== activePrimaryGuardian.guardian.userId &&
      input.actorUserId !== childActorUserId
    ) {
      return {
        result: "rejected",
        errorCode: "JOIN_ACTOR_NOT_AUTHORIZED"
      };
    }

    const requestHash = createStableHash({
      childId: input.childId,
      code: input.code
    });

    return this.prisma.$transaction(async (tx) => {
      await lockChild(tx, input.childId);

      const lockedPrimaryGuardian = await findActiveJoinPrimaryGuardian(
        tx,
        input.childId
      );
      if (!lockedPrimaryGuardian) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      const lockedChildActorUserId = lockedPrimaryGuardian.child.userId;
      if (
        input.actorUserId !== lockedPrimaryGuardian.guardian.userId &&
        input.actorUserId !== lockedChildActorUserId
      ) {
        return {
          result: "rejected",
          errorCode: "JOIN_ACTOR_NOT_AUTHORIZED"
        };
      }

      if (await hasFrozenGuardianDispute(tx, input.childId)) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_DISPUTE_FROZEN"
        };
      }

      const idempotency = await reserveIdempotencyRecord(tx, {
        key: input.idempotencyKey,
        actorUserId: input.actorUserId,
        action: "community_member.request_with_invite",
        targetType: "child_profile",
        targetId: input.childId,
        requestHash
      });

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const inviteCandidates = await tx.$queryRaw<InviteCodeCandidate[]>`
        SELECT "id", "communityId", "ruleVersionId"
        FROM "CommunityInviteCode"
        WHERE "code" = ${input.code}
          AND "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      `;
      const inviteCandidate = inviteCandidates[0];

      if (!inviteCandidate) {
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        });
      }

      if (
        !(await isCommunityOpenForAdmission(tx, inviteCandidate.communityId))
      ) {
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
        });
      }

      if (!inviteCandidate.ruleVersionId) {
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        });
      }

      if (
        await hasActiveJoinRiskRestriction(tx, {
          childId: input.childId,
          primaryGuardianId: lockedPrimaryGuardian.guardianId,
          primaryGuardianUserId: lockedPrimaryGuardian.guardian.userId,
          communityId: inviteCandidate.communityId,
          now
        })
      ) {
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "RISK_RESTRICTED"
        });
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
        if (
          existingMember.status === "removed" ||
          existingMember.status === "banned"
        ) {
          return completeIdempotentJoinRequest(tx, idempotency.id, {
            result: "rejected",
            errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
          });
        }

        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "accepted",
          communityId: existingMember.communityId,
          childId: existingMember.childId,
          memberStatus: existingMember.status
        });
      }

      if (
        await this.recordAbnormalJoinRiskIfNeeded(tx, {
          childId: input.childId,
          attemptedCommunityId: inviteCandidate.communityId,
          now
        })
      ) {
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "RISK_RESTRICTED"
        });
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
        return completeIdempotentJoinRequest(tx, idempotency.id, {
          result: "rejected",
          errorCode: "INVITE_CODE_UNAVAILABLE"
        });
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
          actorUserId: input.actorUserId,
          action: "community_member.request_with_invite",
          targetType: "community_member",
          targetId: member.id,
          afterJson: {
            inviteCodeId: inviteCode.id,
            communityId: inviteCode.communityId,
            childId: input.childId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            requestedAt: now.toISOString()
          }
        }
      });

      return completeIdempotentJoinRequest(tx, idempotency.id, {
        result: "accepted",
        communityId: member.communityId,
        childId: member.childId,
        memberStatus: member.status
      });
    });
  }

  private async recordAbnormalJoinRiskIfNeeded(
    tx: Prisma.TransactionClient,
    input: {
      childId: string;
      attemptedCommunityId: string;
      now: Date;
    }
  ): Promise<boolean> {
    const activeCommunityCount = await tx.communityMember.count({
      where: {
        childId: input.childId,
        status: "active",
        communityId: {
          not: input.attemptedCommunityId
        },
        community: {
          status: "active"
        }
      }
    });

    if (activeCommunityCount < ABNORMAL_JOIN_ACTIVE_COMMUNITY_THRESHOLD) {
      return false;
    }

    await this.riskGovernance.recordRiskSignalInTransaction(
      tx,
      {
        type: "abnormal_join_pattern",
        scope: "child",
        targetId: input.childId,
        evidenceJson: {
          source: "community_member.request_with_invite",
          activeCommunityCount,
          attemptedCommunityId: input.attemptedCommunityId,
          threshold: ABNORMAL_JOIN_ACTIVE_COMMUNITY_THRESHOLD
        },
        now: input.now
      },
      input.now
    );

    return true;
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
      await lockChild(tx, input.childId);

      const primaryGuardian = await findActivePrimaryGuardian(tx, input.childId);
      if (!primaryGuardian || primaryGuardian.guardian.userId !== input.actorUserId) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      if (await hasFrozenGuardianDispute(tx, input.childId)) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_DISPUTE_FROZEN"
        };
      }

      if (
        await hasActiveJoinRiskRestriction(tx, {
          childId: input.childId,
          primaryGuardianId: primaryGuardian.guardianId,
          primaryGuardianUserId: primaryGuardian.guardian.userId,
          communityId: input.communityId,
          now
        })
      ) {
        return {
          result: "rejected",
          errorCode: "RISK_RESTRICTED"
        };
      }

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
      await lockCommunity(tx, input.communityId);
      await lockChild(tx, input.childId);

      const lockedCommunity = await tx.auctionCommunity.findUnique({
        where: {
          id: input.communityId
        },
        select: {
          status: true
        }
      });
      if (!lockedCommunity || lockedCommunity.status !== "active") {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_MEMBER_STATE_INVALID"
        };
      }

      const scopedAdmin = await findActiveScopedActivityAdmin(
        tx,
        input.actorUserId,
        input.communityId
      );
      if (!scopedAdmin) {
        return {
          result: "rejected",
          errorCode: "COMMUNITY_ADMIN_REQUIRED"
        };
      }

      const primaryGuardian = await findActivePrimaryGuardian(tx, input.childId);
      if (!primaryGuardian) {
        return {
          result: "rejected",
          errorCode: "ACTIVE_PRIMARY_GUARDIAN_REQUIRED"
        };
      }

      if (await hasFrozenGuardianDispute(tx, input.childId)) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_DISPUTE_FROZEN"
        };
      }

      if (
        await hasActiveJoinRiskRestriction(tx, {
          childId: input.childId,
          primaryGuardianId: primaryGuardian.guardianId,
          primaryGuardianUserId: primaryGuardian.guardian.userId,
          communityId: input.communityId,
          now
        })
      ) {
        return {
          result: "rejected",
          errorCode: "RISK_RESTRICTED"
        };
      }

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
          ...(input.status === "rejected" ? { status: "removed" as const } : {}),
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
            evidenceAudit: summarizeEvidenceForAudit(input.evidenceJson),
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

  private async listPendingMemberReviewRows(input: {
    communityId?: string;
    now: Date;
  }): Promise<MemberReviewQueueRow[]> {
    const where: Prisma.CommunityMemberWhereInput = {
      status: "pending_admin"
    };
    if (input.communityId) {
      where.communityId = input.communityId;
    }

    const members = await this.prisma.communityMember.findMany({
      where,
      orderBy: [
        {
          guardianConfirmedAt: "asc"
        },
        {
          communityId: "asc"
        },
        {
          childId: "asc"
        }
      ],
      take: 100,
      include: {
        child: {
          select: {
            guardianLinks: {
              where: {
                role: "primary",
                status: "active"
              },
              select: {
                guardianId: true,
                guardian: {
                  select: {
                    userId: true
                  }
                }
              },
              take: 1
            }
          }
        }
      }
    });

    return Promise.all(
      members.map(async (member) => {
        const primaryGuardian = member.child.guardianLinks[0];
        const riskRestricted = primaryGuardian
          ? await hasActiveJoinRiskRestriction(this.prisma, {
              childId: member.childId,
              primaryGuardianId: primaryGuardian.guardianId,
              primaryGuardianUserId: primaryGuardian.guardian.userId,
              communityId: member.communityId,
              now: input.now
            })
          : true;

        return {
          key: member.id,
          communityId: member.communityId,
          childId: member.childId,
          guardianId: primaryGuardian?.guardianId ?? "",
          memberStatus: member.status,
          rosterVerificationStatus: member.rosterVerificationStatus,
          riskState: riskRestricted ? ("restricted" as const) : ("clear" as const),
          requestedAt: member.guardianConfirmedAt?.toISOString() ?? ""
        };
      })
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

async function reserveIdempotencyRecord(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  }
): Promise<JoinRequestIdempotencyReservation> {
  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      key_actorUserId_action_targetType_targetId: {
        key: input.key,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId
      }
    },
    select: {
      id: true,
      requestHash: true,
      status: true,
      responseJson: true
    }
  });

  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      return {
        result: "conflict"
      };
    }

    const response = parseCommunityMemberTransitionResult(
      existing.responseJson
    );
    if (existing.status === "completed" && response) {
      return {
        result: "replay",
        response
      };
    }

    return {
      result: "conflict"
    };
  }

  const created = await tx.idempotencyRecord.create({
    data: {
      key: input.key,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestHash: input.requestHash,
      status: "processing"
    },
    select: {
      id: true
    }
  });

  return {
    result: "reserved",
    id: created.id
  };
}

async function completeIdempotentJoinRequest(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: CommunityMemberTransitionResult
): Promise<CommunityMemberTransitionResult> {
  await tx.idempotencyRecord.update({
    where: {
      id: idempotencyRecordId
    },
    data: {
      status: "completed",
      responseJson: response
    }
  });

  return response;
}

function parseCommunityMemberTransitionResult(
  value: Prisma.JsonValue | null
): CommunityMemberTransitionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (response.result === "accepted") {
    return typeof response.communityId === "string" &&
      typeof response.childId === "string" &&
      typeof response.memberStatus === "string"
      ? {
          result: "accepted",
          communityId: response.communityId,
          childId: response.childId,
          memberStatus: response.memberStatus as CommunityMemberStatus
        }
      : null;
  }

  if (response.result === "rejected" && typeof response.errorCode === "string") {
    return {
      result: "rejected",
      errorCode: response.errorCode as CommunityMemberTransitionErrorCode
    };
  }

  return null;
}

function createStableHash(value: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function summarizeEvidenceForAudit(value: Prisma.InputJsonValue) {
  return {
    recorded: true,
    kind: Array.isArray(value) ? "array" : typeof value,
    sha256: createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")
  };
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

async function findActiveJoinPrimaryGuardian(
  tx: Prisma.TransactionClient,
  childId: string
) {
  return tx.guardianChildLink.findFirst({
    where: {
      childId,
      role: "primary",
      status: "active",
      child: {
        status: "active"
      },
      guardian: {
        status: "active"
      }
    },
    select: {
      guardianId: true,
      child: {
        select: {
          userId: true
        }
      },
      guardian: {
        select: {
          userId: true
        }
      }
    }
  });
}

async function findActivePrimaryGuardian(
  tx: Prisma.TransactionClient,
  childId: string
) {
  return tx.guardianChildLink.findFirst({
    where: {
      childId,
      role: "primary",
      status: "active",
      guardian: {
        status: "active"
      }
    },
    select: {
      guardianId: true,
      guardian: {
        select: {
          userId: true
        }
      }
    }
  });
}

async function hasFrozenGuardianDispute(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<boolean> {
  const dispute = await tx.guardianDispute.findFirst({
    where: {
      childId,
      status: {
        in: ["pending_platform_review", "frozen"]
      }
    },
    select: {
      id: true
    }
  });

  return Boolean(dispute);
}

async function hasActiveJoinRiskRestriction(
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    childId: string;
    primaryGuardianId: string;
    primaryGuardianUserId: string;
    communityId: string;
    now: Date;
  }
) {
  const restriction = await tx.riskRestriction.findFirst({
    where: {
      status: "active",
      type: {
        in: ["suspended", "no_join"]
      },
      startsAt: {
        lte: input.now
      },
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }]
        },
        {
          OR: [
            {
              scope: "child",
              targetId: input.childId
            },
            {
              scope: "guardian",
              targetId: input.primaryGuardianId
            },
            {
              scope: "user",
              targetId: input.primaryGuardianUserId
            },
            {
              scope: "community",
              targetId: input.communityId
            },
            {
              scope: "community_member",
              childId: input.childId,
              communityId: input.communityId
            }
          ]
        }
      ]
    },
    select: {
      id: true
    }
  });

  return Boolean(restriction);
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
