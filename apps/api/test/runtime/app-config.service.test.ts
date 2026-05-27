import { describe, expect, it } from "vitest";
import { AppConfigService } from "../../src/config/app-config.service.js";

describe("AppConfigService", () => {
  it("uses local runtime defaults when env vars are absent", () => {
    const config = new AppConfigService({});

    expect(config.nodeEnv).toBe("development");
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toContain("auction_app");
    expect(config.redisUrl).toBe("redis://localhost:6379/0");
  });

  it("rejects invalid ports before API boot", () => {
    const config = new AppConfigService({ PORT: "not-a-port" });

    expect(() => config.port).toThrow("PORT must be an integer");
  });
});
