import type {
  NotificationActionType,
  NotificationDeliveryStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type { NotificationSender } from "./outbox-processor.js";

type SubscriptionMessageSender = {
  send(input: {
    recipientUserId: string;
    templateKey: string;
    payload: Record<string, unknown>;
  }): Promise<
    | { ok: true; providerMessageId: string; mutatesBusinessState: false }
    | { ok: false; errorCode: string; mutatesBusinessState: false }
  >;
};

type NotificationDraft = {
  recipientUserId: string;
  recipientChildId: string | null;
  type: NotificationType;
  priority: NotificationPriority;
  mandatory: boolean;
  title: string;
  body: string;
  relatedType: string;
  relatedId: string;
  targetVersion: number | null;
  actionType: NotificationActionType | null;
  deliveryStatus: NotificationDeliveryStatus;
};

type AuctionContext = {
  auctionSessionId: string;
  itemId: string;
  communityId: string;
  sellerChildId: string;
  version: number;
};

type TransactionContext = {
  transactionId: string;
  auctionSessionId: string;
  communityId: string;
  buyerChildId: string;
  sellerChildId: string;
  version: number;
};

const supportedEventTypes = new Set([
  "auction.bid_accepted",
  "auction.bid_outbid",
  "auction.bid_withdrawn",
  "auction.settled",
  "auction.unsold",
  "auction.cancelled",
  "transaction.guardian_confirmed",
  "transaction.cancelled",
  "transaction.completed",
  "transaction.disputed",
  "transaction.platform_review_required"
]);

export class FakeWorkerSubscriptionMessageSender
  implements SubscriptionMessageSender
{
  constructor(private readonly mode: "normal" | "failure" = "normal") {}

  async send(input: {
    recipientUserId: string;
    templateKey: string;
    payload: Record<string, unknown>;
  }) {
    if (this.mode === "failure") {
      return {
        ok: false as const,
        errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
        mutatesBusinessState: false as const
      };
    }

    return {
      ok: true as const,
      providerMessageId: `fake_${input.recipientUserId}_${input.templateKey}`,
      mutatesBusinessState: false as const
    };
  }
}

export class PrismaNotificationSender implements NotificationSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly subscriptionSender: SubscriptionMessageSender =
      new FakeWorkerSubscriptionMessageSender()
  ) {}

  async send(input: {
    outboxEventId: string;
    eventType: string;
    targetType: string;
    targetId: string;
    idempotencyKey: string;
    payloadJson: Record<string, unknown>;
  }) {
    if (!supportedEventTypes.has(input.eventType)) {
      return {
        ok: true as const,
        providerMessageId: `notification_ignored_${input.outboxEventId}`,
        mutatesBusinessState: false as const
      };
    }

    const drafts = await deriveNotificationDrafts(this.prisma, input);
    await this.persistDrafts({
      outboxEventId: input.outboxEventId,
      drafts
    });
    await this.deliverPendingSubscriptions(input.outboxEventId);

    return {
      ok: true as const,
      providerMessageId: `notification_${input.outboxEventId}_${drafts.length}`,
      mutatesBusinessState: false as const
    };
  }

  private async persistDrafts(input: {
    outboxEventId: string;
    drafts: NotificationDraft[];
  }) {
    if (input.drafts.length === 0) {
      return;
    }

    await this.prisma.notification.createMany({
      data: input.drafts.map((draft) => ({
        recipientUserId: draft.recipientUserId,
        recipientChildId: draft.recipientChildId,
        type: draft.type,
        priority: draft.priority,
        mandatory: draft.mandatory,
        title: draft.title,
        body: draft.body,
        relatedType: draft.relatedType,
        relatedId: draft.relatedId,
        eventId: input.outboxEventId,
        targetVersion: draft.targetVersion,
        actionType: draft.actionType,
        deliveryStatus: draft.deliveryStatus,
        updatedAt: new Date()
      })),
      skipDuplicates: true
    });
  }

  private async deliverPendingSubscriptions(outboxEventId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        eventId: outboxEventId,
        deliveryStatus: "pending",
        priority: {
          in: ["high", "urgent"]
        }
      },
      select: {
        id: true,
        recipientUserId: true,
        type: true,
        priority: true,
        relatedType: true,
        relatedId: true
      }
    });

    for (const notification of notifications) {
      const result = await this.subscriptionSender.send({
        recipientUserId: notification.recipientUserId,
        templateKey: notification.type,
        payload: {
          priority: notification.priority,
          relatedType: notification.relatedType,
          relatedId: notification.relatedId
        }
      });
      await this.prisma.notification.update({
        where: {
          id: notification.id
        },
        data: {
          deliveryStatus: result.ok ? "sent" : "failed"
        }
      });
    }
  }
}

