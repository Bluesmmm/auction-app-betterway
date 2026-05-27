import { spawnSync } from "node:child_process";

run("npm", ["run", "db:validate"]);
run("npm", ["run", "db:generate"]);
run("npm", ["run", "db:deploy"]);
run("npm", ["run", "db:status"]);

console.log("stage1 migration rehearsal passed");

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
