import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin stage6 shell", () => {
  it("exposes the transaction closure route and command helpers", () => {
    const app = readFileSync("apps/admin/src/App.tsx", "utf8");
    const nav = readFileSync("apps/admin/src/stage6-nav.ts", "utf8");
    const api = readFileSync("apps/admin/src/stage6-api.ts", "utf8");
    const view = readFileSync("apps/admin/src/stage6-views.tsx", "utf8");

    expect(nav).toContain("Transaction Closure");
    expect(nav).toContain("/stage6/transaction-closure");
    expect(app).toContain("stage6AdminViewDefinitions");
    expect(app).toContain("Stage6TransactionClosureView");
    expect(app).toContain("/stage6/transaction-closure");
    expect(api).toContain("/auctions/communities/:communityId/delivery-points");
    expect(api).toContain("/auctions/delivery-points/:deliveryPointId");
    expect(api).toContain("/auctions/delivery-points/:deliveryPointId/disable");
    expect(api).toContain("/auctions/appeals");
    expect(api).toContain("/auctions/appeals/:appealId/review");
    expect(api).toContain(
      "/auctions/appeal-attachments/:appealAttachmentId/grant"
    );
    expect(api).toContain(
      "/auctions/transactions/:transactionId/dispute-resolution"
    );
    expect(api).toContain("stage6AdminCommandCatalog");
    expect(api).toContain("createAppealAttachmentGrant");
    expect(api).toContain("resolveTransactionDispute");
    expect(view).toContain("Stage 6 Transaction Closure");
    expect(view).toContain("Delivery Points");
    expect(view).toContain("Transaction Appeals");
    expect(view).toContain("Platform Review Detail");
    expect(view).toContain("Attachment Grant");
    expect(view).toContain("Resolve Transaction Dispute");
  });
});
