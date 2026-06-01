import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage 2 seed and verification scripts", () => {
  it("keeps deterministic seed fixtures for platform admin, guardian applicant, community request, and scoped activity admin", () => {
    const seed = readFileSync("apps/api/prisma/seed.mjs", "utf8");

    expect(seed).toContain("seed_user_stage2_platform_admin");
    expect(seed).toContain("mock_openid_stage2_platform_admin");
    expect(seed).toContain("seed_user_stage2_guardian_applicant");
    expect(seed).toContain("mock_openid_stage2_guardian_applicant");
    expect(seed).toContain("seed_user_stage2_activity_admin");
    expect(seed).toContain("mock_openid_stage2_activity_admin");
    expect(seed).toContain("seed_request_stage2_pending");
    expect(seed).toContain("seed_community_stage2_sample");
    expect(seed).toContain("seed_rule_stage2_sample_active");
    expect(seed).toContain("STAGE2JOIN");
    expect(seed).toContain('role: "platform_admin"');
    expect(seed).toContain('role: "activity_admin"');
    expect(seed).toContain("communityCreationRequest.upsert");
    expect(seed).toContain("adminCommunityScope.upsert");
    expect(seed).toContain("communityRuleVersion.upsert");
  });

  it("keeps a Stage 2 verification entrypoint wired through package.json", () => {
    expect(existsSync("scripts/stage2/verify-stage2.mjs")).toBe(true);

    const rootPackage = readFileSync("package.json", "utf8");
    const verifyScript = readFileSync("scripts/stage2/verify-stage2.mjs", "utf8");

    expect(rootPackage).toContain('"stage2:verify"');
    expect(rootPackage).toContain("node scripts/stage2/verify-stage2.mjs");
    expect(verifyScript).toContain("spawnSync");
    expect(verifyScript).toContain('"db:generate"');
    expect(verifyScript).toContain('"db:deploy"');
    expect(verifyScript).toContain('"db:status"');
    expect(verifyScript).toContain('"db:validate"');
    expect(verifyScript).toContain('"db:seed"');
    expect(verifyScript).toContain('"apps/api/test/contracts"');
    expect(verifyScript).toContain('"apps/api/test/integration"');
    expect(verifyScript).toContain('"apps/api/test/runtime/admin-stage2-shell.test.ts"');
    expect(verifyScript).toContain(
      '"apps/api/test/runtime/stage2-controller-di.test.ts"'
    );
    expect(verifyScript).toContain('"typecheck"');
    expect(verifyScript).toContain('"build"');
    expect(verifyScript).toContain("mock_openid_stage2_platform_admin");
    expect(verifyScript).toContain("mock_openid_stage2_guardian_applicant");
    expect(verifyScript).toContain("mock_openid_stage2_activity_admin");
    expect(verifyScript).toContain("seed_request_stage2_pending");
    expect(verifyScript).toContain("seed_community_stage2_sample");
    expect(verifyScript).toContain("seed_rule_stage2_sample_active");
    expect(verifyScript).toContain("STAGE2JOIN");
    expect(verifyScript).toContain("stage2 verification passed");
    expect(verifyScript).toContain("activity-admin scope is missing");
    expect(verifyScript).toContain(
      "applicant should not receive automatic activity-admin scope"
    );
  });
});
