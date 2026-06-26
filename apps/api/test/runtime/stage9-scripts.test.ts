import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage9 verification scripts", () => {
  it("defines discover, strict verify, full verify, report artifacts, and the initial gate matrix", () => {
    const pkg = readFileSync("package.json", "utf8");
    const matrixPath = "scripts/stage9/gate-matrix.mjs";
    const verifierPath = "scripts/stage9/verify-stage9.mjs";

    expect(pkg).toContain('"stage9:discover"');
    expect(pkg).toContain('"stage9:authorization"');
    expect(pkg).toContain('"stage9:candidate-image"');
    expect(pkg).toContain('"stage9:deletion-retention"');
    expect(pkg).toContain('"stage9:file-search-notification"');
    expect(pkg).toContain('"stage9:grey-release"');
    expect(pkg).toContain('"stage9:governance"');
    expect(pkg).toContain('"stage9:ledger"');
    expect(pkg).toContain('"stage9:outbox-worker"');
    expect(pkg).toContain('"stage9:privacy-content"');
    expect(pkg).toContain('"stage9:runtime-rehearsal"');
    expect(pkg).toContain('"stage9:state-machine"');
    expect(pkg).toContain('"stage9:verify"');
    expect(pkg).toContain('"stage9:verify:full"');
    expect(existsSync(matrixPath)).toBe(true);
    expect(existsSync(verifierPath)).toBe(true);
    expect(existsSync("scripts/stage9/run-authorization-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-candidate-image-gate.mjs")).toBe(
      true
    );
    expect(existsSync("scripts/stage9/run-deletion-retention-gate.mjs")).toBe(
      true
    );
    expect(existsSync("scripts/stage9/run-file-search-notification-gate.mjs")).toBe(
      true
    );
    expect(existsSync("scripts/stage9/run-grey-release-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-governance-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-ledger-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-outbox-worker-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-privacy-content-gate.mjs")).toBe(true);
    expect(existsSync("scripts/stage9/run-runtime-rehearsal-gate.mjs")).toBe(
      true
    );
    expect(existsSync("scripts/stage9/ensure-prisma-runtime-engine.mjs")).toBe(
      true
    );
    expect(existsSync("scripts/stage9/run-state-machine-gate.mjs")).toBe(true);
    expect(existsSync("Dockerfile.candidate")).toBe(true);
    expect(existsSync("docker-compose.candidate.yml")).toBe(true);
    expect(existsSync(".dockerignore")).toBe(true);
    expect(existsSync("docs/stage9/manual-evidence/README.md")).toBe(true);
    expect(
      existsSync("docs/stage9/manual-evidence/legal-prepilot-review.example.json")
    ).toBe(true);
    expect(
      existsSync(
        "docs/stage9/manual-evidence/operations-pilot-materials.example.json"
      )
    ).toBe(true);
    expect(
      existsSync(
        "docs/stage9/manual-evidence/vendor-production-config.example.json"
      )
    ).toBe(true);

    const matrix = readFileSync(matrixPath, "utf8");
    const verifier = readFileSync(verifierPath, "utf8");
    const dockerignore = readFileSync(".dockerignore", "utf8");
    const legalManualTemplate = readFileSync(
      "docs/stage9/manual-evidence/legal-prepilot-review.example.json",
      "utf8"
    );
    const operationsManualTemplate = readFileSync(
      "docs/stage9/manual-evidence/operations-pilot-materials.example.json",
      "utf8"
    );
    const vendorManualTemplate = readFileSync(
      "docs/stage9/manual-evidence/vendor-production-config.example.json",
      "utf8"
    );
    const authorizationGate = readFileSync(
      "scripts/stage9/run-authorization-gate.mjs",
      "utf8"
    );
    const candidateImageGate = readFileSync(
      "scripts/stage9/run-candidate-image-gate.mjs",
      "utf8"
    );
    const deletionRetentionGate = readFileSync(
      "scripts/stage9/run-deletion-retention-gate.mjs",
      "utf8"
    );
    const fileSearchNotificationGate = readFileSync(
      "scripts/stage9/run-file-search-notification-gate.mjs",
      "utf8"
    );
    const governanceGate = readFileSync(
      "scripts/stage9/run-governance-gate.mjs",
      "utf8"
    );
    const greyReleaseGate = readFileSync(
      "scripts/stage9/run-grey-release-gate.mjs",
      "utf8"
    );
    const ledgerGate = readFileSync("scripts/stage9/run-ledger-gate.mjs", "utf8");
    const outboxWorkerGate = readFileSync(
      "scripts/stage9/run-outbox-worker-gate.mjs",
      "utf8"
    );
    const privacyContentGate = readFileSync(
      "scripts/stage9/run-privacy-content-gate.mjs",
      "utf8"
    );
    const runtimeRehearsalGate = readFileSync(
      "scripts/stage9/run-runtime-rehearsal-gate.mjs",
      "utf8"
    );
    const stateMachineGate = readFileSync(
      "scripts/stage9/run-state-machine-gate.mjs",
      "utf8"
    );

    expect(matrix).toContain("stage9GateStatuses");
    expect(matrix).toContain("stage9OverallStatuses");
    expect(matrix).toContain("stage9GateMaturities");
    expect(matrix).toContain("stage9GateModes");
    expect(matrix).toContain("stage9ReportPaths");
    expect(matrix).toContain("stage9Gates");

    for (const category of [
      "stage-verification",
      "state-machine",
      "ledger",
      "concurrency",
      "authorization",
      "privacy-content",
      "file-search-notification",
      "governance",
      "runtime-rehearsal",
      "deletion-retention",
      "manual-pilot"
    ]) {
      expect(matrix).toContain(`category: "${category}"`);
    }

    for (const status of ["passed", "failed", "manual_gate", "not_covered"]) {
      expect(matrix).toContain(`"${status}"`);
    }

    for (const status of [
      "ready_for_pilot",
      "ready_with_manual_gates",
      "blocked"
    ]) {
      expect(matrix).toContain(`"${status}"`);
    }

    for (const gateId of [
      "stage-baseline-branches-present",
      "stage1-to-stage8-full-verification",
      "minimal-auction-state-machine-e2e",
      "ledger-recompute-clean",
      "authorization-privacy-cross-community",
      "grey-release-compatibility",
      "candidate-image-runtime",
      "governance-pause-and-review-recovery",
      "outbox-worker-failure-recovery",
      "legal-prepilot-review"
    ]) {
      expect(matrix).toContain(`id: "${gateId}"`);
    }

    expect(matrix).toContain('owner: "legal"');
    expect(matrix).toContain('owner: "operations"');
    expect(matrix).toContain('owner: "vendor_owner"');
    expect(matrix).toContain("blockingIfMissing: true");
    expect(matrix).toContain("evidencePath");
    expect(matrix).toContain("templatePath");
    expect(matrix).toContain("requiredFields");
    expect(matrix).toContain("artifacts/stage9/manual-evidence");
    expect(matrix).toContain("docs/stage9/manual-evidence");
    expect(matrix).toContain("docs/MVP_ROADMAP.md");
    expect(matrix).toContain("artifacts/stage9/prepilot-verification-report.json");
    expect(matrix).toContain("artifacts/stage9/prepilot-verification-report.md");
    expect(matrix).toContain("npm run db:generate");
    expect(matrix).toContain("npm run stage9:authorization");
    expect(matrix).toContain("npm run stage9:candidate-image");
    expect(matrix).toContain("npm run stage9:deletion-retention");
    expect(matrix).toContain("npm run stage9:file-search-notification");
    expect(matrix).toContain("npm run stage9:grey-release");
    expect(matrix).toContain("npm run stage9:governance");
    expect(matrix).toContain("npm run stage9:ledger");
    expect(matrix).toContain("npm run stage9:outbox-worker");
    expect(matrix).toContain("npm run stage9:privacy-content");
    expect(matrix).toContain("npm run stage9:runtime-rehearsal");
    expect(matrix).toContain("npm run stage9:state-machine");
    expect(matrix).toContain('maturity: "automated"');

    expect(authorizationGate).toContain("stage9_authorization_scope");
    expect(authorizationGate).toContain(
      "apps/api/test/contracts/child-participation.service.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/integration/community-admin-authorization.service.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/integration/community-access.service.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/contracts/sensitive-operation.service.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/contracts/admin-security.service.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/contracts/communities.controller.test.ts"
    );
    expect(authorizationGate).toContain(
      "apps/api/test/integration/stage6-api-flow.test.ts"
    );

    expect(deletionRetentionGate).toContain("stage9_deletion_retention");
    expect(deletionRetentionGate).toContain(
      "apps/api/test/integration/child-data-retention.service.test.ts"
    );

    expect(fileSearchNotificationGate).toContain(
      "stage9_file_search_notification"
    );
    expect(fileSearchNotificationGate).toContain(
      "apps/api/test/contracts/private-object-storage.service.test.ts"
    );
    expect(fileSearchNotificationGate).toContain(
      "apps/api/test/integration/stage7-search-favorites-flow.test.ts"
    );
    expect(fileSearchNotificationGate).toContain(
      "apps/api/test/integration/stage7-notifications-api-flow.test.ts"
    );
    expect(fileSearchNotificationGate).toContain(
      "apps/worker/test/notification-sender.test.ts"
    );
    expect(fileSearchNotificationGate).toContain(
      "apps/worker/test/realtime-hint-publisher.test.ts"
    );

    expect(greyReleaseGate).toContain(
      "scripts/stage9/ensure-prisma-runtime-engine.mjs"
    );
    expect(greyReleaseGate).toContain("--no-deps");
    expect(greyReleaseGate).toContain("--force-recreate");
    expect(greyReleaseGate).toContain("scripts/stage1/check-connectivity.mjs");
    expect(greyReleaseGate).toContain("scripts/stage1/rehearse-migration.mjs");

    expect(candidateImageGate).toContain("Dockerfile.candidate");
    expect(candidateImageGate).toContain("docker-compose.candidate.yml");
    expect(candidateImageGate).toContain("STAGE9_CANDIDATE_IMAGE");
    expect(candidateImageGate).toContain('"build"');
    expect(candidateImageGate).toContain('"image"');
    expect(candidateImageGate).toContain('"inspect"');
    expect(candidateImageGate).toContain("assertDockerAvailable");
    expect(candidateImageGate).toContain("requires a reachable Docker daemon");
    expect(candidateImageGate).toContain("assertServiceImage");
    expect(candidateImageGate).toContain("--no-deps");
    expect(candidateImageGate).toContain("--force-recreate");
    expect(candidateImageGate).toContain("scripts/stage1/check-connectivity.mjs");
    expect(dockerignore).toContain("node_modules/.bin");
    expect(dockerignore).toContain("node_modules/.bin/**");
    expect(dockerignore).toContain("node_modules/@auction");
    expect(dockerignore).toContain("node_modules/@auction/**");
    expect(dockerignore).toContain("!apps/api/node_modules");
    expect(dockerignore).toContain("!apps/api/node_modules/**");
    expect(legalManualTemplate).toContain('"gateId": "legal-prepilot-review"');
    expect(legalManualTemplate).toContain('"owner": "legal"');
    expect(operationsManualTemplate).toContain(
      '"gateId": "operations-pilot-materials"'
    );
    expect(operationsManualTemplate).toContain('"owner": "operations"');
    expect(vendorManualTemplate).toContain('"gateId": "vendor-production-config"');
    expect(vendorManualTemplate).toContain('"owner": "vendor_owner"');

    expect(governanceGate).toContain("stage9_governance");
    expect(governanceGate).toContain(
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts"
    );
    expect(governanceGate).toContain(
      "apps/api/test/integration/stage8-governance-flow.test.ts"
    );
    expect(governanceGate).toContain(
      "apps/api/test/integration/risk-governance.service.test.ts"
    );
    expect(governanceGate).toContain(
      "apps/api/test/contracts/stage8.controller.test.ts"
    );
    expect(governanceGate).toContain(
      "apps/worker/test/high-risk-governance-review-expiry-worker.test.ts"
    );
    expect(governanceGate).toContain(
      "apps/worker/test/auction-settlement-worker.test.ts"
    );

    expect(ledgerGate).toContain("stage9_ledger_recompute");
    expect(ledgerGate).toContain("stage9_ledger_transaction");
    expect(ledgerGate).toContain(
      "apps/api/test/integration/ledger-check.service.test.ts"
    );
    expect(ledgerGate).toContain(
      "apps/api/test/integration/transaction-decision.service.test.ts"
    );
    expect(ledgerGate).toContain("apps/worker/test/ledger-check-worker.test.ts");
    expect(ledgerGate).toContain("stage4:ledger-check");

    expect(outboxWorkerGate).toContain("stage9_outbox_worker");
    expect(outboxWorkerGate).toContain(
      "apps/worker/test/outbox-dispatcher.test.ts"
    );
    expect(outboxWorkerGate).toContain(
      "apps/worker/test/outbox-processor.test.ts"
    );
    expect(outboxWorkerGate).toContain(
      "apps/worker/test/notification-sender.test.ts"
    );
    expect(outboxWorkerGate).toContain(
      "apps/worker/test/auction-settlement-worker.test.ts"
    );
    expect(outboxWorkerGate).toContain(
      "apps/worker/test/transaction-timeout-worker.test.ts"
    );
    expect(outboxWorkerGate).toContain("apps/worker/test/periodic-task.test.ts");
    expect(outboxWorkerGate).toContain(
      "apps/api/test/integration/stage7-notifications-api-flow.test.ts"
    );

    expect(privacyContentGate).toContain("stage9_privacy_content");
    expect(privacyContentGate).toContain(
      "apps/api/test/contracts/content-provider-and-upload.test.ts"
    );
    expect(privacyContentGate).toContain(
      "apps/api/test/integration/stage3-content-review-flow.test.ts"
    );

    expect(runtimeRehearsalGate).toContain(
      "scripts/stage9/ensure-prisma-runtime-engine.mjs"
    );
    expect(runtimeRehearsalGate).toContain("db:generate");
    expect(runtimeRehearsalGate).toContain("scripts/stage1/check-connectivity.mjs");
    expect(runtimeRehearsalGate).toContain("scripts/stage1/rehearse-migration.mjs");
    expect(runtimeRehearsalGate).toContain(
      "scripts/stage1/rehearse-backup-restore.mjs"
    );
    expect(runtimeRehearsalGate).toContain("stage9:ledger");
    expect(runtimeRehearsalGate).toContain("stage9:outbox-worker");

    expect(stateMachineGate).toContain("stage9_state_machine");
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/stage3-content-review-flow.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/auction-session.service.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/bidding.service.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/worker/test/auction-settlement-worker.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/transaction-decision.service.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/transaction-appeal.service.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/api/test/integration/stage6-api-flow.test.ts"
    );
    expect(stateMachineGate).toContain(
      "apps/worker/test/transaction-timeout-worker.test.ts"
    );

    expect(verifier).toContain("parseMode");
    expect(verifier).toContain("evaluateGate");
    expect(verifier).toContain("evaluateManualGateEvidence");
    expect(verifier).toContain("resolveManualEvidencePath");
    expect(verifier).toContain("computeOverallStatus");
    expect(verifier).toContain("writeReports");
    expect(verifier).toContain("STAGE9_MANUAL_EVIDENCE_DIR");
    expect(verifier).toContain("expiresAt must be later");
    expect(verifier).toContain("stage9:discover");
    expect(verifier).toContain("stage9 verification blocked");
  });
});