async function deriveNotificationDrafts(
  prisma: PrismaClient,
  input: {
    eventType: string;
    targetId: string;
    payloadJson: Record<string, unknown>;
  }
): Promise<NotificationDraft[]> {
  switch (input.eventType) {
    case "auction.bid_accepted":
      return deriveBidAccepted(prisma, input.payloadJson);
    case "auction.bid_outbid":
      return deriveBidOutbid(prisma, input.payloadJson);
    case "auction.bid_withdrawn":
      return deriveBidWithdrawn(prisma, input.payloadJson);
    case "auction.settled":
      return deriveAuctionSettled(prisma, input.payloadJson);
    case "auction.unsold":
      return deriveAuctionUnsold(prisma, input.payloadJson);
    case "auction.cancelled":
      return deriveAuctionCancelled(prisma, input.payloadJson);
    case "transaction.guardian_confirmed":
      return deriveTransactionEvent(prisma, input.targetId, {
        type: "transaction_guardian_confirmed",
        priority: "high",
        mandatory: true,
        parentTitle: "成交确认已更新",
        parentBody: "请打开交易详情查看最新状态。"
      });
    case "transaction.cancelled":
      return deriveTransactionEvent(prisma, input.targetId, {
        type: "transaction_cancelled",
        priority: "high",
        mandatory: true,
        childTitle: "交易已取消",
        childBody: "请让家长查看交易详情。",
        parentTitle: "交易已取消",
        parentBody: "请打开交易详情查看最新状态。"
      });
    case "transaction.completed":
      return deriveTransactionEvent(prisma, input.targetId, {
        type: "transaction_completed",
        priority: "high",
        mandatory: true,
        childTitle: "交易已完成",
        childBody: "积分和交易状态已更新，请让家长查看详情。",
        parentTitle: "交易已完成",
        parentBody: "请打开交易详情查看积分转移结果。"
      });
    case "transaction.disputed":
      return deriveTransactionEvent(prisma, input.targetId, {
        type: "transaction_disputed",
        priority: "urgent",
        mandatory: true,
        parentTitle: "交易进入争议处理",
        parentBody: "请打开交易详情查看最新处理状态。",
        adminTitle: "有交易需要一线处理",
        adminBody: "请打开交易详情查看争议处理待办。"
      });
    case "transaction.platform_review_required":
      return deriveTransactionEvent(prisma, input.targetId, {
        type: "transaction_platform_review_required",
        priority: "urgent",
        mandatory: true,
        parentTitle: "交易进入平台复核",
        parentBody: "请打开交易详情查看平台复核状态。",
        adminTitle: "有交易需要平台复核",
        adminBody: "请打开交易详情处理平台复核待办。",
        includePlatformAdmins: true
      });
    default:
      return [];
  }
}

async function deriveBidAccepted(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const auction = await getAuctionContext(
    prisma,
    expectString(payload.auctionSessionId)
  );
  if (!auction) {
    return [];
  }

  return notificationsForChildren(prisma, {
    childIds: [expectString(payload.bidderChildId)],
    type: "auction_bid_accepted",
    childTitle: "出价已提交",
    childBody: "请打开拍卖详情查看最新状态。",
    parentTitle: "孩子的出价已提交",
    parentBody: "请打开拍卖详情查看最新状态。",
    relatedType: "auction_session",
    relatedId: auction.auctionSessionId,
    targetVersion: auction.version,
    communityId: auction.communityId,
    priority: "normal",
    mandatory: false
  });
}

async function deriveBidOutbid(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const auction = await getAuctionContext(
    prisma,
    expectString(payload.auctionSessionId)
  );
  if (!auction) {
    return [];
  }

  return notificationsForChildren(prisma, {
    childIds: [expectString(payload.outbidBidderChildId)],
    type: "auction_bid_outbid",
    childTitle: "你的出价被超越了",
    childBody: "请打开拍卖详情查看最新状态。",
    parentTitle: "孩子的出价被超越了",
    parentBody: "冻结积分已按规则释放，请打开拍卖详情查看最新状态。",
    relatedType: "auction_session",
    relatedId: auction.auctionSessionId,
    targetVersion: auction.version,
    communityId: auction.communityId,
    priority: "normal",
    mandatory: false
  });
}

