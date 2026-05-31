import type { PrismaClient, SessionStatus, UserStatus } from "@prisma/client";
import { SessionTokenService } from "./session-token.service.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CreateSessionInput = {
  userId: string;
  deviceFingerprintHash: string;
  ipHash: string;
  userAgentHash: string;
  now?: Date;
};

export type SessionGrant =
  | {
      result: "accepted";
      userId: string;
      sessionId: string;
      accessToken: string;
      accessTokenExpiresAt: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    }
  | {
      result: "rejected";
      errorCode: "USER_NOT_ACTIVE";
    };

export type RefreshSessionInput = {
  refreshToken: string;
  now?: Date;
};

export type RefreshSessionResult =
  | {
      result: "accepted";
      userId: string;
      sessionId: string;
      accessToken: string;
      accessTokenExpiresAt: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "REFRESH_TOKEN_INVALID"
        | "SESSION_REVOKED"
        | "SESSION_EXPIRED"
        | "USER_NOT_ACTIVE";
    };

export type RevokeSessionInput = {
  actorUserId: string;
  sessionId: string;
  reason: string;
  now?: Date;
};

export type RevokeSessionResult =
  | {
      result: "accepted";
      sessionId: string;
      status: SessionStatus;
      revokedAt: string | null;
    }
  | {
      result: "rejected";
      errorCode: "SESSION_NOT_OWNED_BY_ACTOR";
    };

export type RevokeUserSessionsInput = {
  actorUserId: string;
  targetUserId: string;
  reason: string;
  now?: Date;
};

export type RevokeUserSessionsResult = {
  result: "accepted";
  targetUserId: string;
  revokedSessionCount: number;
};

export type AssertActiveSessionInput = {
  userId: string;
  sessionId: string;
  now?: Date;
};

export type AssertActiveSessionResult =
  | {
      result: "accepted";
      sessionId: string;
      userId: string;
      expiresAt: string;
      lastSeenAt: string | null;
    }
  | {
      result: "rejected";
      errorCode: "SESSION_REVOKED" | "SESSION_EXPIRED" | "USER_NOT_ACTIVE";
    };

