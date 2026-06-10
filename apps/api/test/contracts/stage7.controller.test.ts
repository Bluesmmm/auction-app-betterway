import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionService } from "../../src/accounts/session.service.js";
import { SessionTokenService } from "../../src/accounts/session-token.service.js";
import { Stage7Controller } from "../../src/stage7/stage7.controller.js";
import type { Stage7DiscoveryService } from "../../src/stage7/stage7-discovery.service.js";

const tokens = new SessionTokenService("stage7-controller-test-key");

describe("Stage7Controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("searches with the bearer actor and explicit child/community scope", async () => {
    setServerTime("2026-06-09T11:00:00.000Z");
    const { controller, discovery } = createController();
    vi.mocked(discovery.searchCommunityContent).mockResolvedValue({
      result: "accepted",
      nextCursor: "cursor_2",
      results: [
        {
          targetType: "item",
          targetId: "item_1",
          communityId: "community_1",
          contentVersionId: "version_1",
          title: "科学书",
          description: "适合三年级",
          category: null,
          targetVersion: 3,
          sourceCreatedAt: "2026-06-09T09:00:00.000Z",
          auctionEndAt: "2026-06-09T12:00:00.000Z",
          bidCount: 2,
          favoriteCount: 5,
          isFavorited: true
        }
      ]
    });

    await expect(
      controller.search(
        {
          childId: "child_1",
          communityId: "community_1",
          q: "科学",
          targetType: "item",
          sort: "popular",
          limit: "12"
        },
        bearerToken("guardian_user_1", "session_1")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      serverTime: "2026-06-09T11:00:00.000Z",
      targetType: "stage7_search",
      targetId: "community_1",
      nextCursor: "cursor_2",
      results: [
        expect.objectContaining({
          targetId: "item_1",
          isFavorited: true
        })
      ]
    });
    expect(discovery.searchCommunityContent).toHaveBeenCalledWith({
      actorUserId: "guardian_user_1",
      childId: "child_1",
      communityId: "community_1",
      query: "科学",
      category: undefined,
      targetType: "item",
      sort: "popular",
      cursor: undefined,
      limit: 12,
      now: new Date("2026-06-09T11:00:00.000Z")
    });
  });

  it("favorites an item through the bearer actor only", async () => {
    setServerTime("2026-06-09T11:05:00.000Z");
    const { controller, discovery } = createController();
    vi.mocked(discovery.favoriteItem).mockResolvedValue({
      result: "accepted",
      itemId: "item_2",
      childId: "child_2",
      communityId: "community_2",
      status: "active"
    });

    await expect(
      controller.favoriteItem(
        "item_2",
        {
          childId: "child_2",
          communityId: "community_2"
        },
        bearerToken("guardian_user_2", "session_2")
      )
    ).resolves.toMatchObject({
      result: "accepted",
      targetType: "item_favorite",
      targetId: "item_2",
      status: "active"
    });
    expect(discovery.favoriteItem).toHaveBeenCalledWith({
      actorUserId: "guardian_user_2",
      childId: "child_2",
      communityId: "community_2",
      itemId: "item_2",
      now: new Date("2026-06-09T11:05:00.000Z")
    });
  });

  it("rejects missing child scope before search reaches the service", async () => {
    setServerTime("2026-06-09T11:10:00.000Z");
    const { controller, discovery } = createController();

    await expect(
      controller.search(
        {
          communityId: "community_3"
        },
        bearerToken("guardian_user_3", "session_3")
      )
    ).resolves.toMatchObject({
      result: "rejected",
      targetType: "stage7_search",
      errorCode: "CHILD_ID_REQUIRED"
    });
    expect(discovery.searchCommunityContent).not.toHaveBeenCalled();
  });

  it("returns service rejection codes for invisible favorites", async () => {
    setServerTime("2026-06-09T11:15:00.000Z");
    const { controller, discovery } = createController();
    vi.mocked(discovery.favoriteItem).mockResolvedValue({
      result: "rejected",
      errorCode: "ITEM_NOT_VISIBLE"
    });

    await expect(
      controller.favoriteItem(
        "item_4",
        {
          childId: "child_4",
          communityId: "community_4"
        },
        bearerToken("guardian_user_4", "session_4")
      )
    ).resolves.toEqual({
      result: "rejected",
      serverTime: "2026-06-09T11:15:00.000Z",
      targetType: "item_favorite",
      targetId: "item_4",
      targetVersion: 1,
      latestStatus: "rejected",
      refreshRequired: false,
      errorCode: "ITEM_NOT_VISIBLE"
    });
  });
});

function createController() {
  const sessions = {
    assertActiveSession: vi.fn().mockResolvedValue({
      result: "accepted"
    })
  } as unknown as SessionService;
  const discovery = {
    searchCommunityContent: vi.fn(),
    listFavoriteItems: vi.fn(),
    favoriteItem: vi.fn(),
    removeFavoriteItem: vi.fn()
  } as unknown as Stage7DiscoveryService;

  return {
    controller: new Stage7Controller(discovery, sessions, tokens),
    discovery
  };
}

function bearerToken(userId: string, sessionId: string) {
  const token = tokens.createAccessToken({
    userId,
    sessionId,
    expiresAt: new Date("2026-06-09T12:00:00.000Z")
  });
  return `Bearer ${token}`;
}

function setServerTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
