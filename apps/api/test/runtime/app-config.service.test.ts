import { describe, expect, it } from "vitest";
import { AppConfigService } from "../../src/config/app-config.service.js";

describe("AppConfigService", () => {
  it("requires runtime connection env vars instead of using source defaults", () => {
    const config = new AppConfigService({});

    expect(config.nodeEnv).toBe("development");
    expect(config.port).toBe(3000);
    expect(() => config.databaseUrl).toThrow("DATABASE_URL must be configured");
    expect(() => config.redisUrl).toThrow("REDIS_URL must be configured");
    expect(() => config.workerName).toThrow("WORKER_NAME must be configured");
    expect(() => config.objectStorageSigningKey).toThrow(
      "OBJECT_STORAGE_KEY_CURRENT must be configured"
    );
  });

  it("reads runtime connection and browser origin configuration from env", () => {
    const config = new AppConfigService({
      DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
      REDIS_URL: "redis://redis:6379/0",
      WORKER_NAME: "auction-worker-runtime",
      OBJECT_STORAGE_KEY_CURRENT: "runtime-object-storage-current",
      CORS_ALLOWED_ORIGINS: "http://localhost:5173, https://admin.example.com"
    });

    expect(config.databaseUrl).toContain("@postgres:5432/auction_app");
    expect(config.redisUrl).toBe("redis://redis:6379/0");
    expect(config.workerName).toBe("auction-worker-runtime");
    expect(config.objectStorageSigningKey).toBe("runtime-object-storage-current");
    expect(config.corsAllowedOrigins).toEqual([
      "http://localhost:5173",
      "https://admin.example.com"
    ]);
  });

  it("rejects invalid ports before API boot", () => {
    const config = new AppConfigService({ PORT: "not-a-port" });

    expect(() => config.port).toThrow("PORT must be an integer");
  });
});
