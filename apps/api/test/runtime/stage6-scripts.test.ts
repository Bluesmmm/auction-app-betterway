import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage 6 verification scripts", () => {
  it("keeps a Stage 6 first-round verification entrypoint wired through package.json", () => {
    expect(existsSync("scripts/stage6/verify-stage6.mjs")).toBe(true);

    const rootPackage = readFileSync("package.json", "utf8");
    const verifyScript = readFileSync("scripts/stage6/verify-stage6.mjs", "utf8");

    expect(rootPackage).toContain('"stage6:verify"');
    expect(rootPackage).toContain("node scripts/stage6/verify-stage6.mjs");

    expect(verifyScript).toContain('"runtime:up"');
    expect(verifyScript).toContain('"db:generate"');
    expect(verifyScript).toContain('"db:validate"');
    expect(verifyScript).toContain('"db:deploy"');
    expect(verifyScript).toContain('"stage6_verify_api"');
    expect(verifyScript).toContain('"stage6_verify_worker"');
    expect(verifyScript).toContain(
      '"apps/api/test/contracts/stage6-schema.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/transaction-decision.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/transaction-appeal.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/runtime/stage6-scripts.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/worker/test/transaction-timeout-worker.test.ts"'
    );
    expect(verifyScript).toContain('"typecheck"');
    expect(verifyScript).toContain('"build"');
    expect(verifyScript).toContain("stage6 verification passed");
  });
});