export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: SessionTokenService
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionGrant> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: input.userId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!user || user.status !== "active") {
      return {
        result: "rejected",
        errorCode: "USER_NOT_ACTIVE"
      };
    }

    const now = input.now ?? new Date();
    const refreshToken = this.tokens.createRefreshToken();
    const refreshTokenExpiresAt = new Date(now.getTime() + REFRESH_SESSION_TTL_MS);
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const session = await this.prisma.userSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        deviceFingerprintHash: input.deviceFingerprintHash,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        expiresAt: refreshTokenExpiresAt,
        lastSeenAt: now
      }
    });
    await this.prisma.trustedDevice.upsert({
      where: {
        userId_deviceFingerprintHash: {
          userId: input.userId,
          deviceFingerprintHash: input.deviceFingerprintHash
        }
      },
      update: {
        lastSeenAt: now
      },
      create: {
        userId: input.userId,
        deviceFingerprintHash: input.deviceFingerprintHash,
        trustLevel: "normal",
        lastSeenAt: now
      }
    });

    return {
      result: "accepted",
      userId: input.userId,
      sessionId: session.id,
      accessToken: this.tokens.createAccessToken({
        userId: input.userId,
        sessionId: session.id,
        expiresAt: accessTokenExpiresAt
      }),
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString()
    };
  }

  async refreshSession(
    input: RefreshSessionInput
  ): Promise<RefreshSessionResult> {
    const now = input.now ?? new Date();
    const currentRefreshTokenHash = this.tokens.hashRefreshToken(
      input.refreshToken
    );
    const session = await this.prisma.userSession.findUnique({
      where: {
        refreshTokenHash: currentRefreshTokenHash
      },
      include: {
        user: {
          select: {
            status: true
          }
        }
      }
    });

    if (!session) {
      return {
        result: "rejected",
        errorCode: "REFRESH_TOKEN_INVALID"
      };
    }

    const sessionState = await this.ensureRefreshableSession({
      sessionId: session.id,
      sessionStatus: session.status,
      sessionExpiresAt: session.expiresAt,
      userStatus: session.user.status,
      now
    });
    if (sessionState.result === "rejected") {
      return sessionState;
    }

    const refreshToken = this.tokens.createRefreshToken();
    const refreshTokenExpiresAt = new Date(now.getTime() + REFRESH_SESSION_TTL_MS);
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const rotated = await this.prisma.userSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: currentRefreshTokenHash,
        status: "active",
        expiresAt: {
          gt: now
        },
        user: {
          status: "active"
        }
      },
      data: {
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        lastSeenAt: now,
        status: "active",
        revokedAt: null
      }
    });

    if (rotated.count !== 1) {
      const currentSession = await this.prisma.userSession.findUnique({
        where: {
          id: session.id
        },
        include: {
          user: {
            select: {
              status: true
            }
          }
        }
      });

      if (currentSession) {
        const currentState = await this.ensureRefreshableSession({
          sessionId: currentSession.id,
          sessionStatus: currentSession.status,
          sessionExpiresAt: currentSession.expiresAt,
          userStatus: currentSession.user.status,
          now
        });

        if (currentState.result === "rejected") {
          return currentState;
        }
      }

      return {
        result: "rejected",
        errorCode: "REFRESH_TOKEN_INVALID"
      };
    }

    const updatedSession = await this.prisma.userSession.findUniqueOrThrow({
      where: {
        id: session.id
      }
    });

    return {
      result: "accepted",
      userId: updatedSession.userId,
      sessionId: updatedSession.id,
      accessToken: this.tokens.createAccessToken({
        userId: updatedSession.userId,
        sessionId: updatedSession.id,
        expiresAt: accessTokenExpiresAt
      }),
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString()
    };
  }

  async revokeSession(input: RevokeSessionInput): Promise<RevokeSessionResult> {
    const now = input.now ?? new Date();
    const existing = await this.prisma.userSession.findUnique({
      where: {
        id: input.sessionId
      }
    });

    if (!existing) {
      return {
        result: "accepted",
        sessionId: input.sessionId,
        status: "revoked",
        revokedAt: now.toISOString()
      };
    }

    if (existing.userId !== input.actorUserId) {
      return {
        result: "rejected",
        errorCode: "SESSION_NOT_OWNED_BY_ACTOR"
      };
    }

    const updated =
      existing.status === "active" && existing.expiresAt.getTime() > now.getTime()
        ? await this.prisma.userSession.update({
            where: {
              id: input.sessionId
            },
            data: {
              status: "revoked",
              revokedAt: now
            }
          })
        : existing;

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "user_session.revoke",
        targetType: "user_session",
        targetId: input.sessionId,
        reason: input.reason,
        beforeJson: {
          previousStatus: existing.status
        },
        afterJson: {
          status: updated.status,
          revokedAt: updated.revokedAt?.toISOString() ?? now.toISOString()
        }
      }
    });

    return {
      result: "accepted",
      sessionId: updated.id,
      status: updated.status,
      revokedAt: updated.revokedAt?.toISOString() ?? null
    };
  }

  async revokeUserSessions(
    input: RevokeUserSessionsInput
  ): Promise<RevokeUserSessionsResult> {
    const now = input.now ?? new Date();
    const revoked = await this.prisma.userSession.updateMany({
      where: {
        userId: input.targetUserId,
        status: "active"
      },
      data: {
        status: "revoked",
        revokedAt: now
      }
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "user_session.revoke_all",
        targetType: "user",
        targetId: input.targetUserId,
        reason: input.reason,
        afterJson: {
          revokedSessionCount: revoked.count
        }
      }
    });

    return {
      result: "accepted",
      targetUserId: input.targetUserId,
      revokedSessionCount: revoked.count
    };
  }

  async assertActiveSession(
    input: AssertActiveSessionInput
  ): Promise<AssertActiveSessionResult> {
    const now = input.now ?? new Date();
    const session = await this.prisma.userSession.findUnique({
      where: {
        id: input.sessionId
      },
      include: {
        user: {
          select: {
            status: true
          }
        }
      }
    });

    if (!session || session.userId !== input.userId) {
      return {
        result: "rejected",
        errorCode: "SESSION_REVOKED"
      };
    }

    const state = await this.ensureRefreshableSession({
      sessionId: session.id,
      sessionStatus: session.status,
      sessionExpiresAt: session.expiresAt,
      userStatus: session.user.status,
      now
    });
    if (state.result === "rejected") {
      return state;
    }

    if (
      !session.lastSeenAt ||
      now.getTime() > session.lastSeenAt.getTime()
    ) {
      await this.prisma.userSession.update({
        where: {
          id: session.id
        },
        data: {
          lastSeenAt: now
        }
      });
    }

    return {
      result: "accepted",
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: now.toISOString()
    };
  }

  private async ensureRefreshableSession(input: {
    sessionId: string;
    sessionStatus: SessionStatus;
    sessionExpiresAt: Date;
    userStatus: UserStatus;
    now: Date;
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode: "SESSION_REVOKED" | "SESSION_EXPIRED" | "USER_NOT_ACTIVE";
      }
  > {
    if (input.userStatus !== "active") {
      return {
        result: "rejected",
        errorCode: "USER_NOT_ACTIVE"
      };
    }

    if (input.sessionStatus === "revoked") {
      return {
        result: "rejected",
        errorCode: "SESSION_REVOKED"
      };
    }

    if (
      input.sessionStatus === "expired" ||
      input.sessionExpiresAt.getTime() <= input.now.getTime()
    ) {
      if (input.sessionStatus !== "expired") {
        await this.prisma.userSession.updateMany({
          where: {
            id: input.sessionId,
            status: {
              not: "revoked"
            },
            expiresAt: {
              lte: input.now
            }
          },
          data: {
            status: "expired"
          }
        });
      }

      return {
        result: "rejected",
        errorCode: "SESSION_EXPIRED"
      };
    }

    return {
      result: "accepted"
    };
  }
}
