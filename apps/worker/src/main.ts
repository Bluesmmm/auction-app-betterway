import { PrismaClient } from "@prisma/client";
import { createOutboxNotificationWorker } from "./outbox-worker.js";
import {
  PrismaLedgerCheckRunner,
  startPeriodicLedgerCheckWorker
} from "./ledger-check-worker.js";
import {
  createAuctionSettlementTriggerWorker,
  PrismaAuctionSettlementRunner,
  startPeriodicAuctionSettlementScanner
} from "./auction-settlement-worker.js";
import {
  createBullMqAuctionSettlementScheduler,
  PrismaOutboxDispatcher,
  startPeriodicOutboxDispatcher
} from "./outbox-dispatcher.js";
import {
  PrismaTransactionTimeoutRunner,
  startPeriodicTransactionTimeoutScanner
} from "./transaction-timeout-worker.js";
import { RedactingWorkerLogger } from "./redacting-worker-logger.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";
import { loadWorkerRuntimeConfig } from "./worker-config.js";
import { PrismaNotificationSender } from "./notification-sender.js";
import { createRedisRealtimeHintPublisher } from "./realtime-hint-publisher.js";

const config = loadWorkerRuntimeConfig();
const logger = new RedactingWorkerLogger();
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.databaseUrl
    }
  }
});
const heartbeat = await startWorkerHeartbeat({
  connection: config.redis,
  workerName: config.workerName
});
const auctionSettlementScheduler = createBullMqAuctionSettlementScheduler({
  connection: config.redis
});
const notificationSender = new PrismaNotificationSender(prisma);
const realtimePublisher = createRedisRealtimeHintPublisher({
  connection: config.redis
});
const outboxDispatcher = new PrismaOutboxDispatcher(prisma, {
  workerName: config.workerName,
  leaseMs: config.outboxDispatchLeaseMs,
  settlementScheduler: auctionSettlementScheduler,
  notificationSender,
  realtimePublisher
});
const outboxDispatchLoop = startPeriodicOutboxDispatcher({
  dispatcher: outboxDispatcher,
  intervalMs: config.outboxDispatchIntervalMs,
  limit: config.outboxDispatchLimit
});
const ledgerChecks = startPeriodicLedgerCheckWorker({
  workerName: config.workerName,
  intervalMs: config.ledgerCheckIntervalMs,
  runner: new PrismaLedgerCheckRunner(prisma)
});
const auctionSettlementRunner = new PrismaAuctionSettlementRunner(prisma);
const auctionSettlementScanner = startPeriodicAuctionSettlementScanner({
  prisma,
  runner: auctionSettlementRunner,
  workerName: config.workerName,
  intervalMs: config.auctionSettlementScanIntervalMs,
  limit: config.auctionSettlementScanLimit
});
const transactionTimeoutRunner = new PrismaTransactionTimeoutRunner(prisma);
const transactionTimeoutScanner = startPeriodicTransactionTimeoutScanner({
  prisma,
  runner: transactionTimeoutRunner,
  workerName: config.workerName,
  intervalMs: config.transactionTimeoutScanIntervalMs,
  limit: config.transactionTimeoutScanLimit
});

const outboxWorker = createOutboxNotificationWorker({
  connection: config.redis,
  concurrency: config.concurrency,
  sender: notificationSender
});
const auctionSettlementWorker = createAuctionSettlementTriggerWorker({
  connection: config.redis,
  concurrency: config.concurrency,
  workerName: config.workerName,
  runner: auctionSettlementRunner
});

outboxWorker.on("ready", () => {
  logger.info("worker.ready", {
    workerName: config.workerName
  });
});

outboxWorker.on("failed", (job, error) => {
  logger.error("worker.job_failed", {
    jobId: job?.id,
    message: error.message
  });
});

auctionSettlementWorker.on("failed", (job, error) => {
  logger.error("auction_settlement.job_failed", {
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
  await outboxDispatchLoop.stop();
  await transactionTimeoutScanner.stop();
  await auctionSettlementScanner.stop();
  await ledgerChecks.stop();
  await heartbeat.stop();
  await auctionSettlementWorker.close();
  await outboxWorker.close();
  await auctionSettlementScheduler.close();
  await realtimePublisher.close();
  await prisma.$disconnect();
  process.exit(0);
}
