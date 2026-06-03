import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildLedgerCheckIdempotencyKey,
  runLedgerCheckTick,
  startPeriodicLedgerCheckWorker
} from "../src/ledger-check-worker.js";

describe("ledger check worker", () => {
  it("keeps worker diff coverage aligned with the Stage 4 ledger check script", () => {
    const source = readFileSync("apps/worker/src/ledger-check-worker.ts", "utf8");

    expect(source).toContain('"snapshot_mismatch"');
    expect(source).toContain('"active_hold_mismatch"');
    expect(source).toContain('"negative_replay"');
    expect(source).toContain('"missing_account"');
  });

  it("builds one idempotency key per check window", () => {
    expect(
      buildLedgerCheckIdempotencyKey({
        now: new Date("2026-06-02T16:04:59.000Z"),
        intervalMs: 300_000
      })
    ).toBe("ledger-check:2026-06-02T16:00:00.000Z");
    expect(
      buildLedgerCheckIdempotencyKey({
        now: new Date("2026-06-02T16:05:00.000Z"),
        intervalMs: 300_000
      })
    ).toBe("ledger-check:2026-06-02T16:05:00.000Z");
  });

  it("runs one ledger check tick with the worker identity", async () => {
    const calls: unknown[] = [];
    const result = await runLedgerCheckTick({
      workerName: "stage4-ledger-worker",
      intervalMs: 300_000,
      now: new Date("2026-06-02T16:06:00.000Z"),
      runner: {
        async run(input) {
          calls.push(input);
          return {
            result: "accepted",
            runId: "run_1",
            status: "passed",
            ledgerDiffCount: 0
          };
        }
      }
    });

    expect(result).toEqual({
      result: "accepted",
      runId: "run_1",
      status: "passed",
      ledgerDiffCount: 0
    });
    expect(calls).toEqual([
      {
        idempotencyKey: "ledger-check:2026-06-02T16:05:00.000Z",
        workerName: "stage4-ledger-worker",
        now: new Date("2026-06-02T16:06:00.000Z")
      }
    ]);
  });

  it("starts and stops a periodic timer without running immediately by default", async () => {
    vi.useFakeTimers();
    const runner = {
      run: vi.fn(async () => ({
        result: "accepted" as const,
        runId: "run_timer",
        status: "passed" as const,
        ledgerDiffCount: 0
      }))
    };

    try {
      const handle = startPeriodicLedgerCheckWorker({
        workerName: "stage4-ledger-worker",
        intervalMs: 60_000,
        runner
      });

      expect(runner.run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runner.run).toHaveBeenCalledTimes(1);
      await handle.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runner.run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
