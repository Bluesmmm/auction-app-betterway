import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query
} from "@nestjs/common";
import "reflect-metadata";
import {
  authenticateBearerSession,
  type AuthenticatedActor
} from "../accounts/controller-auth.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { ContentFileAccessService } from "./content-file-access.service.js";
import { ContentReviewService, type ItemImageInput } from "./content-review.service.js";
import { ContentVisibilityService } from "./content-visibility.service.js";
import { MediaUploadService } from "./media-upload.service.js";

type WriteResponseMeta = {
  now: Date;
  targetType: string;
  targetId: string;
  latestStatus: string;
  targetVersion?: number;
};

export class ContentController {
  constructor(
    private readonly uploads: MediaUploadService,
    private readonly reviews: ContentReviewService,
    private readonly visibility: ContentVisibilityService,
    private readonly fileAccess: ContentFileAccessService,
    private readonly sessionTokens: SessionTokenService,
    private readonly sessions: SessionService
  ) {}

  async createTempMedia(
    body: {
      storageBucket: string;
      storageKey: string;
      mimeType: string;
      detectedMimeType: string;
      sizeBytes: number;
      pixelWidth: number;
      pixelHeight: number;
      checksum: string;
      metadataPrivacyCleared: boolean;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.uploads.createTempPrivateMedia({
      actorUserId: actor.userId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "media_asset",
        targetId: result.result === "accepted" ? result.mediaAssetId : actor.userId,
        latestStatus:
          result.result === "accepted" ? result.visibility : "rejected"
      },
      result
    );
  }

  async submitItem(
    body: {
      childId: string;
      communityId: string;
      title: string;
      description: string;
      startPoints: number;
      minIncrementPoints: number;
      images: ItemImageInput[];
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.submitItem({
      actorUserId: actor.userId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "item",
        targetId: result.result === "accepted" ? result.itemId : body.childId,
        latestStatus: result.result === "accepted" ? result.itemStatus : "rejected"
      },
      result
    );
  }

  async editItem(
    itemId: string,
    body: {
      childId: string;
      communityId: string;
      title: string;
      description: string;
      images: ItemImageInput[];
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.editItem({
      actorUserId: actor.userId,
      itemId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "item",
        targetId: itemId,
        latestStatus:
          result.result === "accepted" ? result.contentVersionStatus : "rejected",
        targetVersion: result.result === "accepted" ? result.versionNo : 1
      },
      result
    );
  }

  async submitWantedPost(
    body: {
      childId: string;
      communityId: string;
      title: string;
      description: string;
      category?: string;
      images: ItemImageInput[];
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.submitWantedPost({
      actorUserId: actor.userId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "wanted_request",
        targetId:
          result.result === "accepted" ? result.wantedPostId : body.childId,
        latestStatus:
          result.result === "accepted"
            ? result.wantedPostStatus
            : "rejected"
      },
      result
    );
  }

  async editWantedPost(
    wantedPostId: string,
    body: {
      childId: string;
      communityId: string;
      title: string;
      description: string;
      category?: string;
      images: ItemImageInput[];
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.editWantedPost({
      actorUserId: actor.userId,
      wantedPostId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "wanted_request",
        targetId: wantedPostId,
        latestStatus:
          result.result === "accepted"
            ? result.contentVersionStatus
            : "rejected"
      },
      result
    );
  }

  async submitWantedResponse(
    wantedPostId: string,
    body: {
      responderChildId: string;
      communityId: string;
      title: string;
      description: string;
      images: ItemImageInput[];
      idempotencyKey: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.submitWantedResponse({
      actorUserId: actor.userId,
      wantedPostId,
      ...body,
      now
    });

    return writeResponse(
      {
        now,
        targetType: "wanted_response",
        targetId:
          result.result === "accepted"
            ? result.wantedResponseId
            : wantedPostId,
        latestStatus:
          result.result === "accepted"
            ? result.wantedResponseStatus
            : "rejected"
      },
      result
    );
  }

  async listModerationQueue(communityId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.reviews.listModerationQueue({
      actorUserId: actor.userId,
      communityId
    });
  }

  async getModerationTask(taskId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.reviews.getModerationTask({
      actorUserId: actor.userId,
      taskId
    });
  }

  async processModerationTask(taskId: string, authorization?: string) {
    const now = new Date();
    await this.authenticate(authorization, now);
    const result = await this.reviews.processModerationTask({ taskId, now });
    return writeResponse(
      {
        now,
        targetType: "moderation_task",
        targetId: taskId,
        latestStatus:
          result.result === "accepted" ? result.taskStatus : "rejected"
      },
      result
    );
  }

  async retryModerationTask(taskId: string, authorization?: string) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.retryModerationTask({
      actorUserId: actor.userId,
      taskId,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "moderation_task",
        targetId: taskId,
        latestStatus:
          result.result === "accepted" ? result.taskStatus : "rejected"
      },
      result
    );
  }

  async reviewModerationTask(
    taskId: string,
    body: {
      decision: "approve" | "reject" | "escalate";
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.reviewModerationTask({
      actorUserId: actor.userId,
      taskId,
      decision: body.decision,
      reason: body.reason,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "moderation_task",
        targetId: taskId,
        latestStatus:
          result.result === "accepted" ? result.taskStatus : "rejected"
      },
      result
    );
  }

  async platformReviewModerationTask(
    taskId: string,
    body: {
      decision: "block" | "reject";
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.platformReviewModerationTask({
      actorUserId: actor.userId,
      taskId,
      decision: body.decision,
      reason: body.reason,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "moderation_task",
        targetId: taskId,
        latestStatus:
          result.result === "accepted" ? result.taskStatus : "rejected"
      },
      result
    );
  }

  async getVisibleItemDetail(
    communityId: string,
    itemId: string,
    childId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.visibility.getVisibleItemDetail({
      actorUserId: actor.userId,
      childId,
      communityId,
      itemId,
      now
    });
  }

  async getVisibleWantedPostDetail(
    communityId: string,
    wantedPostId: string,
    childId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.visibility.getVisibleWantedPostDetail({
      actorUserId: actor.userId,
      childId,
      communityId,
      wantedPostId,
      now
    });
  }

  async getVisibleWantedResponseDetail(
    communityId: string,
    wantedResponseId: string,
    childId: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.visibility.getVisibleWantedResponseDetail({
      actorUserId: actor.userId,
      childId,
      communityId,
      wantedResponseId,
      now
    });
  }

  async delistItem(
    itemId: string,
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.delistItem({
      actorUserId: actor.userId,
      itemId,
      reason: body.reason,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "item",
        targetId: itemId,
        latestStatus:
          result.result === "accepted" ? result.itemStatus : "rejected"
      },
      result
    );
  }

  async delistWantedPost(
    wantedPostId: string,
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.delistWantedPost({
      actorUserId: actor.userId,
      wantedPostId,
      reason: body.reason,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "wanted_request",
        targetId: wantedPostId,
        latestStatus:
          result.result === "accepted" ? result.wantedPostStatus : "rejected"
      },
      result
    );
  }

  async cancelWantedResponse(
    wantedResponseId: string,
    body: {
      reason: string;
    },
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    const result = await this.reviews.cancelWantedResponse({
      actorUserId: actor.userId,
      wantedResponseId,
      reason: body.reason,
      now
    });
    return writeResponse(
      {
        now,
        targetType: "wanted_response",
        targetId: wantedResponseId,
        latestStatus:
          result.result === "accepted"
            ? result.wantedResponseStatus
            : "rejected"
      },
      result
    );
  }

  async verifyFileGrant(
    grantToken: string,
    purpose: string,
    authorization?: string
  ) {
    const now = new Date();
    const actor = await this.authenticate(authorization, now);
    return this.fileAccess.verifyItemImageGrant({
      grantToken,
      granteeUserId: actor.userId,
      purpose,
      now
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

defineConstructorParamTypes(ContentController, [
  MediaUploadService,
  ContentReviewService,
  ContentVisibilityService,
  ContentFileAccessService,
  SessionTokenService,
  SessionService
]);
Controller("content")(ContentController);
applyMethodDecorator(Post("media-assets"), ContentController.prototype, "createTempMedia");
applyMethodDecorator(Post("items"), ContentController.prototype, "submitItem");
applyMethodDecorator(
  Post("items/:itemId/versions"),
  ContentController.prototype,
  "editItem"
);
applyMethodDecorator(Post("wanted-posts"), ContentController.prototype, "submitWantedPost");
applyMethodDecorator(
  Post("wanted-posts/:wantedPostId/versions"),
  ContentController.prototype,
  "editWantedPost"
);
applyMethodDecorator(
  Post("wanted-posts/:wantedPostId/responses"),
  ContentController.prototype,
  "submitWantedResponse"
);
applyMethodDecorator(
  Get("communities/:communityId/moderation-tasks"),
  ContentController.prototype,
  "listModerationQueue"
);
applyMethodDecorator(
  Get("moderation-tasks/:taskId"),
  ContentController.prototype,
  "getModerationTask"
);
applyMethodDecorator(
  Post("moderation-tasks/:taskId/process"),
  ContentController.prototype,
  "processModerationTask"
);
applyMethodDecorator(
  Post("moderation-tasks/:taskId/retry"),
  ContentController.prototype,
  "retryModerationTask"
);
applyMethodDecorator(
  Post("moderation-tasks/:taskId/review"),
  ContentController.prototype,
  "reviewModerationTask"
);
applyMethodDecorator(
  Post("moderation-tasks/:taskId/platform-review"),
  ContentController.prototype,
  "platformReviewModerationTask"
);
applyMethodDecorator(
  Get("communities/:communityId/items/:itemId/visible-detail"),
  ContentController.prototype,
  "getVisibleItemDetail"
);
applyMethodDecorator(
  Get("communities/:communityId/wanted-posts/:wantedPostId/visible-detail"),
  ContentController.prototype,
  "getVisibleWantedPostDetail"
);
applyMethodDecorator(
  Get("communities/:communityId/wanted-responses/:wantedResponseId/visible-detail"),
  ContentController.prototype,
  "getVisibleWantedResponseDetail"
);
applyMethodDecorator(Post("items/:itemId/delist"), ContentController.prototype, "delistItem");
applyMethodDecorator(
  Post("wanted-posts/:wantedPostId/delist"),
  ContentController.prototype,
  "delistWantedPost"
);
applyMethodDecorator(
  Post("wanted-responses/:wantedResponseId/cancel"),
  ContentController.prototype,
  "cancelWantedResponse"
);
applyMethodDecorator(Get("file-grants/verify"), ContentController.prototype, "verifyFileGrant");

applyParameterDecorator(Body(), ContentController.prototype, "createTempMedia", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "createTempMedia", 1);
applyParameterDecorator(Body(), ContentController.prototype, "submitItem", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "submitItem", 1);
applyParameterDecorator(Param("itemId"), ContentController.prototype, "editItem", 0);
applyParameterDecorator(Body(), ContentController.prototype, "editItem", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "editItem", 2);
applyParameterDecorator(Body(), ContentController.prototype, "submitWantedPost", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "submitWantedPost", 1);
applyParameterDecorator(Param("wantedPostId"), ContentController.prototype, "editWantedPost", 0);
applyParameterDecorator(Body(), ContentController.prototype, "editWantedPost", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "editWantedPost", 2);
applyParameterDecorator(Param("wantedPostId"), ContentController.prototype, "submitWantedResponse", 0);
applyParameterDecorator(Body(), ContentController.prototype, "submitWantedResponse", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "submitWantedResponse", 2);
applyParameterDecorator(Param("communityId"), ContentController.prototype, "listModerationQueue", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "listModerationQueue", 1);
applyParameterDecorator(Param("taskId"), ContentController.prototype, "getModerationTask", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "getModerationTask", 1);
applyParameterDecorator(Param("taskId"), ContentController.prototype, "processModerationTask", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "processModerationTask", 1);
applyParameterDecorator(Param("taskId"), ContentController.prototype, "retryModerationTask", 0);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "retryModerationTask", 1);
applyParameterDecorator(Param("taskId"), ContentController.prototype, "reviewModerationTask", 0);
applyParameterDecorator(Body(), ContentController.prototype, "reviewModerationTask", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "reviewModerationTask", 2);
applyParameterDecorator(Param("taskId"), ContentController.prototype, "platformReviewModerationTask", 0);
applyParameterDecorator(Body(), ContentController.prototype, "platformReviewModerationTask", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "platformReviewModerationTask", 2);
applyParameterDecorator(Param("communityId"), ContentController.prototype, "getVisibleItemDetail", 0);
applyParameterDecorator(Param("itemId"), ContentController.prototype, "getVisibleItemDetail", 1);
applyParameterDecorator(Query("childId"), ContentController.prototype, "getVisibleItemDetail", 2);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "getVisibleItemDetail", 3);
applyParameterDecorator(Param("communityId"), ContentController.prototype, "getVisibleWantedPostDetail", 0);
applyParameterDecorator(Param("wantedPostId"), ContentController.prototype, "getVisibleWantedPostDetail", 1);
applyParameterDecorator(Query("childId"), ContentController.prototype, "getVisibleWantedPostDetail", 2);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "getVisibleWantedPostDetail", 3);
applyParameterDecorator(Param("communityId"), ContentController.prototype, "getVisibleWantedResponseDetail", 0);
applyParameterDecorator(Param("wantedResponseId"), ContentController.prototype, "getVisibleWantedResponseDetail", 1);
applyParameterDecorator(Query("childId"), ContentController.prototype, "getVisibleWantedResponseDetail", 2);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "getVisibleWantedResponseDetail", 3);
applyParameterDecorator(Param("itemId"), ContentController.prototype, "delistItem", 0);
applyParameterDecorator(Body(), ContentController.prototype, "delistItem", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "delistItem", 2);
applyParameterDecorator(Param("wantedPostId"), ContentController.prototype, "delistWantedPost", 0);
applyParameterDecorator(Body(), ContentController.prototype, "delistWantedPost", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "delistWantedPost", 2);
applyParameterDecorator(Param("wantedResponseId"), ContentController.prototype, "cancelWantedResponse", 0);
applyParameterDecorator(Body(), ContentController.prototype, "cancelWantedResponse", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "cancelWantedResponse", 2);
applyParameterDecorator(Query("grant"), ContentController.prototype, "verifyFileGrant", 0);
applyParameterDecorator(Query("purpose"), ContentController.prototype, "verifyFileGrant", 1);
applyParameterDecorator(Headers("authorization"), ContentController.prototype, "verifyFileGrant", 2);

function writeResponse<T extends Record<string, unknown>>(
  meta: WriteResponseMeta,
  payload: T
) {
  return {
    serverTime: meta.now.toISOString(),
    targetType: meta.targetType,
    targetId: meta.targetId,
    targetVersion: meta.targetVersion ?? 1,
    latestStatus: meta.latestStatus,
    result: payload.result ?? "accepted",
    refreshRequired: false,
    ...payload
  };
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
