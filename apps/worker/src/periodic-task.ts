import { RedactingWorkerLogger } from "./redacting-worker-logger.js";

type PeriodicTaskLogger = Pick<RedactingWorkerLogger, "error">;

const defaultLogger = new RedactingWorkerLogger();

export function runPeriodicTask(input: {
  taskName: string;
  run: () => Promise<unknown>;
  logger?: PeriodicTaskLogger;
}): void {
  void input.run().catch((error: unknown) => {
    (input.logger ?? defaultLogger).error("worker.periodic_task_failed", {
      taskName: input.taskName,
      error: serializeError(error)
    });
  });
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return String(error);
}
