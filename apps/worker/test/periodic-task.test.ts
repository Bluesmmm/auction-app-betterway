import { describe, expect, it, vi } from "vitest";
import { runPeriodicTask } from "../src/periodic-task.js";

describe("periodic task guard", () => {
  it("logs rejected background tasks instead of leaving an unhandled rejection", async () => {
    const logger = {
      error: vi.fn()
    };

    runPeriodicTask({
      taskName: "stage5_test_task",
      logger,
      run: async () => {
        throw new Error("background failure");
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith("worker.periodic_task_failed", {
      taskName: "stage5_test_task",
      error: {
        name: "Error",
        message: "background failure"
      }
    });
  });
});
