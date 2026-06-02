import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appModule = readFileSync("apps/api/src/app.module.ts", "utf8");
const contentController = readFileSync(
  "apps/api/src/content/content.controller.ts",
  "utf8"
);
const contentModule = readFileSync("apps/api/src/content/content.module.ts", "utf8");

describe("Stage 3 content controller wiring", () => {
  it("registers ContentModule in the root app module", () => {
    expect(appModule).toContain('import { ContentModule } from "./content/content.module.js";');
    expect(appModule).toContain("ContentModule");
  });

  it("declares the content controller route prefix and module", () => {
    expect(contentController).toContain('Controller("content")(ContentController)');
    expect(contentController).toContain('Post("wanted-posts")');
    expect(contentController).toContain('Post("wanted-posts/:wantedPostId/responses")');
    expect(contentController).toContain(
      'Get("communities/:communityId/wanted-posts/:wantedPostId/visible-detail")'
    );
    expect(contentController).toContain(
      'Get("communities/:communityId/wanted-responses/:wantedResponseId/visible-detail")'
    );
    expect(contentModule).toContain("controllers: [ContentController]");
    expect(contentModule).toContain("ContentReviewService");
    expect(contentModule).toContain("ContentVisibilityService");
    expect(contentModule).toContain("ContentFileAccessService");
  });
});
