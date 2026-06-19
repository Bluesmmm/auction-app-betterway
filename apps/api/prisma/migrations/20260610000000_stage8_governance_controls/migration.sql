-- Stage 8 governance controls: scoped pilot risk controls with preview evidence.

CREATE TYPE "GovernanceControlScopeType" AS ENUM (
    'platform',
    'community'
);

CREATE TYPE "GovernanceControlType" AS ENUM (
    'pause_publish',
    'pause_bid',
    'pause_settlement',
    'force_platform_review'
);

CREATE TYPE "GovernanceControlStatus" AS ENUM (
    'active',
    'lifted',
    'expired'
);

CREATE TABLE "GovernanceControl" (
    "id" TEXT NOT NULL,
    "scopeType" "GovernanceControlScopeType" NOT NULL,
    "scopeId" TEXT,
    "controlType" "GovernanceControlType" NOT NULL,
    "status" "GovernanceControlStatus" NOT NULL DEFAULT 'active',
    "reason" TEXT NOT NULL,
    "previewAuditLogId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "liftedByUserId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftReason" TEXT,

    CONSTRAINT "GovernanceControl_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GovernanceControl_scope_check" CHECK (
        ("scopeType" = 'platform' AND "scopeId" IS NULL) OR
        ("scopeType" = 'community' AND "scopeId" IS NOT NULL)
    ),
    CONSTRAINT "GovernanceControl_lift_check" CHECK (
        ("status" = 'lifted' AND "liftedAt" IS NOT NULL AND "liftedByUserId" IS NOT NULL AND "liftReason" IS NOT NULL) OR
        ("status" <> 'lifted')
    )
);

CREATE UNIQUE INDEX "GovernanceControl_previewAuditLogId_key"
    ON "GovernanceControl"("previewAuditLogId");

CREATE UNIQUE INDEX "GovernanceControl_active_platform_scope_type_idx"
    ON "GovernanceControl"("scopeType", "controlType")
    WHERE "status" = 'active' AND "scopeType" = 'platform' AND "scopeId" IS NULL;

CREATE UNIQUE INDEX "GovernanceControl_active_community_scope_type_idx"
    ON "GovernanceControl"("scopeType", "scopeId", "controlType")
    WHERE "status" = 'active' AND "scopeType" = 'community' AND "scopeId" IS NOT NULL;

CREATE INDEX "GovernanceControl_scopeType_scopeId_controlType_status_idx"
    ON "GovernanceControl"("scopeType", "scopeId", "controlType", "status");

CREATE INDEX "GovernanceControl_createdByUserId_createdAt_idx"
    ON "GovernanceControl"("createdByUserId", "createdAt");

CREATE INDEX "GovernanceControl_status_startsAt_endsAt_idx"
    ON "GovernanceControl"("status", "startsAt", "endsAt");

ALTER TABLE "GovernanceControl"
    ADD CONSTRAINT "GovernanceControl_scopeId_fkey"
    FOREIGN KEY ("scopeId")
    REFERENCES "AuctionCommunity"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "GovernanceControl"
    ADD CONSTRAINT "GovernanceControl_previewAuditLogId_fkey"
    FOREIGN KEY ("previewAuditLogId")
    REFERENCES "AuditLog"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "GovernanceControl"
    ADD CONSTRAINT "GovernanceControl_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "GovernanceControl"
    ADD CONSTRAINT "GovernanceControl_liftedByUserId_fkey"
    FOREIGN KEY ("liftedByUserId")
    REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
