import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CommunityAccessService } from "./community-access.service.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: CommunityAccessService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CommunityAccessService(prisma)
    }
  ],
  exports: [CommunityAccessService]
})
export class CommunitiesModule {}
