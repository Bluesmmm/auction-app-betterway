import type { Prisma, PrismaClient } from "@prisma/client";

export type CriticalTransactionOptions = {
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
};

export async function runCriticalTransaction<T>(
  prisma: Pick<PrismaClient, "$transaction">,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: CriticalTransactionOptions = {}
): Promise<T> {
  const lockTimeoutMs = options.lockTimeoutMs ?? 3000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 5000;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`
      );

      return operation(tx);
    },
    {
      maxWait: options.maxWaitMs ?? 3000,
      timeout: options.timeoutMs ?? 7000
    }
  );
}
