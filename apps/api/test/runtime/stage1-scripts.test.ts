import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scripts = [
  "scripts/stage1/check-connectivity.mjs",
  "scripts/stage1/scan-logs.mjs",
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

  it("requires runnable admin and miniprogram skeleton entrypoints", () => {
    const skeletonFiles = [
      "apps/admin/src/main.ts",
      "apps/admin/src/main.tsx",
      "apps/admin/src/App.tsx",
      "apps/admin/src/stage1-shell.ts",
      "apps/admin/tsconfig.build.json",
      "apps/admin/vite.config.ts",
      "apps/miniprogram/app.json",
      "apps/miniprogram/app.ts",
      "apps/miniprogram/pages/health/index.json",
      "apps/miniprogram/pages/health/index.ts"
    ];
    const script = readFileSync("scripts/stage1/check-connectivity.mjs", "utf8");

    for (const file of skeletonFiles) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
      expect(script).toContain(file);
    }
    expect(script).toContain("node\", \"apps/admin/dist/main.js");
    expect(script).toContain("apps/admin/dist/web/index.html");
    expect(script).toContain("API_BASE_URL");
    expect(script).toContain("MINIPROGRAM_API_BASE_URL");
  });

  it("keeps log scanning in the Stage 1 verification path", () => {
    const rootPackage = readFileSync("package.json", "utf8");
    const logScan = readFileSync("scripts/stage1/scan-logs.mjs", "utf8");

    expect(rootPackage).toContain("stage1:log-scan");
    expect(rootPackage).toContain("node scripts/stage1/scan-logs.mjs");
    expect(logScan).toContain("apps/api/dist/runtime/structured-logger.js");
    expect(logScan).toContain("apps/worker/dist/redacting-worker-logger.js");
    expect(logScan).toContain("stage1 log scan passed");
  });

  it("rehearses migration rollback against a temporary database only", () => {
    const script = readFileSync("scripts/stage1/rehearse-migration.mjs", "utf8");

    expect(script).toContain("auction_app_migration_rehearsal");
    expect(script).toContain("/tmp/auction-app-stage1-migration-rollback.sql");
    expect(script).toContain("prepareBaselinePrismaProject");
    expect(script).toContain("deployBaselineDatabase");
    expect(script).toContain("captureRollbackSnapshot");
    expect(script).toContain("restoreRollbackSnapshot");
    expect(script).toContain("dropRehearsalDatabase");
    expect(script).toContain("createRehearsalDatabase");
    expect(script).toContain("DATABASE_URL: rehearsalDatabaseUrl");
    expect(script).not.toContain("dropdb\", \"-U\", \"auction_app\", \"auction_app\"");
  });

  it("uses tracked generic runtime configuration instead of environment-specific env files", () => {
    const rootPackage = readFileSync("package.json", "utf8");
    const connectivity = readFileSync(
      "scripts/stage1/check-connectivity.mjs",
      "utf8"
    );
    const keyRotation = readFileSync(
      "scripts/stage1/rehearse-key-rotation.mjs",
      "utf8"
    );

    expect(existsSync("docker-compose.runtime.yml")).toBe(true);
    expect(rootPackage).toContain("docker-compose.runtime.yml");
    expect(connectivity).toContain("docker-compose.runtime.yml");
    const forbiddenEnvFile = [".env", "staging", "example"].join(".");
    expect(rootPackage).not.toContain(forbiddenEnvFile);
    expect(connectivity).not.toContain(forbiddenEnvFile);
    expect(keyRotation).not.toContain(forbiddenEnvFile);
  });
});
