import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsController } from "../../src/accounts/accounts.controller.js";
import { GuardianManagementService } from "../../src/accounts/guardian-management.service.js";
import { OnboardingService } from "../../src/accounts/onboarding.service.js";
import { SensitiveOperationService } from "../../src/accounts/sensitive-operation.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";

const AUTHORIZATION = "Bearer access_token_1";
const AUTH_USER_ID = "auth_user_1";
const AUTH_SESSION_ID = "auth_session_1";

function buildController() {
  const onboarding = {
    loginWithWechatCodeAndCreateSession: vi.fn(),
    ensureGuardianProfile: vi.fn(),
    createChildWithPrimaryGuardian: vi.fn()
  } as unknown as OnboardingService;
  const sessions = {
    assertActiveSession: vi.fn().mockResolvedValue({
      result: "accepted",
      sessionId: AUTH_SESSION_ID,
      userId: AUTH_USER_ID,
      expiresAt: "2026-05-31T13:00:00.000Z",
      lastSeenAt: "2026-05-31T12:00:00.000Z"
    }),
    refreshSession: vi.fn(),
    revokeSession: vi.fn()
  } as unknown as SessionService;
  const guardians = {
    updateChildGuardianSettings: vi.fn(),
    openGuardianDispute: vi.fn()
  } as unknown as GuardianManagementService;
  const sensitiveOperations = {
    createChallenge: vi.fn(),
    markPassed: vi.fn()
  } as unknown as SensitiveOperationService;
  const sessionTokens = {
    verifyAccessToken: vi.fn().mockReturnValue({
      result: "accepted",
      userId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      expiresAt: "2026-05-31T13:00:00.000Z"
    })
  } as unknown as SessionTokenService;

  return {
    controller: new AccountsController(
      onboarding,
      sessions,
      guardians,
      sensitiveOperations,
      sessionTokens
    ),
    onboarding,
    sessions,
    guardians,
    sensitiveOperations,
    sessionTokens
  };
}

function setServerTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function expectWriteEnvelope(
  response: Record<string, unknown>,
  expected: {
    result: "accepted" | "rejected";
    serverTime: string;
    targetType: string;
    targetId: string;
    latestStatus: string;
    errorCode?: string;
  }
) {
  expect(response).toEqual(
    expect.objectContaining({
      result: expected.result,
      serverTime: expected.serverTime,
      targetType: expected.targetType,
      targetId: expected.targetId,
      targetVersion: 1,
      latestStatus: expected.latestStatus,
      refreshRequired: false,
      ...(expected.errorCode ? { errorCode: expected.errorCode } : {})
    })
  );
}

