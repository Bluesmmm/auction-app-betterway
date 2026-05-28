export class AppConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get nodeEnv(): string {
    return this.env.NODE_ENV ?? "development";
  }

  get port(): number {
    return parsePort(this.env.PORT, 3000);
  }

  get databaseUrl(): string {
    return requireEnv(this.env, "DATABASE_URL");
  }

  get redisUrl(): string {
    return requireEnv(this.env, "REDIS_URL");
  }

  get workerName(): string {
    return requireEnv(this.env, "WORKER_NAME");
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

  get corsAllowedOrigins(): string[] {
    return parseStringList(this.env.CORS_ALLOWED_ORIGINS);
  }
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} must be configured`);
  }

  return value;
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

function parseStringList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
