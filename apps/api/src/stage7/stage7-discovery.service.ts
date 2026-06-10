import { Buffer } from "node:buffer";
import type {
  ItemFavorite,
  Prisma,
  PrismaClient,
  SearchIndexDocument,
  SearchIndexTargetType
} from "@prisma/client";
import type { ChildParticipationService } from "../accounts/child-participation.service.js";

export type Stage7SearchSort =
  | "latest"
  | "ending_soon"
  | "bid_count"
  | "popular";

export type Stage7SearchResultItem = {
  targetType: SearchIndexTargetType;
  targetId: string;
  communityId: string;
  contentVersionId: string;
  title: string;
  description: string;
  category: string | null;
  targetVersion: number;
  sourceCreatedAt: string;
  auctionEndAt: string | null;
  bidCount: number;
  favoriteCount: number;
  isFavorited: boolean;
};

export type Stage7SearchResult =
  | {
      result: "accepted";
      results: Stage7SearchResultItem[];
      nextCursor: string | null;
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "SEARCH_NOT_ALLOWED"
        | "COMMUNITY_ID_REQUIRED";
    };

export type FavoriteItemResult =
  | {
      result: "accepted";
      itemId: string;
      childId: string;
      communityId: string;
      status: "active" | "removed";
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "FAVORITE_NOT_ALLOWED"
        | "ITEM_NOT_VISIBLE";
    };

export type ListFavoriteItemsResult =
  | {
      result: "accepted";
      favorites: Stage7SearchResultItem[];
    }
  | {
      result: "rejected";
      errorCode:
        | "COMMUNITY_MEMBER_REQUIRED"
        | "SEARCH_NOT_ALLOWED"
        | "COMMUNITY_ID_REQUIRED";
    };

type VisibleCandidate = Stage7SearchResultItem & {
  indexDocumentId: string;
  position: SearchCursorPosition;
};

type SearchCursorScope = {
  communityId: string;
  query: string | null;
  category: string | null;
  targetType: SearchIndexTargetType | null;
  sort: Stage7SearchSort;
};

type SearchCursorPosition = {
  id: string;
  sourceCreatedAt: string;
  indexedAt: string;
  auctionEndAt: string | null;
  bidCount: number;
  favoriteCount: number;
};

type SearchCursorState = {
  v: 1;
  scope: SearchCursorScope;
  position: SearchCursorPosition;
  seenIds: string[];
};

const SEARCH_CURSOR_PREFIX = "s7search_";

