import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("miniprogram stage6 shell", () => {
  it("registers the transaction closure page", () => {
    const app = readFileSync("apps/miniprogram/app.json", "utf8");

    expect(app).toContain("pages/stage6/transactions/index");
  });

  it("builds stage6 transaction and appeal helpers", () => {
    const api = readFileSync("apps/miniprogram/src/stage6-api.ts", "utf8");
    const page = readFileSync(
      "apps/miniprogram/pages/stage6/transactions/index.ts",
      "utf8"
    );

    expect(api).toContain("/auctions/transactions/");
    expect(api).toContain("/guardian-confirm");
    expect(api).toContain("/delivery-confirm");
    expect(api).toContain("/appeals");
    expect(api).toContain("/appeal-attachments/");
    expect(api).toContain("buildStage6TransactionDetailRequest");
    expect(api).toContain("buildStage6GuardianConfirmationRequest");
    expect(api).toContain("buildStage6DeliveryConfirmationRequest");
    expect(api).toContain("buildStage6TransactionAppealRequest");
    expect(api).toContain("buildStage6AppealAttachmentGrantRequest");
    expect(page).toContain("stage6TransactionsPage");
    expect(page).toContain("loadTransactionDetail");
    expect(page).toContain("submitGuardianProposal");
    expect(page).toContain("submitDeliveryConfirmation");
    expect(page).toContain("submitTransactionAppeal");
    expect(page).toContain("createAppealImageGrant");
  });
});
