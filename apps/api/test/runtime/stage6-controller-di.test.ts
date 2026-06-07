import "reflect-metadata";
import { readFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { AuctionsController } from "../../src/auctions/auctions.controller.js";
import { TransactionAppealService } from "../../src/auctions/transaction-appeal.service.js";
import { TransactionDecisionService } from "../../src/auctions/transaction-decision.service.js";

const appModule = readFileSync("apps/api/src/app.module.ts", "utf8");
const auctionsModule = readFileSync(
  "apps/api/src/auctions/auctions.module.ts",
  "utf8"
);
const auctionsController = readFileSync(
  "apps/api/src/auctions/auctions.controller.ts",
  "utf8"
);

describe("Stage 6 auctions controller wiring", () => {
  it("keeps AuctionsModule registered in the root app module", () => {
    expect(appModule).toContain('import { AuctionsModule } from "./auctions/auctions.module.js";');
    expect(appModule).toContain("AuctionsModule");
  });

  it("declares the Stage 6 auctions route prefix and operations", () => {
    expect(auctionsController).toContain('Controller("auctions")(AuctionsController)');
    expect(auctionsController).toContain('Get("transactions/:transactionId")');
    expect(auctionsController).toContain(
      'Post("transactions/:transactionId/guardian-confirm")'
    );
    expect(auctionsController).toContain(
      'Post("transactions/:transactionId/delivery-confirm")'
    );
    expect(auctionsController).toContain(
      'Post("transactions/:transactionId/appeals")'
    );
    expect(auctionsController).toContain(
      'Post("transactions/:transactionId/dispute-resolution")'
    );
    expect(auctionsController).toContain(
      'Post("appeal-attachments/:appealAttachmentId/grant")'
    );
    expect(auctionsController).toContain(
      'Get("communities/:communityId/delivery-points")'
    );
    expect(auctionsController).toContain(
      'Post("communities/:communityId/delivery-points")'
    );
    expect(auctionsController).toContain(
      'Patch("delivery-points/:deliveryPointId")'
    );
    expect(auctionsController).toContain(
      'Post("delivery-points/:deliveryPointId/disable")'
    );
    expect(auctionsController).toContain('Get("appeals")');
    expect(auctionsController).toContain('Get("appeals/:appealId")');
    expect(auctionsController).toContain('Post("appeals/:appealId/review")');
    expect(auctionsModule).toContain("controllers: [AuctionsController]");
    expect(auctionsModule).toContain("AccountsModule");
  });

  it("creates the auctions controller through the real Nest container", async () => {
    const app = await NestFactory.createApplicationContext(
      Stage6ControllerDiTestModule,
      {
        logger: false
      }
    );

    try {
      const controller = app.get(AuctionsController);

      expect(
        controllerDeps(controller, [
          "decisions",
          "appeals",
          "sessions",
          "sessionTokens",
          "sensitiveOperations"
        ])
      ).toEqual({
        decisions: true,
        appeals: true,
        sessions: true,
        sessionTokens: true,
        sensitiveOperations: true
      });
    } finally {
      await app.close();
    }
  });
});

class Stage6ControllerDiTestModule {}

Module({
  controllers: [AuctionsController],
  providers: [
    { provide: TransactionDecisionService, useValue: {} },
    { provide: TransactionAppealService, useValue: {} },
    { provide: SessionService, useValue: {} },
    { provide: SessionTokenService, useValue: {} },
    { provide: SensitiveOperationService, useValue: {} }
  ]
})(Stage6ControllerDiTestModule);

function controllerDeps<T extends string>(
  controller: object,
  keys: T[]
): Record<T, boolean> {
  const instance = controller as Record<string, unknown>;
  return Object.fromEntries(
    keys.map((key) => [key, Boolean(instance[key])])
  ) as Record<T, boolean>;
}
