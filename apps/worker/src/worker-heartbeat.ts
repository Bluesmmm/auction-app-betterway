import { Redis } from "ioredis";
import type { RedisConnectionConfig } from "./worker-config.js";

export type WorkerHeartbeatHandle = {
  stop(): Promise<void>;
};

export function workerHeartbeatKey(workerName: string): string {
  return `auction:worker:${workerName}:heartbeat`;
}

export async function startWorkerHeartbeat(input: {
  connection: RedisConnectionConfig;
  workerName: string;
  intervalMs?: number;
}): Promise<WorkerHeartbeatHandle> {
  const redis = new Redis(input.connection);
  const intervalMs = input.intervalMs ?? 5000;
  const writeHeartbeat = async () => {
    await redis.set(
      workerHeartbeatKey(input.workerName),
      String(Date.now()),
      "EX",
      60
    );
  };

  await writeHeartbeat();
  const interval = setInterval(() => {
    void writeHeartbeat();
  }, intervalMs);

  return {
    async stop() {
      clearInterval(interval);
      redis.disconnect();
    }
  };
}
