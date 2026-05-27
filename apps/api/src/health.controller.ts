import { Controller, Get } from "@nestjs/common";
import { AppConfigService } from "./config/app-config.service.js";
import { buildHealthResponse } from "./health-response.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { RedisReadinessService } from "./runtime/redis-readiness.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisReadinessService,
    private readonly config: AppConfigService
  ) {}

  @Get()
  async getHealth() {
    const [database, redis, worker] = await Promise.all([
      this.prisma.checkReadiness(),
      this.redis.checkReadiness(),
      this.redis.checkWorkerReadiness()
    ]);

    return buildHealthResponse(database, redis, worker, this.config);
  }
}
