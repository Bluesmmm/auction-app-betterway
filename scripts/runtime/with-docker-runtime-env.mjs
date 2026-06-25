import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("usage: node scripts/runtime/with-docker-runtime-env.mjs <command> [args...]");
  process.exit(1);
}

const dockerBin =
  process.env.AUCTION_DOCKER_BIN ??
  process.env.STAGE9_DOCKER_BIN ??
  (existsSync("/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe")
    ? "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
    : "docker");
const envFile = `/tmp/auction-runtime-${process.pid}.env`;
const wrapperDir = `/tmp/auction-runtime-docker-${process.pid}`;
const authTokenSigningKey =
  process.env.AUTH_TOKEN_SIGNING_KEY ??
  "auction-runtime-auth-token-signing-key";

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

let exitCode = 1;
try {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      AUTH_TOKEN_SIGNING_KEY: authTokenSigningKey,
      PATH: `${wrapperDir}:${process.env.PATH ?? ""}`
    }
  });

  exitCode = result.status ?? 1;
} finally {
  rmSync(wrapperDir, { recursive: true, force: true });
  rmSync(envFile, { force: true });
}

process.exit(exitCode);

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
