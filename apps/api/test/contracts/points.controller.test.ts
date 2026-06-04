import { describe, expect, it, vi } from "vitest";
import type { LedgerCheckService } from "../../src/points/ledger-check.service.js";
import type { PointLedgerService } from "../../src/points/point-ledger.service.js";
import { PointsController } from "../../src/points/points.controller.js";
import type { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";

const tokens = new SessionTokenService("points-controller-contract-test-key");

describe("PointsController", () => {
  it("wraps the operations dashboard in the standard accepted response envelope", async () => {
    const points = {
      getOperationsDashboard: vi.fn(async () => ({
        result: "accepted" as const,
        generatedAt: "2026-06-04T10:00:00.000Z",
        totals: {
          accountCount: 2,
          availablePoints: 170,
          frozenPoints: 30,
          totalEarnedPoints: 200,
          totalSpentPoints: 0,
          totalAwardedPoints: 200,
          totalPenaltyPoints: 0
        },
        holds: {
          activeCount: 1,
          releasedCount: 0,
          transferredCount: 0,
          cancelledCount: 0,
          disputedCount: 0,
          activeAmountPoints: 30
        },
        transactions: {
          pendingGuardianConfirmCount: 0,
          pendingDeliveryConfirmCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          disputedCount: 0,
          platformReviewCount: 1,
          reviewQueueCount: 1
        },
        auctions: {
          pendingStartCount: 0,
          activeCount: 0,
          pendingSettlementCount: 0,
          settledCount: 1,
          cancelledCount: 0,
          unsoldCount: 0,
          delistedCount: 0
        },
        outbox: {
          pendingCount: 0,
          processingCount: 0,
          sentCount: 0,
          failedCount: 1,
          cancelledCount: 0,
          exceptionCount: 1
        },
        activeHolds: [],
        reviewTransactions: [],
        recentLedgerEntries: [],
        outboxExceptions: [],
        latestLedgerCheckRun: null
      }))
    };
    const controller = createController(points);

    const response = await controller.getOperationsDashboard(
      bearerToken("platform_admin_user", "session_1")
    );

    expect(points.getOperationsDashboard).toHaveBeenCalledWith({
      platformAdminUserId: "platform_admin_user",
      now: expect.any(Date)
    });
    expect(response).toMatchObject({
      result: "accepted",
      targetType: "points_operations_dashboard",
      targetId: "latest",
      targetVersion: 1,
      latestStatus: "active",
      refreshRequired: false,
      generatedAt: "2026-06-04T10:00:00.000Z",
      totals: {
        accountCount: 2,
        availablePoints: 170,
        frozenPoints: 30
      },
      transactions: {
        platformReviewCount: 1,
        reviewQueueCount: 1
      },
      outbox: {
        failedCount: 1,
        exceptionCount: 1
      }
    });
  });

  it("wraps dashboard authorization failures as rejected operations-dashboard responses", async () => {
    const points = {
      getOperationsDashboard: vi.fn(async () => ({
        result: "rejected" as const,
        errorCode: "PLATFORM_ADMIN_REQUIRED" as const
      }))
    };
    const controller = createController(points);

    await expect(
      controller.getOperationsDashboard(bearerToken("guardian_user", "session_2"))
    ).resolves.toMatchObject({
      result: "rejected",
      targetType: "points_operations_dashboard",
      targetId: "latest",
      targetVersion: 1,
      latestStatus: "rejected",
      refreshRequired: false,
      errorCode: "PLATFORM_ADMIN_REQUIRED"
    });
  });
});

function createController(points: Partial<PointLedgerService>) {
  const sessions = {
    assertActiveSession: vi.fn(async (input: { userId: string; sessionId: string }) => ({
      result: "accepted" as const,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAt: "2099-01-01T00:00:00.000Z",
      lastSeenAt: null
    }))
  };

  return new PointsController(
    points as PointLedgerService,
    {} as LedgerCheckService,
    sessions as unknown as SessionService,
    tokens
  );
}

function bearerToken(userId: string, sessionId: string) {
  const token = tokens.createAccessToken({
    userId,
    sessionId,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });

  return `Bearer ${token}`;
}
