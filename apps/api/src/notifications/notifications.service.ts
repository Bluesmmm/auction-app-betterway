import type {
  Notification,
  NotificationPreference,
  PrismaClient
} from "@prisma/client";

export type NotificationSummary = {
  id: string;
  type: string;
  priority: string;
  mandatory: boolean;
  title: string;
  body: string;
  relatedType: string;
  relatedId: string;
  targetVersion: number | null;
  actionType: string | null;
  deliveryStatus: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreferenceSummary = {
  id: string;
  userId: string;
  childId: string | null;
  eventType: string;
  inAppEnabled: boolean;
  wechatSubscribeEnabled: boolean;
  childVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListNotificationsResult = {
  result: "accepted";
  notifications: NotificationSummary[];
  nextCursor: string | null;
};

export type UnreadCountResult = {
  result: "accepted";
  unreadCount: number;
};

export type MarkNotificationReadResult =
  | {
      result: "accepted";
      notificationId: string;
      readAt: string;
    }
  | {
      result: "rejected";
      errorCode: "NOTIFICATION_NOT_FOUND";
    };

export type MarkAllNotificationsReadResult = {
  result: "accepted";
  readCount: number;
  readAt: string;
};

export type ListNotificationPreferencesResult =
  | {
      result: "accepted";
      preferences: NotificationPreferenceSummary[];
    }
  | {
      result: "rejected";
      errorCode: "NOTIFICATION_CHILD_SCOPE_FORBIDDEN";
    };

export type UpdateNotificationPreferenceResult =
  | {
      result: "accepted";
      preference: NotificationPreferenceSummary;
    }
  | {
      result: "rejected";
      errorCode: "NOTIFICATION_CHILD_SCOPE_FORBIDDEN";
    };

export class NotificationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async listNotifications(input: {
    actorUserId: string;
    recipientChildId?: string;
    unreadOnly?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<ListNotificationsResult> {
    const limit = clampLimit(input.limit);
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientUserId: input.actorUserId,
        ...(input.recipientChildId
          ? { recipientChildId: input.recipientChildId }
          : {}),
        ...(input.unreadOnly ? { readAt: null } : {})
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor
        ? {
            cursor: {
              id: input.cursor
            },
            skip: 1
          }
        : {})
    });

    const page = notifications.slice(0, limit);
    return {
      result: "accepted",
      notifications: page.map(toSummary),
      nextCursor: notifications.length > limit ? page.at(-1)?.id ?? null : null
    };
  }

  async countUnread(input: {
    actorUserId: string;
    recipientChildId?: string;
  }): Promise<UnreadCountResult> {
    const unreadCount = await this.prisma.notification.count({
      where: {
        recipientUserId: input.actorUserId,
        readAt: null,
        ...(input.recipientChildId
          ? { recipientChildId: input.recipientChildId }
          : {})
      }
    });

    return {
      result: "accepted",
      unreadCount
    };
  }

  async markRead(input: {
    actorUserId: string;
    notificationId: string;
    now: Date;
  }): Promise<MarkNotificationReadResult> {
    const updated = await this.prisma.notification.updateMany({
      where: {
        id: input.notificationId,
        recipientUserId: input.actorUserId
      },
      data: {
        readAt: input.now
      }
    });

    if (updated.count === 0) {
      return {
        result: "rejected",
        errorCode: "NOTIFICATION_NOT_FOUND"
      };
    }

    return {
      result: "accepted",
      notificationId: input.notificationId,
      readAt: input.now.toISOString()
    };
  }

  async markAllRead(input: {
    actorUserId: string;
    recipientChildId?: string;
    now: Date;
  }): Promise<MarkAllNotificationsReadResult> {
    const updated = await this.prisma.notification.updateMany({
      where: {
        recipientUserId: input.actorUserId,
        readAt: null,
        ...(input.recipientChildId
          ? { recipientChildId: input.recipientChildId }
          : {})
      },
      data: {
        readAt: input.now
      }
    });

    return {
      result: "accepted",
      readCount: updated.count,
      readAt: input.now.toISOString()
    };
  }

  async listPreferences(input: {
    actorUserId: string;
    childId?: string;
  }): Promise<ListNotificationPreferencesResult> {
    if (
      input.childId &&
      !(await this.canScopeChild(input.actorUserId, input.childId))
    ) {
      return {
        result: "rejected",
        errorCode: "NOTIFICATION_CHILD_SCOPE_FORBIDDEN"
      };
    }

    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        userId: input.actorUserId,
        ...(input.childId ? { childId: input.childId } : {})
      },
      orderBy: [{ eventType: "asc" }, { childId: "asc" }]
    });

    return {
      result: "accepted",
      preferences: preferences.map(toPreferenceSummary)
    };
  }

  async updatePreference(input: {
    actorUserId: string;
    eventType: string;
    childId?: string;
    inAppEnabled?: boolean;
    wechatSubscribeEnabled?: boolean;
    childVisible?: boolean;
    now: Date;
  }): Promise<UpdateNotificationPreferenceResult> {
    if (
      input.childId &&
      !(await this.canScopeChild(input.actorUserId, input.childId))
    ) {
      return {
        result: "rejected",
        errorCode: "NOTIFICATION_CHILD_SCOPE_FORBIDDEN"
      };
    }

    const existing = await this.prisma.notificationPreference.findFirst({
      where: {
        userId: input.actorUserId,
        childId: input.childId ?? null,
        eventType: input.eventType
      }
    });
    const data = {
      ...(input.inAppEnabled !== undefined
        ? { inAppEnabled: input.inAppEnabled }
        : {}),
      ...(input.wechatSubscribeEnabled !== undefined
        ? { wechatSubscribeEnabled: input.wechatSubscribeEnabled }
        : {}),
      ...(input.childVisible !== undefined
        ? { childVisible: input.childVisible }
        : {})
    };
    const preference = existing
      ? await this.prisma.notificationPreference.update({
          where: {
            id: existing.id
          },
          data
        })
      : await this.prisma.notificationPreference.create({
          data: {
            userId: input.actorUserId,
            childId: input.childId ?? null,
            eventType: input.eventType,
            ...data
          }
        });

    return {
      result: "accepted",
      preference: toPreferenceSummary(preference)
    };
  }

  private async canScopeChild(actorUserId: string, childId: string) {
    const [childUser, guardianLink] = await Promise.all([
      this.prisma.childProfile.findFirst({
        where: {
          id: childId,
          userId: actorUserId,
          status: "active"
        },
        select: {
          id: true
        }
      }),
      this.prisma.guardianChildLink.findFirst({
        where: {
          childId,
          status: "active",
          guardian: {
            status: "active",
            userId: actorUserId
          },
          child: {
            status: "active"
          }
        },
        select: {
          id: true
        }
      })
    ]);

    return Boolean(childUser || guardianLink);
  }
}

function clampLimit(limit?: number) {
  if (!Number.isFinite(limit)) {
    return 20;
  }

  return Math.min(50, Math.max(1, Math.trunc(limit ?? 20)));
}

function toSummary(notification: Notification): NotificationSummary {
  return {
    id: notification.id,
    type: notification.type,
    priority: notification.priority,
    mandatory: notification.mandatory,
    title: notification.title,
    body: notification.body,
    relatedType: notification.relatedType,
    relatedId: notification.relatedId,
    targetVersion: notification.targetVersion,
    actionType: notification.actionType,
    deliveryStatus: notification.deliveryStatus,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString()
  };
}

function toPreferenceSummary(
  preference: NotificationPreference
): NotificationPreferenceSummary {
  return {
    id: preference.id,
    userId: preference.userId,
    childId: preference.childId,
    eventType: preference.eventType,
    inAppEnabled: preference.inAppEnabled,
    wechatSubscribeEnabled: preference.wechatSubscribeEnabled,
    childVisible: preference.childVisible,
    createdAt: preference.createdAt.toISOString(),
    updatedAt: preference.updatedAt.toISOString()
  };
}
