import type {
  GovernanceControlScopeType,
  GovernanceControlType,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { GOVERNANCE_CONTROL_CHALLENGE_TARGET_TYPE } from "../accounts/sensitive-operation.service.js";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const GovernanceControlSensitiveTargetType =
  GOVERNANCE_CONTROL_CHALLENGE_TARGET_TYPE;

export type GovernanceControlBlockResult =
  | {
      result: "clear";
    }
  | {
      result: "blocked";
      controlId: string;
      controlType: GovernanceControlType;
      scopeType: GovernanceControlScopeType;
      scopeId: string | null;
    };

export class GovernanceControlService {
  constructor(private readonly prisma: PrismaClient) {}

  async checkActiveControl(
    input: {
      controlType: GovernanceControlType;
      communityId?: string | null;
      now?: Date;
    },
    executor: PrismaExecutor = this.prisma
  ): Promise<GovernanceControlBlockResult> {
    const now = input.now ?? new Date();
    const control = await executor.governanceControl.findFirst({
      where: activeGovernanceControlWhere({
        controlType: input.controlType,
        communityId: input.communityId,
        now
      }),
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
        controlType: true
      }
    });

    return control
      ? {
          result: "blocked",
          controlId: control.id,
          controlType: control.controlType,
          scopeType: control.scopeType,
          scopeId: control.scopeId
        }
      : {
          result: "clear"
        };
  }
}

export function governanceControlChallengeTargetId(input: {
  scopeType: GovernanceControlScopeType;
  scopeId?: string | null;
}) {
  return input.scopeType === "platform" ? "platform" : input.scopeId ?? "";
}

export function activeGovernanceControlWhere(input: {
  controlType: GovernanceControlType;
  communityId?: string | null;
  now: Date;
}): Prisma.GovernanceControlWhereInput {
  return {
    status: "active",
    controlType: input.controlType,
    startsAt: {
      lte: input.now
    },
    OR: [
      {
        endsAt: null
      },
      {
        endsAt: {
          gt: input.now
        }
      }
    ],
    AND: [
      {
        OR: [
          {
            scopeType: "platform",
            scopeId: null
          },
          ...(input.communityId
            ? [
                {
                  scopeType: "community" as const,
                  scopeId: input.communityId
                }
              ]
            : [])
        ]
      }
    ]
  };
}
