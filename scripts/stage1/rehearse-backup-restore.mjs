import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const restoreDatabase = "auction_app_restore_check";
const dumpPath = "/tmp/auction-app-stage1-backup.sql";

const dump = runCapture("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "pg_dump",
  "-U",
  "auction_app",
  "-d",
  "auction_app"
]);
writeFileSync(dumpPath, dump.stdout);

run("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "dropdb",
  "-U",
  "auction_app",
  "--if-exists",
  restoreDatabase
]);
run("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "createdb",
  "-U",
  "auction_app",
  restoreDatabase
]);
runWithInput(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "auction_app",
    "-d",
    restoreDatabase
  ],
  readFileSync(dumpPath)
);

const sourceCount = queryCount("auction_app", "\"AuctionCommunity\"");
const restoredCount = queryCount(restoreDatabase, "\"AuctionCommunity\"");

run("docker", [
  "compose",
  "exec",
  "-T",
  "postgres",
  "dropdb",
  "-U",
  "auction_app",
  "--if-exists",
  restoreDatabase
]);

if (sourceCount !== restoredCount) {
  console.error(
    `backup restore count mismatch: source=${sourceCount} restored=${restoredCount}`
  );
  process.exit(1);
}

console.log("stage1 backup restore rehearsal passed");

function queryCount(database, tableName) {
  const result = runCapture("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "auction_app",
    "-d",
    database,
    "-t",
    "-A",
    "-c",
    `select count(*) from ${tableName};`
  ]);

  return Number(result.stdout.trim());
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runWithInput(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  return result;
}
