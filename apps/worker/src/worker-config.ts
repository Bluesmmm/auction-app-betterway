export type RedisConnectionConfig = {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
};

export type WorkerRuntimeConfig = {
  databaseUrl: string;
  redisUrl: string;
  workerName: string;
  concurrency: number;
  ledgerCheckIntervalMs: number;
  outboxDispatchIntervalMs: number;
  outboxDispatchLimit: number;
  outboxDispatchLeaseMs: number;
  auctionSettlementScanIntervalMs: number;
  auctionSettlementScanLimit: number;
  transactionTimeoutScanIntervalMs: number;
  transactionTimeoutScanLimit: number;
  redis: RedisConnectionConfig;
};

export function loadWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerRuntimeConfig {
  const databaseUrl = requireEnv(env, "DATABASE_URL");
  const redisUrl = requireEnv(env, "REDIS_URL");

  return {
    databaseUrl,
    redisUrl,
    workerName: requireEnv(env, "WORKER_NAME"),
    concurrency: parseConcurrency(env.WORKER_CONCURRENCY),
    ledgerCheckIntervalMs:
      parsePositiveInteger(
        env.LEDGER_CHECK_INTERVAL_SECONDS,
        300,
        "LEDGER_CHECK_INTERVAL_SECONDS"
      ) * 1000,
    outboxDispatchIntervalMs:
      parsePositiveInteger(
        env.OUTBOX_DISPATCH_INTERVAL_SECONDS,
        10,
        "OUTBOX_DISPATCH_INTERVAL_SECONDS"
      ) * 1000,
    outboxDispatchLimit: parsePositiveInteger(
      env.OUTBOX_DISPATCH_LIMIT,
      50,
      "OUTBOX_DISPATCH_LIMIT"
    ),
    outboxDispatchLeaseMs:
      parsePositiveInteger(
        env.OUTBOX_DISPATCH_LEASE_SECONDS,
        300,
        "OUTBOX_DISPATCH_LEASE_SECONDS"
      ) * 1000,
    auctionSettlementScanIntervalMs:
      parsePositiveInteger(
        env.AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS,
        60,
        "AUCTION_SETTLEMENT_SCAN_INTERVAL_SECONDS"
      ) * 1000,
    auctionSettlementScanLimit: parsePositiveInteger(
      env.AUCTION_SETTLEMENT_SCAN_LIMIT,
      50,
      "AUCTION_SETTLEMENT_SCAN_LIMIT"
    ),
    transactionTimeoutScanIntervalMs:
      parsePositiveInteger(
        env.TRANSACTION_TIMEOUT_SCAN_INTERVAL_SECONDS,
        60,
        "TRANSACTION_TIMEOUT_SCAN_INTERVAL_SECONDS"
      ) * 1000,
    transactionTimeoutScanLimit: parsePositiveInteger(
      env.TRANSACTION_TIMEOUT_SCAN_LIMIT,
      50,
      "TRANSACTION_TIMEOUT_SCAN_LIMIT"
    ),
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

function parsePositiveInteger(
  rawValue: string | undefined,
  defaultValue: number,
  label: string
): number {
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }

  return value;
}
