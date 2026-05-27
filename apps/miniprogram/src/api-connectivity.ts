export function buildMiniprogramHealthCheckUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/health`;
}

export async function checkMiniprogramApiConnectivity(
  apiBaseUrl: string,
  request: (input: { url: string }) => Promise<{ statusCode: number; data: unknown }>
): Promise<"ready" | "unready"> {
  const response = await request({
    url: buildMiniprogramHealthCheckUrl(apiBaseUrl)
  });
  const data = response.data as { status?: string };

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return "unready";
  }

  return data.status === "ok" || data.status === "degraded" ? "ready" : "unready";
}
