import { describe, expect, it } from "vitest";
import { loadWorkerRuntimeConfig, parseRedisUrl } from "../src/worker-config.js";

describe("worker runtime config", () => {
  it("requires Redis and worker identity env vars", () => {
    expect(() => loadWorkerRuntimeConfig({})).toThrow(
      "REDIS_URL must be configured"
    );
    expect(() =>
      loadWorkerRuntimeConfig({ REDIS_URL: "redis://redis:6379/0" })
    ).toThrow("WORKER_NAME must be configured");
  });

  it("parses runtime Redis settings from env", () => {
    const config = loadWorkerRuntimeConfig({
      REDIS_URL: "redis://redis:6379/0",
      WORKER_NAME: "auction-worker-runtime"
    });

    expect(config.redisUrl).toBe("redis://redis:6379/0");
    expect(config.workerName).toBe("auction-worker-runtime");
    expect(config.redis).toEqual({
      host: "redis",
      port: 6379,
      db: 0,
      password: undefined,
      maxRetriesPerRequest: null
    });
    expect(config.concurrency).toBe(5);
  });

  it("parses Redis URLs for BullMQ", () => {
    const config = parseRedisUrl("redis://:secret@redis.local:6380/2");

    expect(config).toEqual({
      host: "redis.local",
      port: 6380,
      password: "secret",
      db: 2,
      maxRetriesPerRequest: null
    });
  });

  it("rejects unsafe worker concurrency", () => {
    expect(() =>
      loadWorkerRuntimeConfig({
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        WORKER_CONCURRENCY: "100"
      })
    ).toThrow("WORKER_CONCURRENCY must be an integer between 1 and 50");
  });
});
