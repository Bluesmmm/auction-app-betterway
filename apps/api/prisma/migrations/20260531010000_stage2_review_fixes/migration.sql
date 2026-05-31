-- Stage 2 review fixes: make risk restriction provenance explicit.

ALTER TABLE "RiskRestriction"
ADD COLUMN "riskSignalId" TEXT;

UPDATE "RiskRestriction" rr
SET "riskSignalId" = rs."id"
FROM "RiskSignal" rs
WHERE rr."riskSignalId" IS NULL
  AND rr."reason" LIKE 'risk_signal:%'
  AND split_part(rr."reason", ':', 2) = rs."id";

CREATE INDEX "RiskRestriction_riskSignalId_status_idx"
ON "RiskRestriction"("riskSignalId", "status");

ALTER TABLE "RiskRestriction"
ADD CONSTRAINT "RiskRestriction_riskSignalId_fkey"
FOREIGN KEY ("riskSignalId") REFERENCES "RiskSignal"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
