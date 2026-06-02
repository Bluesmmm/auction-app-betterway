import { z } from "zod";

type Stage3Fetch = typeof fetch;

const trimmedStringSchema = z.string().trim().min(1);
const authSchema = z.object({
  accessToken: trimmedStringSchema
});

const reviewTaskRowSchema = z.object({
  key: trimmedStringSchema,
  taskId: trimmedStringSchema,
  contentVersionId: trimmedStringSchema,
  targetType: trimmedStringSchema,
  targetId: trimmedStringSchema,
  itemId: trimmedStringSchema.optional(),
  wantedPostId: trimmedStringSchema.optional(),
  wantedResponseId: trimmedStringSchema.optional(),
  parentWantedPostId: trimmedStringSchema.optional(),
  versionNo: z.number().int().positive(),
  title: z.string(),
  taskStatus: z.string(),
  riskLevel: z.string(),
  createdAt: z.string()
});

export const listContentReviewQueueResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    tasks: z.array(reviewTaskRowSchema)
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["COMMUNITY_ADMIN_REQUIRED"])
  })
]);

const taskDetailSchema = z.object({
  result: z.literal("accepted"),
  taskId: trimmedStringSchema,
  contentVersionId: trimmedStringSchema,
  targetType: trimmedStringSchema,
  targetId: trimmedStringSchema,
  itemId: trimmedStringSchema.optional(),
  wantedPostId: trimmedStringSchema.optional(),
  wantedResponseId: trimmedStringSchema.optional(),
  parentWantedPostId: trimmedStringSchema.optional(),
  versionNo: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  taskStatus: z.string(),
  riskLevel: z.string(),
  ruleTags: z.unknown(),
  images: z.array(
    z.object({
      mediaAssetId: trimmedStringSchema,
      mediaRole: z.string(),
      sortOrder: z.number().int().positive()
    })
  )
});

export const getContentReviewTaskResultSchema = z.union([
  taskDetailSchema,
  z.object({
    result: z.literal("rejected"),
    errorCode: z.enum(["COMMUNITY_ADMIN_REQUIRED", "MODERATION_TASK_NOT_FOUND"])
  })
]);

export const reviewContentTaskResultSchema = z.union([
  z.object({
    result: z.literal("accepted"),
    taskStatus: z.string(),
    contentVersionStatus: z.string()
  }),
  z.object({
    result: z.literal("rejected"),
    errorCode: z.string()
  })
]);

export type ListContentReviewQueueResult = z.infer<
  typeof listContentReviewQueueResultSchema
>;
export type GetContentReviewTaskResult = z.infer<
  typeof getContentReviewTaskResultSchema
>;
export type ReviewContentTaskResult = z.infer<typeof reviewContentTaskResultSchema>;

export type Stage3Auth = z.infer<typeof authSchema>;
export type ReviewContentTaskInput = Stage3Auth & {
  taskId: string;
  decision: "approve" | "reject" | "escalate";
  reason: string;
};

export async function listContentReviewQueue(
  apiBaseUrl: string,
  input: Stage3Auth & { communityId: string },
  fetcher: Stage3Fetch = fetch
): Promise<ListContentReviewQueueResult> {
  const auth = authSchema.parse(input);
  const response = await fetcher(
    buildStage3Url(
      apiBaseUrl,
      `/content/communities/${encodeURIComponent(input.communityId)}/moderation-tasks`
    ),
    {
      method: "GET",
      headers: authHeaders(auth.accessToken)
    }
  );
  return parseStage3Response(response, listContentReviewQueueResultSchema);
}

export async function getContentReviewTask(
  apiBaseUrl: string,
  input: Stage3Auth & { taskId: string },
  fetcher: Stage3Fetch = fetch
): Promise<GetContentReviewTaskResult> {
  const auth = authSchema.parse(input);
  const response = await fetcher(
    buildStage3Url(
      apiBaseUrl,
      `/content/moderation-tasks/${encodeURIComponent(input.taskId)}`
    ),
    {
      method: "GET",
      headers: authHeaders(auth.accessToken)
    }
  );
  return parseStage3Response(response, getContentReviewTaskResultSchema);
}

export async function reviewContentTask(
  apiBaseUrl: string,
  input: ReviewContentTaskInput,
  fetcher: Stage3Fetch = fetch
): Promise<ReviewContentTaskResult> {
  const auth = authSchema.parse(input);
  const response = await fetcher(
    buildStage3Url(
      apiBaseUrl,
      `/content/moderation-tasks/${encodeURIComponent(input.taskId)}/review`
    ),
    {
      method: "POST",
      headers: authHeaders(auth.accessToken),
      body: JSON.stringify({
        decision: input.decision,
        reason: input.reason
      })
    }
  );
  return parseStage3Response(response, reviewContentTaskResultSchema);
}

export async function retryContentTask(
  apiBaseUrl: string,
  input: Stage3Auth & { taskId: string },
  fetcher: Stage3Fetch = fetch
): Promise<ReviewContentTaskResult> {
  const auth = authSchema.parse(input);
  const response = await fetcher(
    buildStage3Url(
      apiBaseUrl,
      `/content/moderation-tasks/${encodeURIComponent(input.taskId)}/retry`
    ),
    {
      method: "POST",
      headers: authHeaders(auth.accessToken),
      body: JSON.stringify({})
    }
  );
  return parseStage3Response(response, reviewContentTaskResultSchema);
}

function buildStage3Url(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function authHeaders(accessToken: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`
  };
}

async function parseStage3Response<T>(
  response: Response,
  schema: z.ZodType<T>
): Promise<T> {
  const payload = await response.json();
  return schema.parse(payload);
}
