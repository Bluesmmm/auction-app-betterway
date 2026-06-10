import { Module } from "@nestjs/common";
import { ChildParticipationService } from "../accounts/child-participation.service.js";
import { AccountsModule } from "../accounts/accounts.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { Stage7Controller } from "./stage7.controller.js";
import { Stage7DiscoveryService } from "./stage7-discovery.service.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [Stage7Controller],
  providers: [
    {
      provide: Stage7DiscoveryService,
      inject: [PrismaService, ChildParticipationService],
      useFactory: (
        prisma: PrismaService,
        participation: ChildParticipationService
      ) => new Stage7DiscoveryService(prisma, participation)
    }
  ],
  exports: [Stage7DiscoveryService]
})
export class Stage7Module {}
