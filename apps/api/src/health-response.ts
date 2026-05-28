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
  const adjudicatedServerTime = serverTime.toISOString();
  const status =
    database.status === "ready" &&
    redis.status === "ready" &&
    worker.status === "ready"
      ? "ok"
      : "degraded";

  return {
    status,
    serverTime: adjudicatedServerTime,
    targetType: "runtime_health",
    targetId: "stage1-runtime",
    targetVersion: 1,
    api: {
      status: "alive",
      environment: config.nodeEnv,
      serverTime: adjudicatedServerTime
    },
    database,
    redis,
    worker
  };
}
