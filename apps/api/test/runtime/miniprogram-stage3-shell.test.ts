import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("miniprogram stage3 shell", () => {
  it("registers submit and detail pages", () => {
    const app = readFileSync("apps/miniprogram/app.json", "utf8");
    expect(app).toContain("pages/stage3/item-submit/index");
    expect(app).toContain("pages/stage3/item-detail/index");
    expect(app).toContain("pages/stage3/wanted-submit/index");
    expect(app).toContain("pages/stage3/wanted-response/index");
  });

  it("builds stage3 request helpers", () => {
    const api = readFileSync("apps/miniprogram/src/stage3-api.ts", "utf8");
    expect(api).toContain("buildSubmitItemRequest");
    expect(api).toContain("buildVisibleItemDetailRequest");
    expect(api).toContain("buildSubmitWantedPostRequest");
    expect(api).toContain("buildSubmitWantedResponseRequest");
    expect(api).toContain("buildVisibleWantedPostDetailRequest");
    expect(api).toContain("buildVisibleWantedResponseDetailRequest");
  });
});
