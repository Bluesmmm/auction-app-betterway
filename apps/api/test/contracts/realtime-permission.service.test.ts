import { describe, expect, it, vi } from "vitest";
import { RealtimePermissionService } from "../../src/realtime/realtime-permission.service.js";

describe("RealtimePermissionService", () => {
  it("authorizes auction rooms only after source visibility and child participation pass", async () => {
    const prisma = {
      auctionSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: "auction_1",
          item: {
            communityId: "community_1",
            status: "listed",
            currentPublicVersion: {
              status: "approved"
            }
          }
        })
      }
    };
    const participation = {
      evaluateChildParticipation: vi.fn().mockResolvedValue({
        result: "accepted"
      })
    };
    const permissions = new RealtimePermissionService(
      prisma as never,
      participation as never
    );

    await expect(
      permissions.authorizeRoom({
        actorUserId: "guardian_user_1",
        room: {
          kind: "auction",
          childId: "child_1",
          auctionSessionId: "auction_1"
        }
      })
    ).resolves.toEqual({
      result: "accepted",
      room: {
        kind: "auction",
        childId: "child_1",
        auctionSessionId: "auction_1"
      }
    });
    expect(participation.evaluateChildParticipation).toHaveBeenCalledWith({
      actorUserId: "guardian_user_1",
      childId: "child_1",
      communityId: "community_1",
      action: "browse_community",
      now: undefined
    });
  });

  it("rejects invisible auction rooms before creating a subscription", async () => {
    const permissions = new RealtimePermissionService(
      {
        auctionSession: {
          findUnique: vi.fn().mockResolvedValue({
            id: "auction_2",
            item: {
              communityId: "community_2",
              status: "delisted",
              currentPublicVersion: {
                status: "approved"
              }
            }
          })
        }
      } as never,
      {
        evaluateChildParticipation: vi.fn()
      } as never
    );

    await expect(
      permissions.authorizeRoom({
        actorUserId: "guardian_user_2",
        room: {
          kind: "auction",
          childId: "child_2",
          auctionSessionId: "auction_2"
        }
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "REALTIME_TARGET_NOT_VISIBLE"
    });
  });
});
