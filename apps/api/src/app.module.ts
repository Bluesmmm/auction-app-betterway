import { Module } from "@nestjs/common";
import { AccountsModule } from "./accounts/accounts.module.js";
import { AdminSecurityModule } from "./admin-security/admin-security.module.js";
import { AuctionsModule } from "./auctions/auctions.module.js";
import { CommunitiesModule } from "./communities/communities.module.js";
import { ContentModule } from "./content/content.module.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { HealthController } from "./health.controller.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PointsModule } from "./points/points.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RuntimeModule } from "./runtime/runtime.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { Stage7Module } from "./stage7/stage7.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RuntimeModule,
    AccountsModule,
    CommunitiesModule,
    AuctionsModule,
    ContentModule,
    PointsModule,
    Stage7Module,
    RealtimeModule,
    NotificationsModule,
    StorageModule,
    AdminSecurityModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