async function deriveBidWithdrawn(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const auction = await getAuctionContext(
    prisma,
    expectString(payload.auctionSessionId)
  );
  if (!auction) {
    return [];
  }

  return notificationsForChildren(prisma, {
    childIds: [expectString(payload.bidderChildId)],
    type: "auction_bid_withdrawn",
    childTitle: "出价已撤销",
    childBody: "请打开拍卖详情查看最新状态。",
    parentTitle: "孩子的出价已撤销",
    parentBody: "冻结积分已按规则释放，请打开拍卖详情查看最新状态。",
    relatedType: "auction_session",
    relatedId: auction.auctionSessionId,
    targetVersion: auction.version,
    communityId: auction.communityId,
    priority: "normal",
    mandatory: false
  });
}

async function deriveAuctionSettled(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const transactionId = expectString(payload.transactionId);
  const transaction = await getTransactionContext(prisma, transactionId);
  if (!transaction) {
    return [];
  }

  return notificationsForChildren(prisma, {
    childIds: [transaction.buyerChildId, transaction.sellerChildId],
    type: "auction_settled",
    childTitle: "拍卖已结束",
    childBody: "请让家长查看成交确认事项。",
    parentTitle: "有成交需要确认",
    parentBody: "请打开交易详情完成监护确认。",
    relatedType: "transaction",
    relatedId: transaction.transactionId,
    targetVersion: transaction.version,
    communityId: transaction.communityId,
    priority: "high",
    mandatory: true
  });
}

async function deriveAuctionUnsold(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const auction = await getAuctionContext(
    prisma,
    expectString(payload.auctionSessionId)
  );
  if (!auction) {
    return [];
  }

  return notificationsForChildren(prisma, {
    childIds: [auction.sellerChildId],
    type: "auction_unsold",
    childTitle: "拍卖已流拍",
    childBody: "请打开拍卖详情查看最新状态。",
    parentTitle: "孩子的拍卖已流拍",
    parentBody: "请打开拍卖详情查看最新状态。",
    relatedType: "auction_session",
    relatedId: auction.auctionSessionId,
    targetVersion: auction.version,
    communityId: auction.communityId,
    priority: "normal",
    mandatory: false
  });
}

async function deriveAuctionCancelled(
  prisma: PrismaClient,
  payload: Record<string, unknown>
) {
  const auction = await getAuctionContext(
    prisma,
    expectString(payload.auctionSessionId)
  );
  if (!auction) {
    return [];
  }

  const childIds = [
    auction.sellerChildId,
    maybeString(payload.releasedBidderChildId)
  ].filter((childId): childId is string => Boolean(childId));

  return notificationsForChildren(prisma, {
    childIds,
    type: "auction_cancelled",
    childTitle: "拍卖已取消",
    childBody: "请打开拍卖详情查看最新状态。",
    parentTitle: "拍卖已取消",
    parentBody: "请打开拍卖详情查看最新状态。",
    relatedType: "auction_session",
    relatedId: auction.auctionSessionId,
    targetVersion: auction.version,
    communityId: auction.communityId,
    priority: "normal",
    mandatory: false
  });
}

async function deriveTransactionEvent(
  prisma: PrismaClient,
  transactionId: string,
  input: {
    type: NotificationType;
    priority: NotificationPriority;
    mandatory: boolean;
    childTitle?: string;
    childBody?: string;
    parentTitle: string;
    parentBody: string;
    adminTitle?: string;
    adminBody?: string;
    includePlatformAdmins?: boolean;
  }
) {
  const transaction = await getTransactionContext(prisma, transactionId);
  if (!transaction) {
    return [];
  }

  const drafts = await notificationsForChildren(prisma, {
    childIds: [transaction.buyerChildId, transaction.sellerChildId],
    type: input.type,
    childTitle: input.childTitle,
    childBody: input.childBody,
    parentTitle: input.parentTitle,
    parentBody: input.parentBody,
    relatedType: "transaction",
    relatedId: transaction.transactionId,
    targetVersion: transaction.version,
    communityId: transaction.communityId,
    priority: input.priority,
    mandatory: input.mandatory
  });

  if (input.adminTitle && input.adminBody) {
    drafts.push(
      ...(await adminNotifications(prisma, {
        communityId: transaction.communityId,
        type: input.type,
        title: input.adminTitle,
        body: input.adminBody,
        relatedType: "transaction",
        relatedId: transaction.transactionId,
        targetVersion: transaction.version,
        priority: input.priority,
        mandatory: input.mandatory,
        includePlatformAdmins: Boolean(input.includePlatformAdmins)
      }))
    );
  }

  return dedupeDrafts(drafts);
}

