import { describe, expect, it } from "vitest";
import {
  buildAdminHealthCheckUrl,
  checkAdminApiConnectivity
} from "../../../admin/src/api-connectivity.js";
import {
  buildMiniprogramHealthCheckUrl,
  checkMiniprogramApiConnectivity
} from "../../../miniprogram/src/api-connectivity.js";

describe("client API connectivity probes", () => {
  it("builds admin and miniprogram health URLs from the same API contract", () => {
    expect(buildAdminHealthCheckUrl("https://api.example.com/")).toBe(
      "https://api.example.com/health"
    );
    expect(buildMiniprogramHealthCheckUrl("https://api.example.com")).toBe(
      "https://api.example.com/health"
    );
  });

  it("accepts ok and degraded API health as reachable for clients", async () => {
    const adminStatus = await checkAdminApiConnectivity(
      "https://api.example.com",
      async () =>
        ({
          ok: true,
          json: async () => ({ status: "degraded" })
        }) as Response
    );
    const miniprogramStatus = await checkMiniprogramApiConnectivity(
      "https://api.example.com",
      async () => ({
        statusCode: 200,
        data: { status: "ok" }
      })
    );

    expect(adminStatus).toBe("ready");
    expect(miniprogramStatus).toBe("ready");
  });
});
