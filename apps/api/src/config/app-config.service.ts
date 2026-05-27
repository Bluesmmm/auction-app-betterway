const DEFAULT_DATABASE_URL =
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";
const DEFAULT_REDIS_URL = "redis://localhost:6379/0";
const DEFAULT_WORKER_NAME = "auction-worker-local";

export class AppConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get nodeEnv(): string {
    return this.env.NODE_ENV ?? "development";
  }

  get port(): number {
    return parsePort(this.env.PORT, 3000);
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  }

  get workerName(): string {
    return this.env.WORKER_NAME ?? DEFAULT_WORKER_NAME;
  }

  get workerHeartbeatKey(): string {
    return `auction:worker:${this.workerName}:heartbeat`;
  }

  get workerHeartbeatStaleAfterMs(): number {
    return parsePositiveInteger(
      this.env.WORKER_HEARTBEAT_STALE_AFTER_SECONDS,
      30
    ) * 1000;
  }
}

function parsePort(rawPort: string | undefined, defaultPort: number): number {
  if (rawPort === undefined || rawPort === "") {
    return defaultPort;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function parsePositiveInteger(
  rawValue: string | undefined,
  defaultValue: number
): number {
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("value must be a positive integer");
  }

  return value;
}