async function notificationsForChildren(
  prisma: PrismaClient,
  input: {
    childIds: string[];
    type: NotificationType;
    childTitle?: string;
    childBody?: string;
    parentTitle: string;
    parentBody: string;
    relatedType: string;
    relatedId: string;
    targetVersion: number | null;
    communityId: string;
    priority: NotificationPriority;
    mandatory: boolean;
  }
) {
  const childIds = [...new Set(input.childIds)];
  const [childUsers, guardianRecipients] = await Promise.all([
    childUserRecipients(prisma, childIds, input.communityId),
    guardianRecipientsForChildren(prisma, childIds, input.communityId)
  ]);
  const drafts: NotificationDraft[] = [];

  if (input.childTitle && input.childBody) {
    for (const child of childUsers) {
      drafts.push({
        recipientUserId: child.userId,
        recipientChildId: child.childId,
        type: input.type,
        priority: input.priority === "urgent" ? "normal" : "low",
        mandatory: false,
        title: input.childTitle,
        body: input.childBody,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        targetVersion: input.targetVersion,
        actionType: actionTypeForRelatedType(input.relatedType),
        deliveryStatus: "suppressed"
      });
    }
  }

  for (const guardian of guardianRecipients) {
    if (
      !(await shouldPersistInAppNotification(prisma, {
        userId: guardian.userId,
        childId: guardian.childId,
        eventType: input.type,
        mandatory: input.mandatory
      }))
    ) {
      continue;
    }
    drafts.push({
      recipientUserId: guardian.userId,
      recipientChildId: guardian.childId,
      type: input.type,
      priority: input.priority,
      mandatory: input.mandatory,
      title: input.parentTitle,
      body: input.parentBody,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      targetVersion: input.targetVersion,
      actionType: actionTypeForRelatedType(input.relatedType),
      deliveryStatus: shouldAttemptSubscription(input.priority)
        ? "pending"
        : "suppressed"
    });
  }

  return dedupeDrafts(drafts);
}

async function adminNotifications(
  prisma: PrismaClient,
  input: {
    communityId: string;
    type: NotificationType;
    title: string;
    body: string;
    relatedType: string;
    relatedId: string;
    targetVersion: number | null;
    priority: NotificationPriority;
    mandatory: boolean;
    includePlatformAdmins: boolean;
  }
) {
  const activityAdmins = await prisma.adminProfile.findMany({
    where: {
      role: "activity_admin",
      status: "active",
      user: {
        status: "active",
        targetRiskRestrictions: {
          none: {
            status: "active",
            type: "suspended"
          }
        }
      },
      communityScopes: {
        some: {
          communityId: input.communityId,
          status: "active"
        }
      }
    },
    select: {
      userId: true
    }
  });
  const platformAdmins = input.includePlatformAdmins
    ? await prisma.adminProfile.findMany({
        where: {
          role: "platform_admin",
          status: "active",
          user: {
            status: "active",
            targetRiskRestrictions: {
              none: {
                status: "active",
                type: "suspended"
              }
            }
          }
        },
        select: {
          userId: true
        }
      })
    : [];

  return dedupeDrafts(
    [...activityAdmins, ...platformAdmins].map((admin) => ({
      recipientUserId: admin.userId,
      recipientChildId: null,
      type: input.type,
      priority: input.priority,
      mandatory: input.mandatory,
      title: input.title,
      body: input.body,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      targetVersion: input.targetVersion,
      actionType: actionTypeForRelatedType(input.relatedType),
      deliveryStatus: shouldAttemptSubscription(input.priority)
        ? "pending"
        : "suppressed"
    }))
  );
}

