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
      "apps/api/test/contracts/stage3-schema.test.ts",
      "apps/api/test/contracts/content-provider-and-upload.test.ts",
      "apps/api/test/integration/stage3-content-review-flow.test.ts",
      "apps/api/test/runtime/stage3-controller-di.test.ts",
      "apps/api/test/runtime/stage3-readiness-script.test.ts",
      "apps/api/test/runtime/admin-stage3-shell.test.ts",
      "apps/api/test/runtime/miniprogram-stage3-shell.test.ts"
    ]
  ],
  ["npm", ["run", "stage3:readiness"]],
  ["npm", ["run", "typecheck"]]
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

console.log("stage3 verification passed");
