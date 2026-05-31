import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const tokenService = new SessionTokenService("session-contract-test-signing-key");
const service = new SessionService(prisma, tokenService);
type UserSessionUpdateMany = typeof prisma.userSession.updateMany;

function createRacingPrisma(beforeUpdateMany: () => Promise<void>): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "userSession") {
        const delegate = target.userSession;

        return new Proxy(delegate, {
          get(userSessionTarget, userSessionProp, userSessionReceiver) {
            const value = Reflect.get(
              userSessionTarget,
              userSessionProp,
              userSessionReceiver
            );

            if (userSessionProp === "updateMany") {
              const updateMany = value as UserSessionUpdateMany;

              return async (...args: Parameters<UserSessionUpdateMany>) => {
                await beforeUpdateMany();
                return updateMany.apply(delegate, args);
              };
            }

            return typeof value === "function" ? value.bind(delegate) : value;
          }
        });
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PrismaClient;
}

describe("SessionService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("login creates a session and returns an access token plus one-time visible refresh token", async () => {
    const user = await prisma.user.create({
      data: {}
    });
    const now = new Date("2026-05-31T10:00:00.000Z");

    const session = await service.createSession({
      userId: user.id,
      deviceFingerprintHash: `device_${Date.now()}`,
      ipHash: `ip_${Date.now()}`,
      userAgentHash: `ua_${Date.now()}`,
      now
    });

    expect(session.result).toBe("accepted");
    if (session.result !== "accepted") {
      throw new Error("expected session creation to succeed");
    }

    const stored = await prisma.userSession.findUniqueOrThrow({
      where: {
        id: session.sessionId
      }
    });

    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.refreshToken).not.toBe(stored.refreshTokenHash);
    expect(stored.refreshTokenHash).toBe(
      tokenService.hashRefreshToken(session.refreshToken)
    );
    expect(tokenService.verifyAccessToken(session.accessToken, now)).toEqual({
      result: "accepted",
      userId: user.id,
      sessionId: session.sessionId,
      expiresAt: session.accessTokenExpiresAt
    });
  });

  it("refreshing with the same active refresh token rotates the stored refresh token hash", async () => {
    const user = await prisma.user.create({
      data: {}
    });
    const created = await service.createSession({
      userId: user.id,
      deviceFingerprintHash: `device_rotate_${Date.now()}`,
      ipHash: `ip_rotate_${Date.now()}`,
      userAgentHash: `ua_rotate_${Date.now()}`,
      now: new Date("2026-05-31T10:05:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error("expected session creation to succeed");
    }

    const beforeRefresh = await prisma.userSession.findUniqueOrThrow({
      where: {
        id: created.sessionId
      }
    });

    const refreshed = await service.refreshSession({
      refreshToken: created.refreshToken,
      now: new Date("2026-05-31T10:06:00.000Z")
    });

    expect(refreshed.result).toBe("accepted");
    if (refreshed.result !== "accepted") {
      throw new Error("expected refresh to succeed");
    }

    const afterRefresh = await prisma.userSession.findUniqueOrThrow({
      where: {
        id: created.sessionId
      }
    });

    expect(afterRefresh.refreshTokenHash).not.toBe(beforeRefresh.refreshTokenHash);
    expect(afterRefresh.refreshTokenHash).toBe(
      tokenService.hashRefreshToken(refreshed.refreshToken)
    );

    await expect(
      service.refreshSession({
        refreshToken: created.refreshToken,
        now: new Date("2026-05-31T10:06:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "REFRESH_TOKEN_INVALID"
    });
  });

  it("accepts a refresh token at most once under concurrent rotation", async () => {
    const user = await prisma.user.create({
      data: {}
    });
    const created = await service.createSession({
      userId: user.id,
      deviceFingerprintHash: `device_concurrent_${Date.now()}`,
      ipHash: `ip_concurrent_${Date.now()}`,
      userAgentHash: `ua_concurrent_${Date.now()}`,
      now: new Date("2026-05-31T10:07:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error("expected session creation to succeed");
    }

    const results = await Promise.all([
      service.refreshSession({
        refreshToken: created.refreshToken,
        now: new Date("2026-05-31T10:08:00.000Z")
      }),
      service.refreshSession({
        refreshToken: created.refreshToken,
        now: new Date("2026-05-31T10:08:00.000Z")
      })
    ]);

    expect(results.filter((result) => result.result === "accepted")).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.result === "rejected" &&
          result.errorCode === "REFRESH_TOKEN_INVALID"
      )
    ).toHaveLength(1);
  });

  it("reports the current session state when refresh rotation loses a race", async () => {
    const scenarios = [
      {
        label: "revoked",
        expectedErrorCode: "SESSION_REVOKED",
        race: async (sessionId: string) => {
          await prisma.userSession.update({
            where: { id: sessionId },
            data: {
              status: "revoked",
              revokedAt: new Date("2026-05-31T10:09:00.000Z")
            }
          });
        }
      },
      {
        label: "restricted",
        expectedErrorCode: "USER_NOT_ACTIVE",
        race: async (_sessionId: string, userId: string) => {
          await prisma.user.update({
            where: { id: userId },
            data: { status: "restricted" }
          });
        }
      },
      {
        label: "expired",
        expectedErrorCode: "SESSION_EXPIRED",
        race: async (sessionId: string) => {
          await prisma.userSession.update({
            where: { id: sessionId },
            data: {
              expiresAt: new Date("2026-05-31T10:07:59.000Z")
            }
          });
        }
      }
    ] as const;

    for (const scenario of scenarios) {
      const user = await prisma.user.create({
        data: {}
      });
      const created = await service.createSession({
        userId: user.id,
        deviceFingerprintHash: `device_${scenario.label}_${Date.now()}`,
        ipHash: `ip_${scenario.label}_${Date.now()}`,
        userAgentHash: `ua_${scenario.label}_${Date.now()}`,
        now: new Date("2026-05-31T10:07:00.000Z")
      });

      if (created.result !== "accepted") {
        throw new Error("expected session creation to succeed");
      }

      let raced = false;
      const racingService = new SessionService(
        createRacingPrisma(async () => {
          if (raced) {
            return;
          }

          raced = true;
          await scenario.race(created.sessionId, user.id);
        }),
        tokenService
      );

      await expect(
        racingService.refreshSession({
          refreshToken: created.refreshToken,
          now: new Date("2026-05-31T10:08:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: scenario.expectedErrorCode
      });
    }
  });

  it("revoked sessions cannot refresh", async () => {
    const user = await prisma.user.create({
      data: {}
    });
    const created = await service.createSession({
      userId: user.id,
      deviceFingerprintHash: `device_revoke_${Date.now()}`,
      ipHash: `ip_revoke_${Date.now()}`,
      userAgentHash: `ua_revoke_${Date.now()}`,
      now: new Date("2026-05-31T10:10:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error("expected session creation to succeed");
    }

    await service.revokeSession({
      actorUserId: user.id,
      sessionId: created.sessionId,
      reason: "contract_test",
      now: new Date("2026-05-31T10:11:00.000Z")
    });

    await expect(
      service.refreshSession({
        refreshToken: created.refreshToken,
        now: new Date("2026-05-31T10:12:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SESSION_REVOKED"
    });
  });

  it("does not let one user revoke another user's session", async () => {
    const owner = await prisma.user.create({
      data: {}
    });
    const attacker = await prisma.user.create({
      data: {}
    });
    const created = await service.createSession({
      userId: owner.id,
      deviceFingerprintHash: `device_cross_revoke_${Date.now()}`,
      ipHash: `ip_cross_revoke_${Date.now()}`,
      userAgentHash: `ua_cross_revoke_${Date.now()}`,
      now: new Date("2026-05-31T10:13:00.000Z")
    });

    if (created.result !== "accepted") {
      throw new Error("expected session creation to succeed");
    }

    await expect(
      service.revokeSession({
        actorUserId: attacker.id,
        sessionId: created.sessionId,
        reason: "cross_user_revoke_attempt",
        now: new Date("2026-05-31T10:14:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "SESSION_NOT_OWNED_BY_ACTOR"
    });

    await expect(
      prisma.userSession.findUniqueOrThrow({
        where: {
          id: created.sessionId
        },
        select: {
          status: true,
          revokedAt: true
        }
      })
    ).resolves.toEqual({
      status: "active",
      revokedAt: null
    });
  });

  it("restricted or closed users cannot refresh", async () => {
    for (const status of ["restricted", "closed"] as const) {
      const user = await prisma.user.create({
        data: {}
      });
      const created = await service.createSession({
        userId: user.id,
        deviceFingerprintHash: `device_${status}_${Date.now()}`,
        ipHash: `ip_${status}_${Date.now()}`,
        userAgentHash: `ua_${status}_${Date.now()}`,
        now: new Date("2026-05-31T10:20:00.000Z")
      });

      if (created.result !== "accepted") {
        throw new Error("expected session creation to succeed");
      }

      await prisma.user.update({
        where: {
          id: user.id
        },
        data: {
          status
        }
      });

      await expect(
        service.refreshSession({
          refreshToken: created.refreshToken,
          now: new Date("2026-05-31T10:21:00.000Z")
        })
      ).resolves.toEqual({
        result: "rejected",
        errorCode: "USER_NOT_ACTIVE"
      });
    }
  });

  it("access token verification rejects expired or tampered tokens", () => {
    const accessToken = tokenService.createAccessToken({
      userId: "user_expired",
      sessionId: "session_expired",
      expiresAt: new Date("2026-05-31T10:30:00.000Z")
    });

    expect(
      tokenService.verifyAccessToken(
        accessToken,
        new Date("2026-05-31T10:31:00.000Z")
      )
    ).toEqual({
      result: "rejected",
      errorCode: "ACCESS_TOKEN_EXPIRED"
    });
    expect(tokenService.verifyAccessToken(`${accessToken}x`)).toEqual({
      result: "rejected",
      errorCode: "ACCESS_TOKEN_INVALID"
    });
  });
});
