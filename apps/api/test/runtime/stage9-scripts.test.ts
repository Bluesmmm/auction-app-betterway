import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage9 verification scripts", () => {
  it("defines discover, strict verify, full verify, report artifacts, and the initial gate matrix", () => {
    const pkg = readFileSync("package.json", "utf8");
    const matrixPath = "scripts/stage9/gate-matrix.mjs";
    const verifierPath = "scripts/stage9/verify-stage9.mjs";

    expect(pkg).toContain('"stage9:discover"');
    expect(pkg).toContain('"stage9:verify"');
    expect(pkg).toContain('"stage9:verify:full"');
    expect(existsSync(matrixPath)).toBe(true);
    expect(existsSync(verifierPath)).toBe(true);

    const matrix = readFileSync(matrixPath, "utf8");
    const verifier = readFileSync(verifierPath, "utf8");

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
    expect(matrix).toContain("docs/MVP_ROADMAP.md");
    expect(matrix).toContain("artifacts/stage9/prepilot-verification-report.json");
    expect(matrix).toContain("artifacts/stage9/prepilot-verification-report.md");
    expect(matrix).toContain("npm run db:generate");

    expect(verifier).toContain("parseMode");
    expect(verifier).toContain("evaluateGate");
    expect(verifier).toContain("computeOverallStatus");
    expect(verifier).toContain("writeReports");
    expect(verifier).toContain("stage9:discover");
    expect(verifier).toContain("stage9 verification blocked");
  });
});
