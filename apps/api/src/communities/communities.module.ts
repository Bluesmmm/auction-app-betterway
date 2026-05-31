import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { SensitiveOperationService } from "../accounts/sensitive-operation.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CommunityAdminAuthorizationService } from "./community-admin-authorization.service.js";
import { CommunityAccessService } from "./community-access.service.js";
import { CommunityApplicationService } from "./community-application.service.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [
    {
      provide: CommunityAccessService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CommunityAccessService(prisma)
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
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CommunityAdminAuthorizationService(prisma)
    }
  ],
  exports: [
    CommunityAccessService,
    CommunityApplicationService,
    CommunityAdminAuthorizationService
  ]
})
export class CommunitiesModule {}
