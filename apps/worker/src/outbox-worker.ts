import { Worker, type Job } from "bullmq";
import { QueueName } from "./queue-names.js";
import type { RedisConnectionConfig } from "./worker-config.js";
import {
  processOutboxNotification,
  type NotificationSender,
  type OutboxJobPayload,
  type OutboxProcessingResult
} from "./outbox-processor.js";

export function createOutboxNotificationWorker(input: {
  connection: RedisConnectionConfig;
  concurrency: number;
  sender: NotificationSender;
}) {
  return new Worker<OutboxJobPayload, OutboxProcessingResult>(
    QueueName.outboxNotifications,
    async (job: Job<OutboxJobPayload>) =>
      processOutboxNotification(job.data, input.sender),
    {
      connection: input.connection,
      concurrency: input.concurrency
    }
  );
}
