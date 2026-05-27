import { Global, Module } from "@nestjs/common";
import { AppConfigModule } from "../config/app-config.module.js";
import { AppConfigService } from "../config/app-config.service.js";
import { RedisReadinessService } from "./redis-readiness.service.js";

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: RedisReadinessService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new RedisReadinessService(config)
    }
  ],
  exports: [RedisReadinessService]
})
export class RuntimeModule {}
