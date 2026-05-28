export function buildMiniprogramHealthCheckUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/health`;
}

type Stage1HealthPayload = {
  status?: string;
  serverTime?: string;
  targetType?: string;
  targetId?: string;
  targetVersion?: number;
};

export async function checkMiniprogramApiConnectivity(
  apiBaseUrl: string,
  request: (input: { url: string }) => Promise<{ statusCode: number; data: unknown }>
): Promise<"ready" | "unready"> {
  const response = await request({
    url: buildMiniprogramHealthCheckUrl(apiBaseUrl)
  });
  const data = response.data as Stage1HealthPayload;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return "unready";
  }

  return isStage1HealthPayload(data) ? "ready" : "unready";
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
