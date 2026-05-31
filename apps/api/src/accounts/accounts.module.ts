import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  FakeSensitiveOperationVerificationProvider,
  FakeWechatAuthProvider
} from "../providers/fake-providers.js";
import { ChildParticipationService } from "./child-participation.service.js";
import { GuardianManagementService } from "./guardian-management.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { RiskGovernanceService } from "./risk-governance.service.js";
import { SensitiveOperationService } from "./sensitive-operation.service.js";
import { SessionService } from "./session.service.js";
import { SessionTokenService } from "./session-token.service.js";
import { AccountsController } from "./accounts.controller.js";

@Module({
  imports: [PrismaModule],
  controllers: [AccountsController],
  providers: [
    {
      provide: FakeWechatAuthProvider,
      useFactory: () => new FakeWechatAuthProvider()
    },
    {
      provide: FakeSensitiveOperationVerificationProvider,
      useFactory: () => new FakeSensitiveOperationVerificationProvider()
    },
    {
      provide: OnboardingService,
      inject: [PrismaService, FakeWechatAuthProvider, SessionService],
      useFactory: (
        prisma: PrismaService,
        wechatAuth: FakeWechatAuthProvider,
        sessions: SessionService
      ) => new OnboardingService(prisma, wechatAuth, sessions)
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
      inject: [
        PrismaService,
        SessionService,
        FakeSensitiveOperationVerificationProvider
      ],
      useFactory: (
        prisma: PrismaService,
        sessions: SessionService,
        verificationProvider: FakeSensitiveOperationVerificationProvider
      ) => new SensitiveOperationService(prisma, sessions, verificationProvider)
    },
    {
      provide: GuardianManagementService,
      inject: [PrismaService, SensitiveOperationService],
      useFactory: (
        prisma: PrismaService,
        sensitiveOperations: SensitiveOperationService
      ) => new GuardianManagementService(prisma, sensitiveOperations)
    },
    {
      provide: ChildParticipationService,
      inject: [PrismaService, SessionService],
      useFactory: (prisma: PrismaService, sessions: SessionService) =>
        new ChildParticipationService(prisma, sessions)
    },
    {
      provide: RiskGovernanceService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new RiskGovernanceService(prisma)
    }
  ],
  exports: [
    OnboardingService,
    SessionTokenService,
    SessionService,
    SensitiveOperationService,
    GuardianManagementService,
    ChildParticipationService,
    RiskGovernanceService
  ]
})
export class AccountsModule {}
