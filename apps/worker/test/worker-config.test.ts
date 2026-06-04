import { describe, expect, it } from "vitest";
import { loadWorkerRuntimeConfig, parseRedisUrl } from "../src/worker-config.js";

describe("worker runtime config", () => {
  it("requires Redis and worker identity env vars", () => {
    expect(() => loadWorkerRuntimeConfig({})).toThrow(
      "DATABASE_URL must be configured"
    );
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app"
      })
    ).toThrow(
      "REDIS_URL must be configured"
    );
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0"
      })
    ).toThrow("WORKER_NAME must be configured");
  });

  it("parses runtime Redis settings from env", () => {
    const config = loadWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
      REDIS_URL: "redis://redis:6379/0",
      WORKER_NAME: "auction-worker-runtime",
      LEDGER_CHECK_INTERVAL_SECONDS: "120",
      OUTBOX_DISPATCH_INTERVAL_SECONDS: "7",
      OUTBOX_DISPATCH_LIMIT: "11",
      OUTBOX_DISPATCH_LEASE_SECONDS: "90",
      AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS: "30",
      AUCTION_SETTLEMENT_SCAN_LIMIT: "25"
    });

    expect(config.databaseUrl).toContain("@postgres:5432/auction_app");
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
    expect(config.ledgerCheckIntervalMs).toBe(120_000);
    expect(config.outboxDispatchIntervalMs).toBe(7_000);
    expect(config.outboxDispatchLimit).toBe(11);
    expect(config.outboxDispatchLeaseMs).toBe(90_000);
    expect(config.auctionSettlementScanIntervalMs).toBe(30_000);
    expect(config.auctionSettlementScanLimit).toBe(25);
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
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        WORKER_CONCURRENCY: "100"
      })
    ).toThrow("WORKER_CONCURRENCY must be an integer between 1 and 50");
  });

  it("defaults ledger checks to five minutes and rejects unsafe intervals", () => {
    const config = loadWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
      REDIS_URL: "redis://redis:6379/0",
      WORKER_NAME: "auction-worker-runtime"
    });
    expect(config.ledgerCheckIntervalMs).toBe(300_000);
    expect(config.outboxDispatchIntervalMs).toBe(10_000);
    expect(config.outboxDispatchLimit).toBe(50);
    expect(config.outboxDispatchLeaseMs).toBe(300_000);
    expect(config.auctionSettlementScanIntervalMs).toBe(60_000);
    expect(config.auctionSettlementScanLimit).toBe(50);
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        LEDGER_CHECK_INTERVAL_SECONDS: "0"
      })
    ).toThrow("LEDGER_CHECK_INTERVAL_SECONDS must be a positive integer");
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        OUTBOX_DISPATCH_INTERVAL_SECONDS: "0"
      })
    ).toThrow("OUTBOX_DISPATCH_INTERVAL_SECONDS must be a positive integer");
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        OUTBOX_DISPATCH_LIMIT: "0"
      })
    ).toThrow("OUTBOX_DISPATCH_LIMIT must be a positive integer");
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        OUTBOX_DISPATCH_LEASE_SECONDS: "0"
      })
    ).toThrow("OUTBOX_DISPATCH_LEASE_SECONDS must be a positive integer");
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS: "0"
      })
    ).toThrow(
      "AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS must be a positive integer"
    );
    expect(() =>
      loadWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
        REDIS_URL: "redis://redis:6379/0",
        WORKER_NAME: "auction-worker-runtime",
        AUCTION_SETTLEMENT_SCAN_LIMIT: "0"
      })
    ).toThrow("AUCTION_SETTLEMENT_SCAN_LIMIT must be a positive integer");
  });
});
