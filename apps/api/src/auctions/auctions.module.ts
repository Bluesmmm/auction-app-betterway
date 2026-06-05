import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FakeContentSafetyProvider } from "../providers/fake-providers.js";
import { AuctionPermissionsService } from "./auction-permissions.service.js";
import { BiddingService } from "./bidding.service.js";
import { AuctionSessionService } from "./auction-session.service.js";
import { TransactionAppealService } from "./transaction-appeal.service.js";
import { TransactionDecisionService } from "./transaction-decision.service.js";

@Module({
  imports: [PrismaModule],
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
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new BiddingService(prisma)
    },
    {
      provide: TransactionDecisionService,
      inject: [PrismaService, AuctionPermissionsService],
      useFactory: (
        prisma: PrismaService,
        permissions: AuctionPermissionsService
      ) => new TransactionDecisionService(prisma, permissions)
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
