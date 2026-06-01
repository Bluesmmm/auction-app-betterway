import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { RiskGovernanceService } from "../accounts/risk-governance.service.js";
import { SensitiveOperationService } from "../accounts/sensitive-operation.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CommunityAdminAuthorizationService } from "./community-admin-authorization.service.js";
import { CommunityAccessService } from "./community-access.service.js";
import { CommunityApplicationService } from "./community-application.service.js";
import { CommunityRuleService } from "./community-rule.service.js";
import { CommunitiesController } from "./communities.controller.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [CommunitiesController],
  providers: [
    {
      provide: CommunityAccessService,
      inject: [
        PrismaService,
        CommunityAdminAuthorizationService,
        RiskGovernanceService
      ],
      useFactory: (
        prisma: PrismaService,
        adminAuthorizations: CommunityAdminAuthorizationService,
        riskGovernance: RiskGovernanceService
      ) => new CommunityAccessService(prisma, adminAuthorizations, riskGovernance)
    },
    {
      provide: CommunityApplicationService,
      inject: [PrismaService, SensitiveOperationService],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService
      ) => new CommunityApplicationService(prisma, sensitiveOperations)
    },
    {
      provide: CommunityAdminAuthorizationService,
      inject: [PrismaService, SensitiveOperationService],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService
      ) => new CommunityAdminAuthorizationService(prisma, sensitiveOperations)
    },
    {
      provide: CommunityRuleService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CommunityRuleService(prisma)
    }
  ],
  exports: [
    CommunityAccessService,
    CommunityApplicationService,
    CommunityAdminAuthorizationService,
    CommunityRuleService
  ]
})
export class CommunitiesModule {}
