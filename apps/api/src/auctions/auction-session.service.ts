import type {
  AuctionSessionStatus,
  ItemStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { runCriticalTransaction } from "../prisma/critical-transaction.js";
import { AuctionPermissionsService } from "./auction-permissions.service.js";

type IdempotencyReservation<T> =
  | { result: "reserved"; id: string }
  | { result: "replay"; response: T }
  | { result: "conflict" };

type AuctionSessionRejectedErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "COMMUNITY_ADMIN_REQUIRED"
  | "ITEM_NOT_FOUND"
  | "COMMUNITY_NOT_ACTIVE"
  | "ITEM_NOT_READY_FOR_AUCTION"
  | "AUCTION_ALREADY_EXISTS";

export type CreateAuctionSessionResult =
  | {
      result: "accepted";
      auctionSessionId: string;
      itemId: string;
      communityId: string;
      status: AuctionSessionStatus;
      startAt: string;
      endAt: string;
      startPoints: number;
      minIncrementPoints: number;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode: AuctionSessionRejectedErrorCode;
    };

type LockedItemRow = {
  id: string;
  communityId: string;
  status: ItemStatus;
  startPoints: number;
  minIncrementPoints: number;
  currentPublicVersionId: string | null;
};

export class AuctionSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions = new AuctionPermissionsService(prisma)
  ) {}

  async createAuctionSession(input: {
    actorUserId: string;
    communityId: string;
    itemId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<CreateAuctionSessionResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      communityId: input.communityId,
      itemId: input.itemId
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency = await reserveIdempotencyRecord<CreateAuctionSessionResult>(
        tx,
        {
          key: idempotencyKey,
          actorUserId: input.actorUserId,
          action: "auction_session.create",
          targetType: "item",
          targetId: input.itemId,
          requestHash
        }
      );

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const authorization = await this.permissions.canManageCommunityAuction(
        {
          actorUserId: input.actorUserId,
          communityId: input.communityId
        },
        tx
      );
      if (authorization.result === "rejected") {
        return completeIdempotency(tx, idempotency.id, authorization);
      }

      const item = await lockItem(tx, input.itemId);
      if (!item || item.communityId !== input.communityId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "ITEM_NOT_FOUND"
        });
      }

      const existingAuction = await tx.auctionSession.findUnique({
        where: {
          itemId: item.id
        },
        select: {
          id: true
        }
      });
      if (existingAuction) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "AUCTION_ALREADY_EXISTS"
        });
      }

      const community = await tx.auctionCommunity.findUnique({
        where: {
          id: item.communityId
        },
        select: {
          id: true,
          status: true,
          defaultAuctionDurationMinutes: true
        }
      });
      if (!community || community.status !== "active") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "COMMUNITY_NOT_ACTIVE"
        });
      }

      if (!isAuctionReadyItemStatus(item.status) || !item.currentPublicVersionId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "ITEM_NOT_READY_FOR_AUCTION"
        });
      }

      const currentPublicVersion = await tx.contentVersion.findUnique({
        where: {
          id: item.currentPublicVersionId
        },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          status: true
        }
      });
      if (
        !currentPublicVersion ||
        currentPublicVersion.targetType !== "item" ||
        currentPublicVersion.targetId !== item.id ||
        currentPublicVersion.status !== "approved"
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "ITEM_NOT_READY_FOR_AUCTION"
        });
      }

      const startAt = now;
      const endAt = new Date(
        startAt.getTime() + community.defaultAuctionDurationMinutes * 60_000
      );
      const auctionSessionIdempotencyKey = buildAuctionSessionIdempotencyKey({
        actorUserId: input.actorUserId,
        itemId: item.id,
        idempotencyKey
      });

      const auction = await tx.auctionSession.create({
        data: {
          itemId: item.id,
          idempotencyKey: auctionSessionIdempotencyKey,
          status: "active",
          startAt,
          endAt,
          startPoints: item.startPoints,
          minIncrementPoints: item.minIncrementPoints,
          createdByUserId: input.actorUserId,
          createdAt: now
        }
      });

      const response: CreateAuctionSessionResult = {
        result: "accepted",
        auctionSessionId: auction.id,
        itemId: auction.itemId,
        communityId: item.communityId,
        status: auction.status,
        startAt: auction.startAt.toISOString(),
        endAt: auction.endAt.toISOString(),
        startPoints: auction.startPoints,
        minIncrementPoints: auction.minIncrementPoints,
        idempotencyKey
      };

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "auction_session.create",
          targetType: "auction_session",
          targetId: auction.id,
          afterJson: {
            itemId: item.id,
            communityId: item.communityId,
            status: auction.status,
            startAt: response.startAt,
            endAt: response.endAt,
            startPoints: auction.startPoints,
            minIncrementPoints: auction.minIncrementPoints,
            auctionSessionIdempotencyKey,
            clientIdempotencyKeyHash: createStableHash({ idempotencyKey })
          }
        }
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "auction.session_created",
          targetType: "auction_session",
          targetId: auction.id,
          idempotencyKey: buildOutboxIdempotencyKey(
            auctionSessionIdempotencyKey
          ),
          payloadJson: {
            auctionSessionId: response.auctionSessionId,
            itemId: response.itemId,
            communityId: response.communityId,
            status: response.status,
            startAt: response.startAt,
            endAt: response.endAt,
            startPoints: response.startPoints,
            minIncrementPoints: response.minIncrementPoints,
            createdByUserId: input.actorUserId
          },
          availableAt: now
        }
      });

      return completeIdempotency(tx, idempotency.id, response);
    });
  }
}

