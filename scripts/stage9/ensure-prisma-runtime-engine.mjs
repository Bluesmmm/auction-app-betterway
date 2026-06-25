import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BinaryType, download } = require("@prisma/fetch-engine");
const { enginesVersion } = require("@prisma/engines-version");

const engineTarget = "debian-openssl-1.1.x";
const engineDir = "node_modules/.prisma/client";
const enginePath = `${engineDir}/libquery_engine-${engineTarget}.so.node`;

if (existsSync(enginePath)) {
  console.log(`prisma runtime engine already present: ${enginePath}`);
} else {
  mkdirSync(engineDir, { recursive: true });
  await download({
    binaries: {
      [BinaryType.QueryEngineLibrary]: engineDir
    },
    binaryTargets: [engineTarget],
    version: enginesVersion,
    showProgress: true,
    printVersion: false
  });
  console.log(`prisma runtime engine downloaded: ${enginePath}`);
}
