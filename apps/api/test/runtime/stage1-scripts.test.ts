import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scripts = [
  "scripts/stage1/check-connectivity.mjs",
  "scripts/stage1/rehearse-migration.mjs",
  "scripts/stage1/rehearse-backup-restore.mjs",
  "scripts/stage1/rehearse-key-rotation.mjs"
];

describe("stage 1 rehearsal scripts", () => {
  it("keeps executable rehearsal entrypoints in the repo", () => {
    for (const script of scripts) {
      expect(existsSync(script), `${script} should exist`).toBe(true);
    }
  });

  it("keeps backup restore rehearsal scoped to a temporary database", () => {
    const script = readFileSync(
      "scripts/stage1/rehearse-backup-restore.mjs",
      "utf8"
    );

    expect(script).toContain("auction_app_restore_check");
    expect(script).toContain("/tmp/auction-app-stage1-backup.sql");
    expect(script).not.toContain("dropdb\", \"-U\", \"auction_app\", \"auction_app\"");
  });
});
