import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage 5 verification scripts", () => {
  it("keeps a Stage 5 verification entrypoint wired through package.json", () => {
    expect(existsSync("scripts/stage5/verify-stage5.mjs")).toBe(true);

    const rootPackage = readFileSync("package.json", "utf8");
    const verifyScript = readFileSync("scripts/stage5/verify-stage5.mjs", "utf8");
    const runtimeCompose = readFileSync("docker-compose.runtime.yml", "utf8");

    expect(rootPackage).toContain('"stage5:verify"');
    expect(rootPackage).toContain("node scripts/stage5/verify-stage5.mjs");

    expect(verifyScript).toContain('"runtime:up"');
    expect(verifyScript).toContain('"db:generate"');
    expect(verifyScript).toContain('"db:deploy"');
    expect(verifyScript).toContain('"db:validate"');
    expect(verifyScript).toContain('"stage5_verify_api"');
    expect(verifyScript).toContain('"stage5_verify_bidding"');
    expect(verifyScript).toContain('"stage5_verify_worker"');
    expect(verifyScript).toContain(
      '"apps/api/test/contracts/stage5-schema.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/point-ledger.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/auction-session.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/transaction-decision.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/runtime/admin-stage4-shell.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/runtime/stage4-controller-di.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/api/test/integration/bidding.service.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/worker/test/outbox-dispatcher.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/worker/test/auction-settlement-worker.test.ts"'
    );
    expect(verifyScript).toContain(
      '"apps/worker/test/transaction-timeout-worker.test.ts"'
    );
    expect(verifyScript).toContain('"typecheck"');
    expect(verifyScript).toContain('"build"');
    expect(verifyScript).toContain("stage5 verification passed");

    expect(runtimeCompose).toContain(
      "OUTBOX_DISPATCH_INTERVAL_SECONDS: ${OUTBOX_DISPATCH_INTERVAL_SECONDS:-10}"
    );
    expect(runtimeCompose).toContain(
      "OUTBOX_DISPATCH_LIMIT: ${OUTBOX_DISPATCH_LIMIT:-50}"
    );
    expect(runtimeCompose).toContain(
      "OUTBOX_DISPATCH_LEASE_SECONDS: ${OUTBOX_DISPATCH_LEASE_SECONDS:-300}"
    );
    expect(runtimeCompose).toContain(
      "AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS: ${AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS:-60}"
    );
    expect(runtimeCompose).toContain(
      "AUCTION_SETTLEMENT_SCAN_LIMIT: ${AUCTION_SETTLEMENT_SCAN_LIMIT:-50}"
    );
    expect(runtimeCompose).toContain(
      "TRANSACTION_TIMEOUT_SCAN_INTERVAL_SECONDS: ${TRANSACTION_TIMEOUT_SCAN_INTERVAL_SECONDS:-60}"
    );
    expect(runtimeCompose).toContain(
      "TRANSACTION_TIMEOUT_SCAN_LIMIT: ${TRANSACTION_TIMEOUT_SCAN_LIMIT:-50}"
    );
  });
});
