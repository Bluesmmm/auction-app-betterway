import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const schema = `stage9_authorization_scope_${Date.now()}_${process.pid}`;
const authorizationGateTestFiles = [
  "apps/api/test/contracts/child-participation.service.test.ts",
  "apps/api/test/integration/community-admin-authorization.service.test.ts",
  "apps/api/test/integration/community-access.service.test.ts",
  "apps/api/test/contracts/sensitive-operation.service.test.ts",
  "apps/api/test/contracts/admin-security.service.test.ts",
  "apps/api/test/contracts/communities.controller.test.ts",
  "apps/api/test/integration/stage6-api-flow.test.ts"
];

assertAuthorizationGateCoverage();

const commands = [];

if (await canConnectToDatabase()) {
  console.log("stage9 authorization gate reusing existing database runtime");
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
    ["test", "--", ...authorizationGateTestFiles],
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

  console.log("stage9 authorization gate passed");
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

function assertAuthorizationGateCoverage() {
  for (const file of authorizationGateTestFiles) {
    if (!existsSync(file)) {
      throw new Error(`stage9 authorization gate missing coverage file: ${file}`);
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
  if (!/^stage9_authorization_scope_\d+_\d+$/.test(schemaName)) {
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
