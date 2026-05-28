type MiniprogramRuntimeEnv = {
  API_BASE_URL?: string;
  MINIPROGRAM_API_BASE_URL?: string;
};

const wechatRuntime = globalThis as typeof globalThis & {
  App?: (config: Record<string, unknown>) => void;
  __AUCTION_MINIPROGRAM_CONFIG__?: {
    apiBaseUrl?: string;
  };
};

export function createStage1AppConfig(
  apiBaseUrl = resolveMiniprogramApiBaseUrl()
) {
  return {
    globalData: {
      apiBaseUrl
    }
  };
}

export const stage1AppConfig = createStage1AppConfig();

wechatRuntime.App?.(stage1AppConfig);

export function resolveMiniprogramApiBaseUrl(
  env = readMiniprogramRuntimeEnv()
): string {
  const apiBaseUrl =
    wechatRuntime.__AUCTION_MINIPROGRAM_CONFIG__?.apiBaseUrl ??
    env.MINIPROGRAM_API_BASE_URL ??
    env.API_BASE_URL;

  if (!apiBaseUrl) {
    throw new Error("MINIPROGRAM_API_BASE_URL or API_BASE_URL must be configured");
  }

  return apiBaseUrl;
}

function readMiniprogramRuntimeEnv(): MiniprogramRuntimeEnv {
  return typeof process === "undefined"
    ? {}
    : (process.env as MiniprogramRuntimeEnv);
}
