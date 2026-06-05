import { spawnSync } from "node:child_process";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const schemas = {
  api: "stage6_verify_api",
  worker: "stage6_verify_worker"
};

const commands = [
  ["npm", ["run", "runtime:up"]],
  ["npm", ["run", "db:generate"]],
  ["npm", ["run", "db:validate"]]
];

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
      "apps/api/test/contracts/stage6-schema.test.ts",
      "apps/api/test/integration/transaction-decision.service.test.ts",
      "apps/api/test/integration/transaction-appeal.service.test.ts",
      "apps/api/test/runtime/stage6-scripts.test.ts"
    ],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.api)
    }
  ],
  [
    "npm",
    ["test", "--", "apps/worker/test/transaction-timeout-worker.test.ts"],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.worker)
    }
  ],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]]
);

for (const command of commands) {
  const [binary, args, extraEnv, options] = command;
  runCommand(binary, args, extraEnv, options);
}

console.log("stage6 verification passed");

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

    process.exit(result.status ?? 1);
  }
}

function databaseUrlForSchema(schema) {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
