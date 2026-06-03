import { Module } from "@nestjs/common";
import { SensitiveOperationService } from "../accounts/sensitive-operation.service.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { AccountsModule } from "../accounts/accounts.module.js";
import { AppConfigService } from "../config/app-config.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LedgerCheckService } from "./ledger-check.service.js";
import { PointLedgerService } from "./point-ledger.service.js";
import { PointsController } from "./points.controller.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [PointsController],
  providers: [
    {
      provide: PointLedgerService,
      inject: [PrismaService, SensitiveOperationService, AppConfigService],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService,
        config: AppConfigService
      ) => new PointLedgerService(prisma, sensitiveOperations, config)
    },
    {
      provide: LedgerCheckService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new LedgerCheckService(prisma)
    }
  ],
  exports: [PointLedgerService, LedgerCheckService]
})
export class PointsModule {}

export const pointsControllerDependencies = [
  PointLedgerService,
  LedgerCheckService,
  SessionService,
  SessionTokenService
] as const;
