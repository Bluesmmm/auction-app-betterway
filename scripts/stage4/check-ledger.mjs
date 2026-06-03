import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const now = new Date();
const idempotencyKey = `stage4-ledger-check:${now.toISOString()}`;

try {
  const run = await prisma.ledgerCheckRun.create({
    data: {
      status: "running",
      idempotencyKey,
      workerName: "stage4-ledger-check-script",
      startedAt: now
    }
  });
  const accounts = await prisma.pointAccount.findMany({
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
  const diffs = [];

  for (const account of accounts) {
    const replay = replayAccount(account.ledgerEntries);
    diffs.push(
      ...replay.negativeReplayDiffs.map((diff) => ({
        runId: run.id,
        ...diff
      }))
    );

    if (
      replay.availablePoints !== account.availablePoints ||
      replay.frozenPoints !== account.frozenPoints
    ) {
      diffs.push({
        runId: run.id,
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
        runId: run.id,
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
  const activeChildrenWithoutAccounts = await prisma.childProfile.findMany({
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
      runId: run.id,
      childId: child.id,
      diffType: "missing_account",
      evidenceJson: {
        childStatus: "active"
      }
    });
  }

  if (diffs.length > 0) {
    await prisma.ledgerCheckDiff.createMany({
      data: diffs
    });
  }

  const negativeReplayCount = diffs.filter(
    (diff) => diff.diffType === "negative_replay"
  ).length;
  const updated = await prisma.ledgerCheckRun.update({
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

  const summary = {
    runId: updated.id,
    status: updated.status,
    checkedAccountCount: updated.checkedAccountCount,
    ledgerDiffCount: updated.ledgerDiffCount,
    negativeReplayCount: updated.negativeReplayCount,
    orphanLedgerCount: updated.orphanLedgerCount
  };

  console.log(JSON.stringify(summary));
  if (updated.ledgerDiffCount !== 0) {
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

function replayAccount(entries) {
  const state = {
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

function applyLedgerEntry(state, entry) {
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
    default:
      state.availablePoints += entry.amountPoints;
      break;
  }
}
