import {
  buildMiniprogramHealthCheckUrl,
  checkMiniprogramApiConnectivity
} from "../../src/api-connectivity.js";
import { stage1AppConfig } from "../../app.js";

type MiniprogramPageRuntime = {
  setData?: (data: Record<string, unknown>) => void;
};

type MiniprogramRequest = (input: {
  url: string;
}) => Promise<{ statusCode: number; data: unknown }>;

type Stage1HealthPage = MiniprogramPageRuntime & {
  data: {
    status: "ready" | "unready";
    apiBaseUrl: string;
    healthUrl: string;
  };
  onLoad(this: Stage1HealthPage): Promise<void>;
  refreshHealth(
    this: Stage1HealthPage,
    request?: MiniprogramRequest
  ): Promise<"ready" | "unready">;
};

export const stage1HealthPage: Stage1HealthPage = {
  data: {
    status: "unready",
    apiBaseUrl: stage1AppConfig.globalData.apiBaseUrl,
    healthUrl: buildMiniprogramHealthCheckUrl(
      stage1AppConfig.globalData.apiBaseUrl
    )
  },
  async onLoad(this: Stage1HealthPage) {
    await this.refreshHealth();
  },
  async refreshHealth(
    this: Stage1HealthPage,
    request: MiniprogramRequest = requestWithWx
  ) {
    const status = await checkMiniprogramApiConnectivity(
      this.data.apiBaseUrl,
      request
    );
    this.setData?.({ status });
    return status;
  }
};

const wechatRuntime = globalThis as typeof globalThis & {
  Page?: (config: Record<string, unknown>) => void;
  wx?: {
    request: (input: {
      url: string;
      success: (response: { statusCode: number; data: unknown }) => void;
      fail: (error: unknown) => void;
    }) => void;
  };
};

wechatRuntime.Page?.(stage1HealthPage);

function requestWithWx(input: {
  url: string;
}): Promise<{ statusCode: number; data: unknown }> {
  if (!wechatRuntime.wx?.request) {
    return Promise.resolve({
      statusCode: 0,
      data: null
    });
  }

  return new Promise((resolve, reject) => {
    wechatRuntime.wx?.request({
      url: input.url,
      success: resolve,
      fail: reject
    });
  });
}
