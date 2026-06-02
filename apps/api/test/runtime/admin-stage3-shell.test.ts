import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin stage3 shell", () => {
  it("exposes a content review route", () => {
    const app = readFileSync("apps/admin/src/App.tsx", "utf8");
    const nav = readFileSync("apps/admin/src/stage3-nav.ts", "utf8");
    const api = readFileSync("apps/admin/src/stage3-api.ts", "utf8");
    const view = readFileSync("apps/admin/src/stage3-views.tsx", "utf8");
    expect(nav).toContain("Content Review");
    expect(nav).toContain("/stage3/content-review");
    expect(app).toContain("stage3AdminViewDefinitions");
    expect(app).toContain("/stage3/content-review");
    expect(api).toContain("targetType");
    expect(api).toContain("wantedPostId");
    expect(api).toContain("wantedResponseId");
    expect(api).toContain("aiEvidence");
    expect(api).toContain("originalImageGrants");
    expect(api).toContain("versionDiff");
    expect(view).toContain("wanted response");
    expect(view).toContain("targetLabel");
    expect(view).toContain("AI Evidence");
    expect(view).toContain("Version Diff");
    expect(view).toContain("Original Grants");
  });
});
