import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage8 verification script", () => {
  it("covers governance APIs, admin shell, and quality gates", () => {
    const script = readFileSync("scripts/stage8/verify-stage8.mjs", "utf8");
    const pkg = readFileSync("package.json", "utf8");

    expect(pkg).toContain('"stage8:verify"');
    expect(script).toContain("stage8_verify_api");
    expect(script).toContain("stage8TestFiles");
    expect(script).toContain("requiredCoverageCategories");
    expect(script).toContain("stage8CoverageMatrix");
    expect(script).toContain("assertStage8VerificationCoverage");
    expect(script).toContain("apps/api/test/contracts/stage8.controller.test.ts");
    expect(script).toContain(
      "apps/api/test/contracts/stage8-governance-controls-schema.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/stage8-high-risk-governance-review-schema.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/admin-security.service.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/stage8-governance-flow.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts"
    );
    expect(script).toContain("apps/worker/test/worker-config.test.ts");
    expect(script).toContain(
      "apps/worker/test/high-risk-governance-review-expiry-worker.test.ts"
    );
    expect(script).toContain("apps/worker/test/notification-sender.test.ts");
    expect(script).toContain("apps/worker/test/auction-settlement-worker.test.ts");
    expect(script).toContain("apps/api/test/runtime/admin-stage8-shell.test.ts");
    expect(script).toContain("apps/api/test/runtime/stage8-scripts.test.ts");
    expect(script).toContain("npm\", [\"run\", \"typecheck\"]");
    expect(script).toContain("npm\", [\"run\", \"build\"]");
    expect(script).toContain("git\", [\"diff\", \"--check\"]");
    for (const category of [
      "contract",
      "integration",
      "state-race",
      "authorization",
      "transaction",
      "notification",
      "worker",
      "compatibility",
      "guard-regression",
      "routing-flag-approve-invalidation",
      "idempotency-payload-conflict",
      "approve-retry-terminal",
      "runtime-shell",
      "quality-gates"
    ]) {
      expect(script).toContain(category);
    }
  });
});