export class Stage7DiscoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly participation: ChildParticipationService
  ) {}

  async searchCommunityContent(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    query?: string;
    category?: string;
    targetType?: SearchIndexTargetType;
    sort?: Stage7SearchSort;
    cursor?: string;
    limit?: number;
    now?: Date;
  }): Promise<Stage7SearchResult> {
    const allowed = await this.ensureCanBrowse(input);
    if (allowed.result === "rejected") {
      return allowed;
    }

    const limit = clampLimit(input.limit);
    const sort = input.sort ?? "latest";
    const cursorScope = buildSearchCursorScope(input, sort);
    const externalCursor = await this.resolveSearchCursor(
      input.cursor,
      cursorScope
    );
    const seenIds = externalCursor?.seenIds ?? [];
    const visible: VisibleCandidate[] = [];
    const batchSize = limit * 3;
    let cursor: SearchCursorPosition | null = null;
    let hasMoreCandidates = true;

    while (visible.length <= limit && hasMoreCandidates) {
      const candidates = await this.searchCandidates({
        ...input,
        sort,
        cursor,
        excludedIds: seenIds,
        take: batchSize + 1
      });
      const batch = candidates.slice(0, batchSize);
      hasMoreCandidates = candidates.length > batchSize;

      for (const candidate of batch) {
        const result = await this.visibleCandidateForIndex(input, candidate);
        if (result) {
          visible.push({
            ...result,
            indexDocumentId: candidate.id,
            position: searchCursorPositionFromDocument(candidate)
          });
        }
        if (visible.length > limit) {
          break;
        }
      }

      const lastScanned = batch.at(-1);
      if (!lastScanned || visible.length > limit) {
        break;
      }
      cursor = searchCursorPositionFromDocument(lastScanned);
    }

    const page = visible.slice(0, limit);
    const pageLast = page.at(-1);
    const nextSeenIds = uniqueStrings([
      ...seenIds,
      ...page.map((candidate) => candidate.indexDocumentId)
    ]);
    return {
      result: "accepted",
      results: page.map(
        ({ indexDocumentId: _indexDocumentId, position: _position, ...result }) =>
          result
      ),
      nextCursor:
        visible.length > limit && pageLast
          ? encodeSearchCursor(
              buildSearchCursorState(
                cursorScope,
                pageLast.position,
                nextSeenIds
              )
            )
          : null
    };
  }

  async favoriteItem(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    itemId: string;
    now?: Date;
  }): Promise<FavoriteItemResult> {
    const canFavorite = await this.ensureCanFavorite(input);
    if (canFavorite.result === "rejected") {
      return canFavorite;
    }

    const visible = await this.visibleItemSummary({
      actorUserId: input.actorUserId,
      childId: input.childId,
      communityId: input.communityId,
      itemId: input.itemId
    });
    if (!visible) {
      return { result: "rejected", errorCode: "ITEM_NOT_VISIBLE" };
    }

    await this.prisma.itemFavorite.upsert({
      where: {
        childId_itemId: {
          childId: input.childId,
          itemId: input.itemId
        }
      },
      update: {
        status: "active",
        removedAt: null
      },
      create: {
        childId: input.childId,
        itemId: input.itemId,
        communityId: input.communityId,
        status: "active"
      }
    });
    await this.refreshItemFavoriteCount(input.itemId);

    return {
      result: "accepted",
      itemId: input.itemId,
      childId: input.childId,
      communityId: input.communityId,
      status: "active"
    };
  }

  async removeFavoriteItem(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    itemId: string;
    now?: Date;
  }): Promise<FavoriteItemResult> {
    const canFavorite = await this.ensureCanFavorite(input);
    if (canFavorite.result === "rejected") {
      return canFavorite;
    }

    await this.prisma.itemFavorite.updateMany({
      where: {
        childId: input.childId,
        itemId: input.itemId,
        communityId: input.communityId,
        status: "active"
      },
      data: {
        status: "removed",
        removedAt: input.now ?? new Date()
      }
    });
    await this.refreshItemFavoriteCount(input.itemId);

    return {
      result: "accepted",
      itemId: input.itemId,
      childId: input.childId,
      communityId: input.communityId,
      status: "removed"
    };
  }

  async listFavoriteItems(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    now?: Date;
  }): Promise<ListFavoriteItemsResult> {
    const allowed = await this.ensureCanBrowse(input);
    if (allowed.result === "rejected") {
      return allowed;
    }

    const visible: Stage7SearchResultItem[] = [];
    const limit = 50;
    const batchSize = 50;
    let cursor: string | undefined;
    let hasMoreCandidates = true;

    while (visible.length < limit && hasMoreCandidates) {
      const candidates = await this.prisma.itemFavorite.findMany({
        where: {
          childId: input.childId,
          communityId: input.communityId,
          status: "active"
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: batchSize + 1,
        ...(cursor
          ? {
              cursor: {
                id: cursor
              },
              skip: 1
            }
          : {})
      });
      const batch = candidates.slice(0, batchSize);
      hasMoreCandidates = candidates.length > batchSize;

      for (const favorite of batch) {
        const result = await this.visibleItemSummary({
          actorUserId: input.actorUserId,
          childId: input.childId,
          communityId: input.communityId,
          itemId: favorite.itemId
        });
        if (result) {
          visible.push({
            ...result,
            isFavorited: true
          });
        }
        if (visible.length >= limit) {
          break;
        }
      }

      const lastScanned = batch.at(-1);
      if (!lastScanned || visible.length >= limit) {
        break;
      }
      cursor = lastScanned.id;
    }

    return {
      result: "accepted",
      favorites: visible
    };
  }

  async upsertSearchIndexDocument(input: {
    targetType: SearchIndexTargetType;
    targetId: string;
  }) {
    if (input.targetType === "item") {
      return this.upsertItemSearchIndex(input.targetId);
    }

    return this.upsertWantedPostSearchIndex(input.targetId);
  }

  private searchCandidates(input: {
    communityId: string;
    query?: string;
    category?: string;
    targetType?: SearchIndexTargetType;
    sort?: Stage7SearchSort;
    cursor?: SearchCursorPosition | null;
    excludedIds?: string[];
    take: number;
  }) {
    const cursorWhere = input.cursor
      ? searchCursorWhere(input.sort ?? "latest", input.cursor)
      : undefined;

    return this.prisma.searchIndexDocument.findMany({
      where: {
        communityId: input.communityId,
        visibilityStatus: "searchable",
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.excludedIds?.length
          ? {
              id: {
                notIn: input.excludedIds
              }
            }
          : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.query?.trim()
          ? {
              searchText: {
                contains: input.query.trim(),
                mode: "insensitive"
              }
            }
          : {}),
        ...(cursorWhere ? { AND: [cursorWhere] } : {})
      },
      orderBy: orderByForSort(input.sort ?? "latest"),
      take: input.take
    });
  }

  private async resolveSearchCursor(
    cursor: string | undefined,
    scope: SearchCursorScope
  ): Promise<SearchCursorState | null> {
    if (!cursor) {
      return null;
    }

    const decoded = decodeSearchCursor(cursor);
    if (decoded) {
      return searchCursorScopeMatches(decoded.scope, scope) ? decoded : null;
    }

    const legacyDocument = await this.prisma.searchIndexDocument.findUnique({
      where: {
        id: cursor
      }
    });
    if (!legacyDocument || !searchDocumentMatchesScope(legacyDocument, scope)) {
      return null;
    }

    return buildSearchCursorState(
      scope,
      searchCursorPositionFromDocument(legacyDocument),
      [legacyDocument.id]
    );
  }

  private async upsertItemSearchIndex(itemId: string) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      include: {
        currentPublicVersion: true,
        auctionSession: true
      }
    });
    if (!item || !item.currentPublicVersion) {
      return { result: "rejected" as const, errorCode: "ITEM_NOT_VISIBLE" };
    }
    const visible =
      isVisibleItemStatus(item.status) &&
      item.currentPublicVersion.status === "approved";

    await this.prisma.searchIndexDocument.upsert({
      where: {
        targetType_targetId: {
          targetType: "item",
          targetId: item.id
        }
      },
      update: {
        contentVersionId: item.currentPublicVersion.id,
        communityId: item.communityId,
        visibilityStatus: visible ? "searchable" : "hidden",
        searchPayload: buildSearchPayload(item.currentPublicVersion, null),
        searchText: buildSearchText(item.currentPublicVersion),
        category: null,
        sourceVersion: item.currentPublicVersion.versionNo,
        sourceCreatedAt: item.createdAt,
        auctionEndAt: item.auctionSession?.endAt ?? null,
        bidCount: await this.countItemBids(item.id),
        favoriteCount: await this.countItemFavorites(item.id),
        indexedAt: new Date()
      },
      create: {
        targetType: "item",
        targetId: item.id,
        contentVersionId: item.currentPublicVersion.id,
        communityId: item.communityId,
        visibilityStatus: visible ? "searchable" : "hidden",
        searchPayload: buildSearchPayload(item.currentPublicVersion, null),
        searchText: buildSearchText(item.currentPublicVersion),
        category: null,
        sourceVersion: item.currentPublicVersion.versionNo,
        sourceCreatedAt: item.createdAt,
        auctionEndAt: item.auctionSession?.endAt ?? null,
        bidCount: await this.countItemBids(item.id),
        favoriteCount: await this.countItemFavorites(item.id)
      }
    });

    return { result: "accepted" as const };
  }

  private async upsertWantedPostSearchIndex(wantedPostId: string) {
    const wantedPost = await this.prisma.wantedPost.findUnique({
      where: { id: wantedPostId },
      include: {
        currentPublicVersion: true
      }
    });
    if (!wantedPost || !wantedPost.currentPublicVersion) {
      return {
        result: "rejected" as const,
        errorCode: "WANTED_POST_NOT_VISIBLE"
      };
    }
    const visible =
      wantedPost.status === "active" &&
      wantedPost.currentPublicVersion.status === "approved";

    await this.prisma.searchIndexDocument.upsert({
      where: {
        targetType_targetId: {
          targetType: "wanted_post",
          targetId: wantedPost.id
        }
      },
      update: {
        contentVersionId: wantedPost.currentPublicVersion.id,
        communityId: wantedPost.communityId,
        visibilityStatus: visible ? "searchable" : "hidden",
        searchPayload: buildSearchPayload(
          wantedPost.currentPublicVersion,
          wantedPost.category
        ),
        searchText: buildSearchText(wantedPost.currentPublicVersion),
        category: wantedPost.category,
        sourceVersion: wantedPost.currentPublicVersion.versionNo,
        sourceCreatedAt: wantedPost.createdAt,
        auctionEndAt: null,
        bidCount: 0,
        favoriteCount: 0,
        indexedAt: new Date()
      },
      create: {
        targetType: "wanted_post",
        targetId: wantedPost.id,
        contentVersionId: wantedPost.currentPublicVersion.id,
        communityId: wantedPost.communityId,
        visibilityStatus: visible ? "searchable" : "hidden",
        searchPayload: buildSearchPayload(
          wantedPost.currentPublicVersion,
          wantedPost.category
        ),
        searchText: buildSearchText(wantedPost.currentPublicVersion),
        category: wantedPost.category,
        sourceVersion: wantedPost.currentPublicVersion.versionNo,
        sourceCreatedAt: wantedPost.createdAt,
        auctionEndAt: null,
        bidCount: 0,
        favoriteCount: 0
      }
    });

    return { result: "accepted" as const };
  }

  private async ensureCanBrowse(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    now?: Date;
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode:
          | "COMMUNITY_MEMBER_REQUIRED"
          | "SEARCH_NOT_ALLOWED"
          | "COMMUNITY_ID_REQUIRED";
      }
  > {
    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.childId,
      communityId: input.communityId,
      action: "browse_community",
      now: input.now
    });
    if (participation.result === "accepted") {
      return participation;
    }

    return {
      result: "rejected",
      errorCode:
        participation.errorCode === "COMMUNITY_MEMBER_REQUIRED"
          ? "COMMUNITY_MEMBER_REQUIRED"
          : participation.errorCode === "COMMUNITY_ID_REQUIRED"
            ? "COMMUNITY_ID_REQUIRED"
            : "SEARCH_NOT_ALLOWED"
    };
  }

  private async ensureCanFavorite(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    now?: Date;
  }): Promise<
    | { result: "accepted" }
    | {
        result: "rejected";
        errorCode:
          | "COMMUNITY_MEMBER_REQUIRED"
          | "FAVORITE_NOT_ALLOWED"
          | "ITEM_NOT_VISIBLE";
      }
  > {
    const participation = await this.participation.evaluateChildParticipation({
      actorUserId: input.actorUserId,
      childId: input.childId,
      communityId: input.communityId,
      action: "favorite",
      now: input.now
    });
    if (participation.result === "accepted") {
      return participation;
    }

    return {
      result: "rejected",
      errorCode:
        participation.errorCode === "COMMUNITY_MEMBER_REQUIRED"
          ? "COMMUNITY_MEMBER_REQUIRED"
          : "FAVORITE_NOT_ALLOWED"
    };
  }

  private async visibleCandidateForIndex(
    input: {
      actorUserId: string;
      childId: string;
      communityId: string;
    },
    candidate: SearchIndexDocument
  ): Promise<Stage7SearchResultItem | null> {
    if (candidate.targetType === "item") {
      return this.visibleItemSummary({
        actorUserId: input.actorUserId,
        childId: input.childId,
        communityId: input.communityId,
        itemId: candidate.targetId,
        expectedContentVersionId: candidate.contentVersionId
      });
    }

    return this.visibleWantedPostSummary({
      communityId: input.communityId,
      wantedPostId: candidate.targetId,
      expectedContentVersionId: candidate.contentVersionId
    });
  }

  private async visibleItemSummary(input: {
    actorUserId: string;
    childId: string;
    communityId: string;
    itemId: string;
    expectedContentVersionId?: string;
  }): Promise<Stage7SearchResultItem | null> {
    const item = await this.prisma.item.findUnique({
      where: { id: input.itemId },
      include: {
        currentPublicVersion: true,
        auctionSession: true
      }
    });
    if (
      !item ||
      item.communityId !== input.communityId ||
      !isVisibleItemStatus(item.status) ||
      !item.currentPublicVersion ||
      item.currentPublicVersion.status !== "approved" ||
      (input.expectedContentVersionId &&
        item.currentPublicVersionId !== input.expectedContentVersionId)
    ) {
      return null;
    }

    const [favoriteCount, bidCount, favorite] = await Promise.all([
      this.countItemFavorites(item.id),
      this.countItemBids(item.id),
      this.findFavorite(input.childId, item.id)
    ]);

    return {
      targetType: "item",
      targetId: item.id,
      communityId: item.communityId,
      contentVersionId: item.currentPublicVersion.id,
      title: item.currentPublicVersion.title ?? "",
      description: item.currentPublicVersion.description ?? "",
      category: null,
      targetVersion: item.currentPublicVersion.versionNo,
      sourceCreatedAt: item.createdAt.toISOString(),
      auctionEndAt: item.auctionSession?.endAt.toISOString() ?? null,
      bidCount,
      favoriteCount,
      isFavorited: favorite?.status === "active"
    };
  }

  private async visibleWantedPostSummary(input: {
    communityId: string;
    wantedPostId: string;
    expectedContentVersionId?: string;
  }): Promise<Stage7SearchResultItem | null> {
    const wantedPost = await this.prisma.wantedPost.findUnique({
      where: { id: input.wantedPostId },
      include: {
        currentPublicVersion: true
      }
    });
    if (
      !wantedPost ||
      wantedPost.communityId !== input.communityId ||
      wantedPost.status !== "active" ||
      !wantedPost.currentPublicVersion ||
      wantedPost.currentPublicVersion.status !== "approved" ||
      (input.expectedContentVersionId &&
        wantedPost.currentPublicVersionId !== input.expectedContentVersionId)
    ) {
      return null;
    }

    return {
      targetType: "wanted_post",
      targetId: wantedPost.id,
      communityId: wantedPost.communityId,
      contentVersionId: wantedPost.currentPublicVersion.id,
      title: wantedPost.currentPublicVersion.title ?? "",
      description: wantedPost.currentPublicVersion.description ?? "",
      category: wantedPost.category,
      targetVersion: wantedPost.currentPublicVersion.versionNo,
      sourceCreatedAt: wantedPost.createdAt.toISOString(),
      auctionEndAt: null,
      bidCount: 0,
      favoriteCount: 0,
      isFavorited: false
    };
  }

  private countItemFavorites(itemId: string) {
    return this.prisma.itemFavorite.count({
      where: {
        itemId,
        status: "active"
      }
    });
  }

  private async refreshItemFavoriteCount(itemId: string) {
    const favoriteCount = await this.countItemFavorites(itemId);
    await this.prisma.searchIndexDocument.updateMany({
      where: {
        targetType: "item",
        targetId: itemId
      },
      data: {
        favoriteCount
      }
    });
  }

  private countItemBids(itemId: string) {
    return this.prisma.bid.count({
      where: {
        auctionSession: {
          itemId
        }
      }
    });
  }

  private findFavorite(childId: string, itemId: string): Promise<ItemFavorite | null> {
    return this.prisma.itemFavorite.findUnique({
      where: {
        childId_itemId: {
          childId,
          itemId
        }
      }
    });
  }
}

