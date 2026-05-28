import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdminHealthCheckUrl,
  checkAdminApiConnectivity
} from "../../../admin/src/api-connectivity.js";
import {
  createAdminStage1Skeleton,
  resolveAdminApiBaseUrl
} from "../../../admin/src/main.js";
import {
  buildMiniprogramHealthCheckUrl,
  checkMiniprogramApiConnectivity
} from "../../../miniprogram/src/api-connectivity.js";

const configuredApiBaseUrl = "https://api.example.com";

describe("client API connectivity probes", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.API_BASE_URL = configuredApiBaseUrl;
    process.env.VITE_API_BASE_URL = configuredApiBaseUrl;
    process.env.MINIPROGRAM_API_BASE_URL = configuredApiBaseUrl;
  });

  afterEach(() => {
    delete process.env.API_BASE_URL;
    delete process.env.VITE_API_BASE_URL;
    delete process.env.MINIPROGRAM_API_BASE_URL;
  });

  it("builds admin and miniprogram health URLs from the same API contract", () => {
    expect(buildAdminHealthCheckUrl("https://api.example.com/")).toBe(
      "https://api.example.com/health"
    );
    expect(buildMiniprogramHealthCheckUrl("https://api.example.com")).toBe(
      "https://api.example.com/health"
    );
  });

  it("accepts ok and degraded API health as reachable for clients", async () => {
    const stage1Health = {
      status: "ok",
      serverTime: "2026-05-27T00:00:00.000Z",
      targetType: "runtime_health",
      targetId: "stage1-runtime",
      targetVersion: 1
    };
    const adminStatus = await checkAdminApiConnectivity(
      "https://api.example.com",
      async () =>
        ({
          ok: true,
          json: async () => ({ ...stage1Health, status: "degraded" })
        }) as Response
    );
    const miniprogramStatus = await checkMiniprogramApiConnectivity(
      "https://api.example.com",
      async () => ({
        statusCode: 200,
        data: stage1Health
      })
    );

    expect(adminStatus).toBe("ready");
    expect(miniprogramStatus).toBe("ready");
  });

  it("rejects health responses that omit the Stage 1 target version contract", async () => {
    const adminStatus = await checkAdminApiConnectivity(
      "https://api.example.com",
      async () =>
        ({
          ok: true,
          json: async () => ({ status: "ok" })
        }) as Response
    );
    const miniprogramStatus = await checkMiniprogramApiConnectivity(
      "https://api.example.com",
      async () => ({
        statusCode: 200,
        data: { status: "ok" }
      })
    );

    expect(adminStatus).toBe("unready");
    expect(miniprogramStatus).toBe("unready");
  });

  it("requires admin API base URL configuration instead of a source default", () => {
    expect(resolveAdminApiBaseUrl({ API_BASE_URL: configuredApiBaseUrl })).toBe(
      configuredApiBaseUrl
    );
    expect(() => resolveAdminApiBaseUrl({})).toThrow(
      "VITE_API_BASE_URL or API_BASE_URL must be configured"
    );
  });

  it("boots minimal admin and miniprogram Stage 1 shells around the health contract", async () => {
    const { stage1AppConfig } = await import("../../../miniprogram/app.js");
    const { stage1HealthPage } = await import(
      "../../../miniprogram/pages/health/index.js"
    );

    expect(createAdminStage1Skeleton("https://api.example.com")).toEqual({
      app: "admin",
      surface: "stage1-admin-react-shell",
      healthUrl: "https://api.example.com/health",
      highRiskGate: "mfa_required",
      stack: {
        ui: "react",
        bundler: "vite",
        designSystem: "antd",
        routing: "react-router",
        serverState: "tanstack-query",
        validation: "zod"
      }
    });
    expect(stage1AppConfig.globalData.apiBaseUrl).toBe(configuredApiBaseUrl);
    expect(stage1HealthPage.data.apiBaseUrl).toBe(configuredApiBaseUrl);
    expect(stage1HealthPage.data.healthUrl).toBe(
      `${configuredApiBaseUrl}/health`
    );
  });

  it("lets the miniprogram health page perform the runtime probe", async () => {
    const { stage1HealthPage } = await import(
      "../../../miniprogram/pages/health/index.js"
    );
    const updates: Record<string, unknown>[] = [];
    const requestedUrls: string[] = [];
    const page = {
      ...stage1HealthPage,
      data: {
        status: "unready" as const,
        apiBaseUrl: "https://api.example.com",
        healthUrl: "https://api.example.com/health"
      },
      setData(update: Record<string, unknown>) {
        updates.push(update);
      }
    };
    const status = await stage1HealthPage.refreshHealth.call(
      page,
      async ({ url }) => {
        requestedUrls.push(url);
        return {
          statusCode: 200,
          data: {
            status: "ok",
            serverTime: "2026-05-27T00:00:00.000Z",
            targetType: "runtime_health",
            targetId: "stage1-runtime",
            targetVersion: 1
          }
        };
      }
    );

    expect(status).toBe("ready");
    expect(requestedUrls).toEqual(["https://api.example.com/health"]);
    expect(updates).toEqual([{ status: "ready" }]);
  });
});