describe("AccountsController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes POST /accounts/wechat-login using server time", async () => {
    setServerTime("2026-05-31T12:00:00.000Z");
    const { controller, onboarding } = buildController();
    vi.mocked(onboarding.loginWithWechatCodeAndCreateSession).mockResolvedValue({
      result: "accepted",
      userId: "user_1",
      openid: "mock_openid_1",
      isNewUser: true,
      sessionId: "session_1",
      accessToken: "access_1",
      accessTokenExpiresAt: "2026-05-31T12:15:00.000Z",
      refreshToken: "refresh_1",
      refreshTokenExpiresAt: "2026-06-30T12:00:00.000Z"
    });

    const response = await controller.loginWithWechat({
      code: "mock_openid_1",
      deviceFingerprintHash: "device_hash",
      ipHash: "ip_hash",
      userAgentHash: "ua_hash"
    });

    expect(onboarding.loginWithWechatCodeAndCreateSession).toHaveBeenCalledWith({
      code: "mock_openid_1",
      deviceFingerprintHash: "device_hash",
      ipHash: "ip_hash",
      userAgentHash: "ua_hash",
      now: new Date("2026-05-31T12:00:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:00:00.000Z",
      targetType: "user_session",
      targetId: "session_1",
      latestStatus: "active"
    });
    expect(response).toEqual(
      expect.objectContaining({
        userId: "user_1",
        accessToken: "access_1",
        refreshToken: "refresh_1"
      })
    );
  });

  it("normalizes POST /accounts/refresh using server time", async () => {
    setServerTime("2026-05-31T12:05:00.000Z");
    const { controller, sessions } = buildController();
    vi.mocked(sessions.refreshSession).mockResolvedValue({
      result: "accepted",
      userId: "user_2",
      sessionId: "session_2",
      accessToken: "access_2",
      accessTokenExpiresAt: "2026-05-31T12:20:00.000Z",
      refreshToken: "refresh_2",
      refreshTokenExpiresAt: "2026-06-30T12:05:00.000Z"
    });

    const response = await controller.refreshSession({
      refreshToken: "refresh_old"
    });

    expect(sessions.refreshSession).toHaveBeenCalledWith({
      refreshToken: "refresh_old",
      now: new Date("2026-05-31T12:05:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:05:00.000Z",
      targetType: "user_session",
      targetId: "session_2",
      latestStatus: "active"
    });
  });

  it("derives logout actor and session from Bearer token", async () => {
    setServerTime("2026-05-31T12:10:00.000Z");
    const { controller, sessions } = buildController();
    vi.mocked(sessions.revokeSession).mockResolvedValue({
      result: "accepted",
      sessionId: AUTH_SESSION_ID,
      status: "revoked",
      revokedAt: "2026-05-31T12:10:00.000Z"
    });

    const response = await controller.logout(
      {
        reason: "user initiated logout"
      },
      AUTHORIZATION
    );

    expect(sessions.revokeSession).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      reason: "user initiated logout",
      now: new Date("2026-05-31T12:10:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:10:00.000Z",
      targetType: "user_session",
      targetId: AUTH_SESSION_ID,
      latestStatus: "revoked"
    });
  });

  it("derives guardian profile userId from Bearer token", async () => {
    setServerTime("2026-05-31T12:16:00.000Z");
    const { controller, onboarding } = buildController();
    vi.mocked(onboarding.ensureGuardianProfile).mockResolvedValue({
      result: "accepted",
      guardianId: "guardian_1",
      guardianStatus: "active"
    });

    const response = await controller.ensureGuardianProfile(
      {
        phoneHash: "phone_hash_secret",
        phoneLast4: "1234",
        consentVersion: "guardian-consent-v1",
        consentedAt: "2026-05-31T12:15:00.000Z"
      },
      AUTHORIZATION
    );

    expect(onboarding.ensureGuardianProfile).toHaveBeenCalledWith({
      userId: AUTH_USER_ID,
      phoneHash: "phone_hash_secret",
      phoneLast4: "1234",
      consentVersion: "guardian-consent-v1",
      consentedAt: new Date("2026-05-31T12:15:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:16:00.000Z",
      targetType: "guardian_profile",
      targetId: "guardian_1",
      latestStatus: "active"
    });
    expect(response).not.toHaveProperty("phoneHash");
  });

  it("derives child creation actor from Bearer token", async () => {
    setServerTime("2026-05-31T12:20:00.000Z");
    const { controller, onboarding } = buildController();
    vi.mocked(onboarding.createChildWithPrimaryGuardian).mockResolvedValue({
      result: "accepted",
      childId: "child_1",
      childStatus: "active",
      availablePoints: 120
    });

    const response = await controller.createChild(
      {
        guardianId: "guardian_5",
        displayName: "Kid",
        gradeBand: "grade_3_4",
        idempotencyKey: "child_create_1"
      },
      AUTHORIZATION
    );

    expect(onboarding.createChildWithPrimaryGuardian).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      guardianId: "guardian_5",
      displayName: "Kid",
      gradeBand: "grade_3_4",
      idempotencyKey: "child_create_1",
      now: new Date("2026-05-31T12:20:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:20:00.000Z",
      targetType: "child_profile",
      targetId: "child_1",
      latestStatus: "active"
    });
  });

  it("derives child settings actor and session from Bearer token", async () => {
    setServerTime("2026-05-31T12:25:00.000Z");
    const { controller, guardians } = buildController();
    vi.mocked(guardians.updateChildGuardianSettings).mockResolvedValue({
      result: "accepted",
      childId: "child_2",
      challengeId: "challenge_2",
      settings: {
        canPublish: true,
        canBid: true,
        maxBidPoints: 50,
        bidRequiresGuardianConfirmation: false,
        canUseCourier: false,
        canUseGuardianArrangedDelivery: true,
        canFavorite: true
      }
    });

    const response = await controller.updateChildSettings(
      "child_2",
      {
        patch: {
          canPublish: true,
          canBid: true,
          maxBidPoints: 50
        }
      },
      AUTHORIZATION
    );

    expect(guardians.updateChildGuardianSettings).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      childId: "child_2",
      sessionId: AUTH_SESSION_ID,
      challengeId: undefined,
      patch: {
        canPublish: true,
        canBid: true,
        maxBidPoints: 50
      },
      now: new Date("2026-05-31T12:25:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:25:00.000Z",
      targetType: "child_guardian_settings",
      targetId: "child_2",
      latestStatus: "active"
    });
  });

  it("derives guardian dispute actor from Bearer token", async () => {
    setServerTime("2026-05-31T12:30:00.000Z");
    const { controller, guardians } = buildController();
    vi.mocked(guardians.openGuardianDispute).mockResolvedValue({
      result: "accepted",
      disputeId: "dispute_1",
      childId: "child_3",
      status: "frozen",
      frozenAt: "2026-05-31T12:30:00.000Z",
      resolvedAt: null,
      resolutionSummary: null
    });

    const response = await controller.openGuardianDispute(
      "child_3",
      {
        disputeType: "consent",
        reason: "guardian conflict"
      },
      AUTHORIZATION
    );

    expect(guardians.openGuardianDispute).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      childId: "child_3",
      disputeType: "consent",
      reason: "guardian conflict",
      now: new Date("2026-05-31T12:30:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:30:00.000Z",
      targetType: "guardian_dispute",
      targetId: "dispute_1",
      latestStatus: "frozen"
    });
  });

  it("exposes sensitive operation challenge creation over HTTP", async () => {
    setServerTime("2026-05-31T12:31:00.000Z");
    const { controller, sensitiveOperations } = buildController();
    vi.mocked(sensitiveOperations.createChallenge).mockResolvedValue({
      result: "accepted",
      challengeId: "challenge_1",
      actorUserId: AUTH_USER_ID,
      operationType: "create_community",
      targetType: "guardian_profile",
      targetId: "guardian_1",
      expiresAt: "2026-05-31T12:36:00.000Z",
      status: "pending"
    });

    const response = await controller.createSensitiveOperationChallenge(
      {
        operationType: "create_community",
        targetType: "guardian_profile",
        targetId: "guardian_1"
      },
      AUTHORIZATION
    );

    expect(sensitiveOperations.createChallenge).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      operationType: "create_community",
      targetType: "guardian_profile",
      targetId: "guardian_1",
      now: new Date("2026-05-31T12:31:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:31:00.000Z",
      targetType: "sensitive_operation_challenge",
      targetId: "challenge_1",
      latestStatus: "pending"
    });
    expect(response).toEqual(
      expect.objectContaining({
        operationType: "create_community",
        operationTargetType: "guardian_profile",
        operationTargetId: "guardian_1"
      })
    );
  });

  it("exposes sensitive operation challenge verification over HTTP", async () => {
    setServerTime("2026-05-31T12:31:30.000Z");
    const { controller, sensitiveOperations } = buildController();
    vi.mocked(sensitiveOperations.markPassed).mockResolvedValue({
      result: "accepted",
      challengeId: "challenge_2",
      actorUserId: AUTH_USER_ID,
      status: "passed",
      passedAt: "2026-05-31T12:31:30.000Z",
      expiresAt: "2026-05-31T12:36:00.000Z"
    });

    const response = await controller.verifySensitiveOperationChallenge(
      "challenge_2",
      {
        verificationCode: "135790"
      },
      AUTHORIZATION
    );

    expect(sensitiveOperations.markPassed).toHaveBeenCalledWith({
      challengeId: "challenge_2",
      actorUserId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      verificationCode: "135790",
      now: new Date("2026-05-31T12:31:30.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T12:31:30.000Z",
      targetType: "sensitive_operation_challenge",
      targetId: "challenge_2",
      latestStatus: "passed"
    });
  });

  it("rejects protected account writes without Bearer auth", async () => {
    setServerTime("2026-05-31T12:32:00.000Z");
    const { controller } = buildController();

    await expect(
      controller.createChild({
        guardianId: "guardian_5",
        displayName: "Kid",
        gradeBand: "grade_3_4",
        idempotencyKey: "child_create_1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("normalizes rejected account writes with adjudicated metadata", async () => {
    setServerTime("2026-05-31T12:35:00.000Z");
    const { controller, sessions } = buildController();
    vi.mocked(sessions.refreshSession).mockResolvedValue({
      result: "rejected",
      errorCode: "REFRESH_TOKEN_INVALID"
    });

    const response = await controller.refreshSession({
      refreshToken: "bad_refresh"
    });

    expectWriteEnvelope(response, {
      result: "rejected",
      serverTime: "2026-05-31T12:35:00.000Z",
      targetType: "user_session",
      targetId: "session_refresh",
      latestStatus: "rejected",
      errorCode: "REFRESH_TOKEN_INVALID"
    });
  });
});
