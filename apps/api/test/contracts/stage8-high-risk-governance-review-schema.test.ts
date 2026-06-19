import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260611000000_stage8_high_risk_governance_review/migration.sql",
  "utf8"
);
const notificationMigration = readFileSync(
  "apps/api/prisma/migrations/20260612000000_stage8_high_risk_governance_review_notifications/migration.sql",
  "utf8"
);
const service = readFileSync(
  "apps/api/src/stage8/high-risk-governance-review.service.ts",
  "utf8"
);
const governanceService = readFileSync(
  "apps/api/src/stage8/stage8-governance.service.ts",
  "utf8"
);
const expiryWorker = readFileSync(
  "apps/worker/src/high-risk-governance-review-expiry-worker.ts",
  "utf8"
);
const notificationSender = readFileSync(
  "apps/worker/src/notification-sender.ts",
  "utf8"
);
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const schemaNormalized = normalize(schema);
const migrationNormalized = normalize(migration);
const notificationMigrationNormalized = normalize(notificationMigration);
const serviceNormalized = normalize(service);
const governanceServiceNormalized = normalize(governanceService);
const expiryWorkerNormalized = normalize(expiryWorker);
const notificationSenderNormalized = normalize(notificationSender);

describe("Stage 8 3A high-risk governance review schema", () => {
  it("defines review request, event log, decision, execution, and action vocabularies", () => {
    for (const enumName of [
      "HighRiskGovernanceReviewActionType",
      "HighRiskGovernanceReviewDecisionState",
      "HighRiskGovernanceReviewExecutionState",
      "HighRiskGovernanceReviewEventType"
    ]) {
      expect(schema).toContain(`enum ${enumName}`);
    }

    expect(schema).toContain("model HighRiskGovernanceReviewRequest");
    expect(schema).toContain("model HighRiskGovernanceReviewEvent");
    expect(schema).toContain("governance_control_create");
    expect(schema).toContain("governance_control_lift");
    expect(schema).toContain("execution_succeeded");
    expect(schema).toContain("execution_failed");
  });

  it("stores immutable payload/evidence and separates decision from execution state", () => {
    expect(schemaNormalized).toContain(
      "decisionState HighRiskGovernanceReviewDecisionState @default(pending)"
    );
    expect(schemaNormalized).toContain(
      "executionState HighRiskGovernanceReviewExecutionState @default(not_started)"
    );
    expect(schemaNormalized).toContain("frozenPayloadJson Json");
    expect(schemaNormalized).toContain("evidenceJson Json");
    expect(schemaNormalized).toContain("sourcePreviewAuditLogId String? @unique");
    expect(schemaNormalized).toContain(
      "@@unique([initiatorUserId, actionType, targetType, targetId, idempotencyKey])"
    );
  });

  it("adds migration constraints for preview locking, terminal states, and pending duplicates", () => {
    expect(migrationNormalized).toContain(
      'CREATE TABLE "HighRiskGovernanceReviewRequest"'
    );
    expect(migrationNormalized).toContain(
      'CREATE TABLE "HighRiskGovernanceReviewEvent"'
    );
    expect(migrationNormalized).toContain(
      'CONSTRAINT "HighRiskGovernanceReviewRequest_reviewer_separation_check"'
    );
    expect(migrationNormalized).toContain(
      'CONSTRAINT "HighRiskGovernanceReviewRequest_approved_execution_check"'
    );
    expect(migrationNormalized).toContain(
      'HighRiskGovernanceReviewRequest_sourcePreviewAuditLogId_key'
    );
    expect(migrationNormalized).toContain(
      'HighRiskGovernanceReviewRequest_pending_create_platform_idx'
    );
    expect(migrationNormalized).toContain(
      'HighRiskGovernanceReviewRequest_pending_create_community_idx'
    );
    expect(migrationNormalized).toContain(
      'HighRiskGovernanceReviewRequest_pending_lift_target_idx'
    );
    expect(migrationNormalized).toContain("WHERE \"decisionState\" = 'pending'");
  });
});

