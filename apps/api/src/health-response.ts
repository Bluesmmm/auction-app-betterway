import type { AppConfigService } from "./config/app-config.service.js";
import type { DatabaseReadiness } from "./prisma/prisma.service.js";
import type {
  RedisReadiness,
  WorkerReadiness
} from "./runtime/redis-readiness.service.js";

export function buildHealthResponse(
  database: DatabaseReadiness,
  redis: RedisReadiness,
  worker: WorkerReadiness,
  config: Pick<AppConfigService, "nodeEnv" | "redisUrl">,
  serverTime: Date = new Date()
) {
  const status =
    database.status === "ready" &&
    redis.status === "ready" &&
    worker.status === "ready"
      ? "ok"
      : "degraded";

  return {
    status,
    api: {
      status: "alive",
      environment: config.nodeEnv,
      serverTime: serverTime.toISOString()
    },
    database,
    redis,
    worker
  };
}
