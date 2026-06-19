import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { SensitiveOperationService } from "../accounts/sensitive-operation.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { GovernanceControlService } from "./governance-control.service.js";
import { HighRiskGovernanceReviewService } from "./high-risk-governance-review.service.js";
import { Stage8Controller } from "./stage8.controller.js";
import { Stage8GovernanceService } from "./stage8-governance.service.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [Stage8Controller],
  providers: [
    {
      provide: GovernanceControlService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new GovernanceControlService(prisma)
    },
    {
      provide: HighRiskGovernanceReviewService,
      inject: [PrismaService, SensitiveOperationService],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService
      ) => new HighRiskGovernanceReviewService(prisma, sensitiveOperations)
    },
    {
      provide: Stage8GovernanceService,
      inject: [
        PrismaService,
        SensitiveOperationService,
        HighRiskGovernanceReviewService
      ],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService,
        highRiskGovernanceReview: HighRiskGovernanceReviewService
      ) =>
        new Stage8GovernanceService(
          prisma,
          sensitiveOperations,
          highRiskGovernanceReview
        )
    }
  ],
  exports: [
    Stage8GovernanceService,
    GovernanceControlService,
    HighRiskGovernanceReviewService
  ]
})
export class Stage8Module {}
