import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readdirSync("apps/api/prisma/migrations")
  .filter((entry) => entry.includes("stage2"))
  .sort()
  .map((entry) =>
    readFileSync(`apps/api/prisma/migrations/${entry}/migration.sql`, "utf8")
  )
  .join("\n");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const schemaNormalized = normalize(schema);
const migrationNormalized = normalize(migration);

const getIndexBlock = (name: string) => {
  const match = migrationNormalized.match(
    new RegExp(`(CREATE (?:UNIQUE )?INDEX "${name}"[^;]+;)`)
  );

  expect(match, `index ${name} should exist`).not.toBeNull();
  return match?.[1] ?? "";
};

const getConstraintBlock = (name: string) => {
  const startMarker = `ADD CONSTRAINT "${name}" CHECK (`;
  const start = migrationNormalized.indexOf(startMarker);

  expect(start, `constraint ${name} should exist`).toBeGreaterThanOrEqual(0);

  const end = migrationNormalized.indexOf(");", start);
  expect(end, `constraint ${name} should terminate`).toBeGreaterThan(start);

  return migrationNormalized.slice(start, end + 2);
};

const getModelBlock = (name: string) => {
  const match = schemaNormalized.match(
    new RegExp(`model ${name} \\{[^}]+\\}`)
  );

  expect(match, `model ${name} should exist`).not.toBeNull();
  return match?.[0] ?? "";
};

const expectMigrationOrder = (earlier: string, later: string) => {
  const earlierIndex = migrationNormalized.indexOf(earlier);
  const laterIndex = migrationNormalized.indexOf(later);

  expect(earlierIndex, `${earlier} should exist`).toBeGreaterThanOrEqual(0);
  expect(laterIndex, `${later} should exist`).toBeGreaterThanOrEqual(0);
  expect(earlierIndex).toBeLessThan(laterIndex);
};

const expectModelAndMigrationPair = (
  modelBlock: string,
  schemaSnippet: string,
  migrationSnippet: string
) => {
  expect(modelBlock).toContain(schemaSnippet);
  expect(migrationNormalized).toContain(migrationSnippet);
};

const expectScopeTargetConstraint = (constraintText: string) => {
  const branchMatches = constraintText.match(/\(\s*"scope" = '[^']+'[^)]*\)/g) ?? [];
  const branches = new Map(
    branchMatches.map((branch) => {
      const scopeMatch = branch.match(/"scope" = '([^']+)'/);
      expect(scopeMatch, `branch should declare scope: ${branch}`).not.toBeNull();
      return [scopeMatch?.[1] ?? "", branch];
    })
  );

  expect(branchMatches.length).toBe(5);
  expect(branches.size).toBe(5);

  const expectBranch = (scope: string, clauses: string[]) => {
    const branch = branches.get(scope);

    expect(branch, `scope branch ${scope} should exist`).toBeDefined();

    for (const clause of clauses) {
      expect(branch).toContain(clause);
    }
  };

  expectBranch("community", [
    `"scope" = 'community'`,
    `"communityId" IS NOT NULL`,
    `"targetId" = "communityId"`,
    `"childId" IS NULL`,
    `"guardianId" IS NULL`,
    `"targetUserId" IS NULL`,
    `"communityMemberId" IS NULL`
  ]);
  expectBranch("child", [
    `"scope" = 'child'`,
    `"childId" IS NOT NULL`,
    `"targetId" = "childId"`,
    `"communityId" IS NULL`,
    `"guardianId" IS NULL`,
    `"targetUserId" IS NULL`,
    `"communityMemberId" IS NULL`
  ]);
  expectBranch("guardian", [
    `"scope" = 'guardian'`,
    `"guardianId" IS NOT NULL`,
    `"targetId" = "guardianId"`,
    `"communityId" IS NULL`,
    `"childId" IS NULL`,
    `"targetUserId" IS NULL`,
    `"communityMemberId" IS NULL`
  ]);
  expectBranch("user", [
    `"scope" = 'user'`,
    `"targetUserId" IS NOT NULL`,
    `"targetId" = "targetUserId"`,
    `"communityId" IS NULL`,
    `"childId" IS NULL`,
    `"guardianId" IS NULL`,
    `"communityMemberId" IS NULL`
  ]);
  expectBranch("community_member", [
    `"scope" = 'community_member'`,
    `"communityMemberId" IS NOT NULL`,
    `"targetId" = "communityMemberId"`,
    `"communityId" IS NOT NULL`,
    `"childId" IS NOT NULL`,
    `"guardianId" IS NULL`,
    `"targetUserId" IS NULL`
  ]);
};

