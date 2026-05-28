import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rehearsalDatabase =
  process.env.STAGE1_MIGRATION_REHEARSAL_DATABASE ??
  "auction_app_migration_rehearsal";
const rehearsalDatabaseUrl = `postgresql://auction_app:auction_app@localhost:5432/${rehearsalDatabase}?schema=public`;
const rollbackSnapshotPath = "/tmp/auction-app-stage1-migration-rollback.sql";
const prismaDir = "apps/api/prisma";

const baselineProject = prepareBaselinePrismaProject();

try {
  run("npm", ["run", "db:validate"]);
  run("npm", ["run", "db:generate"]);

  dropRehearsalDatabase();
  createRehearsalDatabase();
  deployBaselineDatabase(baselineProject.schemaPath);
  captureRollbackSnapshot();
  deployAndCheckRehearsalDatabase();

  dropRehearsalDatabase();
  createRehearsalDatabase();
  restoreRollbackSnapshot();
  deployAndCheckRehearsalDatabase();
  dropRehearsalDatabase();

  console.log("stage1 migration rehearsal passed");
} finally {
  rmSync(baselineProject.root, {
    recursive: true,
    force: true
  });
}

function prepareBaselinePrismaProject() {
  const migrationNames = readdirSync(`${prismaDir}/migrations`, {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationNames.length < 2) {
    throw new Error("stage1 rollback rehearsal requires at least two migrations");
  }

  const baselineMigrationNames = migrationNames.slice(0, -1);
  const root = mkdtempSync(join(tmpdir(), "auction-app-stage1-prisma-baseline-"));
  const baselinePrismaDir = join(root, "prisma");
  const baselineMigrationsDir = join(baselinePrismaDir, "migrations");
  mkdirSync(baselineMigrationsDir, {
    recursive: true
  });

  cpSync(`${prismaDir}/schema.prisma`, join(baselinePrismaDir, "schema.prisma"));
  cpSync(
    `${prismaDir}/migrations/migration_lock.toml`,
    join(baselineMigrationsDir, "migration_lock.toml")
  );

  for (const migrationName of baselineMigrationNames) {
    cpSync(
      `${prismaDir}/migrations/${migrationName}`,
      join(baselineMigrationsDir, migrationName),
      {
        recursive: true
      }
    );
  }

  return {
    root,
    schemaPath: join(baselinePrismaDir, "schema.prisma")
  };
}

function deployBaselineDatabase(schemaPath) {
  run(
    "npx",
    ["--no-install", "prisma", "migrate", "deploy", "--schema", schemaPath],
    {
      DATABASE_URL: rehearsalDatabaseUrl
    }
  );
}

function deployAndCheckRehearsalDatabase() {
  run("npm", ["run", "db:deploy"], {
    DATABASE_URL: rehearsalDatabaseUrl
  });
  run("npm", ["run", "db:status"], {
    DATABASE_URL: rehearsalDatabaseUrl
  });
}

function captureRollbackSnapshot() {
  const dump = runCapture("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "auction_app",
    "-d",
    rehearsalDatabase
  ]);
  writeFileSync(rollbackSnapshotPath, dump.stdout);
}

function restoreRollbackSnapshot() {
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
      rehearsalDatabase
    ],
    readFileSync(rollbackSnapshotPath)
  );
}

function createRehearsalDatabase() {
  run("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "auction_app",
    rehearsalDatabase
  ]);
}

function dropRehearsalDatabase() {
  run("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "dropdb",
    "-U",
    "auction_app",
    "--if-exists",
    rehearsalDatabase
  ]);
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

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