async function childUserRecipients(
  prisma: PrismaClient,
  childIds: string[],
  communityId: string
) {
  const children = await prisma.childProfile.findMany({
    where: {
      id: {
        in: childIds
      },
      status: "active",
      userId: {
        not: null
      },
      riskRestrictions: {
        none: {
          status: "active",
          type: "suspended"
        }
      },
      memberships: {
        some: {
          communityId,
          status: "active"
        }
      },
      user: {
        status: "active",
        targetRiskRestrictions: {
          none: {
            status: "active",
            type: "suspended"
          }
        }
      }
    },
    select: {
      id: true,
      userId: true
    }
  });

  return children.flatMap((child) =>
    child.userId
      ? [
          {
            childId: child.id,
            userId: child.userId
          }
        ]
      : []
  );
}

async function guardianRecipientsForChildren(
  prisma: PrismaClient,
  childIds: string[],
  communityId: string
) {
  const links = await prisma.guardianChildLink.findMany({
    where: {
      childId: {
        in: childIds
      },
      status: "active",
      guardian: {
        status: "active",
        user: {
          status: "active",
          targetRiskRestrictions: {
            none: {
              status: "active",
              type: "suspended"
            }
          }
        }
      },
      child: {
        status: "active",
        memberships: {
          some: {
            communityId,
            status: "active"
          }
        },
        riskRestrictions: {
          none: {
            status: "active",
            type: "suspended"
          }
        }
      }
    },
    select: {
      childId: true,
      guardian: {
        select: {
          userId: true
        }
      }
    }
  });

  return links.map((link) => ({
    childId: link.childId,
    userId: link.guardian.userId
  }));
}

async function shouldPersistInAppNotification(
  prisma: PrismaClient,
  input: {
    userId: string;
    childId: string | null;
    eventType: string;
    mandatory: boolean;
  }
) {
  if (input.mandatory) {
    return true;
  }

  const preference = await prisma.notificationPreference.findFirst({
    where: {
      userId: input.userId,
      childId: input.childId,
      eventType: input.eventType
    },
    select: {
      inAppEnabled: true
    }
  });

  return preference?.inAppEnabled ?? true;
}

async function getAuctionContext(
  prisma: PrismaClient,
  auctionSessionId: string
): Promise<AuctionContext | null> {
  const auction = await prisma.auctionSession.findUnique({
    where: {
      id: auctionSessionId
    },
    select: {
      id: true,
      itemId: true,
      version: true,
      item: {
        select: {
          communityId: true,
          sellerChildId: true
        }
      }
    }
  });

  return auction
    ? {
        auctionSessionId: auction.id,
        itemId: auction.itemId,
        communityId: auction.item.communityId,
        sellerChildId: auction.item.sellerChildId,
        version: auction.version
      }
    : null;
}

async function getTransactionContext(
  prisma: PrismaClient,
  transactionId: string
): Promise<TransactionContext | null> {
  const transaction = await prisma.transaction.findUnique({
    where: {
      id: transactionId
    },
    select: {
      id: true,
      auctionSessionId: true,
      buyerChildId: true,
      sellerChildId: true,
      version: true,
      auctionSession: {
        select: {
          item: {
            select: {
              communityId: true
            }
          }
        }
      }
    }
  });

  return transaction
    ? {
        transactionId: transaction.id,
        auctionSessionId: transaction.auctionSessionId,
        communityId: transaction.auctionSession.item.communityId,
        buyerChildId: transaction.buyerChildId,
        sellerChildId: transaction.sellerChildId,
        version: transaction.version
      }
    : null;
}

function shouldAttemptSubscription(priority: NotificationPriority) {
  return priority === "high" || priority === "urgent";
}

function actionTypeForRelatedType(
  relatedType: string
): NotificationActionType | null {
  switch (relatedType) {
    case "auction_session":
      return "view_auction";
    case "transaction":
      return "view_transaction";
    case "appeal":
      return "view_appeal";
    case "point_account":
    case "point_ledger_entry":
      return "view_points";
    case "search_result":
      return "open_search_result";
    default:
      return null;
  }
}

function dedupeDrafts(drafts: NotificationDraft[]) {
  const byKey = new Map<string, NotificationDraft>();
  for (const draft of drafts) {
    byKey.set(
      `${draft.recipientUserId}:${draft.recipientChildId ?? "__none__"}:${draft.type}`,
      draft
    );
  }
  return [...byKey.values()];
}

function expectString(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("OUTBOX_NOTIFICATION_INVALID_PAYLOAD");
  }
  return value;
}

function maybeString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export type NotificationSenderPrisma = PrismaClient;
export type NotificationSenderJson = Prisma.InputJsonValue;
