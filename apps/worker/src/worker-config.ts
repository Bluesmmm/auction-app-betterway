export type RedisConnectionConfig = {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
};

export type WorkerRuntimeConfig = {
  redisUrl: string;
  workerName: string;
  concurrency: number;
  redis: RedisConnectionConfig;
};

export function loadWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerRuntimeConfig {
  const redisUrl = requireEnv(env, "REDIS_URL");

  return {
    redisUrl,
    workerName: requireEnv(env, "WORKER_NAME"),
    concurrency: parseConcurrency(env.WORKER_CONCURRENCY),
    redis: parseRedisUrl(redisUrl)
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} must be configured`);
  }

  return value;
}

export function parseRedisUrl(redisUrl: string): RedisConnectionConfig {
  const url = new URL(redisUrl);

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  const dbFromPath = url.pathname.replace("/", "");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: dbFromPath ? Number(dbFromPath) : 0,
    maxRetriesPerRequest: null
  };
}

function parseConcurrency(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue === "") {
    return 5;
  }

  const concurrency = Number(rawValue);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error("WORKER_CONCURRENCY must be an integer between 1 and 50");
  }

  return concurrency;
}
