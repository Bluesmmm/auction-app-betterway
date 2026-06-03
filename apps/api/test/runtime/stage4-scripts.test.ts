import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage 4 verification scripts", () => {
  it("keeps a Stage 4 verification entrypoint wired through package.json", () => {
    expect(existsSync("scripts/stage4/check-ledger.mjs")).toBe(true);
    expect(existsSync("scripts/stage4/verify-stage4.mjs")).toBe(true);

    const rootPackage = readFileSync("package.json", "utf8");
    const ledgerCheckScript = readFileSync(
      "scripts/stage4/check-ledger.mjs",
      "utf8"
    );
    const verifyScript = readFileSync("scripts/stage4/verify-stage4.mjs", "utf8");
    const runtimeCompose = readFileSync("docker-compose.runtime.yml", "utf8");

    expect(rootPackage).toContain('"stage4:ledger-check"');
    expect(rootPackage).toContain("node scripts/stage4/check-ledger.mjs");
    expect(rootPackage).toContain('"stage4:verify"');
    expect(rootPackage).toContain("node scripts/stage4/verify-stage4.mjs");

    expect(ledgerCheckScript).toContain("ledgerCheckRun.create");
    expect(ledgerCheckScript).toContain("ledgerCheckDiff.createMany");
    expect(ledgerCheckScript).toContain('"snapshot_mismatch"');
    expect(ledgerCheckScript).toContain('"active_hold_mismatch"');
    expect(ledgerCheckScript).toContain('"negative_replay"');
    expect(ledgerCheckScript).toContain('"missing_account"');
    expect(ledgerCheckScript).toContain("process.exit(1)");

    expect(verifyScript).toContain('"runtime:up"');
    expect(verifyScript).toContain('"db:generate"');
    expect(verifyScript).toContain('"db:deploy"');
    expect(verifyScript).toContain('"db:validate"');
    expect(verifyScript).toContain(
      '"apps/api/test/contracts/stage4-schema.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/point-ledger.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/ledger-check.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/worker/test/ledger-check-worker.test.ts"'
    );
    expect(verifyScript).toContain('"stage4:ledger-check"');
    expect(verifyScript).toContain('"typecheck"');
    expect(verifyScript).toContain('"build"');
    expect(verifyScript).toContain("stage4 verification passed");

    expect(runtimeCompose).toContain(
      "LEDGER_CHECK_INTERVAL_SECONDS: ${LEDGER_CHECK_INTERVAL_SECONDS:-300}"
    );
  });
});
