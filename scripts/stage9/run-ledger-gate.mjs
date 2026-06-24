import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const schemaSuffix = `${Date.now()}_${process.pid}`;
const schemas = {
  ledger: `stage9_ledger_recompute_${schemaSuffix}`,
  transaction: `stage9_ledger_transaction_${schemaSuffix}`
};

const ledgerGateTestFiles = [
  "apps/api/test/integration/ledger-check.service.test.ts",
  "apps/api/test/integration/transaction-decision.service.test.ts",
  "apps/worker/test/ledger-check-worker.test.ts"
];

assertLedgerGateCoverage();

const commands = [];

if (await canConnectToDatabase()) {
  console.log("stage9 ledger gate reusing existing database runtime");
} else {
  commands.push(["npm", ["run", "runtime:up"]]);
}

commands.push(["npm", ["run", "db:generate"]], ["npm", ["run", "db:validate"]]);

for (const schema of Object.values(schemas)) {
  commands.push([
    "npm",
    ["run", "db:deploy"],
    {
      DATABASE_URL: databaseUrlForSchema(schema)
    },
    {
      attempts: 20,
      retryDelayMs: 1000
    }
  ]);
}

commands.push(
  [
    "npm",
    [
      "test",
      "--",
      "apps/api/test/integration/ledger-check.service.test.ts",
      "apps/worker/test/ledger-check-worker.test.ts"
    ],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.ledger)
    }
  ],
  [
    "npm",
    ["run", "stage4:ledger-check"],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.ledger)
    }
  ],
  [
    "npm",
    ["test", "--", "apps/api/test/integration/transaction-decision.service.test.ts"],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.transaction)
    }
  ],
  [
    "npm",
    ["run", "stage4:ledger-check"],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.transaction)
    }
  ]
);

let failure = null;
let shouldDropCreatedSchemas = false;
try {
  for (const command of commands) {
    const [binary, args, extraEnv, options] = command;
    if (extraEnv?.DATABASE_URL) {
      shouldDropCreatedSchemas = true;
    }
    runCommand(binary, args, extraEnv, options);
  }

  console.log("stage9 ledger gate passed");
} catch (error) {
  failure = error;
} finally {
  if (shouldDropCreatedSchemas) {
    try {
      await dropCreatedSchemas();
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

function assertLedgerGateCoverage() {
  for (const file of ledgerGateTestFiles) {
    if (!existsSync(file)) {
      throw new Error(`stage9 ledger gate missing coverage file: ${file}`);
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

    const error = new Error(
      `command failed: ${binary} ${args.join(" ")}`
    );
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

async function dropCreatedSchemas() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrlForSchema("public")
      }
    }
  });

  try {
    for (const schema of Object.values(schemas)) {
      assertStage9SchemaName(schema);
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function assertStage9SchemaName(schema) {
  if (!/^stage9_ledger_[a-z_]+_\d+_\d+$/.test(schema)) {
    throw new Error(`refusing to drop unexpected schema: ${schema}`);
  }
}

function databaseUrlForSchema(schema) {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schema);
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
