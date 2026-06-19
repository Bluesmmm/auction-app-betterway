-- Stage 8 3A administrator-only notifications for high-risk governance review.

ALTER TYPE "NotificationType"
    ADD VALUE IF NOT EXISTS 'high_risk_governance_review_pending';

ALTER TYPE "NotificationType"
    ADD VALUE IF NOT EXISTS 'high_risk_governance_review_result';

ALTER TYPE "NotificationActionType"
    ADD VALUE IF NOT EXISTS 'view_high_risk_governance_review';
