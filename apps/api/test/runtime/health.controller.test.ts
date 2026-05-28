import { describe, expect, it } from "vitest";
import { buildHealthResponse } from "../../src/health-response.js";

describe("HealthController", () => {
  it("reports API alive and database ready separately", async () => {
    const result = buildHealthResponse(
      {
        status: "ready",
        latencyMs: 2,
        serverTime: "2026-05-27T00:00:00.000Z"
      },
      {
        status: "ready",
        latencyMs: 1
      },
      {
        status: "ready",
        workerName: "auction-worker-test",
        heartbeatAgeMs: 100
      },
      {
        nodeEnv: "test",
        redisUrl: "redis://localhost:6379/0"
      },
      new Date("2026-05-27T00:00:00.000Z")
    );

    expect(result.status).toBe("ok");
    expect(result.serverTime).toBe("2026-05-27T00:00:00.000Z");
    expect(result.targetType).toBe("runtime_health");
    expect(result.targetId).toBe("stage1-runtime");
    expect(result.targetVersion).toBe(1);
    expect(result.api.status).toBe("alive");
    expect(result.api.serverTime).toBe("2026-05-27T00:00:00.000Z");
    expect(result.database.status).toBe("ready");
    expect(result.redis.status).toBe("ready");
    expect(result.worker.status).toBe("ready");
  });

  it("keeps API health visible when database readiness fails", async () => {
    const result = buildHealthResponse(
      {
        status: "unready",
        latencyMs: 3,
        errorCode: "DATABASE_UNAVAILABLE"
      },
      {
        status: "ready",
        latencyMs: 1
      },
      {
        status: "ready",
        workerName: "auction-worker-test",
        heartbeatAgeMs: 100
      },
      {
        nodeEnv: "test",
        redisUrl: "redis://localhost:6379/0"
      },
      new Date("2026-05-27T00:00:00.000Z")
    );

    expect(result.status).toBe("degraded");
    expect(result.api.status).toBe("alive");
    expect(result.database.status).toBe("unready");
    if (result.database.status !== "unready") {
      throw new Error("expected database to be unready");
    }
    expect(result.database.errorCode).toBe("DATABASE_UNAVAILABLE");
  });

  it("marks health degraded when worker heartbeat is stale", async () => {
    const result = buildHealthResponse(
      {
        status: "ready",
        latencyMs: 2,
        serverTime: "2026-05-27T00:00:00.000Z"
      },
      {
        status: "ready",
        latencyMs: 1
      },
      {
        status: "unready",
        workerName: "auction-worker-test",
        errorCode: "WORKER_HEARTBEAT_STALE",
        heartbeatAgeMs: 60_000
      },
      {
        nodeEnv: "test",
        redisUrl: "redis://localhost:6379/0"
      },
      new Date("2026-05-27T00:00:00.000Z")
    );

    expect(result.status).toBe("degraded");
    expect(result.worker.status).toBe("unready");
  });
});
