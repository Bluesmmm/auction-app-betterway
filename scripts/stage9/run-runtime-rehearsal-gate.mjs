import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";

const composeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.runtime.yml"];
const dockerBin =
  process.env.STAGE9_DOCKER_BIN ??
  (existsSync("/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe")
    ? "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
    : "docker");
const envFile = `/tmp/stage9-runtime-rehearsal-${process.pid}.env`;
const wrapperDir = `/tmp/stage9-runtime-docker-${process.pid}`;
const authTokenSigningKey =
  process.env.AUTH_TOKEN_SIGNING_KEY ??
  "stage9-runtime-rehearsal-auth-token-signing-key";

writeFileSync(envFile, `AUTH_TOKEN_SIGNING_KEY=${authTokenSigningKey}\n`);
mkdirSync(wrapperDir, { recursive: true });
writeFileSync(
  `${wrapperDir}/docker`,
  [
    "#!/usr/bin/env bash",
    "if [ \"$1\" = \"compose\" ]; then",
    "  shift",
    `  exec ${shellQuote(dockerBin)} compose --env-file ${shellQuote(envFile)} "$@"`,
    "fi",
    `exec ${shellQuote(dockerBin)} "$@"`,
    ""
  ].join("\n"),
  { mode: 0o755 }
);

const dockerEnv = {
  AUTH_TOKEN_SIGNING_KEY: authTokenSigningKey,
  PATH: `${wrapperDir}:${process.env.PATH ?? ""}`
};

try {
  runCommand("npm", ["run", "db:generate"]);
  runCommand("node", ["scripts/stage9/ensure-prisma-runtime-engine.mjs"]);
  runCommand("npm", ["run", "build:runtime"]);
  runDockerCompose(["up", "-d", "postgres", "redis"]);
  runCommand("npm", ["run", "db:deploy"]);
  runDockerCompose(["up", "-d", "--force-recreate", "api", "worker"]);
  runCommand("node", ["scripts/stage1/check-connectivity.mjs"], dockerEnv);
  runCommand("node", ["scripts/stage1/scan-logs.mjs"]);
  runCommand("node", ["scripts/stage1/rehearse-backup-restore.mjs"], dockerEnv);
  runCommand("node", ["scripts/stage1/rehearse-migration.mjs"], dockerEnv);
  runCommand("node", ["scripts/stage1/rehearse-key-rotation.mjs"]);
  runCommand("npm", ["run", "stage9:ledger"]);
  runCommand("npm", ["run", "stage9:outbox-worker"]);
  runCommand("npm", ["run", "stage9:file-search-notification"]);
  runCommand("npm", ["run", "stage9:privacy-content"]);

  console.log("stage9 runtime rehearsal gate passed");
} finally {
  rmSync(wrapperDir, { recursive: true, force: true });
  rmSync(envFile, { force: true });
}

function runDockerCompose(args) {
  runCommand(dockerBin, ["compose", "--env-file", envFile, ...composeFiles, ...args], {
    AUTH_TOKEN_SIGNING_KEY: authTokenSigningKey
  });
}

function runCommand(binary, args, extraEnv = {}) {
  const result = spawnSync(binary, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...extraEnv
    }
  });

  if (result.status !== 0) {
    const error = new Error(`command failed: ${binary} ${args.join(" ")}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
