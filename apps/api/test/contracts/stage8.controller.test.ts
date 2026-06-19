import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { Stage8Controller } from "../../src/stage8/stage8.controller.js";
import type { Stage8GovernanceService } from "../../src/stage8/stage8-governance.service.js";
import type {
  HighRiskGovernanceReviewEventRow,
  HighRiskGovernanceReviewRow
} from "../../src/stage8/high-risk-governance-review.service.js";

const tokens = new SessionTokenService("stage8-controller-test-key");

describe("Stage8Controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads governance overview for the bearer admin and scoped community", async () => {
    setServerTime("2026-06-10T12:00:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.getGovernanceOverview).mockResolvedValue({
      result: "accepted",
      adminScope: {
        role: "activity_admin",
        platformWide: false,
        communityIds: ["community_1"],
        mfaEnabled: true
      },
      queueSummary: {
        pendingCommunityRequests: 0,
        pendingMemberReviews: 2,
        contentReviewTasks: 0,
        pendingAppeals: 1,
        platformAppeals: 0,
        unreadHighPriorityNotifications: 3
      },
      systemSummary: {
        pendingOutboxEvents: 0,
        failedOutboxEvents: 0,
        latestLedgerCheck: null
      },
      pilotMetrics: {
        activeCommunities: 1,
        activeMembers: 18,
        activeAuctions: 4,
        pendingGuardianTransactions: 2
      },
      recentAuditLogs: []
    });

    await expect(
      controller.getGovernanceOverview(
        {
          communityId: "community_1"
        },
        bearerToken("admin_user_1", "session_1")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      serverTime: "2026-06-10T12:00:00.000Z",
      targetType: "stage8_governance_overview",
      targetId: "community_1",
      queueSummary: {
        pendingMemberReviews: 2
      }
    });
    expect(governance.getGovernanceOverview).toHaveBeenCalledWith({
      actorUserId: "admin_user_1",
      communityId: "community_1"
    });
  });

  it("creates dangerous operation preview without accepting client actor ids", async () => {
    setServerTime("2026-06-10T12:05:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.createAdminOperationPreview).mockResolvedValue({
      result: "accepted",
      previewId: "preview_1",
      operation: "force_delist",
      targetType: "item",
      targetId: "item_1",
      communityId: "community_1",
      impactSummary: {
        operation: "force_delist",
        targetType: "item",
        targetId: "item_1",
        communityId: "community_1",
        counts: {
          activeAuctionCount: 1
        },
        warnings: ["Preview only"]
      },
      confirmationRequired: true,
      expiresAt: "2026-06-10T12:10:00.000Z",
      mutatesBusinessState: false
    });

    await expect(
      controller.createAdminOperationPreview(
        {
          operation: "force_delist",
          targetType: "item",
          targetId: "item_1",
          communityId: "community_1",
          reason: "suspected prohibited item"
        },
        bearerToken("admin_user_2", "session_2")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_admin_operation_preview",
      targetId: "preview_1",
      operation: "force_delist",
      mutatesBusinessState: false
    });
    expect(governance.createAdminOperationPreview).toHaveBeenCalledWith({
      actorUserId: "admin_user_2",
      operation: "force_delist",
      targetType: "item",
      targetId: "item_1",
      communityId: "community_1",
      reason: "suspected prohibited item",
      now: new Date("2026-06-10T12:05:00.000Z")
    });
  });

  it("rejects unsupported preview operations before reaching the service", async () => {
    setServerTime("2026-06-10T12:10:00.000Z");
    const { controller, governance } = createController();

    await expect(
      controller.createAdminOperationPreview(
        {
          operation: "delete_everything",
          targetType: "item",
          targetId: "item_2"
        },
        bearerToken("admin_user_3", "session_3")
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "OPERATION_NOT_SUPPORTED"
    });
    expect(governance.createAdminOperationPreview).not.toHaveBeenCalled();
  });

  it("lists governance controls for the bearer admin", async () => {
    setServerTime("2026-06-10T12:15:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.listGovernanceControls).mockResolvedValue({
      result: "accepted",
      controls: [
        {
          id: "control_1",
          scopeType: "community",
          scopeId: "community_1",
          controlType: "pause_bid",
          status: "active",
          effective: true,
          reason: "risk spike",
          createdByUserId: "admin_user_4",
          liftedByUserId: null,
          startsAt: "2026-06-10T12:00:00.000Z",
          endsAt: null,
          createdAt: "2026-06-10T12:00:00.000Z",
          liftedAt: null,
          liftReason: null,
          previewAuditLogId: "preview_audit_1"
        }
      ]
    });

    await expect(
      controller.listGovernanceControls(
        {
          communityId: "community_1"
        },
        bearerToken("admin_user_4", "session_4")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_governance_controls",
      targetId: "community_1",
      controls: [
        {
          id: "control_1",
          effective: true
        }
      ]
    });
    expect(governance.listGovernanceControls).toHaveBeenCalledWith({
      actorUserId: "admin_user_4",
      communityId: "community_1",
      now: new Date("2026-06-10T12:15:00.000Z")
    });
  });

  it("creates governance control preview without mutating business state", async () => {
    setServerTime("2026-06-10T12:20:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.createGovernanceControlPreview).mockResolvedValue({
      result: "accepted",
      previewId: "governance_preview_1",
      scopeType: "community",
      scopeId: "community_1",
      controlType: "pause_publish",
      impactSummary: {
        scopeType: "community",
        scopeId: "community_1",
        controlType: "pause_publish",
        counts: {
          activeAuctionCount: 1,
          activeHoldCount: 0,
          pendingTransactionCount: 0,
          manualReviewTaskCount: 2
        },
        blockedActions: ["publish_content"],
        warnings: ["New publishing will be paused."]
      },
      confirmationRequired: true,
      expiresAt: "2026-06-10T12:25:00.000Z",
      mutatesBusinessState: false
    });

    await expect(
      controller.createGovernanceControlPreview(
        {
          scopeType: "community",
          scopeId: "community_1",
          controlType: "pause_publish",
          reason: "manual review overload"
        },
        bearerToken("admin_user_5", "session_5")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_governance_control_preview",
      targetId: "governance_preview_1",
      mutatesBusinessState: false
    });
    expect(governance.createGovernanceControlPreview).toHaveBeenCalledWith({
      actorUserId: "admin_user_5",
      scopeType: "community",
      scopeId: "community_1",
      controlType: "pause_publish",
      reason: "manual review overload",
      now: new Date("2026-06-10T12:20:00.000Z")
    });
  });

  it("creates and lifts governance controls with bearer session challenge context", async () => {
    setServerTime("2026-06-10T12:30:00.000Z");
    const { controller, governance } = createController();
    const control = {
      id: "control_2",
      scopeType: "community" as const,
      scopeId: "community_2",
      controlType: "pause_settlement" as const,
      status: "active" as const,
      effective: true,
      reason: "settlement anomaly",
      createdByUserId: "admin_user_6",
      liftedByUserId: null,
      startsAt: "2026-06-10T12:30:00.000Z",
      endsAt: "2026-06-10T13:30:00.000Z",
      createdAt: "2026-06-10T12:30:00.000Z",
      liftedAt: null,
      liftReason: null,
      previewAuditLogId: "preview_audit_2"
    };
    vi.mocked(governance.createGovernanceControl).mockResolvedValue({
      result: "accepted",
      control
    });
    vi.mocked(governance.liftGovernanceControl).mockResolvedValue({
      result: "accepted",
      control: {
        ...control,
        status: "lifted",
        effective: false,
        liftedByUserId: "admin_user_6",
        liftedAt: "2026-06-10T12:35:00.000Z",
        liftReason: "risk cleared"
      }
    });

    await expect(
      controller.createGovernanceControl(
        {
          scopeType: "community",
          scopeId: "community_2",
          controlType: "pause_settlement",
          previewId: "governance_preview_2",
          sensitiveChallengeId: "challenge_2",
          reason: "settlement anomaly",
          endsAt: "2026-06-10T13:30:00.000Z"
        },
        bearerToken("admin_user_6", "session_6")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_governance_control",
      targetId: "control_2",
      latestStatus: "active"
    });
    expect(governance.createGovernanceControl).toHaveBeenCalledWith({
      actorUserId: "admin_user_6",
      sessionId: "session_6",
      challengeId: "challenge_2",
      idempotencyKey: undefined,
      previewId: "governance_preview_2",
      scopeType: "community",
      scopeId: "community_2",
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      endsAt: new Date("2026-06-10T13:30:00.000Z"),
      now: new Date("2026-06-10T12:30:00.000Z")
    });

    setServerTime("2026-06-10T12:35:00.000Z");
    await expect(
      controller.liftGovernanceControl(
        "control_2",
        {
          sensitiveChallengeId: "challenge_3",
          reason: "risk cleared"
        },
        bearerToken("admin_user_6", "session_6")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_governance_control",
      targetId: "control_2",
      latestStatus: "lifted"
    });
    expect(governance.liftGovernanceControl).toHaveBeenCalledWith({
      actorUserId: "admin_user_6",
      sessionId: "session_6",
      challengeId: "challenge_3",
      idempotencyKey: undefined,
      controlId: "control_2",
      reason: "risk cleared",
      now: new Date("2026-06-10T12:35:00.000Z")
    });
  });

  it("returns pending high-risk governance reviews with idempotency context", async () => {
    setServerTime("2026-06-10T12:37:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.createGovernanceControl).mockResolvedValue({
      result: "pending_review",
      review: highRiskReview({
        id: "review_create_1",
        actionType: "governance_control_create",
        targetType: "governance_control_scope",
        targetId: "community_3",
        scopeId: "community_3",
        sourcePreviewAuditLogId: "governance_preview_4",
        idempotencyKey: "idem_create_1"
      })
    });
    vi.mocked(governance.liftGovernanceControl).mockResolvedValue({
      result: "pending_review",
      review: highRiskReview({
        id: "review_lift_1",
        actionType: "governance_control_lift",
        targetType: "governance_control",
        targetId: "control_3",
        scopeId: "community_3",
        sourcePreviewAuditLogId: null,
        idempotencyKey: "idem_lift_1"
      })
    });

    await expect(
      controller.createGovernanceControl(
        {
          scopeType: "community",
          scopeId: "community_3",
          controlType: "pause_settlement",
          previewId: "governance_preview_4",
          sensitiveChallengeId: "challenge_4",
          idempotencyKey: "idem_create_1",
          reason: "settlement anomaly"
        },
        bearerToken("admin_user_8", "session_8")
      )
    ).resolves.toMatchObject({
      result: "pending_review",
      targetType: "stage8_governance_control",
      targetId: "review_create_1",
      latestStatus: "pending",
      reviewRequestId: "review_create_1",
      reviewStatus: "pending",
      executionStatus: "not_started",
      actionType: "governance_control_create",
      reviewTargetType: "governance_control_scope",
      reviewTargetId: "community_3"
    });
    expect(governance.createGovernanceControl).toHaveBeenCalledWith({
      actorUserId: "admin_user_8",
      sessionId: "session_8",
      challengeId: "challenge_4",
      idempotencyKey: "idem_create_1",
      previewId: "governance_preview_4",
      scopeType: "community",
      scopeId: "community_3",
      controlType: "pause_settlement",
      reason: "settlement anomaly",
      endsAt: null,
      now: new Date("2026-06-10T12:37:00.000Z")
    });

    await expect(
      controller.liftGovernanceControl(
        "control_3",
        {
          sensitiveChallengeId: "challenge_5",
          idempotencyKey: "idem_lift_1",
          reason: "risk cleared"
        },
        bearerToken("admin_user_8", "session_8")
      )
    ).resolves.toMatchObject({
      result: "pending_review",
      targetId: "review_lift_1",
      reviewRequestId: "review_lift_1",
      actionType: "governance_control_lift",
      reviewTargetType: "governance_control",
      reviewTargetId: "control_3"
    });
    expect(governance.liftGovernanceControl).toHaveBeenCalledWith({
      actorUserId: "admin_user_8",
      sessionId: "session_8",
      challengeId: "challenge_5",
      idempotencyKey: "idem_lift_1",
      controlId: "control_3",
      reason: "risk cleared",
      now: new Date("2026-06-10T12:37:00.000Z")
    });
  });

  it("lists and loads high-risk governance reviews for the bearer admin", async () => {
    setServerTime("2026-06-10T12:38:00.000Z");
    const { controller, governance } = createController();
    const review = highRiskReview({
      id: "review_detail_1",
      frozenPayloadJson: {
        actionType: "governance_control_create",
        reason: "settlement anomaly"
      },
      evidenceJson: {
        previewAfterJson: {
          controlType: "pause_settlement"
        }
      }
    });
    vi.mocked(governance.listHighRiskGovernanceReviews).mockResolvedValue({
      result: "accepted",
      reviews: [review]
    });
    vi.mocked(governance.getHighRiskGovernanceReviewDetail).mockResolvedValue({
      result: "accepted",
      review,
      events: [
        highRiskReviewEvent({
          id: "review_event_1",
          requestId: review.id,
          eventType: "created",
          toDecisionState: "pending"
        })
      ]
    });

    await expect(
      controller.listHighRiskGovernanceReviews(
        {
          decisionState: "all"
        },
        bearerToken("admin_user_9", "session_9")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_high_risk_governance_reviews",
      targetId: "all",
      reviews: [
        {
          id: "review_detail_1",
          frozenPayloadJson: {
            reason: "settlement anomaly"
          },
          evidenceJson: {
            previewAfterJson: {
              controlType: "pause_settlement"
            }
          }
        }
      ]
    });
    expect(governance.listHighRiskGovernanceReviews).toHaveBeenCalledWith({
      actorUserId: "admin_user_9",
      decisionState: "all",
      now: new Date("2026-06-10T12:38:00.000Z")
    });

    await expect(
      controller.getHighRiskGovernanceReviewDetail(
        "review_detail_1",
        bearerToken("admin_user_9", "session_9")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "stage8_high_risk_governance_review",
      targetId: "review_detail_1",
      latestStatus: "pending",
      review: {
        id: "review_detail_1"
      },
      events: [
        {
          id: "review_event_1",
          eventType: "created"
        }
      ]
    });
    expect(governance.getHighRiskGovernanceReviewDetail).toHaveBeenCalledWith({
      actorUserId: "admin_user_9",
      reviewRequestId: "review_detail_1",
      now: new Date("2026-06-10T12:38:00.000Z")
    });
  });

  it("approves, rejects, and withdraws high-risk reviews with bearer session context", async () => {
    setServerTime("2026-06-10T12:39:00.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.approveGovernanceControlReview).mockResolvedValue({
      result: "accepted",
      review: highRiskReview({
        id: "review_transition_1",
        decisionState: "approved",
        executionState: "succeeded",
        reviewerUserId: "admin_user_10",
        decidedAt: "2026-06-10T12:39:00.000Z",
        executedAt: "2026-06-10T12:39:00.000Z"
      }),
      transitionApplied: true
    });
    vi.mocked(governance.rejectGovernanceControlReview).mockResolvedValue({
      result: "accepted",
      review: highRiskReview({
        id: "review_transition_2",
        decisionState: "rejected",
        reviewerUserId: "admin_user_10",
        decisionReason: "insufficient evidence",
        decidedAt: "2026-06-10T12:39:00.000Z"
      }),
      transitionApplied: true
    });
    vi.mocked(governance.withdrawGovernanceControlReview).mockResolvedValue({
      result: "accepted",
      review: highRiskReview({
        id: "review_transition_3",
        decisionState: "withdrawn",
        decisionReason: "opened by mistake",
        decidedAt: "2026-06-10T12:39:00.000Z"
      }),
      transitionApplied: true
    });

    await expect(
      controller.approveHighRiskGovernanceReview(
        "review_transition_1",
        {
          sensitiveChallengeId: "challenge_approve_1"
        },
        bearerToken("admin_user_10", "session_10")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "approved",
      review: {
        id: "review_transition_1",
        executionState: "succeeded"
      },
      transitionApplied: true
    });
    expect(governance.approveGovernanceControlReview).toHaveBeenCalledWith({
      reviewRequestId: "review_transition_1",
      reviewerUserId: "admin_user_10",
      sessionId: "session_10",
      challengeId: "challenge_approve_1",
      now: new Date("2026-06-10T12:39:00.000Z")
    });

    await expect(
      controller.rejectHighRiskGovernanceReview(
        "review_transition_2",
        {
          sensitiveChallengeId: "challenge_reject_1",
          reason: "insufficient evidence"
        },
        bearerToken("admin_user_10", "session_10")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "rejected",
      review: {
        id: "review_transition_2",
        decisionReason: "insufficient evidence"
      }
    });
    expect(governance.rejectGovernanceControlReview).toHaveBeenCalledWith({
      reviewRequestId: "review_transition_2",
      reviewerUserId: "admin_user_10",
      sessionId: "session_10",
      challengeId: "challenge_reject_1",
      reason: "insufficient evidence",
      now: new Date("2026-06-10T12:39:00.000Z")
    });

    await expect(
      controller.withdrawHighRiskGovernanceReview(
        "review_transition_3",
        {
          reason: "opened by mistake"
        },
        bearerToken("admin_user_10", "session_10")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      latestStatus: "withdrawn",
      review: {
        id: "review_transition_3",
        decisionReason: "opened by mistake"
      }
    });
    expect(governance.withdrawGovernanceControlReview).toHaveBeenCalledWith({
      reviewRequestId: "review_transition_3",
      actorUserId: "admin_user_10",
      reason: "opened by mistake",
      now: new Date("2026-06-10T12:39:00.000Z")
    });
  });

  it("returns stable review transition errors", async () => {
    setServerTime("2026-06-10T12:39:30.000Z");
    const { controller, governance } = createController();
    vi.mocked(governance.approveGovernanceControlReview).mockResolvedValue({
      result: "rejected",
      errorCode: "SELF_REVIEW_FORBIDDEN"
    });

    await expect(
      controller.approveHighRiskGovernanceReview(
        "review_self_1",
        {
          sensitiveChallengeId: "challenge_self_1"
        },
        bearerToken("admin_user_11", "session_11")
      )
    ).resolves.toMatchObject({
      result: "rejected",
      targetType: "stage8_high_risk_governance_review",
      targetId: "review_self_1",
      errorCode: "SELF_REVIEW_FORBIDDEN"
    });
  });

  it("rejects invalid governance control end times before reaching the service", async () => {
    setServerTime("2026-06-10T12:40:00.000Z");
    const { controller, governance } = createController();

    await expect(
      controller.createGovernanceControl(
        {
          scopeType: "community",
          scopeId: "community_2",
          controlType: "pause_bid",
          previewId: "governance_preview_3",
          sensitiveChallengeId: "challenge_4",
          reason: "temporary bidding pause",
          endsAt: "not-a-date"
        },
        bearerToken("admin_user_7", "session_7")
      )
    ).resolves.toMatchObject({
      result: "rejected",
      errorCode: "GOVERNANCE_CONTROL_ENDS_AT_INVALID"
    });
    expect(governance.createGovernanceControl).not.toHaveBeenCalled();
  });
});

