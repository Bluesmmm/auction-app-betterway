import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChildOnboardingRequest,
  buildCommunityJoinRequest,
  buildGuardianJoinConfirmationRequest,
  buildGuardianOnboardingRequest,
  buildSensitiveOperationChallengeRequest,
  buildSensitiveOperationChallengeVerificationRequest,
  buildWechatLoginRequest,
  requestJson,
  type MiniprogramJsonResponse,
  type Stage2RequestResult
} from "../../../miniprogram/src/stage2-api.js";

const configuredApiBaseUrl = "https://api.example.com";

describe("miniprogram Stage 2 shell", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.API_BASE_URL = configuredApiBaseUrl;
    process.env.MINIPROGRAM_API_BASE_URL = configuredApiBaseUrl;
  });

  afterEach(() => {
    delete process.env.API_BASE_URL;
    delete process.env.MINIPROGRAM_API_BASE_URL;
  });

  it("registers onboarding, child, and join pages in the miniprogram app config", () => {
    const appConfig = JSON.parse(readFileSync("apps/miniprogram/app.json", "utf8")) as {
      pages: string[];
    };

    expect(appConfig.pages).toEqual(
      expect.arrayContaining([
        "pages/health/index",
        "pages/stage2/onboarding/index",
        "pages/stage2/child/index",
        "pages/stage2/join/index"
      ])
    );
  });

  it("builds pure Stage 2 request configs for onboarding, child creation, and join flows", () => {
    expect(
      buildWechatLoginRequest(configuredApiBaseUrl, {
        code: "mock-wechat-code",
        deviceFingerprintHash: "device_hash",
        ipHash: "ip_hash",
        userAgentHash: "ua_hash"
      })
    ).toEqual({
      url: "https://api.example.com/accounts/wechat-login",
      method: "POST",
      data: {
        code: "mock-wechat-code",
        deviceFingerprintHash: "device_hash",
        ipHash: "ip_hash",
        userAgentHash: "ua_hash"
      },
      header: {
        "content-type": "application/json"
      }
    });
    expect(
      buildGuardianOnboardingRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        phoneHash: "phone_hash_1",
        phoneLast4: "1234",
        consentVersion: "guardian-consent-v1",
        consentedAt: "2026-05-31T00:00:00.000Z"
      })
    ).toEqual({
      url: "https://api.example.com/accounts/guardian-profile",
      method: "POST",
      data: {
        phoneHash: "phone_hash_1",
        phoneLast4: "1234",
        consentVersion: "guardian-consent-v1",
        consentedAt: "2026-05-31T00:00:00.000Z"
      },
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
    expect(
      buildChildOnboardingRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        guardianId: "guardian_1",
        displayName: "Child 1",
        gradeBand: "grade_3_4",
        idempotencyKey: "child_1"
      })
    ).toEqual({
      url: "https://api.example.com/accounts/children",
      method: "POST",
      data: {
        guardianId: "guardian_1",
        displayName: "Child 1",
        gradeBand: "grade_3_4",
        idempotencyKey: "child_1"
      },
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
    expect(
      buildCommunityJoinRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        childId: "child_1",
        code: "STAGE2JOIN",
        idempotencyKey: "join_1"
      })
    ).toEqual({
      url: "https://api.example.com/communities/join-requests",
      method: "POST",
      data: {
        childId: "child_1",
        code: "STAGE2JOIN",
        idempotencyKey: "join_1"
      },
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
    expect(
      buildGuardianJoinConfirmationRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        communityId: "community_1",
        childId: "child_1"
      })
    ).toEqual({
      url: "https://api.example.com/communities/community_1/members/child_1/guardian-confirm",
      method: "POST",
      data: {},
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
    expect(
      buildSensitiveOperationChallengeRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        operationType: "create_community",
        targetType: "guardian_profile",
        targetId: "guardian_1"
      })
    ).toEqual({
      url: "https://api.example.com/accounts/sensitive-operation-challenges",
      method: "POST",
      data: {
        operationType: "create_community",
        targetType: "guardian_profile",
        targetId: "guardian_1"
      },
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
    expect(
      buildSensitiveOperationChallengeVerificationRequest(configuredApiBaseUrl, {
        accessToken: "access_1",
        challengeId: "challenge_1",
        verificationCode: "135790"
      })
    ).toEqual({
      url: "https://api.example.com/accounts/sensitive-operation-challenges/challenge_1/verify",
      method: "POST",
      data: {
        verificationCode: "135790"
      },
      header: {
        "content-type": "application/json",
        authorization: "Bearer access_1"
      }
    });
  });

  it("wraps Stage 2 JSON requests with a reusable transport adapter", async () => {
    const requested: Record<string, unknown>[] = [];
    const response = await requestJson<{ result: "accepted"; userId: string }>(
      buildWechatLoginRequest(configuredApiBaseUrl, {
        code: "mock-stage2-code",
        deviceFingerprintHash: "device_hash",
        ipHash: "ip_hash",
        userAgentHash: "ua_hash"
      }),
      async (input) => {
        requested.push(input as Record<string, unknown>);
        return {
          statusCode: 200,
          data: {
            result: "accepted",
            userId: "user_stage2_1"
          }
        };
      }
    );

    expect(requested).toEqual([
      {
        url: "https://api.example.com/accounts/wechat-login",
        method: "POST",
        data: {
          code: "mock-stage2-code",
          deviceFingerprintHash: "device_hash",
          ipHash: "ip_hash",
          userAgentHash: "ua_hash"
        },
        header: {
          "content-type": "application/json"
        }
      }
    ]);
    expect(response).toEqual({
      statusCode: 200,
      data: {
        result: "accepted",
        userId: "user_stage2_1"
      }
    });
  });

  it("exposes runnable onboarding, child, and join page shells around the Stage 2 request builders", async () => {
    const { stage2OnboardingPage } = await import(
      "../../../miniprogram/pages/stage2/onboarding/index.js"
    );
    const { stage2ChildPage } = await import(
      "../../../miniprogram/pages/stage2/child/index.js"
    );
    const { stage2JoinPage } = await import(
      "../../../miniprogram/pages/stage2/join/index.js"
    );
    const requestedUrls: string[] = [];

    const request = async ({
      url
    }: {
      url: string;
    }): Promise<MiniprogramJsonResponse<Stage2RequestResult>> => {
      requestedUrls.push(url);
      return {
        statusCode: 200,
        data: {
          result: "accepted"
        }
      };
    };

    const onboardingUpdates: Record<string, unknown>[] = [];
    const onboardingPage = {
      ...stage2OnboardingPage,
      data: { ...stage2OnboardingPage.data },
      setData(update: Record<string, unknown>) {
        onboardingUpdates.push(update);
        this.data = {
          ...this.data,
          ...update
        };
      }
    };
    const childUpdates: Record<string, unknown>[] = [];
    const childPage = {
      ...stage2ChildPage,
      data: { ...stage2ChildPage.data },
      setData(update: Record<string, unknown>) {
        childUpdates.push(update);
        this.data = {
          ...this.data,
          ...update
        };
      }
    };
    const joinUpdates: Record<string, unknown>[] = [];
    const joinPage = {
      ...stage2JoinPage,
      data: { ...stage2JoinPage.data },
      setData(update: Record<string, unknown>) {
        joinUpdates.push(update);
        this.data = {
          ...this.data,
          ...update
        };
      }
    };

    await stage2OnboardingPage.submitWechatLogin.call(
      onboardingPage,
      {
        code: "mock-stage2-login",
        deviceFingerprintHash: "device_hash",
        ipHash: "ip_hash",
        userAgentHash: "ua_hash"
      },
      request
    );
    await stage2OnboardingPage.submitGuardianProfile.call(
      onboardingPage,
      {
        accessToken: "access_1",
        phoneHash: "phone_hash_1",
        phoneLast4: "1234",
        consentVersion: "guardian-consent-v1",
        consentedAt: "2026-05-31T00:00:00.000Z"
      },
      request
    );
    await stage2ChildPage.submitChildProfile.call(
      childPage,
      {
        accessToken: "access_1",
        guardianId: "guardian_1",
        displayName: "Child 1",
        gradeBand: "grade_3_4",
        idempotencyKey: "child_1"
      },
      request
    );
    await stage2JoinPage.submitJoinRequest.call(
      joinPage,
      {
        accessToken: "access_1",
        childId: "child_1",
        code: "STAGE2JOIN",
        idempotencyKey: "join_1"
      },
      request
    );
    await stage2JoinPage.confirmGuardianJoin.call(
      joinPage,
      {
        accessToken: "access_1",
        communityId: "community_1",
        childId: "child_1"
      },
      request
    );

    expect(onboardingPage.data).toEqual({
      apiBaseUrl: configuredApiBaseUrl,
      loginStatus: "accepted",
      guardianStatus: "accepted"
    });
    expect(childPage.data).toEqual({
      apiBaseUrl: configuredApiBaseUrl,
      childStatus: "accepted"
    });
    expect(joinPage.data).toEqual({
      apiBaseUrl: configuredApiBaseUrl,
      joinStatus: "accepted",
      confirmationStatus: "accepted"
    });
    expect(onboardingUpdates).toEqual([
      { loginStatus: "submitting" },
      { loginStatus: "accepted" },
      { guardianStatus: "submitting" },
      { guardianStatus: "accepted" }
    ]);
    expect(childUpdates).toEqual([
      { childStatus: "submitting" },
      { childStatus: "accepted" }
    ]);
    expect(joinUpdates).toEqual([
      { joinStatus: "submitting" },
      { joinStatus: "accepted" },
      { confirmationStatus: "submitting" },
      { confirmationStatus: "accepted" }
    ]);
    expect(requestedUrls).toEqual([
      "https://api.example.com/accounts/wechat-login",
      "https://api.example.com/accounts/guardian-profile",
      "https://api.example.com/accounts/children",
      "https://api.example.com/communities/join-requests",
      "https://api.example.com/communities/community_1/members/child_1/guardian-confirm"
    ]);
  });
});
