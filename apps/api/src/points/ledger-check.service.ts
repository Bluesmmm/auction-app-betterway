import type {
  LedgerCheckDiffType,
  LedgerCheckRunStatus,
  PointLedgerEntry,
  Prisma,
  PrismaClient
} from "@prisma/client";

export type RunLedgerCheckInput = {
  idempotencyKey: string;
  workerName?: string;
  childIds?: string[];
  now?: Date;
};

export type RunLedgerCheckResult = {
  result: "accepted";
  runId: string;
  status: LedgerCheckRunStatus;
  checkedAccountCount: number;
  ledgerDiffCount: number;
  negativeReplayCount: number;
  orphanLedgerCount: number;
};

export type LedgerCheckRunRow = {
  id: string;
  status: LedgerCheckRunStatus;
  checkedAccountCount: number;
  ledgerDiffCount: number;
  negativeReplayCount: number;
  orphanLedgerCount: number;
  startedAt: string;
  finishedAt: string | null;
  workerName: string | null;
  failureReason: string | null;
};

type ReplayState = {
  availablePoints: number;
  frozenPoints: number;
  negativeReplayDiffs: PendingDiff[];
};

type PendingDiff = {
  accountId?: string;
  childId?: string;
  ledgerEntryId?: string;
  diffType: LedgerCheckDiffType;
  expectedAvailablePoints?: number;
  actualAvailablePoints?: number;
  expectedFrozenPoints?: number;
  actualFrozenPoints?: number;
  evidenceJson: Prisma.InputJsonValue;
};

export class LedgerCheckService {
  constructor(private readonly prisma: PrismaClient) {}

  async listRecentRuns(input: { limit?: number } = {}): Promise<LedgerCheckRunRow[]> {
    const rows = await this.prisma.ledgerCheckRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(input.limit ?? 20, 1), 100)
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      checkedAccountCount: row.checkedAccountCount,
      ledgerDiffCount: row.ledgerDiffCount,
      negativeReplayCount: row.negativeReplayCount,
      orphanLedgerCount: row.orphanLedgerCount,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      workerName: row.workerName,
      failureReason: row.failureReason
    }));
  }

  async runLedgerCheck(input: RunLedgerCheckInput): Promise<RunLedgerCheckResult> {
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
        checkedAccountCount: existing.checkedAccountCount,
        ledgerDiffCount: existing.ledgerDiffCount,
        negativeReplayCount: existing.negativeReplayCount,
        orphanLedgerCount: existing.orphanLedgerCount
      };
    }

    const now = input.now ?? new Date();
    const run =
      existing ??
      (await this.prisma.ledgerCheckRun.create({
        data: {
          status: "running",
          idempotencyKey: input.idempotencyKey,
          workerName: input.workerName,
          startedAt: now
        }
      }));

    try {
      const diffs: PendingDiff[] = [];
      const accounts = await this.prisma.pointAccount.findMany({
        where: input.childIds
          ? {
              childId: {
                in: input.childIds
              }
            }
          : undefined,
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

      for (const account of accounts) {
        const replay = replayAccount(account.ledgerEntries);
        diffs.push(...replay.negativeReplayDiffs);

        if (
          replay.availablePoints !== account.availablePoints ||
          replay.frozenPoints !== account.frozenPoints
        ) {
          diffs.push({
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
          diffs.push({
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
      }

      const activeChildrenWithoutAccounts = await this.prisma.childProfile.findMany({
        where: {
          status: "active",
          ...(input.childIds
            ? {
                id: {
                  in: input.childIds
                }
              }
            : {}),
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
      const orphanLedgerCount = diffs.filter(
        (diff) => diff.diffType === "orphan_ledger_entry"
      ).length;
      const status = diffs.length === 0 ? "passed" : "failed";
      const updated = await this.prisma.ledgerCheckRun.update({
        where: {
          id: run.id
        },
        data: {
          status,
          checkedAccountCount: accounts.length,
          ledgerDiffCount: diffs.length,
          negativeReplayCount,
          orphanLedgerCount,
          finishedAt: input.now ?? new Date(),
          failureReason: status === "failed" ? "ledger_diff_detected" : null
        }
      });

      return {
        result: "accepted",
        runId: updated.id,
        status: updated.status,
        checkedAccountCount: updated.checkedAccountCount,
        ledgerDiffCount: updated.ledgerDiffCount,
        negativeReplayCount: updated.negativeReplayCount,
        orphanLedgerCount: updated.orphanLedgerCount
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
        checkedAccountCount: updated.checkedAccountCount,
        ledgerDiffCount: updated.ledgerDiffCount,
        negativeReplayCount: updated.negativeReplayCount,
        orphanLedgerCount: updated.orphanLedgerCount
      };
    }
  }
}

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
    case "transfer_out": {
      state.frozenPoints -= Math.abs(entry.amountPoints);
      break;
    }
    case "transfer_in": {
      state.availablePoints += Math.abs(entry.amountPoints);
      break;
    }
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
