import type {
  CommunityCreationRequestStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import {
  getChallengeSessionId,
  SensitiveOperationService,
  SensitiveOperationType
} from "../accounts/sensitive-operation.service.js";

export type SubmitCreationRequestResult =
  | {
      result: "accepted";
      requestId: string;
      requestStatus: CommunityCreationRequestStatus;
    }
  | {
      result: "rejected";
      errorCode:
        | "GUARDIAN_NOT_ACTIVE"
        | "GUARDIAN_NOT_OWNED_BY_ACTOR"
        | "GUARDIAN_DISPUTE_FROZEN"
        | "EXPECTED_CHILD_COUNT_INVALID"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SESSION_REVOKED"
        | "RISK_RESTRICTED";
    };

export type ReviewCreationRequestResult =
  | {
      result: "accepted";
      requestId: string;
      requestStatus: CommunityCreationRequestStatus;
      communityId: string | null;
    }
  | {
      result: "rejected";
      errorCode:
        | "PLATFORM_ADMIN_REQUIRED"
        | "CREATION_REQUEST_NOT_FOUND"
        | "CREATION_REQUEST_STATE_INVALID"
        | "DEFAULT_AUCTION_DURATION_INVALID";
    };

export class CommunityApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sensitiveOperations: SensitiveOperationService
  ) {}

  async submitCreationRequest(input: {
    actorUserId: string;
    sessionId: string;
    guardianId: string;
    name: string;
    description?: string;
    gradeBand: string;
    expectedChildCount: number;
    ruleDraftJson: Prisma.InputJsonValue;
    challengeId: string;
    now?: Date;
  }): Promise<SubmitCreationRequestResult> {
    const now = input.now ?? new Date();
    if (
      !Number.isInteger(input.expectedChildCount) ||
      input.expectedChildCount <= 0
    ) {
      return {
        result: "rejected",
        errorCode: "EXPECTED_CHILD_COUNT_INVALID"
      };
    }

    const guardian = await this.prisma.guardianProfile.findUnique({
      where: {
        id: input.guardianId
      },
      select: {
        userId: true,
        status: true
      }
    });

    if (!guardian || guardian.status !== "active") {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_NOT_ACTIVE"
      };
    }

    if (guardian.userId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_NOT_OWNED_BY_ACTOR"
      };
    }

    const challengeCheck = await this.assertFreshCreationChallenge({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      guardianId: input.guardianId,
      challengeId: input.challengeId,
      now
    });
    if (challengeCheck.result === "rejected") {
      return challengeCheck;
    }

    const authorization = await this.sensitiveOperations.authorize({
      actorUserId: input.actorUserId,
      operationType: SensitiveOperationType.createCommunity,
      targetType: "guardian_profile",
      targetId: input.guardianId,
      sessionId: input.sessionId,
      now
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    if (await this.hasFrozenChildForGuardian(input.guardianId)) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_DISPUTE_FROZEN"
      };
    }

    const request = await this.prisma.communityCreationRequest.create({
      data: {
        applicantGuardianId: input.guardianId,
        requestedName: input.name,
        requestedDescription: input.description,
        requestedGradeBand: input.gradeBand,
        expectedMemberSize: input.expectedChildCount,
        ruleDraftJson: input.ruleDraftJson,
        status: "pending_review"
      }
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "community_creation_request.submit",
        targetType: "community_creation_request",
        targetId: request.id,
        afterJson: {
          guardianId: input.guardianId,
          requestedName: input.name,
          expectedChildCount: input.expectedChildCount,
          challengeId: input.challengeId
        }
      }
    });

    return {
      result: "accepted",
      requestId: request.id,
      requestStatus: request.status
    };
  }

  async approveCreationRequest(input: {
    platformAdminUserId: string;
    requestId: string;
    defaultAuctionDurationMinutes: number;
    now?: Date;
  }): Promise<ReviewCreationRequestResult> {
    const now = input.now ?? new Date();
    if (
      !Number.isInteger(input.defaultAuctionDurationMinutes) ||
      input.defaultAuctionDurationMinutes <= 0
    ) {
      return {
        result: "rejected",
        errorCode: "DEFAULT_AUCTION_DURATION_INVALID"
      };
    }

    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCreationRequest(tx, input.requestId);

      const request = await tx.communityCreationRequest.findUnique({
        where: {
          id: input.requestId
        }
      });

      if (!request) {
        return {
          result: "rejected",
          errorCode: "CREATION_REQUEST_NOT_FOUND"
        };
      }

      if (request.status !== "pending_review") {
        return {
          result: "rejected",
          errorCode: "CREATION_REQUEST_STATE_INVALID"
        };
      }

      const community = await tx.auctionCommunity.create({
        data: {
          name: request.requestedName,
          description: request.requestedDescription,
          creatorGuardianId: request.applicantGuardianId,
          status: "active",
          defaultAuctionDurationMinutes: input.defaultAuctionDurationMinutes
        }
      });

      await tx.communityRuleVersion.create({
        data: {
          communityId: community.id,
          versionNo: 1,
          status: "active",
          rulesJson: request.ruleDraftJson as Prisma.InputJsonValue,
          effectiveAt: now
        }
      });

      const updated = await tx.communityCreationRequest.update({
        where: {
          id: input.requestId
        },
        data: {
          status: "approved",
          reviewedByUserId: input.platformAdminUserId,
          reviewedAt: now,
          approvedCommunityId: community.id
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "community_creation_request.approve",
          targetType: "community_creation_request",
          targetId: updated.id,
          afterJson: {
            communityId: community.id,
            defaultAuctionDurationMinutes: input.defaultAuctionDurationMinutes,
            reviewedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        requestId: updated.id,
        requestStatus: updated.status,
        communityId: community.id
      };
    });
  }

  async rejectCreationRequest(input: {
    platformAdminUserId: string;
    requestId: string;
    reason: string;
    now?: Date;
  }): Promise<ReviewCreationRequestResult> {
    const now = input.now ?? new Date();
    if (!(await this.isActiveMfaPlatformAdmin(input.platformAdminUserId))) {
      return {
        result: "rejected",
        errorCode: "PLATFORM_ADMIN_REQUIRED"
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCreationRequest(tx, input.requestId);

      const request = await tx.communityCreationRequest.findUnique({
        where: {
          id: input.requestId
        }
      });

      if (!request) {
        return {
          result: "rejected",
          errorCode: "CREATION_REQUEST_NOT_FOUND"
        };
      }

      if (request.status !== "pending_review") {
        return {
          result: "rejected",
          errorCode: "CREATION_REQUEST_STATE_INVALID"
        };
      }

      const updated = await tx.communityCreationRequest.update({
        where: {
          id: input.requestId
        },
        data: {
          status: "rejected",
          reviewedByUserId: input.platformAdminUserId,
          reviewedAt: now,
          reviewNotes: input.reason
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "community_creation_request.reject",
          targetType: "community_creation_request",
          targetId: updated.id,
          reason: input.reason,
          afterJson: {
            reviewedAt: now.toISOString()
          }
        }
      });

      return {
        result: "accepted",
        requestId: updated.id,
        requestStatus: updated.status,
        communityId: null
      };
    });
  }

  private async assertFreshCreationChallenge(input: {
    actorUserId: string;
    sessionId: string;
    guardianId: string;
    challengeId: string;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED" | "SENSITIVE_CHALLENGE_EXPIRED";
      }
  > {
    const challenge = await this.prisma.sensitiveOperationChallenge.findUnique({
      where: {
        id: input.challengeId
      }
    });

    if (
      !challenge ||
      challenge.actorUserId !== input.actorUserId ||
      challenge.operation !== SensitiveOperationType.createCommunity ||
      getChallengeSessionId(challenge.riskLabelsJson) !== input.sessionId ||
      challenge.targetType !== "guardian_profile" ||
      challenge.targetId !== input.guardianId
    ) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    const expired = challenge.expiresAt.getTime() <= input.now.getTime();
    if (expired || challenge.status === "expired") {
      if (expired && challenge.status !== "expired") {
        await this.prisma.sensitiveOperationChallenge.updateMany({
          where: {
            id: challenge.id,
            status: {
              in: ["pending", "passed", "cooling_down"]
            }
          },
          data: {
            status: "expired"
          }
        });
      }

      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
      };
    }

    if (challenge.status !== "passed") {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED"
      };
    }

    return {
      result: "accepted"
    };
  }

  private async hasFrozenChildForGuardian(guardianId: string): Promise<boolean> {
    const frozenDispute = await this.prisma.guardianDispute.findFirst({
      where: {
        status: "frozen",
        child: {
          guardianLinks: {
            some: {
              guardianId,
              status: "active"
            }
          }
        }
      },
      select: {
        id: true
      }
    });

    return Boolean(frozenDispute);
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

async function lockCreationRequest(
  tx: Prisma.TransactionClient,
  requestId: string
) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CommunityCreationRequest"
    WHERE "id" = ${requestId}
    FOR UPDATE
  `;
}