describe("Stage 8 3A high-risk governance review service contract", () => {
  it("keeps review creation idempotent and checks for eligible independent reviewers", () => {
    expect(serviceNormalized).toContain(
      "initiatorUserId_actionType_targetType_targetId_idempotencyKey"
    );
    expect(serviceNormalized).toContain("findReviewRequestByIdempotency");
    expect(serviceNormalized).toContain("listReviewRequests");
    expect(serviceNormalized).toContain("getReviewRequestDetail");
    expect(serviceNormalized).toContain("expireDuePendingReviews");
    expect(serviceNormalized).toContain("toReviewEventRow");
    expect(serviceNormalized).toContain("NO_ELIGIBLE_REVIEWER");
    expect(serviceNormalized).toContain("listEligibleReviewerUserIds");
    expect(serviceNormalized).toContain("eligibleReviewerUserIds");
    expect(serviceNormalized).toContain("PREVIEW_ALREADY_CONSUMED");
  });

  it("uses first-writer-wins terminal transitions and transactional approval execution", () => {
    expect(serviceNormalized).toContain(
      'decisionState: "pending", reviewerUserId: null'
    );
    expect(serviceNormalized).toContain("input.execute");
    expect(serviceNormalized).toContain('decisionState: "approved"');
    expect(serviceNormalized).toContain("execution_succeeded");
    expect(serviceNormalized).toContain("execution_failed");
    expect(serviceNormalized).toContain("transitionApplied: false");
  });

  it("routes pause-settlement controls through review without bypassing existing requests", () => {
    expect(governanceServiceNormalized).toContain(
      "replayExistingGovernanceControlReview"
    );
    expect(governanceServiceNormalized).toContain(
      "findReviewRequestByIdempotency"
    );
    expect(governanceServiceNormalized).toContain("ROUTING_DISABLED");
    expect(governanceServiceNormalized).toContain(
      'controlType === "pause_settlement"'
    );
    expect(governanceServiceNormalized).toContain(
      "STAGE8_HIGH_RISK_GOVERNANCE_REVIEW"
    );
    expect(governanceServiceNormalized).toContain(
      'process.env.NODE_ENV === "production"'
    );
  });

  it("expires stale pending reviews through API lazy expiry and the worker scanner", () => {
    expect(serviceNormalized).toContain('decisionState: "pending"');
    expect(serviceNormalized).toContain("expiresAt");
    expect(serviceNormalized).toContain('eventType: "expired"');
    expect(expiryWorkerNormalized).toContain(
      "scanExpiredHighRiskGovernanceReviews"
    );
    expect(expiryWorkerNormalized).toContain(
      "startPeriodicHighRiskGovernanceReviewExpiryScanner"
    );
    expect(expiryWorkerNormalized).toContain(
      "high_risk_governance_review.expired"
    );
    expect(expiryWorkerNormalized).toContain("transition.count !== 1");
  });

  it("adds administrator-only notification routing for review pending and terminal results", () => {
    expect(schema).toContain("high_risk_governance_review_pending");
    expect(schema).toContain("high_risk_governance_review_result");
    expect(schema).toContain("view_high_risk_governance_review");
    expect(notificationMigrationNormalized).toContain(
      "high_risk_governance_review_pending"
    );
    expect(notificationMigrationNormalized).toContain(
      "high_risk_governance_review_result"
    );
    expect(notificationMigrationNormalized).toContain(
      "view_high_risk_governance_review"
    );
    expect(notificationSenderNormalized).toContain(
      "deriveHighRiskGovernanceReviewPending"
    );
    expect(notificationSenderNormalized).toContain(
      "payload.eligibleReviewerUserIds"
    );
    expect(notificationSenderNormalized).toContain(
      "deriveHighRiskGovernanceReviewResult"
    );
    expect(notificationSenderNormalized).toContain(
      'role: "platform_admin"'
    );
    expect(notificationSenderNormalized).toContain(
      "not: review.initiatorUserId"
    );
    expect(notificationSenderNormalized).toContain(
      "high_risk_governance_review.execution_failed"
    );
  });
});
