import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { AccountsController } from "../../src/accounts/accounts.controller.js";
import { GuardianManagementService } from "../../src/accounts/guardian-management.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { RiskGovernanceService } from "../../src/accounts/risk-governance.service.js";
import { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import { CommunityApplicationService } from "../../src/communities/community-application.service.js";
import { CommunitiesController } from "../../src/communities/communities.controller.js";

describe("Stage 2 controller dependency injection", () => {
  it("creates Stage 2 controllers through the real Nest container", async () => {
    const app = await NestFactory.createApplicationContext(
      Stage2ControllerDiTestModule,
      {
        logger: false
      }
    );

    try {
      const accounts = app.get(AccountsController);
      const communities = app.get(CommunitiesController);

      expect(controllerDeps(accounts, [
        "onboarding",
        "sessions",
        "guardians",
        "sensitiveOperations",
        "sessionTokens"
      ])).toEqual({
        onboarding: true,
        sessions: true,
        guardians: true,
        sensitiveOperations: true,
        sessionTokens: true
      });
      expect(controllerDeps(communities, [
        "applications",
        "adminAuthorizations",
        "access",
        "risks",
        "sessionTokens",
        "sessions"
      ])).toEqual({
        applications: true,
        adminAuthorizations: true,
        access: true,
        risks: true,
        sessionTokens: true,
        sessions: true
      });
    } finally {
      await app.close();
    }
  });
});

class Stage2ControllerDiTestModule {}

Module({
  controllers: [AccountsController, CommunitiesController],
  providers: [
    { provide: OnboardingService, useValue: {} },
    { provide: SessionService, useValue: {} },
    { provide: GuardianManagementService, useValue: {} },
    { provide: SensitiveOperationService, useValue: {} },
    { provide: SessionTokenService, useValue: {} },
    { provide: CommunityApplicationService, useValue: {} },
    { provide: CommunityAdminAuthorizationService, useValue: {} },
    { provide: CommunityAccessService, useValue: {} },
    { provide: RiskGovernanceService, useValue: {} }
  ]
})(Stage2ControllerDiTestModule);

function controllerDeps<T extends string>(
  controller: object,
  keys: T[]
): Record<T, boolean> {
  const instance = controller as Record<string, unknown>;
  return Object.fromEntries(
    keys.map((key) => [key, Boolean(instance[key])])
  ) as Record<T, boolean>;
}
