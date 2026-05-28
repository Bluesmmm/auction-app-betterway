import { buildAdminHealthCheckUrl } from "./api-connectivity.js";

type AdminRuntimeEnv = {
  API_BASE_URL?: string;
  VITE_API_BASE_URL?: string;
};

export type AdminStage1Skeleton = {
  app: "admin";
  surface: "stage1-admin-react-shell";
  healthUrl: string;
  highRiskGate: "mfa_required";
  stack: {
    ui: "react";
    bundler: "vite";
    designSystem: "antd";
    routing: "react-router";
    serverState: "tanstack-query";
    validation: "zod";
  };
};

export function createAdminStage1Skeleton(
  apiBaseUrl = resolveAdminApiBaseUrl()
): AdminStage1Skeleton {
  return {
    app: "admin",
    surface: "stage1-admin-react-shell",
    healthUrl: buildAdminHealthCheckUrl(apiBaseUrl),
    highRiskGate: "mfa_required",
    stack: {
      ui: "react",
      bundler: "vite",
      designSystem: "antd",
      routing: "react-router",
      serverState: "tanstack-query",
      validation: "zod"
    }
  };
}

export function resolveAdminApiBaseUrl(env = readAdminRuntimeEnv()): string {
  const apiBaseUrl = env.VITE_API_BASE_URL ?? env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL or API_BASE_URL must be configured");
  }

  return apiBaseUrl;
}

function readAdminRuntimeEnv(): AdminRuntimeEnv {
  const nodeEnv =
    typeof process === "undefined" ? {} : (process.env as AdminRuntimeEnv);
  const viteEnv =
    "env" in import.meta
      ? ((import.meta as ImportMeta & { env?: AdminRuntimeEnv }).env ?? {})
      : {};

  return {
    ...nodeEnv,
    ...viteEnv
  };
}
