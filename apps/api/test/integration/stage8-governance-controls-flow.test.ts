import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BiddingService } from "../../src/auctions/bidding.service.js";
import { TransactionDecisionService } from "../../src/auctions/transaction-decision.service.js";
import { ContentReviewService } from "../../src/content/content-review.service.js";
import { GovernanceControlService } from "../../src/stage8/governance-control.service.js";
import { HighRiskGovernanceReviewService } from "../../src/stage8/high-risk-governance-review.service.js";
import { Stage8GovernanceService } from "../../src/stage8/stage8-governance.service.js";
import { SensitiveOperationType } from "../../src/accounts/sensitive-operation.service.js";
import type { ChildParticipationService } from "../../src/accounts/child-participation.service.js";
import type { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import type { ContentSafetyProvider } from "../../src/providers/provider-contracts.js";
import type { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";

const databaseUrl = requireIsolatedDatabaseUrl();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const governanceControls = new GovernanceControlService(prisma);
const sensitiveOperations = {
  authorizeFreshChallenge: vi.fn(async (input) => ({
    result: "accepted" as const,
    actorUserId: input.actorUserId,
    operationType: input.operationType,
    targetType: input.targetType,
    targetId: input.targetId,
    challengeId: input.challengeId ?? "challenge"
  }))
} as unknown as SensitiveOperationService;
const governance = new Stage8GovernanceService(prisma, sensitiveOperations);
const highRiskGovernanceReview = new HighRiskGovernanceReviewService(
  prisma,
  sensitiveOperations
);
const governanceWithReview = new Stage8GovernanceService(
  prisma,
  sensitiveOperations,
  highRiskGovernanceReview
);
const bidding = new BiddingService(prisma, governanceControls);
const transactions = new TransactionDecisionService(
  prisma,
  undefined,
  governanceControls
);
const participation = {
  evaluateChildParticipation: vi.fn(async () => ({
    result: "accepted" as const
  }))
} as unknown as ChildParticipationService;
const adminAuthorizations = {
  findActiveScopedActivityAdmin: vi.fn(async () => ({
    result: "accepted" as const
  }))
} as unknown as CommunityAdminAuthorizationService;
const contentReview = new ContentReviewService(
  prisma,
  participation,
  adminAuthorizations,
  {} as ContentSafetyProvider,
  governanceControls
);
const targetPrefix = "stage8_controls_";
const highRiskCleanupPrisma = prisma as unknown as PrismaClient & {
  highRiskGovernanceReviewEvent: {
    count(args: unknown): Promise<number>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  highRiskGovernanceReviewRequest: {
    create(args: unknown): Promise<{ id: string }>;
    findUnique(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
};

function unique(label: string) {
  return `${targetPrefix}${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createChallengeGate(expectedCalls: number) {
  let callCount = 0;
  let readyResolve!: () => void;
  let releaseResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });

  return {
    authorize: async (
      input: Parameters<SensitiveOperationService["authorizeFreshChallenge"]>[0]
    ) => {
      callCount += 1;
      if (callCount === expectedCalls) {
        readyResolve();
      }
      await released;
      return {
        result: "accepted" as const,
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: input.challengeId ?? "challenge"
      };
    },
    release() {
      releaseResolve();
    },
    async waitUntilReady() {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("challenge gate did not receive both calls")),
              1000
            );
          })
        ]);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
  };
}

function createPrismaThatLiftsControlAfterRead(input: {
  controlId: string;
  liftedByUserId: string;
  liftedAt: Date;
}) {
  let lifted = false;
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "governanceControl") {
        return typeof value === "function" ? value.bind(target) : value;
      }

      return new Proxy(value, {
        get(delegateTarget, delegateProp, delegateReceiver) {
          const delegateValue = Reflect.get(
            delegateTarget,
            delegateProp,
            delegateReceiver
          );
          if (delegateProp !== "findUnique") {
            return typeof delegateValue === "function"
              ? delegateValue.bind(delegateTarget)
              : delegateValue;
          }

          return async (...args: unknown[]) => {
            const result = await Reflect.apply(delegateValue, delegateTarget, args);
            const query = args[0] as { where?: { id?: string } } | undefined;
            if (
              !lifted &&
              query?.where?.id === input.controlId &&
              result &&
              typeof result === "object" &&
              "status" in result &&
              result.status === "active"
            ) {
              lifted = true;
              await prisma.governanceControl.update({
                where: {
                  id: input.controlId
                },
                data: {
                  status: "lifted",
                  liftedByUserId: input.liftedByUserId,
                  liftedAt: input.liftedAt,
                  liftReason: "concurrent lift"
                }
              });
            }
            return result;
          };
        }
      });
    }
  }) as PrismaClient;
}

describe("Stage8 governance controls", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(sensitiveOperations.authorizeFreshChallenge).mockImplementation(
      async (input) => ({
        result: "accepted" as const,
        actorUserId: input.actorUserId,
        operationType: input.operationType,
        targetType: input.targetType,
        targetId: input.targetId,
        challengeId: input.challengeId ?? "challenge"
      })
    );
    await cleanup();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    await cleanup();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("previews, creates, rejects duplicates, emits evidence, lifts, and recreates", async () => {
    const community = await createCommunity("create_lift");
    const admin = await createAdmin("platform", "platform_admin", true);
    const now = new Date("2026-06-10T13:00:00.000Z");

    const preview = await governance.createGovernanceControlPreview({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      reason: "suspicious bidding burst",
      now
    });
    expect(preview).toMatchObject({
      result: "accepted",
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      mutatesBusinessState: false
    });
    if (preview.result !== "accepted") {
      throw new Error("expected preview to be accepted");
    }

    const created = await governance.createGovernanceControl({
      actorUserId: admin.userId,
      sessionId: "session_1",
      challengeId: "challenge_1",
      previewId: preview.previewId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      reason: "suspicious bidding burst",
      now
    });
    expect(created).toMatchObject({
      result: "accepted",
      control: {
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_bid",
        status: "active",
        effective: true
      }
    });
    if (created.result !== "accepted") {
      throw new Error("expected governance control creation to succeed");
    }
    expect(sensitiveOperations.authorizeFreshChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: SensitiveOperationType.manageGovernanceControl,
        targetType: "governance_control_scope",
        targetId: community.id
      })
    );

    await expect(
      governance.createGovernanceControl({
        actorUserId: admin.userId,
        sessionId: "session_1",
        challengeId: "challenge_1",
        previewId: preview.previewId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_bid",
        reason: "duplicate",
        now
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PREVIEW_ALREADY_CONSUMED"
    });

    const duplicatePreview = await governance.createGovernanceControlPreview({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      reason: "new preview while the same control is active",
      now: new Date("2026-06-10T13:01:00.000Z")
    });
    if (duplicatePreview.result !== "accepted") {
      throw new Error("expected duplicate preview to be accepted");
    }
    await expect(
      governance.createGovernanceControl({
        actorUserId: admin.userId,
        sessionId: "session_1",
        challengeId: "challenge_1b",
        previewId: duplicatePreview.previewId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_bid",
        reason: "duplicate active control",
        now: new Date("2026-06-10T13:01:10.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_ALREADY_ACTIVE"
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          action: "stage8.governance_control.create",
          targetId: created.control.id
        }
      })
    ).resolves.toEqual(expect.objectContaining({ reason: "suspicious bidding burst" }));
    await expect(
      prisma.outboxEvent.findFirst({
        where: {
          eventType: "governance_control.created",
          targetId: created.control.id
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          controlType: "pause_bid",
          scopeId: community.id
        })
      })
    );

    const lifted = await governance.liftGovernanceControl({
      actorUserId: admin.userId,
      sessionId: "session_1",
      challengeId: "challenge_2",
      controlId: created.control.id,
      reason: "bidding normalized",
      now: new Date("2026-06-10T13:05:00.000Z")
    });
    expect(lifted).toMatchObject({
      result: "accepted",
      control: {
        status: "lifted",
        effective: false,
        liftReason: "bidding normalized"
      }
    });

    const secondPreview = await governance.createGovernanceControlPreview({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      now: new Date("2026-06-10T13:06:00.000Z")
    });
    if (secondPreview.result !== "accepted") {
      throw new Error("expected second preview to be accepted");
    }
    await expect(
      governance.createGovernanceControl({
        actorUserId: admin.userId,
        sessionId: "session_1",
        challengeId: "challenge_3",
        previewId: secondPreview.previewId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_bid",
        reason: "reopen control",
        now: new Date("2026-06-10T13:06:10.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted"
    });
  });

  it("routes pause-settlement creation through high-risk review and executes on approval", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_create");
    const initiator = await createAdmin(
      "platform_review_create_initiator",
      "platform_admin",
      true
    );
    const reviewer = await createAdmin(
      "platform_review_create_reviewer",
      "platform_admin",
      true
    );
    const preview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:00:00.000Z")
    });
    expect(preview).toMatchObject({
      result: "accepted",
      controlType: "pause_settlement"
    });
    if (preview.result !== "accepted") {
      throw new Error("expected pause-settlement preview to be accepted");
    }

    const requested = await governanceWithReview.createGovernanceControl({
      actorUserId: initiator.userId,
      sessionId: "session_review_create_initiator",
      challengeId: "challenge_review_create_initiator",
      idempotencyKey: unique("review_create_key"),
      previewId: preview.previewId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:01:00.000Z")
    });
    expect(requested).toMatchObject({
      result: "pending_review",
      review: {
        actionType: "governance_control_create",
        decisionState: "pending",
        executionState: "not_started",
        sourcePreviewAuditLogId: preview.previewId
      }
    });
    if (requested.result !== "pending_review") {
      throw new Error("expected create request to enter pending review");
    }
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          previewAuditLogId: preview.previewId
        }
      })
    ).resolves.toBeNull();

    const approved = await governanceWithReview.approveGovernanceControlReview({
      reviewRequestId: requested.review.id,
      reviewerUserId: reviewer.userId,
      sessionId: "session_review_create_reviewer",
      challengeId: "challenge_review_create_reviewer",
      now: new Date("2026-06-10T14:02:00.000Z")
    });
    expect(approved).toMatchObject({
      result: "accepted",
      transitionApplied: true,
      review: {
        decisionState: "approved",
        executionState: "succeeded"
      }
    });

    const control = await prisma.governanceControl.findUnique({
      where: {
        previewAuditLogId: preview.previewId
      }
    });
    expect(control).toEqual(
      expect.objectContaining({
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_settlement",
        status: "active",
        createdByUserId: initiator.userId
      })
    );
    if (!control) {
      throw new Error("expected approval to create governance control");
    }
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "governance_control.created",
          targetId: control.id
        }
      })
    ).resolves.toBe(1);

    vi.mocked(sensitiveOperations.authorizeFreshChallenge).mockImplementation(
      async () => ({
        result: "rejected" as const,
        errorCode: "SENSITIVE_CHALLENGE_EXPIRED"
      })
    );
    await expect(
      governanceWithReview.approveGovernanceControlReview({
        reviewRequestId: requested.review.id,
        reviewerUserId: reviewer.userId,
        sessionId: "session_review_create_reviewer",
        challengeId: "challenge_review_create_reviewer",
        now: new Date("2026-06-10T14:40:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transitionApplied: false,
      review: {
        decisionState: "approved",
        executionState: "succeeded"
      }
    });
  });

  it("rejects create retries when the same idempotency key carries a different frozen payload", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_idempotency_conflict");
    const initiator = await createAdmin(
      "platform_review_idempotency_conflict_initiator",
      "platform_admin",
      true
    );
    await createAdmin(
      "platform_review_idempotency_conflict_reviewer",
      "platform_admin",
      true
    );
    const firstPreview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "first impact evidence",
      now: new Date("2026-06-10T14:03:00.000Z")
    });
    const secondPreview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "second impact evidence",
      now: new Date("2026-06-10T14:04:00.000Z")
    });
    if (firstPreview.result !== "accepted" || secondPreview.result !== "accepted") {
      throw new Error("expected pause-settlement previews to be accepted");
    }
    const idempotencyKey = unique("review_idempotency_conflict_key");

    await expect(
      governanceWithReview.createGovernanceControl({
        actorUserId: initiator.userId,
        sessionId: "session_review_idempotency_conflict",
        challengeId: "challenge_review_idempotency_conflict",
        idempotencyKey,
        previewId: firstPreview.previewId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_settlement",
        reason: "first settlement anomaly",
        now: new Date("2026-06-10T14:05:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "pending_review",
      review: {
        sourcePreviewAuditLogId: firstPreview.previewId
      }
    });
    await expect(
      governanceWithReview.createGovernanceControl({
        actorUserId: initiator.userId,
        sessionId: "session_review_idempotency_conflict",
        challengeId: "challenge_review_idempotency_conflict",
        idempotencyKey,
        previewId: secondPreview.previewId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_settlement",
        reason: "different settlement anomaly",
        now: new Date("2026-06-10T14:06:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("routes pause-settlement lift through high-risk review and executes on approval", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_lift");
    const initiator = await createAdmin(
      "platform_review_lift_initiator",
      "platform_admin",
      true
    );
    const reviewer = await createAdmin(
      "platform_review_lift_reviewer",
      "platform_admin",
      true
    );
    const control = await createDirectControl({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement"
    });

    const requested = await governanceWithReview.liftGovernanceControl({
      actorUserId: initiator.userId,
      sessionId: "session_review_lift_initiator",
      challengeId: "challenge_review_lift_initiator",
      idempotencyKey: unique("review_lift_key"),
      controlId: control.id,
      reason: "settlement recovered",
      now: new Date("2026-06-10T14:10:00.000Z")
    });
    expect(requested).toMatchObject({
      result: "pending_review",
      review: {
        actionType: "governance_control_lift",
        targetType: "governance_control",
        targetId: control.id,
        decisionState: "pending",
        executionState: "not_started"
      }
    });
    if (requested.result !== "pending_review") {
      throw new Error("expected lift request to enter pending review");
    }
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          id: control.id
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "active"
    });

    const approved = await governanceWithReview.approveGovernanceControlReview({
      reviewRequestId: requested.review.id,
      reviewerUserId: reviewer.userId,
      sessionId: "session_review_lift_reviewer",
      challengeId: "challenge_review_lift_reviewer",
      now: new Date("2026-06-10T14:11:00.000Z")
    });
    expect(approved).toMatchObject({
      result: "accepted",
      transitionApplied: true,
      review: {
        decisionState: "approved",
        executionState: "succeeded"
      }
    });
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          id: control.id
        },
        select: {
          status: true,
          liftedByUserId: true,
          liftReason: true
        }
      })
    ).resolves.toEqual({
      status: "lifted",
      liftedByUserId: initiator.userId,
      liftReason: "settlement recovered"
    });
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "governance_control.lifted",
          targetId: control.id
        }
      })
    ).resolves.toBe(1);
  });

  it("replays an existing review before routing flag fallback can execute synchronously", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_flag_off");
    const initiator = await createAdmin(
      "platform_review_flag_off_initiator",
      "platform_admin",
      true
    );
    await createAdmin("platform_review_flag_off_reviewer", "platform_admin", true);
    const preview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      now: new Date("2026-06-10T14:20:00.000Z")
    });
    if (preview.result !== "accepted") {
      throw new Error("expected pause-settlement preview to be accepted");
    }
    const idempotencyKey = unique("review_flag_off_key");
    const requested = await governanceWithReview.createGovernanceControl({
      actorUserId: initiator.userId,
      sessionId: "session_review_flag_off",
      challengeId: "challenge_review_flag_off",
      idempotencyKey,
      previewId: preview.previewId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:21:00.000Z")
    });
    expect(requested).toMatchObject({
      result: "pending_review",
      review: {
        decisionState: "pending"
      }
    });

    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "false");
    await expect(
      governanceWithReview.createGovernanceControl({
        actorUserId: initiator.userId,
        sessionId: "session_review_flag_off",
        idempotencyKey,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_settlement",
        now: new Date("2026-06-10T14:26:30.000Z")
      })
    ).resolves.toMatchObject({
      result: "pending_review",
      review: {
        decisionState: "invalidated",
        executionState: "not_started"
      }
    });
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          previewAuditLogId: preview.previewId
        }
      })
    ).resolves.toBeNull();
  });

  it("invalidates pending reviews instead of approving them when routing is disabled", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_flag_off_approve");
    const initiator = await createAdmin(
      "platform_review_flag_off_approve_initiator",
      "platform_admin",
      true
    );
    const reviewer = await createAdmin(
      "platform_review_flag_off_approve_reviewer",
      "platform_admin",
      true
    );
    const preview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:27:00.000Z")
    });
    if (preview.result !== "accepted") {
      throw new Error("expected pause-settlement preview to be accepted");
    }
    const requested = await governanceWithReview.createGovernanceControl({
      actorUserId: initiator.userId,
      sessionId: "session_review_flag_off_approve_initiator",
      challengeId: "challenge_review_flag_off_approve_initiator",
      idempotencyKey: unique("review_flag_off_approve_key"),
      previewId: preview.previewId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:28:00.000Z")
    });
    if (requested.result !== "pending_review") {
      throw new Error("expected create request to enter pending review");
    }

    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "false");
    await expect(
      governanceWithReview.approveGovernanceControlReview({
        reviewRequestId: requested.review.id,
        reviewerUserId: reviewer.userId,
        sessionId: "session_review_flag_off_approve_reviewer",
        challengeId: "challenge_review_flag_off_approve_reviewer",
        now: new Date("2026-06-10T14:29:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transitionApplied: true,
      review: {
        decisionState: "invalidated",
        executionState: "not_started",
        executionErrorCode: null
      }
    });
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          previewAuditLogId: preview.previewId
        }
      })
    ).resolves.toBeNull();
    await expect(
      prisma.outboxEvent.count({
        where: {
          targetId: requested.review.id,
          eventType: "high_risk_governance_review.invalidated"
        }
      })
    ).resolves.toBe(1);
  });

  it("lists and details high-risk reviews only for platform admins", async () => {
    vi.stubEnv("STAGE8_HIGH_RISK_GOVERNANCE_REVIEW", "true");
    const community = await createCommunity("review_api_auth");
    const initiator = await createAdmin(
      "platform_review_api_auth_initiator",
      "platform_admin",
      true
    );
    const reviewer = await createAdmin(
      "platform_review_api_auth_reviewer",
      "platform_admin",
      true
    );
    const activityAdmin = await createAdmin(
      "activity_review_api_auth",
      "activity_admin",
      true
    );
    const preview = await governanceWithReview.createGovernanceControlPreview({
      actorUserId: initiator.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:30:00.000Z")
    });
    if (preview.result !== "accepted") {
      throw new Error("expected pause-settlement preview to be accepted");
    }
    const requested = await governanceWithReview.createGovernanceControl({
      actorUserId: initiator.userId,
      sessionId: "session_review_api_auth",
      challengeId: "challenge_review_api_auth",
      idempotencyKey: unique("review_api_auth_key"),
      previewId: preview.previewId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      now: new Date("2026-06-10T14:31:00.000Z")
    });
    if (requested.result !== "pending_review") {
      throw new Error("expected create request to enter pending review");
    }

    await expect(
      highRiskGovernanceReview.listReviewRequests({
        actorUserId: reviewer.userId,
        now: new Date("2026-06-10T14:32:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      reviews: expect.arrayContaining([
        expect.objectContaining({
          id: requested.review.id,
          frozenPayloadJson: expect.objectContaining({
            reason: "settlement anomaly"
          })
        })
      ])
    });
    await expect(
      highRiskGovernanceReview.getReviewRequestDetail({
        actorUserId: reviewer.userId,
        reviewRequestId: requested.review.id,
        now: new Date("2026-06-10T14:32:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      review: {
        id: requested.review.id,
        evidenceJson: expect.objectContaining({
          sourcePreviewAuditLogId: preview.previewId
        })
      },
      events: [
        expect.objectContaining({
          eventType: "created",
          toDecisionState: "pending"
        })
      ]
    });
    await expect(
      highRiskGovernanceReview.getReviewRequestDetail({
        actorUserId: activityAdmin.userId,
        reviewRequestId: requested.review.id,
        now: new Date("2026-06-10T14:32:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });
  });

  it("expires due pending reviews lazily from detail, list, and approve paths", async () => {
    const initiator = await createAdmin(
      "platform_review_lazy_expiry_initiator",
      "platform_admin",
      true
    );
    const reviewer = await createAdmin(
      "platform_review_lazy_expiry_reviewer",
      "platform_admin",
      true
    );
    const detailExpired = await createDirectHighRiskReview({
      initiatorUserId: initiator.userId,
      targetId: unique("lazy_detail_target"),
      expiresAt: new Date("2026-06-10T14:59:00.000Z")
    });

    await expect(
      highRiskGovernanceReview.getReviewRequestDetail({
        actorUserId: reviewer.userId,
        reviewRequestId: detailExpired.id,
        now: new Date("2026-06-10T15:00:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      review: {
        id: detailExpired.id,
        decisionState: "expired"
      },
      events: [
        expect.objectContaining({
          eventType: "expired",
          toDecisionState: "expired"
        })
      ]
    });
    await expect(
      highRiskGovernanceReview.listReviewRequests({
        actorUserId: reviewer.userId,
        decisionState: "pending",
        now: new Date("2026-06-10T15:00:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      reviews: expect.not.arrayContaining([
        expect.objectContaining({
          id: detailExpired.id
        })
      ])
    });

    const approveExpired = await createDirectHighRiskReview({
      initiatorUserId: initiator.userId,
      targetId: unique("lazy_approve_target"),
      expiresAt: new Date("2026-06-10T14:59:00.000Z")
    });
    await expect(
      governanceWithReview.approveGovernanceControlReview({
        reviewRequestId: approveExpired.id,
        reviewerUserId: reviewer.userId,
        sessionId: "session_lazy_expiry_reviewer",
        challengeId: "challenge_lazy_expiry_reviewer",
        now: new Date("2026-06-10T15:00:00.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transitionApplied: true,
      review: {
        id: approveExpired.id,
        decisionState: "expired",
        executionState: "not_started"
      }
    });
    await expect(
      governanceWithReview.approveGovernanceControlReview({
        reviewRequestId: approveExpired.id,
        reviewerUserId: reviewer.userId,
        sessionId: "session_lazy_expiry_reviewer",
        challengeId: "challenge_lazy_expiry_reviewer",
        now: new Date("2026-06-10T15:00:10.000Z")
      })
    ).resolves.toMatchObject({
      result: "accepted",
      transitionApplied: false,
      review: {
        id: approveExpired.id,
        decisionState: "expired"
      }
    });
    await expect(
      highRiskCleanupPrisma.highRiskGovernanceReviewEvent.count({
        where: {
          requestId: approveExpired.id,
          eventType: "expired"
        }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: {
          targetId: approveExpired.id,
          eventType: "high_risk_governance_review.expired"
        }
      })
    ).resolves.toBe(1);
  });

  it("returns not active for concurrent duplicate lift attempts", async () => {
    const community = await createCommunity("concurrent_lift");
    const admin = await createAdmin("platform_concurrent_lift", "platform_admin", true);
    const control = await createDirectControl({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid"
    });
    const challengeGate = createChallengeGate(2);
    vi.mocked(sensitiveOperations.authorizeFreshChallenge).mockImplementation(
      challengeGate.authorize
    );

    const first = governance.liftGovernanceControl({
      actorUserId: admin.userId,
      sessionId: "session_concurrent",
      challengeId: "challenge_concurrent_1",
      controlId: control.id,
      reason: "first lift",
      now: new Date("2026-06-10T13:10:00.000Z")
    });
    const second = governance.liftGovernanceControl({
      actorUserId: admin.userId,
      sessionId: "session_concurrent",
      challengeId: "challenge_concurrent_2",
      controlId: control.id,
      reason: "second lift",
      now: new Date("2026-06-10T13:10:00.000Z")
    });

    await challengeGate.waitUntilReady();
    challengeGate.release();

    const results = await Promise.all([first, second]);
    const accepted = results.filter((result) => result.result === "accepted");
    const rejected = results.filter((result) => result.result === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([
      {
        result: "rejected",
        errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
      }
    ]);
    await expect(
      prisma.outboxEvent.count({
        where: {
          eventType: "governance_control.lifted",
          targetId: control.id
        }
      })
    ).resolves.toBe(1);
  });

  it("keeps a concurrently lifted expired control lifted during lazy expiry", async () => {
    const community = await createCommunity("expired_lift_race");
    const admin = await createAdmin("platform_expired_lift_race", "platform_admin", true);
    const now = new Date("2026-06-10T13:20:00.000Z");
    const control = await createDirectControl({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      endsAt: new Date("2026-06-10T13:19:00.000Z")
    });
    const racedGovernance = new Stage8GovernanceService(
      createPrismaThatLiftsControlAfterRead({
        controlId: control.id,
        liftedByUserId: admin.userId,
        liftedAt: now
      }),
      sensitiveOperations
    );

    await expect(
      racedGovernance.liftGovernanceControl({
        actorUserId: admin.userId,
        sessionId: "session_expired_lift_race",
        challengeId: "challenge_expired_lift_race",
        controlId: control.id,
        reason: "late lift",
        now
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
    });
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          id: control.id
        },
        select: {
          status: true,
          liftedByUserId: true,
          liftReason: true
        }
      })
    ).resolves.toEqual({
      status: "lifted",
      liftedByUserId: admin.userId,
      liftReason: "concurrent lift"
    });
  });

  it("marks elapsed active controls expired when lift is attempted", async () => {
    const community = await createCommunity("expired_lift");
    const admin = await createAdmin("platform_expired_lift", "platform_admin", true);
    const control = await createDirectControl({
      actorUserId: admin.userId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid",
      endsAt: new Date("2026-06-10T13:19:00.000Z")
    });

    await expect(
      governance.liftGovernanceControl({
        actorUserId: admin.userId,
        sessionId: "session_expired_lift",
        challengeId: "challenge_expired_lift",
        controlId: control.id,
        reason: "late lift",
        now: new Date("2026-06-10T13:20:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_NOT_ACTIVE"
    });
    await expect(
      prisma.governanceControl.findUnique({
        where: {
          id: control.id
        },
        select: {
          status: true
        }
      })
    ).resolves.toEqual({
      status: "expired"
    });
  });

  it("keeps activity-admin scope and pause-settlement boundaries", async () => {
    const community = await createCommunity("activity_scope");
    const otherCommunity = await createCommunity("activity_other");
    const admin = await createAdmin("activity", "activity_admin", true);
    await prisma.adminCommunityScope.create({
      data: {
        id: unique("scope"),
        adminProfileId: admin.adminProfileId,
        communityId: community.id,
        status: "active"
      }
    });

    await expect(
      governance.createGovernanceControlPreview({
        actorUserId: admin.userId,
        scopeType: "community",
        scopeId: otherCommunity.id,
        controlType: "pause_bid"
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_SCOPE_FORBIDDEN"
    });
    await expect(
      governance.createGovernanceControlPreview({
        actorUserId: admin.userId,
        scopeType: "community",
        scopeId: community.id,
        controlType: "pause_settlement"
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "CONTROL_TYPE_FORBIDDEN"
    });
  });

  it("blocks publish, bid, transaction confirmation, and activity-admin approval", async () => {
    const community = await createCommunity("guards");
    const actor = await createUser("guard_actor");
    const child = await createChild("guard_child");
    await createDirectControl({
      actorUserId: actor.id,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_publish"
    });

    await expect(
      contentReview.submitItem({
        actorUserId: actor.id,
        childId: child.id,
        communityId: community.id,
        title: "Paused Item",
        description: "blocked by governance control",
        startPoints: 10,
        minIncrementPoints: 1,
        images: [],
        idempotencyKey: unique("publish")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_ACTIVE"
    });

    const auction = await createAuctionFixture("bid_guard", community.id);
    await createDirectControl({
      actorUserId: actor.id,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_bid"
    });
    await expect(
      bidding.placeBid({
        actorUserId: actor.id,
        auctionSessionId: auction.auctionId,
        bidderChildId: unique("missing_bidder_child"),
        amountPoints: 10,
        idempotencyKey: unique("bid"),
        now: new Date("2026-06-10T13:10:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_ACTIVE"
    });

    const transaction = await createTransactionFixture("settlement_guard", community.id);
    await createDirectControl({
      actorUserId: actor.id,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement"
    });
    await expect(
      transactions.decideGuardianConfirmation({
        actorUserId: actor.id,
        transactionId: transaction.transactionId,
        value: "confirmed",
        deliveryMethod: "guardian_arranged",
        idempotencyKey: unique("guardian_confirm"),
        now: new Date("2026-06-10T13:11:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_ACTIVE"
    });

    const task = await createModerationTask("review_guard", community.id, child.id);
    await createDirectControl({
      actorUserId: actor.id,
      scopeType: "community",
      scopeId: community.id,
      controlType: "force_platform_review"
    });
    await expect(
      contentReview.reviewModerationTask({
        actorUserId: actor.id,
        taskId: task.taskId,
        decision: "approve",
        reason: "activity admin cannot approve while forced platform review is active"
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "PLATFORM_REVIEW_REQUIRED"
    });
  });
});

function requireIsolatedDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Stage 8 governance controls tests require DATABASE_URL");
  }

  const schema = new URL(databaseUrl).searchParams.get("schema");
  if (!schema || schema === "public") {
    throw new Error(
      "Stage 8 governance controls tests require a non-public DATABASE_URL schema"
    );
  }

  return databaseUrl;
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      id: unique(`${label}_user`),
      status: "active"
    }
  });
}

async function createAdmin(
  label: string,
  role: "activity_admin" | "platform_admin",
  mfaEnabled: boolean
) {
  const user = await createUser(label);
  const admin = await prisma.adminProfile.create({
    data: {
      id: unique(`${label}_admin`),
      userId: user.id,
      role,
      status: "active",
      mfaEnabled
    }
  });

  return {
    userId: user.id,
    adminProfileId: admin.id
  };
}

function createCommunity(label: string) {
  return prisma.auctionCommunity.create({
    data: {
      id: unique(`${label}_community`),
      name: `${label} community`,
      creatorGuardianId: unique(`${label}_guardian`),
      status: "active",
      defaultAuctionDurationMinutes: 60
    }
  });
}

function createChild(label: string) {
  return prisma.childProfile.create({
    data: {
      id: unique(`${label}_child`),
      displayName: `${label} Child`,
      gradeBand: "3-4",
      status: "active"
    }
  });
}

async function createDirectControl(input: {
  actorUserId: string;
  scopeType: "platform" | "community";
  scopeId: string | null;
  controlType:
    | "pause_publish"
    | "pause_bid"
    | "pause_settlement"
    | "force_platform_review";
  endsAt?: Date;
}) {
  const audit = await prisma.auditLog.create({
    data: {
      id: unique("preview_audit"),
      actorUserId: input.actorUserId,
      action: "stage8.governance_control_preview",
      targetType: "governance_control_scope",
      targetId: input.scopeType === "platform" ? "platform" : input.scopeId ?? "",
      beforeJson: {},
      afterJson: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        controlType: input.controlType,
        expiresAt: "2026-06-10T13:30:00.000Z",
        mutatesBusinessState: false
      }
    }
  });
  return prisma.governanceControl.create({
    data: {
      id: unique("control"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      controlType: input.controlType,
      reason: "test control",
      previewAuditLogId: audit.id,
      createdByUserId: input.actorUserId,
      startsAt: new Date("2026-06-10T12:00:00.000Z"),
      endsAt: input.endsAt ?? null
    }
  });
}

async function createDirectHighRiskReview(input: {
  initiatorUserId: string;
  targetId: string;
  expiresAt: Date;
}) {
  const id = unique("high_risk_review");
  const community = await createCommunity("high_risk_review_scope");
  return highRiskCleanupPrisma.highRiskGovernanceReviewRequest.create({
    data: {
      id,
      actionType: "governance_control_create",
      decisionState: "pending",
      executionState: "not_started",
      targetType: "governance_control_scope",
      targetId: input.targetId,
      scopeType: "community",
      scopeId: community.id,
      controlType: "pause_settlement",
      sourcePreviewAuditLogId: null,
      initiatorUserId: input.initiatorUserId,
      idempotencyKey: unique("review_idempotency"),
      requestHash: unique("review_hash"),
      frozenPayloadJson: {
        actionType: "governance_control_create"
      },
      evidenceJson: {
        source: "stage8-governance-controls-lazy-expiry-test"
      },
      expiresAt: input.expiresAt,
      createdAt: new Date(input.expiresAt.getTime() - 30_000),
      updatedAt: new Date(input.expiresAt.getTime() - 30_000)
    }
  });
}

async function createAuctionFixture(label: string, communityId: string) {
  const seller = await createChild(`${label}_seller`);
  const item = await prisma.item.create({
    data: {
      id: unique(`${label}_item`),
      communityId,
      sellerChildId: seller.id,
      status: "listed",
      startPoints: 10,
      minIncrementPoints: 1
    }
  });
  const auction = await prisma.auctionSession.create({
    data: {
      id: unique(`${label}_auction`),
      itemId: item.id,
      idempotencyKey: unique(`${label}_auction_idem`),
      status: "active",
      startAt: new Date("2026-06-10T13:00:00.000Z"),
      endAt: new Date("2026-06-10T14:00:00.000Z"),
      startPoints: 10,
      minIncrementPoints: 1,
      currentPricePoints: 10
    }
  });

  return {
    auctionId: auction.id
  };
}

async function createTransactionFixture(label: string, communityId: string) {
  const seller = await createChild(`${label}_seller`);
  const buyer = await createChild(`${label}_buyer`);
  const account = await prisma.pointAccount.create({
    data: {
      id: unique(`${label}_account`),
      childId: buyer.id,
      availablePoints: 50,
      frozenPoints: 10,
      totalEarnedPoints: 60,
      totalSpentPoints: 0
    }
  });
  const auction = await createAuctionFixture(label, communityId);
  const hold = await prisma.pointHold.create({
    data: {
      id: unique(`${label}_hold`),
      accountId: account.id,
      auctionSessionId: auction.auctionId,
      amountPoints: 10,
      status: "active"
    }
  });
  const transaction = await prisma.transaction.create({
    data: {
      id: unique(`${label}_transaction`),
      auctionSessionId: auction.auctionId,
      buyerChildId: buyer.id,
      sellerChildId: seller.id,
      pointHoldId: hold.id,
      pointsAmount: 10,
      status: "pending_guardian_confirm",
      guardianConfirmDeadlineAt: new Date("2026-06-11T13:00:00.000Z")
    }
  });

  return {
    transactionId: transaction.id
  };
}

async function createModerationTask(
  label: string,
  communityId: string,
  childId: string
) {
  const item = await prisma.item.create({
    data: {
      id: unique(`${label}_item`),
      communityId,
      sellerChildId: childId,
      status: "manual_reviewing",
      startPoints: 10,
      minIncrementPoints: 1
    }
  });
  const version = await prisma.contentVersion.create({
    data: {
      id: unique(`${label}_version`),
      targetType: "item",
      targetId: item.id,
      versionNo: 1,
      status: "pending_manual",
      title: "Forced review item",
      description: "Requires platform review",
      payloadJson: {
        source: "stage8-governance-controls-test"
      }
    }
  });
  await prisma.item.update({
    where: {
      id: item.id
    },
    data: {
      latestVersionId: version.id
    }
  });
  const task = await prisma.moderationTask.create({
    data: {
      id: unique(`${label}_task`),
      contentVersionId: version.id,
      status: "needs_manual_review",
      providerRiskLevel: "low"
    }
  });

  return {
    taskId: task.id
  };
}

async function cleanup() {
  await prisma.governanceControl.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          createdByUserId: {
            startsWith: targetPrefix
          }
        },
        {
          scopeId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await highRiskCleanupPrisma.highRiskGovernanceReviewEvent.deleteMany({
    where: {
      OR: [
        {
          actorUserId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await highRiskCleanupPrisma.highRiskGovernanceReviewRequest.deleteMany({
    where: {
      OR: [
        {
          initiatorUserId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        },
        {
          scopeId: {
            startsWith: targetPrefix
          }
        },
        {
          sourcePreviewAuditLogId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.notification.deleteMany({
    where: {
      OR: [
        {
          recipientUserId: {
            startsWith: targetPrefix
          }
        },
        {
          relatedId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        },
        {
          idempotencyKey: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          actorUserId: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.moderationTask.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.item.updateMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          latestVersionId: {
            startsWith: targetPrefix
          }
        },
        {
          currentPublicVersionId: {
            startsWith: targetPrefix
          }
        }
      ]
    },
    data: {
      latestVersionId: null,
      currentPublicVersionId: null
    }
  });
  await prisma.contentVersion.deleteMany({
    where: {
      OR: [
        {
          id: {
            startsWith: targetPrefix
          }
        },
        {
          targetId: {
            startsWith: targetPrefix
          }
        }
      ]
    }
  });
  await prisma.transaction.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.pointHold.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionSession.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.item.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.pointAccount.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.adminCommunityScope.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.adminProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.childProfile.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.auctionCommunity.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: targetPrefix
      }
    }
  });
}
