import { Module } from "@nestjs/common";
import { AccountsModule } from "./accounts/accounts.module.js";
import { AdminSecurityModule } from "./admin-security/admin-security.module.js";
import { CommunitiesModule } from "./communities/communities.module.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RuntimeModule } from "./runtime/runtime.module.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RuntimeModule,
    AccountsModule,
    CommunitiesModule,
    StorageModule,
    AdminSecurityModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
