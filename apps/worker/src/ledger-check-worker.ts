import type {
  LedgerCheckDiffType,
  Prisma,
  PrismaClient,
  PointLedgerEntry
} from "@prisma/client";

export type LedgerCheckRunnerInput = {
  idempotencyKey: string;
  workerName: string;
  now: Date;
};

export type LedgerCheckRunnerResult = {
  result: "accepted";
  runId: string;
  status: "running" | "passed" | "failed" | "skipped";
  ledgerDiffCount: number;
};

export type LedgerCheckRunner = {
  run(input: LedgerCheckRunnerInput): Promise<LedgerCheckRunnerResult>;
};

export type PeriodicLedgerCheckHandle = {
  stop(): Promise<void>;
};

type LedgerCheckDiffDraft = {
  accountId?: string;
  childId?: string;
  ledgerEntryId?: string;
  diffType: LedgerCheckDiffType;
  expectedAvailablePoints?: number;
  actualAvailablePoints?: number;
  expectedFrozenPoints?: number;
  actualFrozenPoints?: number;
  evidenceJson: Prisma.InputJsonObject;
};

const LEDGER_CHECK_ADVISORY_LOCK_KEY = 442_004_004;

export function buildLedgerCheckIdempotencyKey(input: {
  now: Date;
  intervalMs: number;
}): string {
  const windowStart = new Date(
    Math.floor(input.now.getTime() / input.intervalMs) * input.intervalMs
  );
  return `ledger-check:${windowStart.toISOString()}`;
}

export async function runLedgerCheckTick(input: {
  workerName: string;
  intervalMs: number;
  now?: Date;
  runner: LedgerCheckRunner;
}): Promise<LedgerCheckRunnerResult> {
  const now = input.now ?? new Date();

  return input.runner.run({
    idempotencyKey: buildLedgerCheckIdempotencyKey({
      now,
      intervalMs: input.intervalMs
    }),
    workerName: input.workerName,
    now
  });
}

export function startPeriodicLedgerCheckWorker(input: {
  workerName: string;
  intervalMs: number;
  runner: LedgerCheckRunner;
}): PeriodicLedgerCheckHandle {
  const interval = setInterval(() => {
    void runLedgerCheckTick({
      workerName: input.workerName,
      intervalMs: input.intervalMs,
      runner: input.runner
    });
  }, input.intervalMs);

  return {
    async stop() {
      clearInterval(interval);
    }
  };
}

export class PrismaLedgerCheckRunner implements LedgerCheckRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async run(input: LedgerCheckRunnerInput): Promise<LedgerCheckRunnerResult> {
    const acquired = await this.acquireLock();
    if (!acquired) {
      const skipped = await this.createSkippedRun(input);
      return {
        result: "accepted",
        runId: skipped.id,
        status: "skipped",
        ledgerDiffCount: 0
      };
    }

