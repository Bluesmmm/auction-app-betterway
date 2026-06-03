import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "runtime:up"]],
  ["npm", ["run", "db:generate"]],
  ["npm", ["run", "db:deploy"]],
  ["npm", ["run", "db:validate"]],
  [
    "npm",
    [
      "test",
      "--",
      "apps/api/test/contracts/stage4-schema.test.ts",
      "apps/api/test/integration/onboarding.service.test.ts",
      "apps/api/test/integration/point-ledger.service.test.ts",
      "apps/api/test/integration/ledger-check.service.test.ts",
      "apps/api/test/runtime/app-config.service.test.ts",
      "apps/api/test/runtime/stage4-controller-di.test.ts",
      "apps/api/test/runtime/admin-stage4-shell.test.ts",
      "apps/api/test/runtime/miniprogram-stage4-shell.test.ts",
      "apps/api/test/runtime/stage4-scripts.test.ts",
      "apps/worker/test/worker-config.test.ts",
      "apps/worker/test/ledger-check-worker.test.ts"
    ]
  ],
  ["npm", ["run", "stage4:ledger-check"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]]
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("stage4 verification passed");
