-- Stage 8 3A high-risk governance review: immutable two-person approval facts.

CREATE TYPE "HighRiskGovernanceReviewActionType" AS ENUM (
    'governance_control_create',
    'governance_control_lift'
);

CREATE TYPE "HighRiskGovernanceReviewDecisionState" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'expired',
    'withdrawn',
    'invalidated'
);

CREATE TYPE "HighRiskGovernanceReviewExecutionState" AS ENUM (
    'not_started',
    'succeeded',
    'failed'
);

CREATE TYPE "HighRiskGovernanceReviewEventType" AS ENUM (
    'created',
    'approved',
    'rejected',
    'withdrawn',
    'expired',
    'invalidated',
    'execution_succeeded',
    'execution_failed'
);

CREATE TABLE "HighRiskGovernanceReviewRequest" (
    "id" TEXT NOT NULL,
    "actionType" "HighRiskGovernanceReviewActionType" NOT NULL,
    "decisionState" "HighRiskGovernanceReviewDecisionState" NOT NULL DEFAULT 'pending',
    "executionState" "HighRiskGovernanceReviewExecutionState" NOT NULL DEFAULT 'not_started',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scopeType" "GovernanceControlScopeType",
    "scopeId" TEXT,
    "controlType" "GovernanceControlType",
    "sourcePreviewAuditLogId" TEXT,
    "initiatorUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "frozenPayloadJson" JSONB NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "decisionReason" TEXT,
    "executionErrorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HighRiskGovernanceReviewRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HighRiskGovernanceReviewRequest_scope_check" CHECK (
        ("scopeType" IS NULL AND "scopeId" IS NULL) OR
        ("scopeType" = 'platform' AND "scopeId" IS NULL) OR
        ("scopeType" = 'community' AND "scopeId" IS NOT NULL)
    ),
    CONSTRAINT "HighRiskGovernanceReviewRequest_reviewer_separation_check" CHECK (
        "reviewerUserId" IS NULL OR "reviewerUserId" <> "initiatorUserId"
    ),
    CONSTRAINT "HighRiskGovernanceReviewRequest_approved_execution_check" CHECK (
        "decisionState" <> 'approved' OR "executionState" <> 'not_started'
    ),
    CONSTRAINT "HighRiskGovernanceReviewRequest_pending_execution_check" CHECK (
        "decisionState" <> 'pending' OR "executionState" = 'not_started'
    ),
    CONSTRAINT "HighRiskGovernanceReviewRequest_reason_check" CHECK (
        ("decisionState" NOT IN ('rejected', 'withdrawn') AND "decisionReason" IS NULL) OR
        ("decisionState" IN ('rejected', 'withdrawn') AND "decisionReason" IS NOT NULL AND LENGTH(BTRIM("decisionReason")) > 0) OR
        ("decisionState" IN ('invalidated', 'approved', 'expired'))
    ),
    CONSTRAINT "HighRiskGovernanceReviewRequest_execution_failure_check" CHECK (
        ("executionState" <> 'failed' AND "executionErrorCode" IS NULL) OR
        ("executionState" = 'failed' AND "executionErrorCode" IS NOT NULL)
    )
);

CREATE TABLE "HighRiskGovernanceReviewEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventType" "HighRiskGovernanceReviewEventType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "errorCode" TEXT,
    "fromDecisionState" "HighRiskGovernanceReviewDecisionState",
    "toDecisionState" "HighRiskGovernanceReviewDecisionState",
    "fromExecutionState" "HighRiskGovernanceReviewExecutionState",
    "toExecutionState" "HighRiskGovernanceReviewExecutionState",
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payloadSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighRiskGovernanceReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HighRiskGovernanceReviewRequest_sourcePreviewAuditLogId_key"
    ON "HighRiskGovernanceReviewRequest"("sourcePreviewAuditLogId");

CREATE UNIQUE INDEX "HighRiskGovernanceReviewRequest_idempotency_key"
    ON "HighRiskGovernanceReviewRequest"(
        "initiatorUserId",
        "actionType",
        "targetType",
        "targetId",
        "idempotencyKey"
    );

