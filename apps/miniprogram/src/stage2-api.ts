export type MiniprogramJsonMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export type MiniprogramJsonRequestOptions<TData = unknown> = {
  url: string;
  method: MiniprogramJsonMethod;
  data?: TData;
  header?: Record<string, string>;
};

export type MiniprogramJsonResponse<TResponse = unknown> = {
  statusCode: number;
  data: TResponse;
};

export type WechatLoginPayload = {
  code: string;
  deviceFingerprintHash: string;
  ipHash: string;
  userAgentHash: string;
};

export type GuardianOnboardingPayload = {
  accessToken: string;
  phoneHash: string;
  phoneLast4: string;
  consentVersion: string;
  consentedAt: string;
};

export type ChildOnboardingPayload = {
  accessToken: string;
  guardianId: string;
  displayName: string;
  gradeBand: string;
  idempotencyKey: string;
};

export type CommunityJoinPayload = {
  accessToken: string;
  childId: string;
  code: string;
  idempotencyKey: string;
};

export type GuardianJoinConfirmationPayload = {
  accessToken: string;
  communityId: string;
  childId: string;
};

export type SensitiveOperationChallengePayload = {
  accessToken: string;
  operationType: string;
  targetType: string;
  targetId: string;
};

export type SensitiveOperationChallengeVerificationPayload = {
  accessToken: string;
  challengeId: string;
  verificationCode: string;
};

export type Stage2RequestResult = {
  result?: "accepted" | "rejected";
  errorCode?: string;
};

type MiniprogramRequestTransport = (
  input: MiniprogramJsonRequestOptions
) => Promise<MiniprogramJsonResponse>;

const jsonHeaders = {
  "content-type": "application/json"
};

export function buildStage2ApiUrl(apiBaseUrl: string, pathname: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`;
}

export function buildWechatLoginRequest(
  apiBaseUrl: string,
  payload: WechatLoginPayload
): MiniprogramJsonRequestOptions<WechatLoginPayload> {
  return buildJsonPostRequest(
    buildStage2ApiUrl(apiBaseUrl, "/accounts/wechat-login"),
    payload
  );
}

export function buildGuardianOnboardingRequest(
  apiBaseUrl: string,
  payload: GuardianOnboardingPayload
): MiniprogramJsonRequestOptions<Omit<GuardianOnboardingPayload, "accessToken">> {
  const { accessToken, ...data } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(apiBaseUrl, "/accounts/guardian-profile"),
    data,
    accessToken
  );
}

export function buildChildOnboardingRequest(
  apiBaseUrl: string,
  payload: ChildOnboardingPayload
): MiniprogramJsonRequestOptions<Omit<ChildOnboardingPayload, "accessToken">> {
  const { accessToken, ...data } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(apiBaseUrl, "/accounts/children"),
    data,
    accessToken
  );
}

export function buildCommunityJoinRequest(
  apiBaseUrl: string,
  payload: CommunityJoinPayload
): MiniprogramJsonRequestOptions<Omit<CommunityJoinPayload, "accessToken">> {
  const { accessToken, ...data } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(apiBaseUrl, "/communities/join-requests"),
    data,
    accessToken
  );
}

export function buildGuardianJoinConfirmationRequest(
  apiBaseUrl: string,
  payload: GuardianJoinConfirmationPayload
): MiniprogramJsonRequestOptions<Record<string, never>> {
  const { accessToken, communityId, childId } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(
      apiBaseUrl,
      `/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(
        childId
      )}/guardian-confirm`
    ),
    {},
    accessToken
  );
}

export function buildSensitiveOperationChallengeRequest(
  apiBaseUrl: string,
  payload: SensitiveOperationChallengePayload
): MiniprogramJsonRequestOptions<
  Omit<SensitiveOperationChallengePayload, "accessToken">
> {
  const { accessToken, ...data } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(apiBaseUrl, "/accounts/sensitive-operation-challenges"),
    data,
    accessToken
  );
}

export function buildSensitiveOperationChallengeVerificationRequest(
  apiBaseUrl: string,
  payload: SensitiveOperationChallengeVerificationPayload
): MiniprogramJsonRequestOptions<
  Omit<SensitiveOperationChallengeVerificationPayload, "accessToken" | "challengeId">
> {
  const { accessToken, challengeId, ...data } = payload;
  return buildJsonPostRequest(
    buildStage2ApiUrl(
      apiBaseUrl,
      `/accounts/sensitive-operation-challenges/${encodeURIComponent(
        challengeId
      )}/verify`
    ),
    data,
    accessToken
  );
}

export async function requestJson<TResponse = unknown>(
  input: MiniprogramJsonRequestOptions,
  request: MiniprogramRequestTransport = requestWithWx
): Promise<MiniprogramJsonResponse<TResponse>> {
  const response = await request({
    ...input,
    header: {
      ...jsonHeaders,
      ...input.header
    }
  });

  return response as MiniprogramJsonResponse<TResponse>;
}

export function toStage2SubmissionStatus(
  response: MiniprogramJsonResponse<Stage2RequestResult>
): "accepted" | "rejected" {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return "rejected";
  }

  return response.data?.result === "rejected" ? "rejected" : "accepted";
}

function buildJsonPostRequest<TData>(
  url: string,
  data: TData,
  accessToken?: string
): MiniprogramJsonRequestOptions<TData> {
  return {
    url,
    method: "POST",
    data,
    header: {
      ...jsonHeaders,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    }
  };
}

const wechatRuntime = globalThis as typeof globalThis & {
  wx?: {
    request: (input: {
      url: string;
      method: MiniprogramJsonMethod;
      data?: unknown;
      header?: Record<string, string>;
      success: (response: MiniprogramJsonResponse) => void;
      fail: (error: unknown) => void;
    }) => void;
  };
};

function requestWithWx(
  input: MiniprogramJsonRequestOptions
): Promise<MiniprogramJsonResponse> {
  if (!wechatRuntime.wx?.request) {
    return Promise.resolve({
      statusCode: 0,
      data: null
    });
  }

  return new Promise((resolve, reject) => {
    wechatRuntime.wx?.request({
      url: input.url,
      method: input.method,
      data: input.data,
      header: input.header,
      success: resolve,
      fail: reject
    });
  });
}
