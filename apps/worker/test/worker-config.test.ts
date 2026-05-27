import { describe, expect, it } from "vitest";
import { loadWorkerRuntimeConfig, parseRedisUrl } from "../src/worker-config.js";

describe("worker runtime config", () => {
  it("uses local Redis defaults", () => {
    const config = loadWorkerRuntimeConfig({});

    expect(config.redisUrl).toBe("redis://localhost:6379/0");
    expect(config.redis).toEqual({
      host: "localhost",
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
      loadWorkerRuntimeConfig({ WORKER_CONCURRENCY: "100" })
    ).toThrow("WORKER_CONCURRENCY must be an integer between 1 and 50");
  });
});
