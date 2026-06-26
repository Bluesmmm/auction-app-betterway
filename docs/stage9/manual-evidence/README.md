# Stage 9 Manual Evidence Templates

Stage 9 manual gates require real external evidence, but the evidence files are
not committed to Git. The verifier reads JSON evidence from
`artifacts/stage9/manual-evidence/` by default. Set
`STAGE9_MANUAL_EVIDENCE_DIR` to point at another directory during CI or review.

Each evidence file must use the same file name as its template:

- `legal-prepilot-review.json`
- `operations-pilot-materials.json`
- `vendor-production-config.json`

Required fields:

- `gateId`: must match the Stage 9 gate id.
- `owner`: must match the gate owner.
- `approvedAt`: ISO-8601 timestamp for the approval or review record.
- `expiresAt`: ISO-8601 timestamp later than the report generation time.
- `evidenceUri`: internal review record, ticket, document, or archive URI.
- `summary`: non-sensitive summary of what the evidence covers.