    try {
      return await this.runWithLock(input);
    } finally {
      await this.releaseLock();
    }
  }

  private async runWithLock(
    input: LedgerCheckRunnerInput
  ): Promise<LedgerCheckRunnerResult> {
    const existing = await this.prisma.ledgerCheckRun.findUnique({
      where: {
        idempotencyKey: input.idempotencyKey
      }
    });
    if (existing && existing.status !== "running") {
      return {
        result: "accepted",
        runId: existing.id,
        status: existing.status,
        ledgerDiffCount: existing.ledgerDiffCount
      };
    }

    const run =
      existing ??
      (await this.prisma.ledgerCheckRun.create({
        data: {
          status: "running",
          idempotencyKey: input.idempotencyKey,
          workerName: input.workerName,
          startedAt: input.now
        }
      }));

    try {
      const accounts = await this.prisma.pointAccount.findMany({
        include: {
          ledgerEntries: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          },
          holds: {
            where: {
              status: "active"
            }
          }
        }
      });
      const diffs: LedgerCheckDiffDraft[] = accounts.flatMap((account) => {
        const replay = replayAccount(account.ledgerEntries);
        const accountDiffs: LedgerCheckDiffDraft[] = [
          ...replay.negativeReplayDiffs
        ];

        if (
          replay.availablePoints !== account.availablePoints ||
          replay.frozenPoints !== account.frozenPoints
        ) {
          accountDiffs.push({
            accountId: account.id,
            childId: account.childId,
            diffType: "snapshot_mismatch",
            expectedAvailablePoints: replay.availablePoints,
            actualAvailablePoints: account.availablePoints,
            expectedFrozenPoints: replay.frozenPoints,
            actualFrozenPoints: account.frozenPoints,
            evidenceJson: {
              ledgerEntryCount: account.ledgerEntries.length
            }
          });
        }

        const activeHoldAmount = account.holds.reduce(
          (sum, hold) => sum + hold.amountPoints,
          0
        );
        if (activeHoldAmount !== account.frozenPoints) {
          accountDiffs.push({
            accountId: account.id,
            childId: account.childId,
            diffType: "active_hold_mismatch",
            expectedFrozenPoints: activeHoldAmount,
            actualFrozenPoints: account.frozenPoints,
            evidenceJson: {
              activeHoldCount: account.holds.length
            }
          });
        }

        return accountDiffs;
      });
      const activeChildrenWithoutAccounts = await this.prisma.childProfile.findMany({
        where: {
          status: "active",
          pointAccount: null
        },
        select: {
          id: true
        }
      });
      for (const child of activeChildrenWithoutAccounts) {
        diffs.push({
          childId: child.id,
          diffType: "missing_account",
          evidenceJson: {
            childStatus: "active"
          }
        });
      }

      if (diffs.length > 0) {
        await this.prisma.ledgerCheckDiff.createMany({
          data: diffs.map((diff) => ({
            runId: run.id,
            accountId: diff.accountId,
            childId: diff.childId,
            ledgerEntryId: diff.ledgerEntryId,
            diffType: diff.diffType,
            expectedAvailablePoints: diff.expectedAvailablePoints,
            actualAvailablePoints: diff.actualAvailablePoints,
            expectedFrozenPoints: diff.expectedFrozenPoints,
            actualFrozenPoints: diff.actualFrozenPoints,
            evidenceJson: diff.evidenceJson
          }))
        });
      }

      const negativeReplayCount = diffs.filter(
        (diff) => diff.diffType === "negative_replay"
      ).length;
      const updated = await this.prisma.ledgerCheckRun.update({
        where: {
          id: run.id
        },
        data: {
          status: diffs.length === 0 ? "passed" : "failed",
          checkedAccountCount: accounts.length,
          ledgerDiffCount: diffs.length,
          negativeReplayCount,
          orphanLedgerCount: 0,
          finishedAt: new Date(),
          failureReason: diffs.length === 0 ? null : "ledger_diff_detected"
        }
      });

      return {
        result: "accepted",
        runId: updated.id,
        status: updated.status,
        ledgerDiffCount: updated.ledgerDiffCount
      };
    } catch (error) {
      const updated = await this.prisma.ledgerCheckRun.update({
        where: {
          id: run.id
        },
        data: {
          status: "failed",
          finishedAt: new Date(),
          failureReason: error instanceof Error ? error.message : String(error)
        }
      });

      return {
        result: "accepted",
        runId: updated.id,
        status: updated.status,
        ledgerDiffCount: updated.ledgerDiffCount
      };
    }
  }

  private async acquireLock(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_lock(${LEDGER_CHECK_ADVISORY_LOCK_KEY}) AS acquired
    `;
    return rows[0]?.acquired === true;
  }

  private async releaseLock(): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT pg_advisory_unlock(${LEDGER_CHECK_ADVISORY_LOCK_KEY})
    `;
  }

  private async createSkippedRun(input: LedgerCheckRunnerInput) {
    const idempotencyKey = `${input.idempotencyKey}:skipped:${input.workerName}`;
    const existing = await this.prisma.ledgerCheckRun.findUnique({
      where: {
        idempotencyKey
      }
    });
    if (existing) {
      return existing;
    }

    return this.prisma.ledgerCheckRun.create({
      data: {
        status: "skipped",
        checkedAccountCount: 0,
        ledgerDiffCount: 0,
        negativeReplayCount: 0,
        orphanLedgerCount: 0,
        startedAt: input.now,
        finishedAt: input.now,
        workerName: input.workerName,
        idempotencyKey,
        failureReason: "ledger_check_lock_not_acquired"
      }
    });
  }
}

type ReplayState = {
  availablePoints: number;
  frozenPoints: number;
  negativeReplayDiffs: LedgerCheckDiffDraft[];
};

function replayAccount(entries: PointLedgerEntry[]): ReplayState {
  const state: ReplayState = {
    availablePoints: 0,
    frozenPoints: 0,
    negativeReplayDiffs: []
  };

  for (const entry of entries) {
    applyLedgerEntry(state, entry);

    if (state.availablePoints < 0 || state.frozenPoints < 0) {
      state.negativeReplayDiffs.push({
        accountId: entry.accountId,
        childId: entry.childId,
        ledgerEntryId: entry.id,
        diffType: "negative_replay",
        expectedAvailablePoints: state.availablePoints,
        expectedFrozenPoints: state.frozenPoints,
        evidenceJson: {
          ledgerEntryType: entry.type,
          amountPoints: entry.amountPoints
        }
      });
    }
  }

  return state;
}

function applyLedgerEntry(state: ReplayState, entry: PointLedgerEntry) {
  switch (entry.type) {
    case "hold": {
      const amount = Math.abs(entry.amountPoints);
      state.availablePoints -= amount;
      state.frozenPoints += amount;
      break;
    }
    case "release": {
      const amount = Math.abs(entry.amountPoints);
      state.availablePoints += amount;
      state.frozenPoints -= amount;
      break;
    }
    case "transfer_out":
      state.frozenPoints -= Math.abs(entry.amountPoints);
      break;
    case "transfer_in":
      state.availablePoints += Math.abs(entry.amountPoints);
      break;
    case "initial_grant":
    case "admin_award":
    case "admin_penalty":
    case "admin_adjustment":
    case "correction":
    case "reversal":
      state.availablePoints += entry.amountPoints;
      break;
  }
}
