import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { LedgerCheckService } from "../../src/points/ledger-check.service.js";
import { FakeWechatAuthProvider } from "../../src/providers/fake-providers.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const onboarding = new OnboardingService(
  prisma,
  new FakeWechatAuthProvider(),
  new SessionService(
    prisma,
    new SessionTokenService("stage4-ledger-check-test-signing-key")
  )
);
const checks = new LedgerCheckService(prisma);

function unique(label: string) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("LedgerCheckService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("passes when ledger replay matches account snapshots", async () => {
    const child = await createChild("clean");

    const result = await checks.runLedgerCheck({
      idempotencyKey: unique("clean_run"),
      workerName: "stage4-test-worker",
      childIds: [child.childId],
      now: new Date("2026-06-02T16:00:00.000Z")
    });

    expect(result).toEqual({
      result: "accepted",
      runId: expect.any(String),
      status: "passed",
      checkedAccountCount: expect.any(Number),
      ledgerDiffCount: 0,
      negativeReplayCount: 0,
      orphanLedgerCount: 0
    });
  });

  it("records a snapshot mismatch without repairing the account", async () => {
    const child = await createChild("snapshot_mismatch");
    await prisma.pointAccount.update({
      where: {
        childId: child.childId
      },
      data: {
        availablePoints: 321
      }
    });

    try {
      const result = await checks.runLedgerCheck({
        idempotencyKey: unique("snapshot_mismatch_run"),
        workerName: "stage4-test-worker",
        childIds: [child.childId],
        now: new Date("2026-06-02T16:10:00.000Z")
      });

      expect(result.status).toBe("failed");
      expect(result.ledgerDiffCount).toBeGreaterThan(0);
      await expect(
        prisma.ledgerCheckDiff.findFirstOrThrow({
          where: {
            runId: result.runId,
            account: {
              childId: child.childId
            },
            diffType: "snapshot_mismatch"
          },
          select: {
            expectedAvailablePoints: true,
            actualAvailablePoints: true
          }
        })
      ).resolves.toEqual({
        expectedAvailablePoints: 100,
        actualAvailablePoints: 321
      });
      await expect(
        prisma.pointAccount.findUniqueOrThrow({
          where: {
            childId: child.childId
          },
          select: {
            availablePoints: true
          }
        })
      ).resolves.toEqual({
        availablePoints: 321
      });
    } finally {
      await prisma.pointAccount.update({
        where: {
          childId: child.childId
        },
        data: {
          availablePoints: 100
        }
      });
    }
  });

  it("records negative replay states as ledger diffs", async () => {
    const child = await createChild("negative_replay");
    const account = await prisma.pointAccount.findUniqueOrThrow({
      where: {
        childId: child.childId
      }
    });

    const syntheticEntry = await prisma.pointLedgerEntry.create({
      data: {
        accountId: account.id,
        childId: child.childId,
        type: "correction",
        amountPoints: -150,
        availableAfter: 0,
        frozenAfter: 0,
        relatedType: "stage4_test",
        relatedId: child.childId,
        idempotencyKey: unique("negative_replay_entry"),
        reason: "synthetic negative replay",
        createdByUserId: child.guardianUserId,
        createdAt: new Date("2026-06-02T16:20:00.000Z")
      }
    });
    await prisma.pointAccount.update({
      where: {
        id: account.id
      },
      data: {
        availablePoints: 0
      }
    });

    try {
      const result = await checks.runLedgerCheck({
        idempotencyKey: unique("negative_replay_run"),
        workerName: "stage4-test-worker",
        childIds: [child.childId],
        now: new Date("2026-06-02T16:21:00.000Z")
      });

      expect(result.status).toBe("failed");
      expect(result.negativeReplayCount).toBeGreaterThan(0);
      await expect(
        prisma.ledgerCheckDiff.findFirstOrThrow({
          where: {
            runId: result.runId,
            accountId: account.id,
            diffType: "negative_replay"
          },
          select: {
            expectedAvailablePoints: true
          }
        })
      ).resolves.toEqual({
        expectedAvailablePoints: -50
      });
    } finally {
      await prisma.pointLedgerEntry.deleteMany({
        where: {
          id: syntheticEntry.id
        }
      });
      await prisma.pointAccount.update({
        where: {
          id: account.id
        },
        data: {
          availablePoints: 100
        }
      });
    }
  });

  it("records active children without point accounts as ledger diffs", async () => {
    const child = await prisma.childProfile.create({
      data: {
        displayName: `Missing Account Child ${unique("missing_account")}`,
        gradeBand: "grade_3_4",
        status: "active"
      }
    });

    try {
      const result = await checks.runLedgerCheck({
        idempotencyKey: unique("missing_account_run"),
        workerName: "stage4-test-worker",
        childIds: [child.id],
        now: new Date("2026-06-02T16:30:00.000Z")
      });

      expect(result.status).toBe("failed");
      await expect(
        prisma.ledgerCheckDiff.findFirstOrThrow({
          where: {
            runId: result.runId,
            childId: child.id,
            diffType: "missing_account"
          },
          select: {
            evidenceJson: true
          }
        })
      ).resolves.toEqual({
        evidenceJson: {
          childStatus: "active"
        }
      });
    } finally {
      await prisma.childProfile.delete({
        where: {
          id: child.id
        }
      });
    }
  });
});

async function createChild(label: string) {
  const token = unique(label);
  const login = await onboarding.loginWithWechatCode({
    code: `mock_openid_${token}`,
    now: new Date("2026-06-02T15:50:00.000Z")
  });

  if (login.result !== "accepted") {
    throw new Error("expected login");
  }

  const guardian = await onboarding.ensureGuardianProfile({
    userId: login.userId,
    phoneHash: `phone_hash_${token}`,
    phoneLast4: "2468",
    consentVersion: "guardian-consent-v1",
    consentedAt: new Date("2026-06-02T15:51:00.000Z")
  });
  const child = await onboarding.createChildWithPrimaryGuardian({
    actorUserId: login.userId,
    guardianId: guardian.guardianId,
    displayName: `Ledger Check Child ${token}`,
    gradeBand: "grade_3_4",
    idempotencyKey: unique(`${label}_child`),
    now: new Date("2026-06-02T15:52:00.000Z")
  });

  if (child.result !== "accepted") {
    throw new Error(`expected child: ${child.errorCode}`);
  }

  return {
    childId: child.childId,
    guardianUserId: login.userId
  };
}
