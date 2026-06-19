import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=public";

const schemas = {
  api: "stage8_verify_api"
};

const stage8TestFiles = [
  "apps/api/test/contracts/stage8.controller.test.ts",
  "apps/api/test/contracts/stage8-governance-controls-schema.test.ts",
  "apps/api/test/contracts/stage8-high-risk-governance-review-schema.test.ts",
  "apps/api/test/contracts/admin-security.service.test.ts",
  "apps/api/test/integration/stage8-governance-flow.test.ts",
  "apps/api/test/integration/stage8-governance-controls-flow.test.ts",
  "apps/worker/test/worker-config.test.ts",
  "apps/worker/test/high-risk-governance-review-expiry-worker.test.ts",
  "apps/worker/test/notification-sender.test.ts",
  "apps/worker/test/auction-settlement-worker.test.ts",
  "apps/api/test/runtime/admin-stage8-shell.test.ts",
  "apps/api/test/runtime/stage8-scripts.test.ts"
];

const requiredCoverageCategories = [
  "contract",
  "integration",
  "state-race",
  "authorization",
  "transaction",
  "notification",
  "worker",
  "compatibility",
  "guard-regression",
  "routing-flag-approve-invalidation",
  "idempotency-payload-conflict",
  "approve-retry-terminal",
  "runtime-shell",
  "quality-gates"
];

const stage8CoverageMatrix = [
  {
    category: "contract",
    files: [
      "apps/api/test/contracts/stage8.controller.test.ts",
      "apps/api/test/contracts/stage8-governance-controls-schema.test.ts",
      "apps/api/test/contracts/stage8-high-risk-governance-review-schema.test.ts",
      "apps/api/test/contracts/admin-security.service.test.ts"
    ]
  },
  {
    category: "integration",
    files: [
      "apps/api/test/integration/stage8-governance-flow.test.ts",
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts"
    ]
  },
  {
    category: "state-race",
    files: [
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts",
      "apps/worker/test/high-risk-governance-review-expiry-worker.test.ts"
    ]
  },
  {
    category: "authorization",
    files: [
      "apps/api/test/contracts/admin-security.service.test.ts",
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts"
    ]
  },
  {
    category: "transaction",
    files: ["apps/api/test/integration/stage8-governance-controls-flow.test.ts"]
  },
  {
    category: "notification",
    files: [
      "apps/worker/test/notification-sender.test.ts",
      "apps/api/test/contracts/stage8-high-risk-governance-review-schema.test.ts"
    ]
  },
  {
    category: "worker",
    files: [
      "apps/worker/test/worker-config.test.ts",
      "apps/worker/test/high-risk-governance-review-expiry-worker.test.ts",
      "apps/worker/test/auction-settlement-worker.test.ts"
    ]
  },
  {
    category: "compatibility",
    files: ["apps/api/test/integration/stage8-governance-controls-flow.test.ts"]
  },
  {
    category: "guard-regression",
    files: [
      "apps/api/test/integration/stage8-governance-controls-flow.test.ts",
      "apps/worker/test/auction-settlement-worker.test.ts"
    ]
  },
  {
    category: "routing-flag-approve-invalidation",
    files: ["apps/api/test/integration/stage8-governance-controls-flow.test.ts"]
  },
  {
    category: "idempotency-payload-conflict",
    files: ["apps/api/test/integration/stage8-governance-controls-flow.test.ts"]
  },
  {
    category: "approve-retry-terminal",
    files: ["apps/api/test/integration/stage8-governance-controls-flow.test.ts"]
  },
  {
    category: "runtime-shell",
    files: [
      "apps/api/test/runtime/admin-stage8-shell.test.ts",
      "apps/api/test/runtime/stage8-scripts.test.ts"
    ]
  },
  {
    category: "quality-gates",
    files: ["typecheck", "build", "diff-check"]
  }
];

assertStage8VerificationCoverage();

const commands = [];

if (await canConnectToDatabase()) {
  console.log("stage8 verification reusing existing database runtime");
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
    ["test", "--", ...stage8TestFiles],
    {
      DATABASE_URL: databaseUrlForSchema(schemas.api)
    }
  ],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
  ["git", ["diff", "--check"]]
);

for (const command of commands) {
  const [binary, args, extraEnv, options] = command;
  runCommand(binary, args, extraEnv, options);
}

console.log("stage8 verification passed");

function assertStage8VerificationCoverage() {
  const testFileSet = new Set(stage8TestFiles);
  const coveredCategories = new Set(
    stage8CoverageMatrix.map((entry) => entry.category)
  );

  for (const category of requiredCoverageCategories) {
    if (!coveredCategories.has(category)) {
      throw new Error(`stage8 verification missing coverage category: ${category}`);
    }
  }

  for (const file of stage8TestFiles) {
    if (!existsSync(file)) {
      throw new Error(`stage8 verification missing test file: ${file}`);
    }
  }

  for (const entry of stage8CoverageMatrix) {
    if (entry.files.length === 0) {
      throw new Error(`stage8 coverage category has no files: ${entry.category}`);
    }
    for (const file of entry.files) {
      if (
        file !== "typecheck" &&
        file !== "build" &&
        file !== "diff-check" &&
        !testFileSet.has(file)
      ) {
        throw new Error(
          `stage8 coverage category ${entry.category} references unverified file: ${file}`
        );
      }
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

    process.exit(result.status ?? 1);
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
