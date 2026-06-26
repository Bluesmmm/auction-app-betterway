import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";

const composeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.candidate.yml"];
const dockerBin =
  process.env.AUCTION_DOCKER_BIN ??
  process.env.STAGE9_DOCKER_BIN ??
  (existsSync("/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe")
    ? "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
    : "docker");
const imageTag =
  process.env.STAGE9_CANDIDATE_IMAGE ??
  "auction-app-betterway:stage9-candidate";
const envFile = `/tmp/stage9-candidate-image-${process.pid}.env`;
const wrapperDir = `/tmp/stage9-candidate-image-docker-${process.pid}`;
const authTokenSigningKey =
  process.env.AUTH_TOKEN_SIGNING_KEY ??
  "stage9-candidate-image-auth-token-signing-key";

writeFileSync(
  envFile,
  [
    `AUTH_TOKEN_SIGNING_KEY=${authTokenSigningKey}`,
    `STAGE9_CANDIDATE_IMAGE=${imageTag}`,
    ""
  ].join("\n")
);
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
  STAGE9_CANDIDATE_IMAGE: imageTag,
  PATH: `${wrapperDir}:${process.env.PATH ?? ""}`
};

try {
  assertDockerAvailable();
  runCommand("npm", ["run", "db:generate"]);
  runCommand("node", ["scripts/stage9/ensure-prisma-runtime-engine.mjs"]);
  runCommand("npm", ["run", "build:runtime"]);
  runCommand(dockerBin, [
    "build",
    "-f",
    "Dockerfile.candidate",
    "-t",
    imageTag,
    "."
  ]);
  const imageId = runCapture(dockerBin, [
    "image",
    "inspect",
    imageTag,
    "--format",
    "{{.Id}}"
  ]).stdout.trim();

  runDockerCompose(["up", "-d", "postgres", "redis"]);
  runCommand("npm", ["run", "db:deploy"]);
  runDockerCompose(["up", "-d", "--force-recreate", "api", "worker"]);
  assertServiceImage("api", imageId);
  assertServiceImage("worker", imageId);
  runConnectivityCheck("candidate image initial runtime");

  runDockerCompose(["up", "-d", "--no-deps", "--force-recreate", "api"]);
  assertServiceImage("api", imageId);
  runConnectivityCheck("candidate image after api recreate");

  runDockerCompose(["up", "-d", "--no-deps", "--force-recreate", "worker"]);
  assertServiceImage("worker", imageId);
  runConnectivityCheck("candidate image after worker recreate");

  console.log(`stage9 candidate image gate passed (${imageTag})`);
} finally {
  rmSync(wrapperDir, { recursive: true, force: true });
  rmSync(envFile, { force: true });
}

function runConnectivityCheck(label) {
  console.log(`stage9 candidate image connectivity check: ${label}`);
  runCommand("node", ["scripts/stage1/check-connectivity.mjs"], dockerEnv);
}

function assertServiceImage(service, expectedImageId) {
  const containerId = runCapture(dockerBin, [
    "compose",
    "--env-file",
    envFile,
    ...composeFiles,
    "ps",
    "-q",
    service
  ]).stdout.trim();
  if (!containerId) {
    throw new Error(`candidate service container is missing: ${service}`);
  }

  const actualImageId = runCapture(dockerBin, [
    "inspect",
    containerId,
    "--format",
    "{{.Image}}"
  ]).stdout.trim();
  if (actualImageId !== expectedImageId) {
    throw new Error(
      `candidate service ${service} is not running ${expectedImageId}: ${actualImageId}`
    );
  }
}

function runDockerCompose(args) {
  runCommand(dockerBin, ["compose", "--env-file", envFile, ...composeFiles, ...args], {
    AUTH_TOKEN_SIGNING_KEY: authTokenSigningKey,
    STAGE9_CANDIDATE_IMAGE: imageTag
  });
}

function assertDockerAvailable() {
  const result = spawnSync(dockerBin, ["version"], {
    encoding: "utf8",
    env: process.env
  });
  if (result.status === 0) {
    return;
  }

  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  throw new Error(
    [
      "stage9 candidate image gate requires a reachable Docker daemon.",
      "Start Docker Desktop with WSL integration or set AUCTION_DOCKER_BIN/STAGE9_DOCKER_BIN to a working Docker CLI.",
      output
    ]
      .filter(Boolean)
      .join("\n")
  );
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

function runCapture(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      AUTH_TOKEN_SIGNING_KEY: authTokenSigningKey,
      STAGE9_CANDIDATE_IMAGE: imageTag
    }
  });

  if (result.status !== 0) {
    const error = new Error(
      `command failed: ${binary} ${args.join(" ")}\n${result.stderr || result.stdout}`
    );
    error.exitCode = result.status ?? 1;
    throw error;
  }

  return result;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
