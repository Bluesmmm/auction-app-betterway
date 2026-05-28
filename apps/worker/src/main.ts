import { createOutboxNotificationWorker } from "./outbox-worker.js";
import { RedactingWorkerLogger } from "./redacting-worker-logger.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";
import { loadWorkerRuntimeConfig } from "./worker-config.js";

const config = loadWorkerRuntimeConfig();
const logger = new RedactingWorkerLogger();
const heartbeat = await startWorkerHeartbeat({
  connection: config.redis,
  workerName: config.workerName
});

const worker = createOutboxNotificationWorker({
  connection: config.redis,
  concurrency: config.concurrency,
  sender: {
    async send() {
      return {
        ok: false,
        errorCode: "SUBSCRIPTION_MESSAGE_PROVIDER_NOT_CONFIGURED",
        mutatesBusinessState: false
      };
    }
  }
});

worker.on("ready", () => {
  logger.info("worker.ready", {
    workerName: config.workerName
  });
});

worker.on("failed", (job, error) => {
  logger.error("worker.job_failed", {
    jobId: job?.id,
    message: error.message
  });
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  await heartbeat.stop();
  await worker.close();
  process.exit(0);
}
