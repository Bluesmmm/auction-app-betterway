import "reflect-metadata";
import { readFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { PointsController } from "../../src/points/points.controller.js";
import { PointLedgerService } from "../../src/points/point-ledger.service.js";
import { LedgerCheckService } from "../../src/points/ledger-check.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";

const appModule = readFileSync("apps/api/src/app.module.ts", "utf8");
const pointsController = readFileSync(
  "apps/api/src/points/points.controller.ts",
  "utf8"
);
const pointsModule = readFileSync("apps/api/src/points/points.module.ts", "utf8");

describe("Stage 4 points controller wiring", () => {
  it("registers PointsModule in the root app module", () => {
    expect(appModule).toContain('import { PointsModule } from "./points/points.module.js";');
    expect(appModule).toContain("PointsModule");
  });

  it("declares the Stage 4 points route prefix and operations", () => {
    expect(pointsController).toContain('Controller("points")(PointsController)');
    expect(pointsController).toContain('Get("children/:childId/summary")');
    expect(pointsController).toContain('Get("adjustment-requests")');
    expect(pointsController).toContain('Get("ledger-check-runs")');
    expect(pointsController).toContain(
      'Post("children/:childId/adjustment-requests")'
    );
    expect(pointsController).toContain('Post("admin-adjustment-requests")');
    expect(pointsController).toContain(
      'Post("adjustment-requests/:requestId/review")'
    );
    expect(pointsController).toContain(
      'Post("adjustment-requests/:requestId/second-review")'
    );
    expect(pointsModule).toContain("controllers: [PointsController]");
    expect(pointsModule).toContain("PointLedgerService");
  });

  it("creates the points controller through the real Nest container", async () => {
    const app = await NestFactory.createApplicationContext(
      Stage4ControllerDiTestModule,
      {
        logger: false
      }
    );

    try {
      const controller = app.get(PointsController);

      expect(
        controllerDeps(controller, [
          "points",
          "ledgerChecks",
          "sessions",
          "sessionTokens"
        ])
      ).toEqual({
        points: true,
        ledgerChecks: true,
        sessions: true,
        sessionTokens: true
      });
    } finally {
      await app.close();
    }
  });
});

class Stage4ControllerDiTestModule {}

Module({
  controllers: [PointsController],
  providers: [
    { provide: PointLedgerService, useValue: {} },
    { provide: LedgerCheckService, useValue: {} },
    { provide: SessionService, useValue: {} },
    { provide: SessionTokenService, useValue: {} }
  ]
})(Stage4ControllerDiTestModule);

function controllerDeps<T extends string>(
  controller: object,
  keys: T[]
): Record<T, boolean> {
  const instance = controller as Record<string, unknown>;
  return Object.fromEntries(
    keys.map((key) => [key, Boolean(instance[key])])
  ) as Record<T, boolean>;
}
