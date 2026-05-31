import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RiskGovernanceService } from "../../src/accounts/risk-governance.service.js";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { CommunitiesController } from "../../src/communities/communities.controller.js";
import { CommunityAdminAuthorizationService } from "../../src/communities/community-admin-authorization.service.js";
import { CommunityAccessService } from "../../src/communities/community-access.service.js";
import { CommunityApplicationService } from "../../src/communities/community-application.service.js";

const AUTHORIZATION = "Bearer access_token_1";
const AUTH_USER_ID = "auth_user_1";
const AUTH_SESSION_ID = "auth_session_1";

function buildController() {
  const applications = {
    listCreationRequests: vi.fn(),
    submitCreationRequest: vi.fn(),
    approveCreationRequest: vi.fn(),
    rejectCreationRequest: vi.fn()
  } as unknown as CommunityApplicationService;
  const adminAuthorizations = {
    grantActivityAdmin: vi.fn(),
    revokeActivityAdmin: vi.fn()
  } as unknown as CommunityAdminAuthorizationService;
  const access = {
    listMemberReviewQueue: vi.fn(),
    createInviteCode: vi.fn(),
    requestJoinWithInvite: vi.fn(),
    confirmJoinByPrimaryGuardian: vi.fn(),
    recordRosterVerification: vi.fn(),
    approveCommunityMember: vi.fn()
  } as unknown as CommunityAccessService;
  const risks = {
    listRiskSignals: vi.fn(),
    recordRiskSignal: vi.fn(),
    reviewRiskSignal: vi.fn(),
    applyRiskRestriction: vi.fn(),
    resolveRiskRestriction: vi.fn()
  } as unknown as RiskGovernanceService;
  const sessionTokens = {
    verifyAccessToken: vi.fn().mockReturnValue({
      result: "accepted",
      userId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      expiresAt: "2026-05-31T14:00:00.000Z"
    })
  } as unknown as SessionTokenService;
  const sessions = {
    assertActiveSession: vi.fn().mockResolvedValue({
      result: "accepted",
      sessionId: AUTH_SESSION_ID,
      userId: AUTH_USER_ID,
      expiresAt: "2026-05-31T14:00:00.000Z",
      lastSeenAt: "2026-05-31T13:00:00.000Z"
    })
  } as unknown as SessionService;

  return {
    controller: new CommunitiesController(
      applications,
      adminAuthorizations,
      access,
      risks,
      sessionTokens,
      sessions
    ),
    applications,
    adminAuthorizations,
    access,
    risks,
    sessionTokens,
    sessions
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

describe("CommunitiesController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes GET /communities/creation-requests", async () => {
    setServerTime("2026-05-31T12:59:00.000Z");
    const { controller, applications } = buildController();
    vi.mocked(applications.listCreationRequests).mockResolvedValue({
      result: "accepted",
      requests: [
        {
          requestId: "request_1",
          guardianId: "guardian_1",
          requestedName: "Community A",
          gradeBand: "grade_3_4",
          expectedChildCount: 30,
          status: "pending_review",
          submittedAt: "2026-05-31T12:58:00.000Z"
        }
      ]
    });

    await expect(
      controller.listCreationRequests(AUTHORIZATION)
    ).resolves.toEqual({
      result: "accepted",
      requests: [
        {
          requestId: "request_1",
          guardianId: "guardian_1",
          requestedName: "Community A",
          gradeBand: "grade_3_4",
          expectedChildCount: 30,
          status: "pending_review",
          submittedAt: "2026-05-31T12:58:00.000Z"
        }
      ]
    });
    expect(applications.listCreationRequests).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID
    });
  });

  it("normalizes GET /communities/member-review-queue", async () => {
    setServerTime("2026-05-31T12:59:30.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.listMemberReviewQueue).mockResolvedValue({
      result: "accepted",
      members: [
        {
          key: "member_1",
          communityId: "community_1",
          childId: "child_1",
          guardianId: "guardian_1",
          memberStatus: "pending_admin",
          rosterVerificationStatus: "matched",
          riskState: "clear",
          requestedAt: "2026-05-31T12:58:30.000Z"
        }
      ]
    });

    await expect(
      controller.listMemberReviewQueue(AUTHORIZATION)
    ).resolves.toEqual({
      result: "accepted",
      members: [
        {
          key: "member_1",
          communityId: "community_1",
          childId: "child_1",
          guardianId: "guardian_1",
          memberStatus: "pending_admin",
          rosterVerificationStatus: "matched",
          riskState: "clear",
          requestedAt: "2026-05-31T12:58:30.000Z"
        }
      ]
    });
    expect(access.listMemberReviewQueue).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      now: new Date("2026-05-31T12:59:30.000Z")
    });
  });

  it("normalizes GET /communities/risk-signals", async () => {
    setServerTime("2026-05-31T12:59:40.000Z");
    const { controller, risks } = buildController();
    vi.mocked(risks.listRiskSignals).mockResolvedValue({
      result: "accepted",
      signals: [
        {
          key: "signal_1",
          signalId: "signal_1",
          scope: "child",
          targetId: "child_1",
          type: "abnormal_join_pattern",
          status: "open",
          restrictionCount: 1,
          openedAt: "2026-05-31T12:58:40.000Z"
        }
      ]
    });

    await expect(controller.listRiskSignals(AUTHORIZATION)).resolves.toEqual({
      result: "accepted",
      signals: [
        {
          key: "signal_1",
          signalId: "signal_1",
          scope: "child",
          targetId: "child_1",
          type: "abnormal_join_pattern",
          status: "open",
          restrictionCount: 1,
          openedAt: "2026-05-31T12:58:40.000Z"
        }
      ]
    });
    expect(risks.listRiskSignals).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID
    });
  });

  it("derives POST /communities/creation-requests actor and session from Bearer token", async () => {
    setServerTime("2026-05-31T13:00:00.000Z");
    const { controller, applications } = buildController();
    vi.mocked(applications.submitCreationRequest).mockResolvedValue({
      result: "accepted",
      requestId: "request_1",
      requestStatus: "pending_review"
    });

    const response = await controller.submitCreationRequest(
      {
        guardianId: "guardian_1",
        name: "Community A",
        gradeBand: "grade_3_4",
        expectedChildCount: 30,
        ruleDraftJson: { version: 1 },
        challengeId: "challenge_1"
      },
      AUTHORIZATION
    );

    expect(applications.submitCreationRequest).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
      guardianId: "guardian_1",
      name: "Community A",
      description: undefined,
      gradeBand: "grade_3_4",
      expectedChildCount: 30,
      ruleDraftJson: { version: 1 },
      challengeId: "challenge_1",
      now: new Date("2026-05-31T13:00:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:00:00.000Z",
      targetType: "community_creation_request",
      targetId: "request_1",
      latestStatus: "pending_review"
    });
  });

  it("derives platform admin for creation request review from Bearer token", async () => {
    setServerTime("2026-05-31T13:05:00.000Z");
    const { controller, applications } = buildController();
    vi.mocked(applications.approveCreationRequest).mockResolvedValue({
      result: "accepted",
      requestId: "request_2",
      requestStatus: "approved",
      communityId: "community_2"
    });

    const response = await controller.approveCreationRequest(
      "request_2",
      {
        defaultAuctionDurationMinutes: 1440
      },
      AUTHORIZATION
    );

    expect(applications.approveCreationRequest).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      requestId: "request_2",
      defaultAuctionDurationMinutes: 1440,
      now: new Date("2026-05-31T13:05:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:05:00.000Z",
      targetType: "community_creation_request",
      targetId: "request_2",
      latestStatus: "approved"
    });
  });

  it("derives platform admin for creation request rejection from Bearer token", async () => {
    setServerTime("2026-05-31T13:06:00.000Z");
    const { controller, applications } = buildController();
    vi.mocked(applications.rejectCreationRequest).mockResolvedValue({
      result: "accepted",
      requestId: "request_2b",
      requestStatus: "rejected",
      communityId: null
    });

    const response = await controller.rejectCreationRequest(
      "request_2b",
      {
        reason: "missing school evidence"
      },
      AUTHORIZATION
    );

    expect(applications.rejectCreationRequest).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      requestId: "request_2b",
      reason: "missing school evidence",
      now: new Date("2026-05-31T13:06:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:06:00.000Z",
      targetType: "community_creation_request",
      targetId: "request_2b",
      latestStatus: "rejected"
    });
  });

  it("derives platform admin for activity admin grants from Bearer token", async () => {
    setServerTime("2026-05-31T13:10:00.000Z");
    const { controller, adminAuthorizations } = buildController();
    vi.mocked(adminAuthorizations.grantActivityAdmin).mockResolvedValue({
      result: "accepted",
      adminProfileId: "admin_profile_1",
      communityId: "community_3",
      scopeStatus: "active"
    });

    const response = await controller.grantActivityAdmin(
      "community_3",
      {
        targetUserId: "target_user_1"
      },
      AUTHORIZATION
    );

    expect(adminAuthorizations.grantActivityAdmin).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      targetUserId: "target_user_1",
      communityId: "community_3",
      now: new Date("2026-05-31T13:10:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:10:00.000Z",
      targetType: "admin_community_scope",
      targetId: "admin_profile_1",
      latestStatus: "active"
    });
  });

  it("derives platform admin for activity admin revokes from Bearer token", async () => {
    setServerTime("2026-05-31T13:11:00.000Z");
    const { controller, adminAuthorizations } = buildController();
    vi.mocked(adminAuthorizations.revokeActivityAdmin).mockResolvedValue({
      result: "accepted",
      adminProfileId: "admin_profile_1",
      communityId: "community_3",
      scopeStatus: "revoked"
    });

    const response = await controller.revokeActivityAdmin(
      "community_3",
      {
        targetUserId: "target_user_1",
        reason: "rotation"
      },
      AUTHORIZATION
    );

    expect(adminAuthorizations.revokeActivityAdmin).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      targetUserId: "target_user_1",
      communityId: "community_3",
      reason: "rotation",
      now: new Date("2026-05-31T13:11:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:11:00.000Z",
      targetType: "admin_community_scope",
      targetId: "admin_profile_1",
      latestStatus: "revoked"
    });
  });

  it("derives activity admin for invite creation from Bearer token", async () => {
    setServerTime("2026-05-31T13:15:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.createInviteCode).mockResolvedValue({
      result: "accepted",
      inviteCodeId: "invite_1",
      code: "JOIN123",
      status: "active"
    });

    const response = await controller.createInvite(
      "community_4",
      {
        code: "JOIN123",
        maxUses: 5
      },
      AUTHORIZATION
    );

    expect(access.createInviteCode).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      communityId: "community_4",
      code: "JOIN123",
      maxUses: 5,
      expiresAt: undefined
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:15:00.000Z",
      targetType: "community_invite_code",
      targetId: "invite_1",
      latestStatus: "active"
    });
  });

  it("derives join request actor from Bearer token", async () => {
    setServerTime("2026-05-31T13:20:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.requestJoinWithInvite).mockResolvedValue({
      result: "accepted",
      communityId: "community_5",
      childId: "child_5",
      memberStatus: "pending_guardian"
    });

    const response = await controller.requestJoin(
      {
        childId: "child_5",
        code: "JOIN555",
        idempotencyKey: "join_req_5"
      },
      AUTHORIZATION
    );

    expect(access.requestJoinWithInvite).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      childId: "child_5",
      code: "JOIN555",
      idempotencyKey: "join_req_5",
      now: new Date("2026-05-31T13:20:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:20:00.000Z",
      targetType: "community_member",
      targetId: "community_5:child_5",
      latestStatus: "pending_guardian"
    });
  });

  it("derives guardian confirmation actor from Bearer token", async () => {
    setServerTime("2026-05-31T13:25:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.confirmJoinByPrimaryGuardian).mockResolvedValue({
      result: "accepted",
      communityId: "community_6",
      childId: "child_6",
      memberStatus: "pending_admin"
    });

    const response = await controller.guardianConfirmMember(
      "community_6",
      "child_6",
      AUTHORIZATION
    );

    expect(access.confirmJoinByPrimaryGuardian).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      communityId: "community_6",
      childId: "child_6",
      now: new Date("2026-05-31T13:25:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:25:00.000Z",
      targetType: "community_member",
      targetId: "community_6:child_6",
      latestStatus: "pending_admin"
    });
  });

  it("derives roster verification actor from Bearer token without echoing evidence", async () => {
    setServerTime("2026-05-31T13:30:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.recordRosterVerification).mockResolvedValue({
      result: "accepted",
      communityId: "community_7",
      childId: "child_7",
      memberStatus: "pending_admin"
    });

    const response = await controller.recordRosterVerification(
      "community_7",
      "child_7",
      {
        status: "matched",
        evidenceJson: {
          rosterId: "7A",
          matchedBy: "teacher"
        }
      },
      AUTHORIZATION
    );

    expect(access.recordRosterVerification).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      communityId: "community_7",
      childId: "child_7",
      status: "matched",
      evidenceJson: {
        rosterId: "7A",
        matchedBy: "teacher"
      },
      now: new Date("2026-05-31T13:30:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:30:00.000Z",
      targetType: "community_member",
      targetId: "community_7:child_7",
      latestStatus: "pending_admin"
    });
    expect(response).not.toHaveProperty("evidenceJson");
  });

  it("derives member approval actor from Bearer token", async () => {
    setServerTime("2026-05-31T13:35:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.approveCommunityMember).mockResolvedValue({
      result: "accepted",
      communityId: "community_8",
      childId: "child_8",
      memberStatus: "active"
    });

    const response = await controller.approveCommunityMember(
      "community_8",
      "child_8",
      AUTHORIZATION
    );

    expect(access.approveCommunityMember).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      communityId: "community_8",
      childId: "child_8",
      now: new Date("2026-05-31T13:35:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:35:00.000Z",
      targetType: "community_member",
      targetId: "community_8:child_8",
      latestStatus: "active"
    });
  });

  it("derives risk signal actor from Bearer token without echoing evidence", async () => {
    setServerTime("2026-05-31T13:40:00.000Z");
    const { controller, risks } = buildController();
    vi.mocked(risks.recordRiskSignal).mockResolvedValue({
      result: "accepted",
      signalId: "signal_1",
      status: "open",
      restrictionIds: ["restriction_1"]
    });

    const response = await controller.recordRiskSignal(
      {
        type: "abnormal_join_pattern",
        scope: "child",
        targetId: "child_9",
        evidenceJson: {
          requestBurst: 5
        }
      },
      AUTHORIZATION
    );

    expect(risks.recordRiskSignal).toHaveBeenCalledWith({
      actorUserId: AUTH_USER_ID,
      type: "abnormal_join_pattern",
      scope: "child",
      targetId: "child_9",
      evidenceJson: {
        requestBurst: 5
      },
      now: new Date("2026-05-31T13:40:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:40:00.000Z",
      targetType: "risk_signal",
      targetId: "signal_1",
      latestStatus: "open"
    });
    expect(response).not.toHaveProperty("evidenceJson");
  });

  it("exposes risk signal review route", async () => {
    setServerTime("2026-05-31T13:42:00.000Z");
    const { controller, risks } = buildController();
    vi.mocked(risks.reviewRiskSignal).mockResolvedValue({
      result: "accepted",
      signalId: "signal_1",
      status: "resolved",
      resolvedRestrictionCount: 1
    });

    const response = await controller.reviewRiskSignal(
      "signal_1",
      {
        decision: "resolved",
        resolutionText: "manual review complete",
        resolveRestrictions: true
      },
      AUTHORIZATION
    );

    expect(risks.reviewRiskSignal).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      signalId: "signal_1",
      decision: "resolved",
      resolutionText: "manual review complete",
      resolveRestrictions: true,
      now: new Date("2026-05-31T13:42:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:42:00.000Z",
      targetType: "risk_signal",
      targetId: "signal_1",
      latestStatus: "resolved"
    });
  });

  it("derives platform admin for risk restrictions from Bearer token", async () => {
    setServerTime("2026-05-31T13:45:00.000Z");
    const { controller, risks } = buildController();
    vi.mocked(risks.applyRiskRestriction).mockResolvedValue({
      result: "accepted",
      restrictionId: "restriction_2",
      status: "active"
    });

    const response = await controller.applyRiskRestriction(
      {
        type: "no_join",
        scope: "child",
        targetId: "child_10",
        reason: "manual restriction"
      },
      AUTHORIZATION
    );

    expect(risks.applyRiskRestriction).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      type: "no_join",
      scope: "child",
      targetId: "child_10",
      reason: "manual restriction",
      expiresAt: undefined,
      now: new Date("2026-05-31T13:45:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:45:00.000Z",
      targetType: "risk_restriction",
      targetId: "restriction_2",
      latestStatus: "active"
    });
  });

  it("exposes risk restriction resolve route", async () => {
    setServerTime("2026-05-31T13:46:00.000Z");
    const { controller, risks } = buildController();
    vi.mocked(risks.resolveRiskRestriction).mockResolvedValue({
      result: "accepted",
      restrictionId: "restriction_2",
      status: "resolved"
    });

    const response = await controller.resolveRiskRestriction(
      "restriction_2",
      {
        resolutionText: "restriction cleared"
      },
      AUTHORIZATION
    );

    expect(risks.resolveRiskRestriction).toHaveBeenCalledWith({
      platformAdminUserId: AUTH_USER_ID,
      restrictionId: "restriction_2",
      resolutionText: "restriction cleared",
      now: new Date("2026-05-31T13:46:00.000Z")
    });
    expectWriteEnvelope(response, {
      result: "accepted",
      serverTime: "2026-05-31T13:46:00.000Z",
      targetType: "risk_restriction",
      targetId: "restriction_2",
      latestStatus: "resolved"
    });
  });

  it("rejects protected community writes without Bearer auth", async () => {
    setServerTime("2026-05-31T13:48:00.000Z");
    const { controller } = buildController();

    await expect(
      controller.requestJoin({
        childId: "child_5",
        code: "JOIN555",
        idempotencyKey: "join_req_5"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("normalizes rejected community writes with adjudicated metadata", async () => {
    setServerTime("2026-05-31T13:50:00.000Z");
    const { controller, access } = buildController();
    vi.mocked(access.createInviteCode).mockResolvedValue({
      result: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });

    const response = await controller.createInvite(
      "community_11",
      {
        code: "FAIL11"
      },
      AUTHORIZATION
    );

    expectWriteEnvelope(response, {
      result: "rejected",
      serverTime: "2026-05-31T13:50:00.000Z",
      targetType: "community_invite_code",
      targetId: "community_11",
      latestStatus: "rejected",
      errorCode: "COMMUNITY_NOT_OPEN_FOR_ADMISSION"
    });
  });
});
