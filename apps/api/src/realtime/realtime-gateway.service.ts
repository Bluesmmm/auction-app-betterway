import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Redis } from "ioredis";
import { WebSocketServer } from "ws";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import type { SessionService } from "../accounts/session.service.js";
import type { SessionTokenService } from "../accounts/session-token.service.js";
import type { AppConfigService } from "../config/app-config.service.js";
import type { RealtimePermissionService } from "./realtime-permission.service.js";
import {
  eventMatchesRoom,
  isNewerRealtimeHint,
  parseRealtimeClientMessage,
  parseRealtimeHintEvent,
  realtimeRoomId,
  STAGE7_REALTIME_CHANNEL,
  type RealtimeHintEvent,
  type RealtimeRoomKey,
  type RealtimeServerFrame
} from "./realtime-types.js";

type RealtimeSocket = {
  readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on?(event: "message", listener: (data: unknown) => void): void;
  on?(event: "close", listener: () => void): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
};

type RealtimeSubscription = {
  room: RealtimeRoomKey;
  knownTargetVersion?: number;
};

type RealtimeConnection = {
  id: string;
  actorUserId: string;
  socket: RealtimeSocket;
  subscriptions: Map<string, RealtimeSubscription>;
  sentEventIds: Set<string>;
};

const WEBSOCKET_OPEN = 1;
const REALTIME_PATH = "/stage7/realtime";
const UNAUTHORIZED_CLOSE_CODE = 4401;
const INVALID_MESSAGE_CLOSE_CODE = 4400;

export class RealtimeGatewayService {
  private webSocketServer: WebSocketServer | null = null;
  private subscriber: Redis | null = null;
  private readonly connections = new Set<RealtimeConnection>();
  private connectionSequence = 0;

  constructor(
    private readonly permissions: RealtimePermissionService,
    private readonly sessionTokens: SessionTokenService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService
  ) {}

