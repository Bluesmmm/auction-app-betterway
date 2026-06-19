import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FakeContentSafetyProvider } from "../providers/fake-providers.js";
import { GovernanceControlService } from "../stage8/governance-control.service.js";
import { Stage8Module } from "../stage8/stage8.module.js";
import { AuctionPermissionsService } from "./auction-permissions.service.js";
import { BiddingService } from "./bidding.service.js";
import { AuctionSessionService } from "./auction-session.service.js";
import { AuctionsController } from "./auctions.controller.js";
import { TransactionAppealService } from "./transaction-appeal.service.js";
import { TransactionDecisionService } from "./transaction-decision.service.js";

@Module({
  imports: [PrismaModule, AccountsModule, Stage8Module],
  controllers: [AuctionsController],
  providers: [
    {
      provide: AuctionPermissionsService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new AuctionPermissionsService(prisma)
    },
    {
      provide: AuctionSessionService,
      inject: [PrismaService, AuctionPermissionsService],
      useFactory: (
        prisma: PrismaService,
        permissions: AuctionPermissionsService
      ) => new AuctionSessionService(prisma, permissions)
    },
    {
      provide: BiddingService,
      inject: [PrismaService, GovernanceControlService],
      useFactory: (
        prisma: PrismaService,
        governanceControls: GovernanceControlService
      ) => new BiddingService(prisma, governanceControls)
    },
    {
      provide: TransactionDecisionService,
      inject: [
        PrismaService,
        AuctionPermissionsService,
        GovernanceControlService
      ],
      useFactory: (
        prisma: PrismaService,
        permissions: AuctionPermissionsService,
        governanceControls: GovernanceControlService
      ) => new TransactionDecisionService(prisma, permissions, governanceControls)
    },
    {
      provide: FakeContentSafetyProvider,
      useFactory: () => new FakeContentSafetyProvider()
    },
    {
      provide: TransactionAppealService,
      inject: [PrismaService, FakeContentSafetyProvider],
      useFactory: (
        prisma: PrismaService,
        contentSafety: FakeContentSafetyProvider
      ) => new TransactionAppealService(prisma, contentSafety)
    }
  ],
  exports: [
    AuctionPermissionsService,
    AuctionSessionService,
    BiddingService,
    TransactionDecisionService,
    TransactionAppealService
  ]
})
export class AuctionsModule {}