function buildSearchCursorScope(
  input: {
    communityId: string;
    query?: string;
    category?: string;
    targetType?: SearchIndexTargetType;
  },
  sort: Stage7SearchSort
): SearchCursorScope {
  return {
    communityId: input.communityId,
    query: normalizeSearchQuery(input.query),
    category: normalizeOptionalString(input.category),
    targetType: input.targetType ?? null,
    sort
  };
}

function buildSearchCursorState(
  scope: SearchCursorScope,
  position: SearchCursorPosition,
  seenIds: string[]
): SearchCursorState {
  return {
    v: 1,
    scope,
    position,
    seenIds
  };
}

function searchCursorPositionFromDocument(
  document: SearchIndexDocument
): SearchCursorPosition {
  return {
    id: document.id,
    sourceCreatedAt: document.sourceCreatedAt.toISOString(),
    indexedAt: document.indexedAt.toISOString(),
    auctionEndAt: document.auctionEndAt?.toISOString() ?? null,
    bidCount: document.bidCount,
    favoriteCount: document.favoriteCount
  };
}

function encodeSearchCursor(cursor: SearchCursorState) {
  return `${SEARCH_CURSOR_PREFIX}${base64UrlEncode(JSON.stringify(cursor))}`;
}

function decodeSearchCursor(cursor: string): SearchCursorState | null {
  if (!cursor.startsWith(SEARCH_CURSOR_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      base64UrlDecode(cursor.slice(SEARCH_CURSOR_PREFIX.length))
    ) as unknown;
    return isSearchCursorState(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function searchCursorWhere(
  sort: Stage7SearchSort,
  position: SearchCursorPosition
): Prisma.SearchIndexDocumentWhereInput {
  const indexedAt = new Date(position.indexedAt);
  switch (sort) {
    case "ending_soon": {
      if (position.auctionEndAt === null) {
        return {
          OR: [
            {
              auctionEndAt: null,
              indexedAt: {
                lt: indexedAt
              }
            },
            {
              auctionEndAt: null,
              indexedAt,
              id: {
                lt: position.id
              }
            }
          ]
        };
      }

      const auctionEndAt = new Date(position.auctionEndAt);
      return {
        OR: [
          {
            auctionEndAt: {
              gt: auctionEndAt
            }
          },
          {
            auctionEndAt: null
          },
          {
            auctionEndAt,
            indexedAt: {
              lt: indexedAt
            }
          },
          {
            auctionEndAt,
            indexedAt,
            id: {
              lt: position.id
            }
          }
        ]
      };
    }
    case "bid_count":
      return {
        OR: [
          {
            bidCount: {
              lt: position.bidCount
            }
          },
          {
            bidCount: position.bidCount,
            indexedAt: {
              lt: indexedAt
            }
          },
          {
            bidCount: position.bidCount,
            indexedAt,
            id: {
              lt: position.id
            }
          }
        ]
      };
    case "popular":
      return {
        OR: [
          {
            favoriteCount: {
              lt: position.favoriteCount
            }
          },
          {
            favoriteCount: position.favoriteCount,
            bidCount: {
              lt: position.bidCount
            }
          },
          {
            favoriteCount: position.favoriteCount,
            bidCount: position.bidCount,
            indexedAt: {
              lt: indexedAt
            }
          },
          {
            favoriteCount: position.favoriteCount,
            bidCount: position.bidCount,
            indexedAt,
            id: {
              lt: position.id
            }
          }
        ]
      };
    case "latest":
    default: {
      const sourceCreatedAt = new Date(position.sourceCreatedAt);
      return {
        OR: [
          {
            sourceCreatedAt: {
              lt: sourceCreatedAt
            }
          },
          {
            sourceCreatedAt,
            indexedAt: {
              lt: indexedAt
            }
          },
          {
            sourceCreatedAt,
            indexedAt,
            id: {
              lt: position.id
            }
          }
        ]
      };
    }
  }
}

function searchCursorScopeMatches(
  actual: SearchCursorScope,
  expected: SearchCursorScope
) {
  return (
    actual.communityId === expected.communityId &&
    actual.query === expected.query &&
    actual.category === expected.category &&
    actual.targetType === expected.targetType &&
    actual.sort === expected.sort
  );
}

function searchDocumentMatchesScope(
  document: SearchIndexDocument,
  scope: SearchCursorScope
) {
  if (
    document.communityId !== scope.communityId ||
    document.visibilityStatus !== "searchable"
  ) {
    return false;
  }
  if (scope.targetType && document.targetType !== scope.targetType) {
    return false;
  }
  if (scope.category && document.category !== scope.category) {
    return false;
  }
  if (
    scope.query &&
    !document.searchText.toLowerCase().includes(scope.query)
  ) {
    return false;
  }

  return true;
}

function isSearchCursorState(input: unknown): input is SearchCursorState {
  if (!input || typeof input !== "object") {
    return false;
  }
  const cursor = input as Partial<SearchCursorState>;
  return (
    cursor.v === 1 &&
    isSearchCursorScope(cursor.scope) &&
    isSearchCursorPosition(cursor.position) &&
    Array.isArray(cursor.seenIds) &&
    cursor.seenIds.every((id) => typeof id === "string" && Boolean(id))
  );
}

function isSearchCursorScope(input: unknown): input is SearchCursorScope {
  if (!input || typeof input !== "object") {
    return false;
  }
  const scope = input as Partial<SearchCursorScope>;
  return (
    typeof scope.communityId === "string" &&
    Boolean(scope.communityId) &&
    (typeof scope.query === "string" || scope.query === null) &&
    (typeof scope.category === "string" || scope.category === null) &&
    (scope.targetType === "item" ||
      scope.targetType === "wanted_post" ||
      scope.targetType === null) &&
    isStage7SearchSort(scope.sort)
  );
}

function isSearchCursorPosition(input: unknown): input is SearchCursorPosition {
  if (!input || typeof input !== "object") {
    return false;
  }
  const position = input as Partial<SearchCursorPosition>;
  return (
    typeof position.id === "string" &&
    Boolean(position.id) &&
    isCursorDateString(position.sourceCreatedAt) &&
    isCursorDateString(position.indexedAt) &&
    (position.auctionEndAt === null ||
      isCursorDateString(position.auctionEndAt)) &&
    isNonNegativeInteger(position.bidCount) &&
    isNonNegativeInteger(position.favoriteCount)
  );
}

function isStage7SearchSort(value: unknown): value is Stage7SearchSort {
  return (
    value === "latest" ||
    value === "ending_soon" ||
    value === "bid_count" ||
    value === "popular"
  );
}

function isCursorDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0
  );
}

function normalizeSearchQuery(query?: string) {
  return normalizeOptionalString(query)?.toLowerCase() ?? null;
}

function normalizeOptionalString(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  return Buffer.from(padded, "base64").toString("utf8");
}

function orderByForSort(
  sort: Stage7SearchSort
): Prisma.SearchIndexDocumentOrderByWithRelationInput[] {
  switch (sort) {
    case "ending_soon":
      return [
        {
          auctionEndAt: {
            sort: "asc",
            nulls: "last"
          }
        },
        { indexedAt: "desc" },
        { id: "desc" }
      ];
    case "bid_count":
      return [{ bidCount: "desc" }, { indexedAt: "desc" }, { id: "desc" }];
    case "popular":
      return [
        { favoriteCount: "desc" },
        { bidCount: "desc" },
        { indexedAt: "desc" },
        { id: "desc" }
      ];
    case "latest":
    default:
      return [{ sourceCreatedAt: "desc" }, { indexedAt: "desc" }, { id: "desc" }];
  }
}

function clampLimit(limit?: number) {
  if (!Number.isFinite(limit)) {
    return 20;
  }

  return Math.min(50, Math.max(1, Math.trunc(limit ?? 20)));
}

function isVisibleItemStatus(status: string) {
  return status === "approved" || status === "listed";
}

function buildSearchText(contentVersion: {
  title: string | null;
  description: string | null;
}) {
  return `${contentVersion.title ?? ""} ${contentVersion.description ?? ""}`
    .trim()
    .toLowerCase();
}

function buildSearchPayload(
  contentVersion: {
    title: string | null;
    description: string | null;
    versionNo: number;
  },
  category: string | null
): Prisma.InputJsonValue {
  return {
    title: contentVersion.title ?? "",
    description: contentVersion.description ?? "",
    category,
    versionNo: contentVersion.versionNo
  };
}
