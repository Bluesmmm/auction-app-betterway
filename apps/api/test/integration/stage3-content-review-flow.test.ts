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
      prisma.aiReviewResult.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        provider: "fake_content_safety",
        providerStatus: "failed",
        failureReason: "CONTENT_SAFETY_UNAVAILABLE"
      })
    );
    await expect(
      service.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "approve",
        reason: "failed tasks cannot be approved",
        now: new Date("2026-06-02T12:00:30.000Z")
      })
    ).resolves.toEqual({
      result: "rejected",
      errorCode: "FAILED_TASK_REQUIRES_RETRY"
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
      prisma.aiReviewResult.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: "success",
        riskLevel: "low",
        labelsJson: []
      })
    );
    const detail = await service.getModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: submitted.moderationTaskId
    });
    expect(detail).toEqual(
      expect.objectContaining({
        result: "accepted",
        aiEvidence: expect.arrayContaining([
          expect.objectContaining({
            provider: "fake_content_safety",
            providerStatus: "success"
          })
        ]),
        originalImageGrants: expect.arrayContaining([
          expect.objectContaining({
            mediaRole: "front",
            url: expect.stringContaining("grant=")
          })
        ]),
        versionDiff: expect.objectContaining({
          previousApprovedVersion: null,
          changedFields: []
        })
      })
    );
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
    await expect(
      prisma.manualReviewRecord.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        reviewerUserId: fixture.activityAdminUserId,
        decision: "approve",
        reason: "safe low risk item"
      })
    );
  });

  it("submits, reviews, and exposes a wanted post through approved content versions only", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "wanted-post"
    );
    const review = createReviewService(fixture);
    const submitted = await submitValidWantedPost(
      review,
      fixture,
      media,
      "wanted-post"
    );

    await review.processModerationTask({ taskId: submitted.moderationTaskId });
    await expect(
      review.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "approve",
        reason: "safe wanted post",
        now: new Date("2026-06-02T12:30:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        taskStatus: "approved",
        contentVersionStatus: "approved"
      })
    );

    const visibility = new ContentVisibilityService(
      prisma,
      fixture.participation,
      "stage3-grant-key"
    );
    await expect(
      visibility.getVisibleWantedPostDetail({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        wantedPostId: submitted.wantedPostId
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        wantedPostId: submitted.wantedPostId,
        title: "Wanted wanted-post",
        versionNo: 1,
        images: expect.arrayContaining([
          expect.objectContaining({ mediaRole: "front" })
        ])
      })
    );
  });

  it("submits, reviews, and exposes a wanted response only after the parent wanted post is active", async () => {
    const fixture = await createStage3Fixture(prisma);
    const review = createReviewService(fixture);
    const postMedia = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "wanted-response-parent"
    );
    const wantedPost = await submitValidWantedPost(
      review,
      fixture,
      postMedia,
      "wanted-response-parent"
    );
    await review.processModerationTask({ taskId: wantedPost.moderationTaskId });
    await review.reviewModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: wantedPost.moderationTaskId,
      decision: "approve",
      reason: "safe wanted parent",
      now: new Date("2026-06-02T12:40:00.000Z")
    });

    const responseMedia = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "wanted-response-child"
    );
    const response = await review.submitWantedResponse({
      actorUserId: fixture.guardianUserId,
      responderChildId: fixture.childId,
      communityId: fixture.communityId,
      wantedPostId: wantedPost.wantedPostId,
      title: "I have the book",
      description: "Clean copy",
      images: responseMedia.map((asset, index) => ({
        mediaAssetId: asset.id,
        mediaRole: itemImageRoles[index],
        sortOrder: index + 1
      })),
      idempotencyKey: `wanted-response-${fixture.childId}`
    });
    expect(response).toEqual(
      expect.objectContaining({
        result: "accepted",
        wantedResponseStatus: "reviewing"
      })
    );
    if (response.result !== "accepted") {
      throw new Error("expected wanted response accepted");
    }

    await review.processModerationTask({ taskId: response.moderationTaskId });
    await review.reviewModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: response.moderationTaskId,
      decision: "approve",
      reason: "safe wanted response",
      now: new Date("2026-06-02T12:45:00.000Z")
    });

    const visibility = new ContentVisibilityService(
      prisma,
      fixture.participation,
      "stage3-grant-key"
    );
    await expect(
      visibility.getVisibleWantedResponseDetail({
        actorUserId: fixture.guardianUserId,
        childId: fixture.childId,
        communityId: fixture.communityId,
        wantedResponseId: response.wantedResponseId
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        wantedResponseId: response.wantedResponseId,
        wantedPostId: wantedPost.wantedPostId,
        title: "I have the book"
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
      prisma.aiReviewResult.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: "success",
        riskLevel: "high",
        ocrText: "detected phone or wechat contact",
        labelsJson: expect.arrayContaining(["ocr_contact"])
      })
    );

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

    await expect(
      service.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "escalate",
        reason: "platform review required",
        now: new Date("2026-06-02T12:51:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        result: "accepted",
        taskStatus: "escalated",
        contentVersionStatus: "escalated"
      })
    );
    await expect(
      prisma.manualReviewRecord.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        decision: "escalate",
        reason: "platform review required"
      })
    );
  });

  it("does not allow activity admins to approve high risk wanted content", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "wanted-risk-high"
    );
    await prisma.mediaAsset.update({
      where: { id: media[0].id },
      data: { checksum: "risk:high:qr" }
    });
    const review = createReviewService(fixture);
    const submitted = await submitValidWantedPost(
      review,
      fixture,
      media,
      "wanted-risk-high"
    );

    await review.processModerationTask({ taskId: submitted.moderationTaskId });
    await expect(
      prisma.aiReviewResult.findFirst({
        where: { taskId: submitted.moderationTaskId }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: "success",
        riskLevel: "severe",
        qrOrBarcodeDetected: true,
        labelsJson: expect.arrayContaining(["qr_or_barcode"])
      })
    );

    await expect(
      review.reviewModerationTask({
        actorUserId: fixture.activityAdminUserId,
        taskId: submitted.moderationTaskId,
        decision: "approve",
        reason: "single reviewer cannot approve high risk wanted post",
        now: new Date("2026-06-02T12:50:00.000Z")
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
    if (edit.result !== "accepted") {
      throw new Error("expected edit accepted");
    }

    const editDetail = await review.getModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: edit.moderationTaskId
    });
    expect(editDetail).toEqual(
      expect.objectContaining({
        result: "accepted",
        versionDiff: expect.objectContaining({
          previousApprovedVersion: expect.objectContaining({
            versionNo: 1,
            title: "Toy visible-v1"
          }),
          currentSubmittedVersion: expect.objectContaining({
            versionNo: 2,
            title: "Edited title"
          }),
          changedFields: expect.arrayContaining([
            "title",
            "description",
            "payload"
          ])
        })
      })
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

  it("rejects old wanted post image grants after delist", async () => {
    const fixture = await createStage3Fixture(prisma);
    const media = await createTempMediaSet(
      prisma,
      fixture.guardianUserId,
      "wanted-delist"
    );
    const review = createReviewService(fixture);
    const submitted = await submitValidWantedPost(
      review,
      fixture,
      media,
      "wanted-delist"
    );
    await review.processModerationTask({ taskId: submitted.moderationTaskId });
    await review.reviewModerationTask({
      actorUserId: fixture.activityAdminUserId,
      taskId: submitted.moderationTaskId,
      decision: "approve",
      reason: "safe",
      now: new Date("2026-06-02T13:20:00.000Z")
    });

    const visibility = new ContentVisibilityService(
      prisma,
      fixture.participation,
      "stage3-grant-key"
    );
    const detail = await visibility.getVisibleWantedPostDetail({
      actorUserId: fixture.guardianUserId,
      childId: fixture.childId,
      communityId: fixture.communityId,
      wantedPostId: submitted.wantedPostId,
      now: new Date("2026-06-02T13:20:30.000Z")
    });
    if (detail.result !== "accepted") {
      throw new Error("expected visible wanted detail");
    }

    const grantToken = new URL(detail.images[0].url).searchParams.get("grant") ?? "";
    const fileAccess = new ContentFileAccessService(prisma, "stage3-grant-key");
    await review.delistWantedPost({
      actorUserId: fixture.activityAdminUserId,
      wantedPostId: submitted.wantedPostId,
      reason: "unsafe after review",
      now: new Date("2026-06-02T13:21:00.000Z")
    });

    await expect(
      fileAccess.verifyItemImageGrant({
        grantToken,
        granteeUserId: fixture.guardianUserId,
        purpose: "wanted_image_view",
        now: new Date("2026-06-02T13:21:30.000Z")
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

async function submitValidWantedPost(
  service: ContentReviewService,
  fixture: Stage3Fixture,
  media: { id: string }[],
  label: string
) {
  const result = await service.submitWantedPost({
    actorUserId: fixture.guardianUserId,
    childId: fixture.childId,
    communityId: fixture.communityId,
    title: `Wanted ${label}`,
    description: `Wanted description ${label}`,
    category: "book",
    images: media.map((asset, index) => ({
      mediaAssetId: asset.id,
      mediaRole: itemImageRoles[index],
      sortOrder: index + 1
    })),
    idempotencyKey: `wanted-${fixture.childId}-${label}`
  });
  if (result.result !== "accepted") {
    throw new Error("expected wanted post accepted");
  }
  return result;
}