  async start(httpServer: Server) {
    if (this.webSocketServer) {
      return;
    }

    this.webSocketServer = new WebSocketServer({
      noServer: true
    });
    this.webSocketServer.on("connection", (socket, request) => {
      const actor = (request as IncomingMessage & {
        authenticatedActor?: AuthenticatedActor;
      }).authenticatedActor;
      if (!actor) {
        socket.close(UNAUTHORIZED_CLOSE_CODE, "UNAUTHORIZED");
        return;
      }
      this.registerConnection(actor.userId, socket);
    });

    httpServer.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });

    this.subscriber = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null
    });
    this.subscriber.on("message", (_channel, payload) => {
      const event = parseRealtimeHintEvent(safeJsonParse(payload));
      if (event) {
        void this.publishHint(event);
      }
    });
    await this.subscriber.subscribe(STAGE7_REALTIME_CHANNEL);
  }

  async stop() {
    for (const connection of this.connections) {
      connection.socket.close(1001, "REALTIME_GATEWAY_STOPPED");
    }
    this.connections.clear();
    this.webSocketServer?.close();
    this.webSocketServer = null;
    await this.subscriber?.quit();
    this.subscriber = null;
  }

  registerConnection(actorUserId: string, socket: RealtimeSocket) {
    const connection: RealtimeConnection = {
      id: `stage7_realtime_${++this.connectionSequence}`,
      actorUserId,
      socket,
      subscriptions: new Map(),
      sentEventIds: new Set()
    };
    this.connections.add(connection);
    socket.on?.("message", (data) => {
      void this.handleSocketMessage(connection, data);
    });
    socket.on?.("close", () => {
      this.connections.delete(connection);
    });
    return connection.id;
  }

  async handleSubscribe(
    connectionId: string,
    message: {
      requestId?: string;
      room: RealtimeRoomKey;
      knownTargetVersion?: number;
    }
  ) {
    const connection = this.findConnection(connectionId);
    if (!connection) {
      return;
    }

    const authorization = await this.permissions.authorizeRoom({
      actorUserId: connection.actorUserId,
      room: message.room,
      now: new Date()
    });
    if (authorization.result === "rejected") {
      this.sendFrame(connection, {
        type: "rejected",
        requestId: message.requestId,
        errorCode: authorization.errorCode,
        refreshRequired: true
      });
      return;
    }

    const roomId = realtimeRoomId(message.room);
    connection.subscriptions.set(roomId, {
      room: message.room,
      knownTargetVersion: message.knownTargetVersion
    });
    this.sendFrame(connection, {
      type: "subscribed",
      requestId: message.requestId,
      roomId,
      refreshRequired: true
    });
  }

  async publishHint(event: RealtimeHintEvent) {
    for (const connection of [...this.connections]) {
      await this.publishHintToConnection(connection, event);
    }
  }

  async pruneUnauthorizedSubscriptions() {
    for (const connection of [...this.connections]) {
      await this.pruneConnectionSubscriptions(connection);
    }
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) {
    if (!this.webSocketServer || request.url?.split("?")[0] !== REALTIME_PATH) {
      return;
    }

    const actor = await this.authenticateUpgradeRequest(request);
    if (!actor) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    (request as IncomingMessage & { authenticatedActor?: AuthenticatedActor })
      .authenticatedActor = actor;

    this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
      this.webSocketServer?.emit("connection", client, request);
    });
  }

  private async authenticateUpgradeRequest(request: IncomingMessage) {
    const now = new Date();
    const authorization =
      request.headers.authorization ?? authorizationFromQuery(request.url);
    try {
      return await authenticateBearerSession(
        {
          authorization,
          now
        },
        this.sessionTokens,
        this.sessions
      );
    } catch {
      return null;
    }
  }

  private async handleSocketMessage(
    connection: RealtimeConnection,
    raw: unknown
  ) {
    const data = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const message = parseRealtimeClientMessage(safeJsonParse(data));
    if (!message) {
      connection.socket.close(INVALID_MESSAGE_CLOSE_CODE, "INVALID_MESSAGE");
      return;
    }

    await this.handleSubscribe(connection.id, {
      requestId: message.requestId,
      room: message.room,
      knownTargetVersion: message.knownTargetVersion
    });
  }

  private async publishHintToConnection(
    connection: RealtimeConnection,
    event: RealtimeHintEvent
  ) {
    if (connection.sentEventIds.has(event.eventId)) {
      return;
    }

    let shouldSend = false;
    for (const [roomId, subscription] of [...connection.subscriptions]) {
      if (!eventMatchesRoom(event, subscription.room)) {
        continue;
      }
      const authorization = await this.permissions.authorizeRoom({
        actorUserId: connection.actorUserId,
        room: subscription.room,
        now: new Date()
      });
      if (authorization.result === "rejected") {
        connection.subscriptions.delete(roomId);
        this.sendFrame(connection, {
          type: "subscription_revoked",
          roomId,
          reason: "PERMISSION_REVOKED",
          refreshRequired: true
        });
        continue;
      }
      if (isNewerRealtimeHint(event, subscription.knownTargetVersion)) {
        shouldSend = true;
        subscription.knownTargetVersion = event.targetVersion;
      }
    }

    if (shouldSend) {
      connection.sentEventIds.add(event.eventId);
      this.sendFrame(connection, {
        type: "hint",
        event,
        refreshRequired: true
      });
    }
  }

  private async pruneConnectionSubscriptions(connection: RealtimeConnection) {
    for (const [roomId, subscription] of [...connection.subscriptions]) {
      const authorization = await this.permissions.authorizeRoom({
        actorUserId: connection.actorUserId,
        room: subscription.room,
        now: new Date()
      });
      if (authorization.result === "rejected") {
        connection.subscriptions.delete(roomId);
        this.sendFrame(connection, {
          type: "subscription_revoked",
          roomId,
          reason: "PERMISSION_REVOKED",
          refreshRequired: true
        });
      }
    }
  }

  private sendFrame(
    connection: RealtimeConnection,
    frame: RealtimeServerFrame
  ) {
    if (
      typeof connection.socket.readyState === "number" &&
      connection.socket.readyState !== WEBSOCKET_OPEN
    ) {
      return;
    }
    connection.socket.send(JSON.stringify(frame));
  }

  private findConnection(connectionId: string) {
    for (const connection of this.connections) {
      if (connection.id === connectionId) {
        return connection;
      }
    }
    return null;
  }
}

function authorizationFromQuery(rawUrl?: string) {
  if (!rawUrl) {
    return undefined;
  }
  const url = new URL(rawUrl, "http://localhost");
  const accessToken = url.searchParams.get("accessToken");
  return accessToken ? `Bearer ${accessToken}` : undefined;
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}
