import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage 3 readiness script", () => {
  it("checks fourth-round hardening markers", () => {
    const script = readFileSync("scripts/stage3/check-readiness.mjs", "utf8");
    const verify = readFileSync("scripts/stage3/verify-stage3.mjs", "utf8");
    const pkg = readFileSync("package.json", "utf8");

    expect(script).toContain("content_review_original");
    expect(script).toContain("platformReviewModerationTask");
    expect(script).toContain("platformReviewContentTask");
    expect(script).toContain("safety_magnetic_beads");
    expect(script).toContain("historyContext");
    expect(script).toContain("stage3 readiness passed");
    expect(verify).toContain("stage3:readiness");
    expect(pkg).toContain('"stage3:readiness"');
  });
});
