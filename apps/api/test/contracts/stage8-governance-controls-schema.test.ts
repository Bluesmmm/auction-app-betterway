import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stage8 governance controls schema", () => {
  it("defines dedicated governance control facts and active uniqueness", () => {
    const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "apps/api/prisma/migrations/20260610000000_stage8_governance_controls/migration.sql",
      "utf8"
    );

    expect(schema).toContain("model GovernanceControl");
    expect(schema).toContain("enum GovernanceControlScopeType");
    expect(schema).toContain("pause_publish");
    expect(schema).toContain("pause_bid");
    expect(schema).toContain("pause_settlement");
    expect(schema).toContain("force_platform_review");
    expect(schema).toContain("previewAuditLogId String");
    expect(migration).toContain("GovernanceControl_scope_check");
    expect(migration).toContain(
      "GovernanceControl_active_platform_scope_type_idx"
    );
    expect(migration).toContain(
      "GovernanceControl_active_community_scope_type_idx"
    );
    expect(migration).toContain("WHERE \"status\" = 'active'");
  });
});
