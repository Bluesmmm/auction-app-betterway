import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ContentFileAccessService } from "../../src/content/content-file-access.service.js";
import { ContentReviewService } from "../../src/content/content-review.service.js";
import { ContentVisibilityService } from "../../src/content/content-visibility.service.js";
import { FakeContentSafetyProvider } from "../../src/providers/fake-providers.js";
import {
  createStage3Fixture,
  createTempMediaSet,
  type Stage3Fixture
} from "./stage3-fixtures.js";

process.env.DATABASE_URL ??=
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const prisma = new PrismaClient();
const itemImageRoles = ["front", "back", "side", "detail"] as const;

describe("Stage 3 content review flow", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects item submission when child is not an active community member", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "inactive-member"
    );
    await prisma.communityMember.update({
      where: {
        communityId_childId: {
          communityId: fixture.communityId,
          childId: fixture.childId
        }
      },
      data: { status: "removed" }
    });

    const service = createReviewService(fixture);

    await expect(
      service.submitItem({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        title: "Toy car",
        description: "Clean toy car",
        startPoints: 10,
        minIncrementPoints: 1,
        images: media.map((asset, index) => ({
          mediaAssetId: asset.id,
          mediaRole: itemImageRoles[index],
          sortOrder: index + 1
        })),
        idempotencyKey: `submit-${fixture.childId}-removed`
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "COMMUNITY_MEMBER_REQUIRED"
    });
  });

  it("submits an item with exactly four temp private media and creates review facts", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "submit-ok"
    );
    const service = createReviewService(fixture);

    const result = await service.submitItem({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      communityId: fixture.communityId,
      title: "Toy car",
      description: "Clean toy car",
      startPoints: 10,
      minIncrementPoints: 1,
      images: media.map((asset, index) => ({
        mediaAssetId: asset.id,
        mediaRole: itemImageRoles[index],
        sortOrder: index + 1
      })),
      idempotencyKey: `submit-${fixture.childId}-ok`
    });

    expect(result).toEqual(
      expect.objectContaining({
        result: "accepted",
        itemStatus: "ai_reviewing",
        contentVersionStatus: "pending_ai",
        moderationTaskStatus: "pending"
      })
    );
    if (result.result !== "accepted") {
      throw new Error("expected accepted");
    }

    const mediaBindings = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "ContentVersionMedia"
      WHERE "contentVersionId" = ${result.contentVersionId}
    `;
    expect(Number(mediaBindings[0]?.count ?? 0n)).toBe(4);
    await expect(
      prisma.moderationTask.findUnique({
        where: { contentVersionId: result.contentVersionId }
      })
    ).resolves.toEqual(expect.objectContaining({ status: "pending" }));

    await expect(
      service.submitItem({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        title: "Second item",
        description: "Same images should be rejected",
        startPoints: 10,
        minIncrementPoints: 1,
        images: media.map((asset, index) => ({
          mediaAssetId: asset.id,
          mediaRole: itemImageRoles[index],
          sortOrder: index + 1
        })),
        idempotencyKey: `submit-${fixture.childId}-reuse`
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "MEDIA_ALREADY_CONSUMED"
    });
  });

  it("keeps provider failures invisible and allows explicit retry", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "provider-failure"
    );
    const service = createReviewService(
      fixture,
      new FakeContentSafetyProvider({ mode: "failure" })
    );
    const submitted = await submitValidStage3Item(
      service,
      fixture,
      media,
      "provider-failure"
    );

    await expect(
      service.processModerationTask({
        taskId: submitted.moderationTaskId,
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).resolves.toEqual({
      result: "accepted",
      taskStatus: "failed",
      contentVersionStatus: "pending_ai",
      errorCode: "CONTENT_SAFETY_UNAVAILABLE"
    });

    await expect(
      service.retryModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        now: new Date("2026-06-02T12:01:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({ result: "accepted", taskStatus: "pending" })
    );
  });

  it("requires manual review even for low risk AI results", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "low-risk"
    );
    const service = createReviewService(fixture);
    const submitted = await submitValidStage3Item(
      service,
      fixture,
      media,
      "low-risk"
    );

    await service.processModerationTask({ taskId: submitted.moderationTaskId });
    await expect(
      prisma.item.findUnique({ where: { id: submitted.itemId } })
    ).resolves.toEqual(expect.objectContaining({ currentPublicVersionId: null }));

    await expect(
      service.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "approve",
        reason: "safe low risk item",
        now: new Date("2026-06-02T12:10:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        taskStatus: "approved",
        contentVersionStatus: "approved"
      })
    );
  });

  it("does not allow activity admins to approve high or severe content", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "risk-high"
    );
    await prisma.mediaAsset.update({
      where: { id: media[0].id },
      data: { checksum: "risk:high:ocr-contact" }
    });
    const service = createReviewService(fixture);
    const submitted = await submitValidStage3Item(
      service,
      fixture,
      media,
      "high-risk"
    );

    await service.processModerationTask({ taskId: submitted.moderationTaskId });

    await expect(
      service.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "approve",
        reason: "single reviewer cannot approve high risk",
        now: new Date("2026-06-02T12:20:00.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "HIGH_RISK_REQUIRES_ESCALATION"
    });
  });

  it("keeps edited new versions invisible until manual approval", async () => {
    const fixture = await createStage3Fixture(prisma);
    const mediaV1 = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "visible-v1"
    );
    const review = createReviewService(fixture);
    const submitted = await submitValidStage3Item(
      review,
      fixture,
      mediaV1,
      "visible-v1"
    );
    await review.processModerationTask({ taskId: submitted.moderationTaskId });
    await review.reviewModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: submitted.moderationTaskId,
      decision: "approve",
      reason: "safe",
      now: new Date("2026-06-02T13:00:00.000Z")
    });

    const mediaV2 = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "visible-v2"
    );
    const edit = await review.editItem({
      actorUserId: fixture.guardianUserId,
      itemId: submitted.itemId,
      childId: fixture.childId,
      communityId: fixture.communityId,
      title: "Edited title",
      description: "Edited description",
      images: mediaV2.map((asset, index) => ({
        mediaAssetId: asset.id,
        mediaRole: itemImageRoles[index],
        sortOrder: index + 1
      })),
      idempotencyKey: `edit-${submitted.itemId}`
    });
    expect(edit).toEqual(
      expect.objectContaining({ result: "accepted", versionNo: 2 })
    );

    const visibility = new ContentVisibilityService(
      prisma,
      fixture.participation,
      "stage3-grant-key"
    );
    await expect(
      visibility.getVisibleItemDetail({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        itemId: submitted.itemId
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        title: "Toy visible-v1",
        versionNo: 1
      })
    );
  });

  it("rejects old image grants after delist", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "delist"
    );
    const review = createReviewService(fixture);
    const submitted = await submitValidStage3Item(
      review,
      fixture,
      media,
      "delist"
    );
    await review.processModerationTask({ taskId: submitted.moderationTaskId });
    await review.reviewModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: submitted.moderationTaskId,
      decision: "approve",
      reason: "safe",
      now: new Date("2026-06-02T13:10:00.000Z")
    });

    const visibility = new ContentVisibilityService(
      prisma,
      fixture.participation,
      "stage3-grant-key"
    );
    const detail = await visibility.getVisibleItemDetail({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      communityId: fixture.communityId,
      itemId: submitted.itemId,
      now: new Date("2026-06-02T13:10:30.000Z")
    });
    if (detail.result !== "accepted") {
      throw new Error("expected visible detail");
    }

    const grantToken = new URL(detail.images[0].url).searchParams.get("grant") ?? "";
    const fileAccess = new ContentFileAccessService(prisma, "stage3-grant-key");
    await review.delistItem({
      actorUserId: fixture.activityAdminUserId,
      itemId: submitted.itemId,
      reason: "unsafe after review",
      now: new Date("2026-06-02T13:11:00.000Z")
    });

    await expect(
      fileAccess.verifyItemImageGrant({
        grantToken,
        granteeUserId: fixture.guardianUserId,
        purpose: "item_image_view",
        now: new Date("2026-06-02T13:11:30.000Z")
      })
    ).resolves.toEqual({ result: "rejected", errorCode: "CONTENT_NOT_VISIBLE" });
  });
});

function createReviewService(
  fixture: Stage3Fixture,
  provider = new FakeContentSafetyProvider()
) {
  return new ContentReviewService(
    prisma,
    fixture.participation,
    fixture.adminAuthorizations,
    provider
  );
}

async function submitValidStage3Item(
  service: ContentReviewService,
  fixture: Stage3Fixture,
  media: { id: string }[],
  label: string
) {
  const result = await service.submitItem({
    actorUserId: fixture.guardianUserId,
    childId: fixture.childId,
    communityId: fixture.communityId,
    title: `Toy ${label}`,
    description: `Clean toy ${label}`,
    startPoints: 10,
    minIncrementPoints: 1,
    images: media.map((asset, index) => ({
      mediaAssetId: asset.id,
      mediaRole: itemImageRoles[index],
      sortOrder: index + 1
    })),
    idempotencyKey: `submit-${fixture.childId}-${label}`
  });
  if (result.result !== "accepted") {
    throw new Error("expected submit accepted");
  }
  return result;
}
