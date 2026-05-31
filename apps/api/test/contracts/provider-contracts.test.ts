import { describe, expect, it } from "vitest";
import {
  FakeContentSafetyProvider,
  FakeObjectStorageProvider,
  FakeSensitiveOperationVerificationProvider,
  FakeSubscriptionMessageProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";

describe("fake provider contracts", () => {
  it("maps mock WeChat codes to internal identity results", async () => {
    const provider = new FakeWechatAuthProvider();
    const result = await provider.exchangeCode("mock_openid_child_1");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected mock WeChat auth to succeed");
    }
    expect(result.openid).toBe("mock_openid_child_1");
  });

  it("fails closed when content safety cannot parse or scan content", async () => {
    const provider = new FakeContentSafetyProvider({
      mode: "failure"
    });

    const result = await provider.reviewText("normal title");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected content safety failure");
    }
    expect(result.failureClosesBusiness).toBe(true);
  });

  it("flags unsafe text deterministically", async () => {
    const provider = new FakeContentSafetyProvider();
    const result = await provider.reviewText("这里有电话和微信号");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected content safety review to succeed");
    }
    expect(result.riskLevel).toBe("high");
    expect(result.labels).toContain("contact_info");
  });

  it("creates short-lived private file grants only after permission input", async () => {
    const provider = new FakeObjectStorageProvider();
    const grant = await provider.createReadGrant({
      mediaAssetId: "asset_1",
      granteeUserId: "user_1",
      purpose: "item_image_view",
      ttlSeconds: 60
    });

    expect(grant.ok).toBe(true);
    if (!grant.ok) {
      throw new Error("expected storage grant to succeed");
    }
    expect(grant.url).toContain("asset_1");
    expect(grant.expiresAt).toMatch(/Z$/);
  });

  it("notification failure does not mutate business state", async () => {
    const provider = new FakeSubscriptionMessageProvider({
      mode: "failure"
    });

    const result = await provider.send({
      recipientUserId: "user_1",
      templateKey: "auction_outbid",
      payload: { auctionId: "auction_1" }
    });

    expect(result.ok).toBe(false);
    expect(result.mutatesBusinessState).toBe(false);
  });

  it("sensitive verification delivery exposes code only through provider boundary", async () => {
    const provider = new FakeSensitiveOperationVerificationProvider();

    const result = await provider.send({
      recipientUserId: "user_1",
      challengeId: "challenge_1",
      operationType: "export_child_data",
      targetType: "child_profile",
      targetId: "child_1",
      code: "123456",
      expiresAt: new Date("2026-05-31T15:00:00.000Z"),
      ttlSeconds: 300
    });

    expect(result.ok).toBe(true);
    expect(provider.getLastDelivery()?.code).toBe("123456");
  });
});