CREATE UNIQUE INDEX "HighRiskGovernanceReviewRequest_pending_create_platform_idx"
    ON "HighRiskGovernanceReviewRequest"("actionType", "scopeType", "controlType")
    WHERE "decisionState" = 'pending'
      AND "actionType" = 'governance_control_create'
      AND "scopeType" = 'platform'
      AND "scopeId" IS NULL
      AND "controlType" IS NOT NULL;

CREATE UNIQUE INDEX "HighRiskGovernanceReviewRequest_pending_create_community_idx"
    ON "HighRiskGovernanceReviewRequest"("actionType", "scopeType", "scopeId", "controlType")
    WHERE "decisionState" = 'pending'
      AND "actionType" = 'governance_control_create'
      AND "scopeType" = 'community'
      AND "scopeId" IS NOT NULL
      AND "controlType" IS NOT NULL;

CREATE UNIQUE INDEX "HighRiskGovernanceReviewRequest_pending_lift_target_idx"
    ON "HighRiskGovernanceReviewRequest"("actionType", "targetType", "targetId")
    WHERE "decisionState" = 'pending'
      AND "actionType" = 'governance_control_lift';

CREATE INDEX "HighRiskGovernanceReviewRequest_decisionState_expiresAt_idx"
    ON "HighRiskGovernanceReviewRequest"("decisionState", "expiresAt");

CREATE INDEX "HighRiskGovernanceReviewRequest_targetType_targetId_decisionState_idx"
    ON "HighRiskGovernanceReviewRequest"("targetType", "targetId", "decisionState");

CREATE INDEX "HighRiskGovernanceReviewRequest_scopeType_scopeId_controlType_decisionState_idx"
    ON "HighRiskGovernanceReviewRequest"("scopeType", "scopeId", "controlType", "decisionState");

CREATE INDEX "HighRiskGovernanceReviewRequest_reviewerUserId_decidedAt_idx"
    ON "HighRiskGovernanceReviewRequest"("reviewerUserId", "decidedAt");

CREATE INDEX "HighRiskGovernanceReviewEvent_requestId_createdAt_idx"
    ON "HighRiskGovernanceReviewEvent"("requestId", "createdAt");

CREATE INDEX "HighRiskGovernanceReviewEvent_eventType_createdAt_idx"
    ON "HighRiskGovernanceReviewEvent"("eventType", "createdAt");

CREATE INDEX "HighRiskGovernanceReviewEvent_actorUserId_createdAt_idx"
    ON "HighRiskGovernanceReviewEvent"("actorUserId", "createdAt");

ALTER TABLE "HighRiskGovernanceReviewRequest"
    ADD CONSTRAINT "HighRiskGovernanceReviewRequest_scopeId_fkey"
    FOREIGN KEY ("scopeId")
    REFERENCES "AuctionCommunity"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "HighRiskGovernanceReviewRequest"
    ADD CONSTRAINT "HighRiskGovernanceReviewRequest_sourcePreviewAuditLogId_fkey"
    FOREIGN KEY ("sourcePreviewAuditLogId")
    REFERENCES "AuditLog"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "HighRiskGovernanceReviewRequest"
    ADD CONSTRAINT "HighRiskGovernanceReviewRequest_initiatorUserId_fkey"
    FOREIGN KEY ("initiatorUserId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "HighRiskGovernanceReviewRequest"
    ADD CONSTRAINT "HighRiskGovernanceReviewRequest_reviewerUserId_fkey"
    FOREIGN KEY ("reviewerUserId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "HighRiskGovernanceReviewEvent"
    ADD CONSTRAINT "HighRiskGovernanceReviewEvent_requestId_fkey"
    FOREIGN KEY ("requestId")
    REFERENCES "HighRiskGovernanceReviewRequest"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "HighRiskGovernanceReviewEvent"
    ADD CONSTRAINT "HighRiskGovernanceReviewEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
