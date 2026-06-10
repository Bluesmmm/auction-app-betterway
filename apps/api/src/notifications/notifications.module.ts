import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NotificationsService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new NotificationsService(prisma)
    }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule {}
