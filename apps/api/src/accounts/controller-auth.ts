import { UnauthorizedException } from "@nestjs/common";
import type { SessionService } from "./session.service.js";
import type { SessionTokenService } from "./session-token.service.js";

export type AuthenticatedActor = {
  userId: string;
  sessionId: string;
};

export async function authenticateBearerSession(
  input: {
    authorization?: string;
    now: Date;
  },
  tokens: SessionTokenService,
  sessions: SessionService
): Promise<AuthenticatedActor> {
  const token = extractBearerToken(input.authorization);
  if (!token) {
    throw new UnauthorizedException("ACCESS_TOKEN_REQUIRED");
  }

  const verified = tokens.verifyAccessToken(token, input.now);
  if (verified.result === "rejected") {
    throw new UnauthorizedException(verified.errorCode);
  }

  const activeSession = await sessions.assertActiveSession({
    userId: verified.userId,
    sessionId: verified.sessionId,
    now: input.now
  });
  if (activeSession.result === "rejected") {
    throw new UnauthorizedException(activeSession.errorCode);
  }

  return {
    userId: verified.userId,
    sessionId: verified.sessionId
  };
}

function extractBearerToken(authorization?: string): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra !== undefined) {
    return null;
  }

  return token;
}
