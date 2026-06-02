import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin stage3 shell", () => {
  it("exposes a content review route", () => {
    const app = readFileSync("apps/admin/src/App.tsx", "utf8");
    const nav = readFileSync("apps/admin/src/stage3-nav.ts", "utf8");
    expect(nav).toContain("Content Review");
    expect(nav).toContain("/stage3/content-review");
    expect(app).toContain("stage3AdminViewDefinitions");
    expect(app).toContain("/stage3/content-review");
  });
});