async function reserveIdempotencyRecord<T>(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  }
): Promise<IdempotencyReservation<T>> {
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IdempotencyRecord" (
      "id",
      "key",
      "actorUserId",
      "action",
      "targetType",
      "targetId",
      "requestHash",
      "status"
    )
    VALUES (
      ${randomUUID()},
      ${input.key},
      ${input.actorUserId},
      ${input.action},
      ${input.targetType},
      ${input.targetId},
      ${input.requestHash},
      'processing'
    )
    ON CONFLICT ("key", "actorUserId", "action", "targetType", "targetId")
    DO NOTHING
    RETURNING "id"
  `;

  if (inserted[0]) {
    return {
      result: "reserved",
      id: inserted[0].id
    };
  }

  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      key_actorUserId_action_targetType_targetId: {
        key: input.key,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId
      }
    },
    select: {
      id: true,
      requestHash: true,
      status: true,
      responseJson: true
    }
  });

  if (!existing || existing.requestHash !== input.requestHash) {
    return { result: "conflict" };
  }

  if (existing.status === "completed" && existing.responseJson) {
    return {
      result: "replay",
      response: existing.responseJson as T
    };
  }

  return {
    result: "conflict"
  };
}

async function completeIdempotency<T>(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: T
): Promise<T> {
  await tx.idempotencyRecord.update({
    where: {
      id: idempotencyRecordId
    },
    data: {
      status: "completed",
      responseJson: response as Prisma.InputJsonValue
    }
  });

  return response;
}

async function lockItem(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<LockedItemRow | null> {
  const rows = await tx.$queryRaw<LockedItemRow[]>`
    SELECT
      "id",
      "communityId",
      "status",
      "startPoints",
      "minIncrementPoints",
      "currentPublicVersionId"
    FROM "Item"
    WHERE "id" = ${itemId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

function isAuctionReadyItemStatus(status: ItemStatus) {
  return status === "approved" || status === "listed";
}

function buildAuctionSessionIdempotencyKey(input: {
  actorUserId: string;
  itemId: string;
  idempotencyKey: string;
}) {
  return `auction_session.create:${createStableHash(input)}`;
}

function buildOutboxIdempotencyKey(auctionSessionIdempotencyKey: string) {
  return `auction.session_created:${createStableHash({
    auctionSessionIdempotencyKey
  })}`;
}

function createStableHash(value: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
