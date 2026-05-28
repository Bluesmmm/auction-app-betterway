import { existsSync } from "node:fs";

const requiredBuildArtifacts = [
  "apps/api/dist/runtime/structured-logger.js",
  "apps/worker/dist/redacting-worker-logger.js"
];

for (const artifact of requiredBuildArtifacts) {
  if (!existsSync(artifact)) {
    fail(`missing log scan build artifact: ${artifact}`);
  }
}

const [{ StructuredLogger }, { RedactingWorkerLogger }] = await Promise.all([
  import("../../apps/api/dist/runtime/structured-logger.js"),
  import("../../apps/worker/dist/redacting-worker-logger.js")
]);

const sensitivePayload = {
  phone: "13812345678",
  addressText: "上海市浦东新区测试路 1 号",
  storageKey: "private/children/raw/object-key-123456789.jpg",
  signedUrl:
    "https://cdn.example.com/private/children/raw/object-key-123456789.jpg?signature=abc",
  nested: {
    courierTrackingNo: "SF987654321"
  },
  note: "快递单号 SF987654321，请送到上海市浦东新区测试路 1 号"
};

const apiLogger = new StructuredLogger();
const workerLogger = new RedactingWorkerLogger();
const generatedLogs = [
  apiLogger.serialize({
    level: "info",
    event: "stage1.log_scan.api",
    payload: sensitivePayload
  }),
  workerLogger.serialize({
    level: "error",
    event: "stage1.log_scan.worker",
    payload: {
      message:
        "delivery failed for 13812345678 at 上海市浦东新区测试路 1 号 with private/children/raw/object-key-123456789.jpg?signature=abc and SF987654321"
    }
  })
].join("\n");

const forbiddenFragments = [
  "13812345678",
  "上海市浦东新区测试路",
  "object-key-123456789",
  "signature=abc",
  "SF987654321"
];

for (const fragment of forbiddenFragments) {
  if (generatedLogs.includes(fragment)) {
    fail(`stage1 log scan leaked sensitive fragment: ${fragment}`);
  }
}

if (!generatedLogs.includes("[REDACTED")) {
  fail("stage1 log scan did not exercise redaction markers");
}

console.log("stage1 log scan passed");

function fail(message) {
  console.error(message);
  process.exit(1);
}