function createController() {
  const sessions = {
    assertActiveSession: vi.fn().mockResolvedValue({
      result: "accepted"
    })
  } as unknown as SessionService;
  const governance = {
    getGovernanceOverview: vi.fn(),
    createAdminOperationPreview: vi.fn(),
    listGovernanceControls: vi.fn(),
    createGovernanceControlPreview: vi.fn(),
    createGovernanceControl: vi.fn(),
    liftGovernanceControl: vi.fn(),
    listHighRiskGovernanceReviews: vi.fn(),
    getHighRiskGovernanceReviewDetail: vi.fn(),
    approveGovernanceControlReview: vi.fn(),
    rejectGovernanceControlReview: vi.fn(),
    withdrawGovernanceControlReview: vi.fn()
  } as unknown as Stage8GovernanceService;

  return {
    controller: new Stage8Controller(governance, sessions, tokens),
    governance
  };
}

function bearerToken(userId: string, sessionId: string) {
  const token = tokens.createAccessToken({
    userId,
    sessionId,
    expiresAt: new Date("2026-06-10T13:00:00.000Z")
  });
  return `Bearer ${token}`;
}

function setServerTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function highRiskReview(
  overrides: Partial<HighRiskGovernanceReviewRow>
): HighRiskGovernanceReviewRow {
  return {
    id: "review_1",
    actionType: "governance_control_create",
    decisionState: "pending",
    executionState: "not_started",
    targetType: "governance_control_scope",
    targetId: "community_1",
    scopeType: "community",
    scopeId: "community_1",
    controlType: "pause_settlement",
    sourcePreviewAuditLogId: "governance_preview_1",
    initiatorUserId: "admin_user_8",
    reviewerUserId: null,
    idempotencyKey: "idem_1",
    requestHash: "hash_1",
    frozenPayloadJson: {},
    evidenceJson: {},
    decisionReason: null,
    executionErrorCode: null,
    expiresAt: "2026-06-10T13:07:00.000Z",
    decidedAt: null,
    executedAt: null,
    createdAt: "2026-06-10T12:37:00.000Z",
    updatedAt: "2026-06-10T12:37:00.000Z",
    ...overrides
  };
}

function highRiskReviewEvent(
  overrides: Partial<HighRiskGovernanceReviewEventRow>
): HighRiskGovernanceReviewEventRow {
  return {
    id: "review_event_1",
    requestId: "review_1",
    eventType: "created",
    actorUserId: "admin_user_8",
    reason: null,
    errorCode: null,
    fromDecisionState: null,
    toDecisionState: "pending",
    fromExecutionState: null,
    toExecutionState: "not_started",
    targetType: "governance_control_scope",
    targetId: "community_1",
    payloadSummaryJson: null,
    createdAt: "2026-06-10T12:37:00.000Z",
    ...overrides
  };
}
