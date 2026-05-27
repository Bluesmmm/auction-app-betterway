export const HighRiskAdminOperation = {
  exportChildData: "export_child_data",
  pauseCommunity: "pause_community",
  forceDelist: "force_delist",
  adjustPoints: "adjust_points",
  adjustAuctionEndTime: "adjust_auction_end_time"
} as const;

export type HighRiskAdminOperation =
  (typeof HighRiskAdminOperation)[keyof typeof HighRiskAdminOperation];

export type AuthorizeHighRiskOperationInput = {
  actorUserId: string;
  operation: HighRiskAdminOperation;
  mfaEnabled: boolean;
  challengeVerifiedAt?: Date;
  now?: Date;
  challengeTtlSeconds?: number;
};

export type AuthorizeHighRiskOperationResult =
  | {
      result: "accepted";
      actorUserId: string;
      operation: HighRiskAdminOperation;
      challengeRequired: false;
    }
  | {
      result: "rejected";
      errorCode: "MFA_REQUIRED" | "SENSITIVE_CHALLENGE_REQUIRED";
      challengeRequired: true;
    };

export class AdminSecurityService {
  authorizeHighRiskOperation(
    input: AuthorizeHighRiskOperationInput
  ): AuthorizeHighRiskOperationResult {
    if (!input.mfaEnabled) {
      return {
        result: "rejected",
        errorCode: "MFA_REQUIRED",
        challengeRequired: true
      };
    }

    if (!input.challengeVerifiedAt) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED",
        challengeRequired: true
      };
    }

    const now = input.now ?? new Date();
    const ttlMs = (input.challengeTtlSeconds ?? 300) * 1000;
    const challengeAgeMs = now.getTime() - input.challengeVerifiedAt.getTime();

    if (challengeAgeMs < 0 || challengeAgeMs > ttlMs) {
      return {
        result: "rejected",
        errorCode: "SENSITIVE_CHALLENGE_REQUIRED",
        challengeRequired: true
      };
    }

    return {
      result: "accepted",
      actorUserId: input.actorUserId,
      operation: input.operation,
      challengeRequired: false
    };
  }
}
