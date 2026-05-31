import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FakeWechatAuthProvider } from "../providers/fake-providers.js";
import { OnboardingService } from "./onboarding.service.js";
import { SensitiveOperationService } from "./sensitive-operation.service.js";
import { SessionService } from "./session.service.js";
import { SessionTokenService } from "./session-token.service.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FakeWechatAuthProvider,
      useFactory: () => new FakeWechatAuthProvider()
    },
    {
      provide: OnboardingService,
      inject: [PrismaService, FakeWechatAuthProvider],
      useFactory: (
        prisma: PrismaService,
        wechatAuth: FakeWechatAuthProvider
      ) => new OnboardingService(prisma, wechatAuth)
    },
    {
      provide: SessionTokenService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new SessionTokenService(config.authTokenSigningKey)
    },
    {
      provide: SessionService,
      inject: [PrismaService, SessionTokenService],
      useFactory: (prisma: PrismaService, tokens: SessionTokenService) =>
        new SessionService(prisma, tokens)
    },
    {
      provide: SensitiveOperationService,
      inject: [PrismaService, SessionService],
      useFactory: (prisma: PrismaService, sessions: SessionService) =>
        new SensitiveOperationService(prisma, sessions)
    }
  ],
  exports: [
    OnboardingService,
    SessionTokenService,
    SessionService,
    SensitiveOperationService
  ]
})
export class AccountsModule {}