describe("Stage 2 schema", () => {
  it("contains account, guardian, community, and risk models", () => {
    for (const model of [
      "UserSession",
      "TrustedDevice",
      "SensitiveOperationChallenge",
      "ChildGuardianSettings",
      "GuardianDispute",
      "CommunityCreationRequest",
      "CommunityRuleVersion",
      "RiskSignal",
      "RiskRestriction"
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("extends schema fields for community admission and governance", () => {
    const communityCreationRequestModel = getModelBlock("CommunityCreationRequest");

    expect(schemaNormalized).toContain("ruleVersionId String?");
    expect(schemaNormalized).toContain("inviteCodeId String?");
    expect(schemaNormalized).toContain("guardianConfirmedAt DateTime?");
    expect(schemaNormalized).toContain("targetUserId String?");
    expect(schemaNormalized).toContain("communityMemberId String?");
    expect(schemaNormalized).toContain("riskSignalId String?");
    expect(schemaNormalized).toContain(
      "rosterVerificationStatus RosterVerificationStatus @default(pending)"
    );
    expect(schemaNormalized).toContain(
      '@@unique([id, communityId], map: "CommunityRuleVersion_id_communityId_key")'
    );
    expect(schemaNormalized).toContain(
      '@@unique([id, communityId], map: "CommunityInviteCode_id_communityId_key")'
    );
    expect(schemaNormalized).toContain(
      '@@unique([id, communityId, childId], map: "CommunityMember_id_communityId_childId_key")'
    );
    expect(schemaNormalized).toContain(`@relation("RiskSignalTargetUser"`);
    expect(schemaNormalized).toContain(`@relation("RiskRestrictionTargetUser"`);
    expect(schemaNormalized).toContain(`@relation("RiskSignalRestrictions"`);
    expect(schemaNormalized).toContain(
      '@relation(fields: [ruleVersionId, communityId], references: [id, communityId], onDelete: Restrict)'
    );
    expect(schemaNormalized).toContain(
      '@relation(fields: [inviteCodeId, communityId], references: [id, communityId], onDelete: Restrict)'
    );
    expect(schemaNormalized).toContain(
      '@relation("RiskSignalCommunityMember", fields: [communityMemberId, communityId, childId], references: [id, communityId, childId], onDelete: Restrict)'
    );
    expect(schemaNormalized).toContain(
      '@relation("RiskRestrictionCommunityMember", fields: [communityMemberId, communityId, childId], references: [id, communityId, childId], onDelete: Restrict)'
    );
    expect(schemaNormalized).toContain(
      "@@index([communityMemberId, communityId, childId])"
    );
    expect(schemaNormalized).toContain(
      '@@index([scope, targetId, status], map: "RiskRestriction_scope_target_status_idx")'
    );
    expect(schemaNormalized).toContain("@@index([riskSignalId, status])");
    expect(schemaNormalized).toContain("model AdminCommunityScope {");
    expect(communityCreationRequestModel).toContain("applicantGuardian");
    expect(communityCreationRequestModel).toContain("reviewedBy");
    expect(communityCreationRequestModel).toContain("approvedCommunity");
    expect(communityCreationRequestModel).not.toContain("AdminCommunityScope");
    expect(communityCreationRequestModel).not.toContain("communityScopes");
  });

  it("keeps migration invariants, constraints, and backfills", () => {
    expect(getIndexBlock("GuardianDispute_one_unresolved_per_child_idx")).toContain(
      `WHERE "status" IN ('pending_platform_review', 'frozen')`
    );
    expect(
      getIndexBlock("CommunityRuleVersion_one_active_per_community_idx")
    ).toContain(`WHERE "status" = 'active'`);
    expect(migrationNormalized).toContain(
      "GuardianDispute_one_unresolved_per_child_idx"
    );
    expect(migrationNormalized).toContain(
      "CommunityRuleVersion_one_active_per_community_idx"
    );
    expect(migrationNormalized).toContain(
      "CommunityMember_id_communityId_childId_key"
    );
    expect(migrationNormalized).toContain(
      "CommunityRuleVersion_id_communityId_key"
    );
    expect(migrationNormalized).toContain(
      "CommunityInviteCode_id_communityId_key"
    );
    expect(migrationNormalized).toContain("RiskSignal_communityId_fkey");
    expect(migrationNormalized).toContain("RiskSignal_targetUserId_fkey");
    expect(migrationNormalized).toContain(
      "RiskSignal_communityMember_target_fkey"
    );
    expect(migrationNormalized).toContain("RiskSignal_guardianId_fkey");
    expect(migrationNormalized).toContain("RiskRestriction_targetUserId_fkey");
    expect(migrationNormalized).toContain("RiskRestriction_riskSignalId_fkey");
    expect(migrationNormalized).toContain(
      "RiskRestriction_communityMember_target_fkey"
    );
    expect(migrationNormalized).toContain("RiskRestriction_guardianId_fkey");
    expect(migrationNormalized).toContain(
      'ALTER TABLE "CommunityInviteCode" ADD CONSTRAINT "CommunityInviteCode_ruleVersion_community_fkey" FOREIGN KEY ("ruleVersionId", "communityId") REFERENCES "CommunityRuleVersion"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_inviteCode_community_fkey" FOREIGN KEY ("inviteCodeId", "communityId") REFERENCES "CommunityInviteCode"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_ruleVersion_community_fkey" FOREIGN KEY ("ruleVersionId", "communityId") REFERENCES "CommunityRuleVersion"("id", "communityId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;'
    );
    expect(migrationNormalized).toContain(
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_imposedByUserId_fkey" FOREIGN KEY ("imposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;'
    );
    expect(getIndexBlock("RiskSignal_communityMemberId_communityId_childId_idx")).toContain(
      'ON "RiskSignal"("communityMemberId", "communityId", "childId")'
    );
    expect(
      getIndexBlock("RiskRestriction_communityMemberId_communityId_childId_idx")
    ).toContain(
      'ON "RiskRestriction"("communityMemberId", "communityId", "childId")'
    );
    expect(getIndexBlock("RiskRestriction_riskSignalId_status_idx")).toContain(
      'ON "RiskRestriction"("riskSignalId", "status")'
    );
    expect(getIndexBlock("CommunityInviteCode_ruleVersionId_communityId_idx")).toContain(
      'ON "CommunityInviteCode"("ruleVersionId", "communityId")'
    );
    expect(getIndexBlock("CommunityMember_inviteCodeId_communityId_idx")).toContain(
      'ON "CommunityMember"("inviteCodeId", "communityId")'
    );
    expect(getIndexBlock("CommunityMember_ruleVersionId_communityId_idx")).toContain(
      'ON "CommunityMember"("ruleVersionId", "communityId")'
    );
    expect(migrationNormalized).toContain(
      'UPDATE "CommunityInviteCode"'
    );
    expect(migrationNormalized).toContain('UPDATE "CommunityMember"');
    expect(migrationNormalized).toContain("legacy_active_stage1_member");
    expect(migrationNormalized).toContain(
      "ChildGuardianSettings_maxBidPoints_positive_check"
    );
    expect(migrationNormalized).toContain(
      "CommunityCreationRequest_expectedMemberSize_positive_check"
    );
    expect(migrationNormalized).toContain(
      "CommunityRuleVersion_versionNo_positive_check"
    );
    expect(migrationNormalized).toContain("stage2_migration");
    expect(migrationNormalized).not.toContain('INSERT INTO "AdminCommunityScope"');
    expect(migrationNormalized).not.toContain('UPDATE "AdminCommunityScope"');
    expectMigrationOrder(
      'INSERT INTO "CommunityRuleVersion" (',
      'ALTER TABLE "CommunityInviteCode" ADD CONSTRAINT "CommunityInviteCode_ruleVersion_community_fkey"'
    );
    expectMigrationOrder(
      'UPDATE "CommunityInviteCode" cic SET "ruleVersionId" = crv."id"',
      'ALTER TABLE "CommunityInviteCode" ADD CONSTRAINT "CommunityInviteCode_ruleVersion_community_fkey"'
    );
    expectMigrationOrder(
      'UPDATE "CommunityMember" cm SET "ruleVersionId" = crv."id"',
      'ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_ruleVersion_community_fkey"'
    );
  });

  it("keeps Prisma risk targets aligned with restrictive SQL foreign keys", () => {
    const riskSignalModel = getModelBlock("RiskSignal");
    const riskRestrictionModel = getModelBlock("RiskRestriction");

    expectModelAndMigrationPair(
      riskSignalModel,
      'targetUser User? @relation("RiskSignalTargetUser", fields: [targetUserId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskSignalModel,
      'communityMember CommunityMember? @relation("RiskSignalCommunityMember", fields: [communityMemberId, communityId, childId], references: [id, communityId, childId], onDelete: Restrict)',
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskSignalModel,
      'community AuctionCommunity? @relation(fields: [communityId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskSignalModel,
      'child ChildProfile? @relation(fields: [childId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskSignalModel,
      'guardian GuardianProfile? @relation(fields: [guardianId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskSignal" ADD CONSTRAINT "RiskSignal_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'targetUser User? @relation("RiskRestrictionTargetUser", fields: [targetUserId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'communityMember CommunityMember? @relation("RiskRestrictionCommunityMember", fields: [communityMemberId, communityId, childId], references: [id, communityId, childId], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_communityMember_target_fkey" FOREIGN KEY ("communityMemberId", "communityId", "childId") REFERENCES "CommunityMember"("id", "communityId", "childId") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'community AuctionCommunity? @relation(fields: [communityId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "AuctionCommunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'child ChildProfile? @relation(fields: [childId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'guardian GuardianProfile? @relation(fields: [guardianId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "GuardianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
    expectModelAndMigrationPair(
      riskRestrictionModel,
      'riskSignal RiskSignal? @relation("RiskSignalRestrictions", fields: [riskSignalId], references: [id], onDelete: Restrict)',
      'ALTER TABLE "RiskRestriction" ADD CONSTRAINT "RiskRestriction_riskSignalId_fkey" FOREIGN KEY ("riskSignalId") REFERENCES "RiskSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
    );
  });

  it("defines full scope-target semantics for risk signal constraints", () => {
    const constraintText = getConstraintBlock("RiskSignal_scope_target_check");

    expectScopeTargetConstraint(constraintText);
  });

  it("defines full scope-target semantics for risk restriction constraints", () => {
    const constraintText = getConstraintBlock("RiskRestriction_scope_target_check");

    expectScopeTargetConstraint(constraintText);
  });
});
