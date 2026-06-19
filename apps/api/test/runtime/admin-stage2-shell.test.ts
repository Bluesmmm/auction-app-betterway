import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  adminShellNavigationItems,
  stage1AdminNavigationItems
} from "../../../admin/src/App.js";
import {
  applyRiskRestriction,
  approveCommunityMember,
  approveCommunityRequest,
  buildAdminCommunityScopeChallengeTargetId,
  buildStage2AdminCommandPath,
  createSensitiveOperationChallenge,
  createInviteCode,
  grantActivityAdmin,
  listCommunityCreationRequests,
  listScopedMemberReviewQueue,
  recordRosterVerification,
  recordRiskSignal,
  rejectCommunityRequest,
  resolveRiskRestriction,
  reviewCommunityRequestResultSchema,
  reviewRiskSignal,
  revokeActivityAdmin,
  verifySensitiveOperationChallenge,
  stage2AdminCommandCatalog
} from "../../../admin/src/stage2-api.js";
import { stage2AdminViewDefinitions } from "../../../admin/src/stage2-nav.js";

describe("admin Stage 2 shell", () => {
  it("keeps Stage 1 Runtime and Security routes in the admin shell", () => {
    expect(stage1AdminNavigationItems).toEqual([
      { key: "runtime", label: "Runtime", path: "/" },
      { key: "security", label: "Security", path: "/security" }
    ]);

    const appSource = readFileSync("apps/admin/src/App.tsx", "utf8");
    expect(appSource).toContain("RuntimeView");
    expect(appSource).toContain("SecurityView");
    expect(appSource).toContain('path="/security"');
  });

  it("registers dense Stage 2 navigation labels and routes", () => {
    expect(stage2AdminViewDefinitions).toEqual([
      expect.objectContaining({
        key: "community-requests",
        label: "Community Requests",
        path: "/stage2/community-requests"
      }),
      expect.objectContaining({
        key: "activity-admins",
        label: "Activity Admins",
        path: "/stage2/activity-admins"
      }),
      expect.objectContaining({
        key: "member-review",
        label: "Member Review",
        path: "/stage2/member-review"
      }),
      expect.objectContaining({
        key: "risk-review",
        label: "Risk Review",
        path: "/stage2/risk-review"
      })
    ]);

    const stage2Start = stage1AdminNavigationItems.length;
    expect(
      adminShellNavigationItems
        .slice(stage2Start, stage2Start + stage2AdminViewDefinitions.length)
        .map((item) => item.label)
    ).toEqual([
      "Community Requests",
      "Activity Admins",
      "Member Review",
      "Risk Review"
    ]);
  });

  it("exposes typed Stage 2 admin command helpers and route patterns", () => {
    expect(typeof approveCommunityRequest).toBe("function");
    expect(typeof listCommunityCreationRequests).toBe("function");
    expect(typeof rejectCommunityRequest).toBe("function");
    expect(typeof createSensitiveOperationChallenge).toBe("function");
    expect(typeof verifySensitiveOperationChallenge).toBe("function");
    expect(typeof buildAdminCommunityScopeChallengeTargetId).toBe("function");
    expect(typeof grantActivityAdmin).toBe("function");
    expect(typeof revokeActivityAdmin).toBe("function");
    expect(typeof createInviteCode).toBe("function");
    expect(typeof recordRosterVerification).toBe("function");
    expect(typeof approveCommunityMember).toBe("function");
    expect(typeof listScopedMemberReviewQueue).toBe("function");
    expect(typeof reviewRiskSignal).toBe("function");
    expect(typeof recordRiskSignal).toBe("function");
    expect(typeof applyRiskRestriction).toBe("function");
    expect(typeof resolveRiskRestriction).toBe("function");

    expect(stage2AdminCommandCatalog).toMatchObject({
      listCommunityCreationRequests: {
        method: "GET",
        path: "/communities/creation-requests"
      },
      approveCommunityRequest: {
        method: "POST",
        path: "/communities/creation-requests/:requestId/approve"
      },
      rejectCommunityRequest: {
        method: "POST",
        path: "/communities/creation-requests/:requestId/reject"
      },
      grantActivityAdmin: {
        method: "POST",
        path: "/communities/:communityId/activity-admins"
      },
      revokeActivityAdmin: {
        method: "POST",
        path: "/communities/:communityId/activity-admins/revoke"
      },
      createInviteCode: {
        method: "POST",
        path: "/communities/:communityId/invites"
      },
      listScopedMemberReviewQueue: {
        method: "GET",
        path: "/communities/:communityId/member-review-queue"
      },
      recordRosterVerification: {
        method: "POST",
        path: "/communities/:communityId/members/:childId/roster-verification"
      },
      approveCommunityMember: {
        method: "POST",
        path: "/communities/:communityId/members/:childId/approve"
      },
      reviewRiskSignal: {
        method: "POST",
        path: "/communities/risk-signals/:signalId/review"
      },
      recordRiskSignal: {
        method: "POST",
        path: "/communities/risk-signals"
      },
      applyRiskRestriction: {
        method: "POST",
        path: "/communities/risk-restrictions"
      },
      resolveRiskRestriction: {
        method: "POST",
        path: "/communities/risk-restrictions/:restrictionId/resolve"
      }
    });

    expect(
      buildStage2AdminCommandPath("recordRosterVerification", {
        communityId: "community_alpha",
        childId: "child_alpha"
      })
    ).toBe(
      "/communities/community_alpha/members/child_alpha/roster-verification"
    );
    expect(
      buildStage2AdminCommandPath("listScopedMemberReviewQueue", {
        communityId: "community_alpha"
      })
    ).toBe("/communities/community_alpha/member-review-queue");
    expect(
      buildAdminCommunityScopeChallengeTargetId(
        "community_alpha",
        "user_alpha"
      )
    ).toBe("community_alpha:user_alpha");
  });

  it("parses review results and sends Stage 2 command payloads through the typed helpers", async () => {
    expect(
      reviewCommunityRequestResultSchema.parse({
        result: "accepted",
        requestId: "ccr_alpha",
        requestStatus: "approved",
        communityId: "community_alpha"
      })
    ).toEqual({
      result: "accepted",
      requestId: "ccr_alpha",
      requestStatus: "approved",
      communityId: "community_alpha"
    });

    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        result: "accepted",
        requestId: "ccr_alpha",
        requestStatus: "approved",
        communityId: "community_alpha"
      }),
      status: 200,
      headers: new Headers(),
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://api.example.com/communities/creation-requests/ccr_alpha/approve",
      clone() {
        return this as unknown as Response;
      },
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      bytes: async () => new Uint8Array(),
      formData: async () => new FormData(),
      text: async () => ""
    }) as Response);

    await expect(
      approveCommunityRequest(
        "https://api.example.com",
        {
          requestId: "ccr_alpha",
          accessToken: "access_admin_alpha",
          defaultAuctionDurationMinutes: 1440
        },
        fetcher
      )
    ).resolves.toEqual({
      result: "accepted",
      requestId: "ccr_alpha",
      requestStatus: "approved",
      communityId: "community_alpha"
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/communities/creation-requests/ccr_alpha/approve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer access_admin_alpha"
        }),
        body: JSON.stringify({
          defaultAuctionDurationMinutes: 1440
        })
      })
    );
  });

  it("creates and verifies sensitive challenges from the admin shell helpers", async () => {
    const createFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: "accepted",
        challengeId: "challenge_alpha",
        actorUserId: "platform_admin_alpha",
        operationType: "grant_activity_admin",
        operationTargetType: "admin_community_scope_request",
        operationTargetId: "community_alpha:user_alpha",
        expiresAt: "2026-05-31T13:05:00.000Z",
        status: "pending"
      }),
      status: 200,
      headers: new Headers(),
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://api.example.com/accounts/sensitive-operation-challenges",
      clone() {
        return this as unknown as Response;
      },
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      bytes: async () => new Uint8Array(),
      formData: async () => new FormData(),
      text: async () => ""
    }) as Response);

    await expect(
      createSensitiveOperationChallenge(
        "https://api.example.com",
        {
          accessToken: "access_platform_admin",
          operationType: "grant_activity_admin",
          targetType: "admin_community_scope_request",
          targetId: "community_alpha:user_alpha"
        },
        createFetcher
      )
    ).resolves.toEqual({
      result: "accepted",
      challengeId: "challenge_alpha",
      actorUserId: "platform_admin_alpha",
      operationType: "grant_activity_admin",
      operationTargetType: "admin_community_scope_request",
      operationTargetId: "community_alpha:user_alpha",
      expiresAt: "2026-05-31T13:05:00.000Z",
      status: "pending"
    });
    expect(createFetcher).toHaveBeenCalledWith(
      "https://api.example.com/accounts/sensitive-operation-challenges",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer access_platform_admin"
        }),
        body: JSON.stringify({
          operationType: "grant_activity_admin",
          targetType: "admin_community_scope_request",
          targetId: "community_alpha:user_alpha"
        })
      })
    );

    const verifyFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: "accepted",
        challengeId: "challenge_alpha",
        actorUserId: "platform_admin_alpha",
        status: "passed",
        passedAt: "2026-05-31T13:01:00.000Z",
        expiresAt: "2026-05-31T13:05:00.000Z"
      }),
      status: 200,
      headers: new Headers(),
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "https://api.example.com/accounts/sensitive-operation-challenges/challenge_alpha/verify",
      clone() {
        return this as unknown as Response;
      },
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      bytes: async () => new Uint8Array(),
      formData: async () => new FormData(),
      text: async () => ""
    }) as Response);

    await expect(
      verifySensitiveOperationChallenge(
        "https://api.example.com",
        {
          accessToken: "access_platform_admin",
          challengeId: "challenge_alpha",
          verificationCode: "135790"
        },
        verifyFetcher
      )
    ).resolves.toEqual({
      result: "accepted",
      challengeId: "challenge_alpha",
      actorUserId: "platform_admin_alpha",
      status: "passed",
      passedAt: "2026-05-31T13:01:00.000Z",
      expiresAt: "2026-05-31T13:05:00.000Z"
    });
    expect(verifyFetcher).toHaveBeenCalledWith(
      "https://api.example.com/accounts/sensitive-operation-challenges/challenge_alpha/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          verificationCode: "135790"
        })
      })
    );
  });

  it("keeps high-risk admin views self-contained for sensitive challenge entry", () => {
    const viewSource = readFileSync("apps/admin/src/stage2-views.tsx", "utf8");

    expect(viewSource).toContain("Create Grant Challenge");
    expect(viewSource).toContain("Create Revoke Challenge");
    expect(viewSource).toContain("Create Review Challenge");
    expect(viewSource).toContain("Verify Challenge");
    expect(viewSource).toContain("createSensitiveOperationChallenge");
    expect(viewSource).toContain("verifySensitiveOperationChallenge");
  });
});
