import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FakeWechatAuthProvider } from "../providers/fake-providers.js";
import { OnboardingService } from "./onboarding.service.js";

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
    }
  ],
  exports: [OnboardingService]
})
export class AccountsModule {}
