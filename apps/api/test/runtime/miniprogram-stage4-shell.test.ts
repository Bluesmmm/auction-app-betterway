import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("miniprogram stage4 shell", () => {
  it("registers the points page", () => {
    const app = readFileSync("apps/miniprogram/app.json", "utf8");

    expect(app).toContain("pages/stage4/points/index");
  });

  it("builds stage4 point summary and guardian request helpers", () => {
    const api = readFileSync("apps/miniprogram/src/stage4-api.ts", "utf8");
    const page = readFileSync(
      "apps/miniprogram/pages/stage4/points/index.ts",
      "utf8"
    );

    expect(api).toContain("/points/children/");
    expect(api).toContain("/summary");
    expect(api).toContain("/adjustment-requests");
    expect(api).toContain("buildPointSummaryRequest");
    expect(api).toContain("buildSubmitGuardianPointAdjustmentRequest");
    expect(page).toContain("stage4PointsPage");
    expect(page).toContain("loadPointSummary");
    expect(page).toContain("submitGuardianPointAdjustment");
  });
});
