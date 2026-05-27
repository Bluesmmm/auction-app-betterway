import { Redis } from "ioredis";
import { AppConfigService } from "../config/app-config.service.js";

export type RedisReadiness =
  | {
      status: "ready";
      latencyMs: number;
    }
  | {
      status: "unready";
      latencyMs: number;
      errorCode: "REDIS_UNAVAILABLE";
    };

export type WorkerReadiness =
  | {
      status: "ready";
      workerName: string;
      heartbeatAgeMs: number;
    }
  | {
      status: "unready";
      workerName: string;
      errorCode: "WORKER_HEARTBEAT_MISSING" | "WORKER_HEARTBEAT_STALE";
      heartbeatAgeMs?: number;
    };

export class RedisReadinessService {
  constructor(private readonly config: AppConfigService) {}

  async checkReadiness(): Promise<RedisReadiness> {
    const startedAt = Date.now();
    const redis = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 0,
      lazyConnect: true
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== "PONG") {
        throw new Error("unexpected redis ping response");
      }

      return {
        status: "ready",
        latencyMs: Date.now() - startedAt
      };
    } catch {
      return {
        status: "unready",
        latencyMs: Date.now() - startedAt,
        errorCode: "REDIS_UNAVAILABLE"
      };
    } finally {
      redis.disconnect();
    }
  }

  async checkWorkerReadiness(): Promise<WorkerReadiness> {
    const redis = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 0,
      lazyConnect: true
    });

    try {
      await redis.connect();
      const heartbeat = await redis.get(this.config.workerHeartbeatKey);
      if (!heartbeat) {
        return {
          status: "unready",
          workerName: this.config.workerName,
          errorCode: "WORKER_HEARTBEAT_MISSING"
        };
      }

      const heartbeatAt = Number(heartbeat);
      const heartbeatAgeMs = Date.now() - heartbeatAt;
      if (
        !Number.isFinite(heartbeatAt) ||
        heartbeatAgeMs > this.config.workerHeartbeatStaleAfterMs
      ) {
        return {
          status: "unready",
          workerName: this.config.workerName,
          errorCode: "WORKER_HEARTBEAT_STALE",
          heartbeatAgeMs
        };
      }

      return {
        status: "ready",
        workerName: this.config.workerName,
        heartbeatAgeMs
      };
    } catch {
      return {
        status: "unready",
        workerName: this.config.workerName,
        errorCode: "WORKER_HEARTBEAT_MISSING"
      };
    } finally {
      redis.disconnect();
    }
  }
}
