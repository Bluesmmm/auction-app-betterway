export function buildAdminHealthCheckUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/health`;
}

export async function checkAdminApiConnectivity(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<"ready" | "unready"> {
  const response = await fetcher(buildAdminHealthCheckUrl(apiBaseUrl));

  if (!response.ok) {
    return "unready";
  }

  const payload = (await response.json()) as { status?: string };
  return payload.status === "ok" || payload.status === "degraded"
    ? "ready"
    : "unready";
}
