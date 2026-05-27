import { describe, expect, it } from "vitest";
import { workerHeartbeatKey } from "../src/worker-heartbeat.js";

describe("worker heartbeat", () => {
  it("uses the same Redis key convention as API health checks", () => {
    expect(workerHeartbeatKey("auction-worker-local")).toBe(
      "auction:worker:auction-worker-local:heartbeat"
    );
  });
});
