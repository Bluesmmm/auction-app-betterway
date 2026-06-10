import type { PrismaClient } from "@prisma/client";
import type { ChildParticipationService } from "../accounts/child-participation.service.js";
import type { RealtimeRoomKey } from "./realtime-types.js";

export type RealtimeRoomAuthorizationResult =
  | {
      result: "accepted";
      room: RealtimeRoomKey;
    }
  | {
      result: "rejected";
      errorCode:
        | "REALTIME_ROOM_FORBIDDEN"
        | "REALTIME_TARGET_NOT_VISIBLE"
        | "REALTIME_CHILD_SCOPE_FORBIDDEN";
    };

export class RealtimePermissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly participation: ChildParticipationService
  ) {}

  async authorizeRoom(input: {
    actorUserId: string;
    room: RealtimeRoomKey;
    now?: Date;
  }): Promise<RealtimeRoomAuthorizationResult> {
    switch (input.room.kind) {
      case "auction":
        return this.authorizeAuctionRoom({
          actorUserId: input.actorUserId,
          room: input.room,
          now: input.now
        });
      case "transaction":
        return this.authorizeTransactionRoom({
          actorUserId: input.actorUserId,
          room: input.room,
          now: input.now
        });
      case "notifications":
        return this.authorizeNotificationRoom({
          actorUserId: input.actorUserId,
          room: input.room
        });
    }
  }

  private async authorizeAuctionRoom(input: {
    actorUserId: string;
    room: Extract<RealtimeRoomKey, { kind: "auction" }>;
    now?: Date;
  }): Promise<RealtimeRoomAuthorizationResult> {
    const auction = await this.prisma.auctionSession.findUnique({
      where: {
        id: input.room.auctionSessionId
      },
      select: {
        id: true,
        item: {
          select: {
            communityId: true,
            status: true,
            currentPublicVersion: {
              select: {
                status: true
              }
            }
          }
        }
      }
    });
    if (
      !auction ||
      !isVisibleItemStatus(auction.item.status) ||
      auction.item.currentPublicVersion?.status !== "approved"
    ) {
      return { result: "rejected", errorCode: "REALTIME_TARGET_NOT_VISIBLE" };
    }

    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.room.childId,
      communityId: auction.item.communityId,
      action: "browse_community",
      now: input.now
    });
    return participation.result === "accepted"
      ? { result: "accepted", room: input.room }
      : { result: "rejected", errorCode: "REALTIME_ROOM_FORBIDDEN" };
  }

  private async authorizeTransactionRoom(input: {
    actorUserId: string;
    room: Extract<RealtimeRoomKey, { kind: "transaction" }>;
    now?: Date;
  }): Promise<RealtimeRoomAuthorizationResult> {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id: input.room.transactionId
      },
      select: {
        buyerChildId: true,
        sellerChildId: true,
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
    if (
      !transaction ||
      (transaction.buyerChildId !== input.room.childId &&
        transaction.sellerChildId !== input.room.childId)
    ) {
      return { result: "rejected", errorCode: "REALTIME_TARGET_NOT_VISIBLE" };
    }

    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.room.childId,
      communityId: transaction.auctionSession.item.communityId,
      action: "browse_community",
      now: input.now
    });
    return participation.result === "accepted"
      ? { result: "accepted", room: input.room }
      : { result: "rejected", errorCode: "REALTIME_ROOM_FORBIDDEN" };
  }

  private async authorizeNotificationRoom(input: {
    actorUserId: string;
    room: Extract<RealtimeRoomKey, { kind: "notifications" }>;
  }): Promise<RealtimeRoomAuthorizationResult> {
    if (!input.room.childId) {
      return { result: "accepted", room: input.room };
    }

    const [childUser, guardianLink] = await Promise.all([
      this.prisma.childProfile.findFirst({
        where: {
          id: input.room.childId,
          userId: input.actorUserId,
          status: "active"
        },
        select: {
          id: true
        }
      }),
      this.prisma.guardianChildLink.findFirst({
        where: {
          childId: input.room.childId,
          status: "active",
          guardian: {
            status: "active",
            userId: input.actorUserId
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

    return childUser || guardianLink
      ? { result: "accepted", room: input.room }
      : {
          result: "rejected",
          errorCode: "REALTIME_CHILD_SCOPE_FORBIDDEN"
        };
  }
}

function isVisibleItemStatus(status: string) {
  return status === "approved" || status === "listed";
}
