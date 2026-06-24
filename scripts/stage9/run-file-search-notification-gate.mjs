import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const schema = `stage9_file_search_notification_${Date.now()}_${process.pid}`;
const fileSearchNotificationGateTestFiles = [
  "apps/api/test/contracts/private-object-storage.service.test.ts",
  "apps/api/test/contracts/realtime-permission.service.test.ts",
  "apps/api/test/integration/stage7-search-favorites-flow.test.ts",
  "apps/api/test/integration/stage7-notifications-api-flow.test.ts",
  "apps/worker/test/notification-sender.test.ts",
  "apps/worker/test/realtime-hint-publisher.test.ts"
];

assertFileSearchNotificationGateCoverage();

const commands = [];

if (await canConnectToDatabase()) {
  console.log(
    "stage9 file-search-notification gate reusing existing database runtime"
  );
} else {
  commands.push(["npm", ["run", "runtime:up"]]);
}

commands.push(
  ["npm", ["run", "db:generate"]],
  ["npm", ["run", "db:validate"]],
  [
    "npm",
    ["run", "db:deploy"],
    {
      DATABASE_URL: databaseUrlForSchema(schema)
    },
    {
      attempts: 20,
      retryDelayMs: 1000
    }
  ],
  [
    "npm",
    ["test", "--", ...fileSearchNotificationGateTestFiles],
    {
      DATABASE_URL: databaseUrlForSchema(schema)
    }
  ]
);

let failure = null;
let shouldDropCreatedSchema = false;
try {
  for (const command of commands) {
    const [binary, args, extraEnv, options] = command;
    if (extraEnv?.DATABASE_URL) {
      shouldDropCreatedSchema = true;
    }
    runCommand(binary, args, extraEnv, options);
  }

  console.log("stage9 file-search-notification gate passed");
} catch (error) {
  failure = error;
} finally {
  if (shouldDropCreatedSchema) {
    try {
      await dropCreatedSchema();
    } catch (error) {
      if (failure) {
        console.error(error instanceof Error ? error.message : String(error));
      } else {
        failure = error;
      }
    }
  }
}

if (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exit(failure.exitCode ?? 1);
}

function assertFileSearchNotificationGateCoverage() {
  for (const file of fileSearchNotificationGateTestFiles) {
    if (!existsSync(file)) {
      throw new Error(
        `stage9 file-search-notification gate missing coverage file: ${file}`
      );
    }
  }
}

function runCommand(binary, args, extraEnv, options = {}) {
  const attempts = options.attempts ?? 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(binary, args, {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        ...(extraEnv ?? {})
      }
    });

    if (result.status === 0) {
      return;
    }

    if (attempt < attempts) {
      sleep(options.retryDelayMs ?? 1000);
      continue;
    }

    const error = new Error(`command failed: ${binary} ${args.join(" ")}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

async function dropCreatedSchema() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrlForSchema("public")
      }
    }
  });

  try {
    assertStage9SchemaName(schema);
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}

function assertStage9SchemaName(schemaName) {
  if (!/^stage9_file_search_notification_\d+_\d+$/.test(schemaName)) {
    throw new Error(`refusing to drop unexpected schema: ${schemaName}`);
  }
}

function databaseUrlForSchema(schemaName) {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function canConnectToDatabase() {
  const url = new URL(baseDatabaseUrl);
  const host = url.hostname || "localhost";
  const port = Number(url.port || 5432);

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
