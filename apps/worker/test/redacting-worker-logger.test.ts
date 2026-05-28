import { describe, expect, it } from "vitest";
import { RedactingWorkerLogger } from "../src/redacting-worker-logger.js";

describe("RedactingWorkerLogger", () => {
  it("redacts sensitive fragments before worker log serialization", () => {
    const logger = new RedactingWorkerLogger();
    const serialized = logger.serialize({
      level: "error",
      event: "worker.job_failed",
      now: new Date("2026-05-27T16:00:00.000Z"),
      payload: {
        message:
          "failed for 13812345678 at 上海市浦东新区测试路 1 号 with private/children/raw/object-key-123456789.jpg?signature=abc and SF987654321",
        signedUrl:
          "https://cdn.example.com/private/children/raw/object-key-123456789.jpg?signature=abc"
      }
    });

    expect(serialized).toContain("worker.job_failed");
    expect(serialized).not.toContain("13812345678");
    expect(serialized).not.toContain("上海市浦东新区测试路");
    expect(serialized).not.toContain("object-key-123456789");
    expect(serialized).not.toContain("signature=abc");
    expect(serialized).not.toContain("SF987654321");
  });
});
