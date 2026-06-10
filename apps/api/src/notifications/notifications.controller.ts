import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query
} from "@nestjs/common";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { NotificationsService } from "./notifications.service.js";

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly sessions: SessionService,
    private readonly sessionTokens: SessionTokenService
  ) {}

  async listNotifications(
    query: {
      recipientChildId?: string;
      unreadOnly?: string | boolean;
      cursor?: string;
      limit?: string | number;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.listNotifications({
      actorUserId: actor.userId,
      recipientChildId: nonEmptyString(query.recipientChildId),
      unreadOnly: coerceBoolean(query.unreadOnly),
      cursor: nonEmptyString(query.cursor),
      limit: coerceLimit(query.limit)
    });

    return acceptedResponse(
      {
        now,
        targetType: "notifications",
        targetId: actor.userId,
        latestStatus: "active"
      },
      {
        notifications: result.notifications,
        nextCursor: result.nextCursor
      }
    );
  }

  async getUnreadCount(
    query: {
      recipientChildId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.countUnread({
      actorUserId: actor.userId,
      recipientChildId: nonEmptyString(query.recipientChildId)
    });

    return acceptedResponse(
      {
        now,
        targetType: "notifications_unread_count",
        targetId: actor.userId,
        latestStatus: "active"
      },
      {
        unreadCount: result.unreadCount
      }
    );
  }

  async markRead(notificationId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.markRead({
      actorUserId: actor.userId,
      notificationId,
      now
    });

    if (result.result === "rejected") {
      return rejectedResponse(
        {
          now,
          targetType: "notification",
          targetId: notificationId,
          latestStatus: "rejected"
        },
        result.errorCode
      );
    }

    return acceptedResponse(
      {
        now,
        targetType: "notification",
        targetId: notificationId,
        latestStatus: "read"
      },
      {
        notificationId: result.notificationId,
        readAt: result.readAt
      }
    );
  }

  async markAllRead(
    body: {
      recipientChildId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.markAllRead({
      actorUserId: actor.userId,
      recipientChildId: nonEmptyString(body.recipientChildId),
      now
    });

    return acceptedResponse(
      {
        now,
        targetType: "notifications",
        targetId: actor.userId,
        latestStatus: "read"
      },
      {
        readCount: result.readCount,
        readAt: result.readAt
      }
    );
  }

  async listPreferences(
    query: {
      recipientChildId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.listPreferences({
      actorUserId: actor.userId,
      childId: nonEmptyString(query.recipientChildId)
    });
    const meta = {
      now,
      targetType: "notification_preferences",
      targetId: actor.userId,
      latestStatus: "active"
    };

    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      preferences: result.preferences
    });
  }

  async updatePreference(
    eventType: string,
    body: {
      recipientChildId?: string;
      inAppEnabled?: boolean;
      wechatSubscribeEnabled?: boolean;
      childVisible?: boolean;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.notifications.updatePreference({
      actorUserId: actor.userId,
      eventType,
      childId: nonEmptyString(body.recipientChildId),
      inAppEnabled: coerceOptionalBoolean(body.inAppEnabled),
      wechatSubscribeEnabled: coerceOptionalBoolean(
        body.wechatSubscribeEnabled
      ),
      childVisible: coerceOptionalBoolean(body.childVisible),
      now
    });
    const meta = {
      now,
      targetType: "notification_preference",
      targetId: eventType,
      latestStatus: "active"
    };

    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      preference: result.preference
    });
  }

  private authenticate(
    authorization: string | undefined,
    now: Date
  ): Promise<AuthenticatedActor> {
    return authenticateBearerSession(
      {
        authorization,
        now
      },
      this.sessionTokens,
      this.sessions
    );
  }
}

defineConstructorParamTypes(NotificationsController, [
  NotificationsService,
  SessionService,
  SessionTokenService
]);
Controller("notifications")(NotificationsController);
applyMethodDecorator(Get(), NotificationsController.prototype, "listNotifications");
applyMethodDecorator(
  Get("unread-count"),
  NotificationsController.prototype,
  "getUnreadCount"
);
applyMethodDecorator(
  Post(":notificationId/read"),
  NotificationsController.prototype,
  "markRead"
);
applyMethodDecorator(
  Post("read-all"),
  NotificationsController.prototype,
  "markAllRead"
);
applyMethodDecorator(
  Get("preferences"),
  NotificationsController.prototype,
  "listPreferences"
);
applyMethodDecorator(
  Put("preferences/:eventType"),
  NotificationsController.prototype,
  "updatePreference"
);
applyParameterDecorator(Query(), NotificationsController.prototype, "listNotifications", 0);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "listNotifications",
  1
);
applyParameterDecorator(
  Query(),
  NotificationsController.prototype,
  "getUnreadCount",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "getUnreadCount",
  1
);
applyParameterDecorator(
  Param("notificationId"),
  NotificationsController.prototype,
  "markRead",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "markRead",
  1
);
applyParameterDecorator(Body(), NotificationsController.prototype, "markAllRead", 0);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "markAllRead",
  1
);
applyParameterDecorator(
  Query(),
  NotificationsController.prototype,
  "listPreferences",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "listPreferences",
  1
);
applyParameterDecorator(
  Param("eventType"),
  NotificationsController.prototype,
  "updatePreference",
  0
);
applyParameterDecorator(
  Body(),
  NotificationsController.prototype,
  "updatePreference",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  NotificationsController.prototype,
  "updatePreference",
  2
);

function acceptedResponse<T extends Record<string, unknown>>(
  meta: WriteResponseMeta,
  payload: T
) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: "accepted",
    refreshRequired: false,
    ...payload
  };
}

function rejectedResponse(meta: WriteResponseMeta, errorCode: string) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: "rejected",
    refreshRequired: false,
    errorCode
  };
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function coerceBoolean(value: unknown) {
  return value === true || value === "true";
}

function coerceOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  return value === true || value === "true";
}

function coerceLimit(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function applyParameterDecorator(
  decorator: ParameterDecorator,
  target: object,
  propertyKey: string,
  parameterIndex: number
) {
  decorator(target, propertyKey, parameterIndex);
}

function applyMethodDecorator(
  decorator: MethodDecorator,
  target: object,
  propertyKey: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) {
    throw new Error(`Missing method descriptor for ${propertyKey}`);
  }

  decorator(target, propertyKey, descriptor);
}

function defineConstructorParamTypes(target: object, paramTypes: unknown[]) {
  Reflect.defineMetadata("design:paramtypes", paramTypes, target);
}
