import { Module } from "@nestjs/common";
import { ChildParticipationService } from "../accounts/child-participation.service.js";
import { AccountsModule } from "../accounts/accounts.module.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { AppConfigService } from "../config/app-config.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGatewayService } from "./realtime-gateway.service.js";
import { RealtimePermissionService } from "./realtime-permission.service.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [
    {
      provide: RealtimePermissionService,
      inject: [PrismaService, ChildParticipationService],
      useFactory: (
        prisma: PrismaService,
        participation: ChildParticipationService
      ) => new RealtimePermissionService(prisma, participation)
    },
    {
      provide: RealtimeGatewayService,
      inject: [
        RealtimePermissionService,
        SessionTokenService,
        SessionService,
        AppConfigService
      ],
      useFactory: (
        permissions: RealtimePermissionService,
        tokens: SessionTokenService,
        sessions: SessionService,
        config: AppConfigService
      ) => new RealtimeGatewayService(permissions, tokens, sessions, config)
    }
  ],
  exports: [RealtimeGatewayService, RealtimePermissionService]
})
export class RealtimeModule {}
