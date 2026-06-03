import { readFileSync } from "node:fs";
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
    expect(() => config.authTokenSigningKey).toThrow(
      "AUTH_TOKEN_SIGNING_KEY must be configured"
    );
  });

  it("reads runtime connection and browser origin configuration from env", () => {
    const config = new AppConfigService({
      DATABASE_URL: "postgresql://auction_app:auction_app@postgres:5432/auction_app",
      REDIS_URL: "redis://redis:6379/0",
      WORKER_NAME: "auction-worker-runtime",
      OBJECT_STORAGE_KEY_CURRENT: "runtime-object-storage-current",
      AUTH_TOKEN_SIGNING_KEY: "runtime-auth-token-current",
      INITIAL_CHILD_POINTS: "125",
      POINT_ADJUSTMENT_SINGLE_REVIEW_LIMIT: "75",
      CORS_ALLOWED_ORIGINS: "http://localhost:5173, https://admin.example.com"
    });

    expect(config.databaseUrl).toContain("@postgres:5432/auction_app");
    expect(config.redisUrl).toBe("redis://redis:6379/0");
    expect(config.workerName).toBe("auction-worker-runtime");
    expect(config.objectStorageSigningKey).toBe("runtime-object-storage-current");
    expect(config.authTokenSigningKey).toBe("runtime-auth-token-current");
    expect(config.initialChildPoints).toBe(125);
    expect(config.pointAdjustmentSingleReviewLimit).toBe(75);
    expect(config.corsAllowedOrigins).toEqual([
      "http://localhost:5173",
      "https://admin.example.com"
    ]);
  });

  it("rejects invalid ports before API boot", () => {
    const config = new AppConfigService({ PORT: "not-a-port" });

    expect(() => config.port).toThrow("PORT must be an integer");
  });

  it("uses safe stage defaults for point ledger knobs", () => {
    const config = new AppConfigService({});

    expect(config.initialChildPoints).toBe(100);
    expect(config.pointAdjustmentSingleReviewLimit).toBe(50);
  });

  it("rejects invalid point ledger configuration", () => {
    expect(
      () => new AppConfigService({ INITIAL_CHILD_POINTS: "0" }).initialChildPoints
    ).toThrow("INITIAL_CHILD_POINTS must be a positive integer");
    expect(
      () =>
        new AppConfigService({
          POINT_ADJUSTMENT_SINGLE_REVIEW_LIMIT: "-1"
        }).pointAdjustmentSingleReviewLimit
    ).toThrow("POINT_ADJUSTMENT_SINGLE_REVIEW_LIMIT must be a positive integer");
  });

  it("does not give runtime containers a default auth token signing key", () => {
    const runtimeCompose = readFileSync("docker-compose.runtime.yml", "utf8");

    expect(runtimeCompose).toContain(
      "AUTH_TOKEN_SIGNING_KEY: ${AUTH_TOKEN_SIGNING_KEY:?AUTH_TOKEN_SIGNING_KEY must be configured}"
    );
    expect(runtimeCompose).not.toContain("runtime-auth-token-current");
  });
});
