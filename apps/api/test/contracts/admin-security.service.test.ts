import { describe, expect, it } from "vitest";
import {
  AdminSecurityService,
  HighRiskAdminOperation
} from "../../src/admin-security/admin-security.service.js";

describe("AdminSecurityService", () => {
  it("rejects high-risk operations when MFA is not enabled", () => {
    const service = new AdminSecurityService();

    expect(
      service.authorizeHighRiskOperation({
        actorUserId: "admin_1",
        operation: HighRiskAdminOperation.adjustPoints,
        mfaEnabled: false,
        challengeVerifiedAt: new Date("2026-05-27T16:20:00.000Z"),
        now: new Date("2026-05-27T16:21:00.000Z")
      })
    ).toEqual({
      result: "rejected",
      errorCode: "MFA_REQUIRED",
      challengeRequired: true
    });
  });

  it("rejects high-risk operations when challenge is expired", () => {
    const service = new AdminSecurityService();

    expect(
      service.authorizeHighRiskOperation({
        actorUserId: "admin_1",
        operation: HighRiskAdminOperation.pauseCommunity,
        mfaEnabled: true,
        challengeVerifiedAt: new Date("2026-05-27T16:00:00.000Z"),
        now: new Date("2026-05-27T16:10:01.000Z"),
        challengeTtlSeconds: 300
      })
    ).toEqual({
      result: "rejected",
      errorCode: "SENSITIVE_CHALLENGE_REQUIRED",
      challengeRequired: true
    });
  });

  it("accepts high-risk operations only with MFA and a fresh challenge", () => {
    const service = new AdminSecurityService();

    expect(
      service.authorizeHighRiskOperation({
        actorUserId: "admin_1",
        operation: HighRiskAdminOperation.exportChildData,
        mfaEnabled: true,
        challengeVerifiedAt: new Date("2026-05-27T16:20:00.000Z"),
        now: new Date("2026-05-27T16:21:00.000Z")
      })
    ).toEqual({
      result: "accepted",
      actorUserId: "admin_1",
      operation: HighRiskAdminOperation.exportChildData,
      challengeRequired: false
    });
  });
});
