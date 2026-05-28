export function buildAdminHealthCheckUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/health`;
}

type Stage1HealthPayload = {
  status?: string;
  serverTime?: string;
  targetType?: string;
  targetId?: string;
  targetVersion?: number;
};

export async function checkAdminApiConnectivity(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<"ready" | "unready"> {
  const response = await fetcher(buildAdminHealthCheckUrl(apiBaseUrl));

  if (!response.ok) {
    return "unready";
  }

  const payload = (await response.json()) as Stage1HealthPayload;
  return isStage1HealthPayload(payload) ? "ready" : "unready";
}

function isStage1HealthPayload(payload: Stage1HealthPayload): boolean {
  const statusReady = payload.status === "ok" || payload.status === "degraded";

  return (
    statusReady &&
    typeof payload.serverTime === "string" &&
    payload.targetType === "runtime_health" &&
    payload.targetId === "stage1-runtime" &&
    typeof payload.targetVersion === "number" &&
    Number.isInteger(payload.targetVersion) &&
    payload.targetVersion > 0
  );
}
