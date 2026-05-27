import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const composeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.staging.yml"];
const stagingEnv = readEnvFile(".env.staging.example");
const port = process.env.PORT ?? stagingEnv.PORT ?? "3000";
const apiHealthUrl =
  process.env.STAGE1_API_HEALTH_URL ?? `http://localhost:${port}/health`;
const workerName =
  process.env.WORKER_NAME ?? stagingEnv.WORKER_NAME ?? "auction-worker-local";
const workerHeartbeatKey = `auction:worker:${workerName}:heartbeat`;
const workerHeartbeatStaleAfterSeconds = Number(
  process.env.WORKER_HEARTBEAT_STALE_AFTER_SECONDS ??
    stagingEnv.WORKER_HEARTBEAT_STALE_AFTER_SECONDS ??
    "30"
);

const requiredFiles = [
  "apps/api/dist/main.js",
  "apps/worker/dist/main.js",
  "apps/admin/package.json",
  "apps/admin/src/api-connectivity.ts",
  "apps/miniprogram/project.config.json",
  "apps/miniprogram/src/api-connectivity.ts"
];

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    fail(`missing required runtime artifact: ${filePath}`);
  }
}

run(["docker", "compose", ...composeFiles, "ps"]);
run([
  "docker",
  "compose",
  ...composeFiles,
  "exec",
  "-T",
  "postgres",
  "pg_isready",
  "-U",
  "auction_app",
  "-d",
  "auction_app"
]);
run(
  [
    "docker",
    "compose",
    ...composeFiles,
    "exec",
    "-T",
    "redis",
    "redis-cli",
    "ping"
  ],
  "PONG"
);

const health = await waitForApiHealth(apiHealthUrl);
const heartbeat = run([
  "docker",
  "compose",
  ...composeFiles,
  "exec",
  "-T",
  "redis",
  "redis-cli",
  "get",
  workerHeartbeatKey
]).stdout.trim();

assertFreshHeartbeat(heartbeat);

console.log(
  `stage1 connectivity checks passed (${health.status}, ${apiHealthUrl}, ${workerName})`
);

async function waitForApiHealth(url) {
  let lastError = "API health did not respond";

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url);
      const payload = await response.json();

      if (!response.ok) {
        lastError = `API health returned HTTP ${response.status}`;
      } else if (payload.status !== "ok") {
        lastError = `API health is ${payload.status}: ${JSON.stringify(payload)}`;
      } else if (payload.database?.status !== "ready") {
        lastError = `database is ${payload.database?.status}`;
      } else if (!payload.database?.serverTime) {
        lastError = "database serverTime is missing";
      } else if (payload.redis?.status !== "ready") {
        lastError = `redis is ${payload.redis?.status}`;
      } else if (payload.worker?.status !== "ready") {
        lastError = `worker is ${payload.worker?.status}`;
      } else {
        return payload;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(500);
  }

  fail(`API health readiness failed at ${url}: ${lastError}`);
}

function assertFreshHeartbeat(rawHeartbeat) {
  if (!rawHeartbeat) {
    fail(`worker heartbeat is missing at ${workerHeartbeatKey}`);
  }

  const heartbeatAt = Number(rawHeartbeat);
  if (!Number.isFinite(heartbeatAt)) {
    fail(`worker heartbeat is not a timestamp: ${rawHeartbeat}`);
  }

  const heartbeatAgeMs = Date.now() - heartbeatAt;
  if (heartbeatAgeMs > workerHeartbeatStaleAfterSeconds * 1000) {
    fail(
      `worker heartbeat is stale at ${workerHeartbeatKey}: ${heartbeatAgeMs}ms old`
    );
  }
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          return [line, ""];
        }

        return [
          line.slice(0, separatorIndex),
          line.slice(separatorIndex + 1)
        ];
      })
  );
}

function run(command, expectStdout) {
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    fail(`${command.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  if (expectStdout && !result.stdout.includes(expectStdout)) {
    fail(`${command.join(" ")} returned unexpected output: ${result.stdout}`);
  }

  return result;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
