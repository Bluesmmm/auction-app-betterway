import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage7 verification script", () => {
  it("covers notification, search, realtime, worker, shell, and quality gates", () => {
    const script = readFileSync("scripts/stage7/verify-stage7.mjs", "utf8");
    const pkg = readFileSync("package.json", "utf8");

    expect(pkg).toContain('"stage7:verify"');
    expect(script).toContain("stage7_verify_api");
    expect(script).toContain("stage7_verify_worker");
    expect(script).toContain(
      "apps/api/test/contracts/stage7-notifications-schema.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/stage7-search-schema.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/stage7-realtime-contract.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/notifications.controller.test.ts"
    );
    expect(script).toContain("apps/api/test/contracts/stage7.controller.test.ts");
    expect(script).toContain(
      "apps/api/test/contracts/realtime-permission.service.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/contracts/realtime-gateway.service.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/stage7-notifications-api-flow.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/stage7-search-favorites-flow.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/stage3-content-review-flow.test.ts"
    );
    expect(script).toContain(
      "apps/api/test/integration/auction-session.service.test.ts"
    );
    expect(script).toContain("apps/worker/test/notification-sender.test.ts");
    expect(script).toContain("apps/worker/test/outbox-dispatcher.test.ts");
    expect(script).toContain("apps/worker/test/realtime-hint-publisher.test.ts");
    expect(script).toContain(
      "apps/api/test/runtime/miniprogram-stage7-shell.test.ts"
    );
    expect(script).toContain("npm\", [\"run\", \"typecheck\"]");
    expect(script).toContain("npm\", [\"run\", \"build\"]");
    expect(script).toContain("git\", [\"diff\", \"--check\"]");
  });
});
