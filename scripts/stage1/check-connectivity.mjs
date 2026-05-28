import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const composeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.runtime.yml"];
const port = process.env.PORT ?? "3000";
const apiHealthUrl =
  process.env.STAGE1_API_HEALTH_URL ?? `http://localhost:${port}/health`;
const apiBaseUrl = buildApiBaseUrl(apiHealthUrl);
const workerName = process.env.WORKER_NAME ?? "auction-worker-runtime";
const workerHeartbeatKey = `auction:worker:${workerName}:heartbeat`;
const workerHeartbeatStaleAfterSeconds = Number(
  process.env.WORKER_HEARTBEAT_STALE_AFTER_SECONDS ??
    "30"
);

const requiredFiles = [
  "apps/api/dist/main.js",
  "apps/worker/dist/main.js",
  "apps/admin/dist/main.js",
  "apps/admin/dist/web/index.html",
  "apps/admin/package.json",
  "apps/admin/src/main.ts",
  "apps/admin/src/main.tsx",
  "apps/admin/src/App.tsx",
  "apps/admin/src/stage1-shell.ts",
  "apps/admin/src/api-connectivity.ts",
  "apps/admin/tsconfig.build.json",
  "apps/admin/vite.config.ts",
  "apps/miniprogram/app.json",
  "apps/miniprogram/app.ts",
  "apps/miniprogram/pages/health/index.json",
  "apps/miniprogram/pages/health/index.ts",
  "apps/miniprogram/project.config.json",
  "apps/miniprogram/src/api-connectivity.ts"
];

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    fail(`missing required runtime artifact: ${filePath}`);
  }
}

const clientRuntimeEnv = {
  API_BASE_URL: apiBaseUrl,
  VITE_API_BASE_URL: apiBaseUrl,
  MINIPROGRAM_API_BASE_URL: apiBaseUrl
};

assertAdminSkeleton(
  run(["node", "apps/admin/dist/main.js"], undefined, clientRuntimeEnv).stdout
);
assertMiniprogramSkeleton();

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
run(
  ["npm", "test", "--", "apps/api/test/runtime/client-connectivity.test.ts"],
  undefined,
  clientRuntimeEnv
);
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
      } else if (!payload.serverTime) {
        lastError = "API health serverTime is missing";
      } else if (payload.targetType !== "runtime_health") {
        lastError = `API health targetType is ${payload.targetType}`;
      } else if (payload.targetId !== "stage1-runtime") {
        lastError = `API health targetId is ${payload.targetId}`;
      } else if (!Number.isInteger(payload.targetVersion)) {
        lastError = "API health targetVersion is missing";
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

function assertAdminSkeleton(rawOutput) {
  try {
    const payload = JSON.parse(rawOutput);
    if (
      payload.app !== "admin" ||
      payload.surface !== "stage1-admin-react-shell" ||
      payload.highRiskGate !== "mfa_required" ||
      typeof payload.healthUrl !== "string" ||
      !payload.healthUrl.endsWith("/health")
    ) {
      fail(`admin stage1 shell returned unexpected payload: ${rawOutput}`);
    }
    if (
      payload.surface !== "stage1-admin-react-shell" ||
      payload.stack?.ui !== "react" ||
      payload.stack?.bundler !== "vite" ||
      payload.stack?.designSystem !== "antd" ||
      payload.stack?.routing !== "react-router" ||
      payload.stack?.serverState !== "tanstack-query" ||
      payload.stack?.validation !== "zod"
    ) {
      fail(`admin stage1 shell does not expose the required web stack: ${rawOutput}`);
    }
  } catch {
    fail(`admin stage1 shell did not emit JSON: ${rawOutput}`);
  }
}

function assertMiniprogramSkeleton() {
  const appConfig = JSON.parse(readFileSync("apps/miniprogram/app.json", "utf8"));
  const projectConfig = JSON.parse(
    readFileSync("apps/miniprogram/project.config.json", "utf8")
  );

  if (!appConfig.pages?.includes("pages/health/index")) {
    fail("miniprogram skeleton does not declare the health page");
  }

  if (projectConfig.miniprogramRoot !== ".") {
    fail("miniprogram project config must point at the local skeleton root");
  }
}

function run(command, expectStdout, env = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.error) {
    fail(`${command.join(" ")} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  if (expectStdout && !result.stdout.includes(expectStdout)) {
    fail(`${command.join(" ")} returned unexpected output: ${result.stdout}`);
  }

  return result;
}

function buildApiBaseUrl(healthUrl) {
  const url = new URL(healthUrl);
  url.pathname = url.pathname.replace(/\/health\/?$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
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
