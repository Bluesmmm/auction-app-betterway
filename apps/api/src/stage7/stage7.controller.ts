import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query
} from "@nestjs/common";
import type { SearchIndexTargetType } from "@prisma/client";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import {
  Stage7DiscoveryService,
  type Stage7SearchSort
} from "./stage7-discovery.service.js";

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

export class Stage7Controller {
  constructor(
    private readonly discovery: Stage7DiscoveryService,
    private readonly sessions: SessionService,
    private readonly sessionTokens: SessionTokenService
  ) {}

  async search(
    query: {
      childId?: string;
      communityId?: string;
      q?: string;
      category?: string;
      targetType?: string;
      sort?: string;
      cursor?: string;
      limit?: string | number;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const childId = nonEmptyString(query.childId);
    const communityId = nonEmptyString(query.communityId);
    const meta = {
      now,
      targetType: "stage7_search",
      targetId: communityId ?? actor.userId,
      latestStatus: "active"
    };
    if (!childId || !communityId) {
      return requireChildCommunity(meta, childId, communityId);
    }

    const result = await this.discovery.searchCommunityContent({
      actorUserId: actor.userId,
      childId,
      communityId,
      query: nonEmptyString(query.q),
      category: nonEmptyString(query.category),
      targetType: coerceTargetType(query.targetType),
      sort: coerceSort(query.sort),
      cursor: nonEmptyString(query.cursor),
      limit: coerceLimit(query.limit),
      now
    });

    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      results: result.results,
      nextCursor: result.nextCursor
    });
  }

  async listFavoriteItems(
    query: {
      childId?: string;
      communityId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const childId = nonEmptyString(query.childId);
    const communityId = nonEmptyString(query.communityId);
    const meta = {
      now,
      targetType: "stage7_item_favorites",
      targetId: childId ?? actor.userId,
      latestStatus: "active"
    };
    if (!childId || !communityId) {
      return requireChildCommunity(meta, childId, communityId);
    }

    const result = await this.discovery.listFavoriteItems({
      actorUserId: actor.userId,
      childId,
      communityId,
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      favorites: result.favorites
    });
  }

  async favoriteItem(
    itemId: string,
    body: {
      childId?: string;
      communityId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const childId = nonEmptyString(body.childId);
    const communityId = nonEmptyString(body.communityId);
    const meta = {
      now,
      targetType: "item_favorite",
      targetId: itemId,
      latestStatus: "active"
    };
    if (!childId || !communityId) {
      return requireChildCommunity(meta, childId, communityId);
    }

    const result = await this.discovery.favoriteItem({
      actorUserId: actor.userId,
      childId,
      communityId,
      itemId,
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      itemId: result.itemId,
      childId: result.childId,
      communityId: result.communityId,
      status: result.status
    });
  }

  async removeFavoriteItem(
    itemId: string,
    body: {
      childId?: string;
      communityId?: string;
    } = {},
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const childId = nonEmptyString(body.childId);
    const communityId = nonEmptyString(body.communityId);
    const meta = {
      now,
      targetType: "item_favorite",
      targetId: itemId,
      latestStatus: "removed"
    };
    if (!childId || !communityId) {
      return requireChildCommunity(meta, childId, communityId);
    }

    const result = await this.discovery.removeFavoriteItem({
      actorUserId: actor.userId,
      childId,
      communityId,
      itemId,
      now
    });
    if (result.result === "rejected") {
      return rejectedResponse(meta, result.errorCode);
    }

    return acceptedResponse(meta, {
      itemId: result.itemId,
      childId: result.childId,
      communityId: result.communityId,
      status: result.status
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

defineConstructorParamTypes(Stage7Controller, [
  Stage7DiscoveryService,
  SessionService,
  SessionTokenService
]);
Controller("stage7")(Stage7Controller);
applyMethodDecorator(Get("search"), Stage7Controller.prototype, "search");
applyMethodDecorator(
  Get("favorites/items"),
  Stage7Controller.prototype,
  "listFavoriteItems"
);
applyMethodDecorator(
  Post("favorites/items/:itemId"),
  Stage7Controller.prototype,
  "favoriteItem"
);
applyMethodDecorator(
  Post("favorites/items/:itemId/remove"),
  Stage7Controller.prototype,
  "removeFavoriteItem"
);
applyParameterDecorator(Query(), Stage7Controller.prototype, "search", 0);
applyParameterDecorator(
  Headers("authorization"),
  Stage7Controller.prototype,
  "search",
  1
);
applyParameterDecorator(
  Query(),
  Stage7Controller.prototype,
  "listFavoriteItems",
  0
);
applyParameterDecorator(
  Headers("authorization"),
  Stage7Controller.prototype,
  "listFavoriteItems",
  1
);
applyParameterDecorator(
  Param("itemId"),
  Stage7Controller.prototype,
  "favoriteItem",
  0
);
applyParameterDecorator(Body(), Stage7Controller.prototype, "favoriteItem", 1);
applyParameterDecorator(
  Headers("authorization"),
  Stage7Controller.prototype,
  "favoriteItem",
  2
);
applyParameterDecorator(
  Param("itemId"),
  Stage7Controller.prototype,
  "removeFavoriteItem",
  0
);
applyParameterDecorator(
  Body(),
  Stage7Controller.prototype,
  "removeFavoriteItem",
  1
);
applyParameterDecorator(
  Headers("authorization"),
  Stage7Controller.prototype,
  "removeFavoriteItem",
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
    latestStatus: "rejected",
    result: "rejected",
    refreshRequired: false,
    errorCode
  };
}

function requireChildCommunity(
  meta: WriteResponseMeta,
  childId?: string,
  communityId?: string
) {
  if (!childId) {
    return rejectedResponse(meta, "CHILD_ID_REQUIRED");
  }
  if (!communityId) {
    return rejectedResponse(meta, "COMMUNITY_ID_REQUIRED");
  }
  return null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function coerceTargetType(value: unknown): SearchIndexTargetType | undefined {
  return value === "item" || value === "wanted_post" ? value : undefined;
}

function coerceSort(value: unknown): Stage7SearchSort | undefined {
  return value === "latest" ||
    value === "ending_soon" ||
    value === "bid_count" ||
    value === "popular"
    ? value
    : undefined;
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
