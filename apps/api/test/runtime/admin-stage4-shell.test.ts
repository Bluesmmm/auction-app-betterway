import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin stage4 shell", () => {
  it("exposes the points ledger route and command helpers", () => {
    const app = readFileSync("apps/admin/src/App.tsx", "utf8");
    const nav = readFileSync("apps/admin/src/stage4-nav.ts", "utf8");
    const api = readFileSync("apps/admin/src/stage4-api.ts", "utf8");
    const view = readFileSync("apps/admin/src/stage4-views.tsx", "utf8");

    expect(nav).toContain("Points Ledger");
    expect(nav).toContain("/stage4/points-ledger");
    expect(app).toContain("stage4AdminViewDefinitions");
    expect(app).toContain("/stage4/points-ledger");
    expect(api).toContain("/points/adjustment-requests");
    expect(api).toContain("/points/admin-adjustment-requests");
    expect(api).toContain("PLATFORM_ADMIN_REQUIRED");
    expect(api).toContain("/points/adjustment-requests/:requestId/review");
    expect(api).toContain("/points/adjustment-requests/:requestId/second-review");
    expect(api).toContain("/points/ledger-check-runs");
    expect(view).toContain("Adjustment Queue");
    expect(view).toContain("Ledger Check Results");
    expect(view).toContain("Second Approve");
  });
});
