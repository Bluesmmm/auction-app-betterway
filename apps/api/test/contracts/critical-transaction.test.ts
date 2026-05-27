import { describe, expect, it } from "vitest";
import { runCriticalTransaction } from "../../src/prisma/critical-transaction.js";

describe("runCriticalTransaction", () => {
  it("sets PostgreSQL timeout guards before running critical business logic", async () => {
    const statements: string[] = [];
    const prisma = {
      async $transaction(callback: (tx: any) => Promise<string>, options: any) {
        const tx = {
          async $executeRawUnsafe(statement: string) {
            statements.push(statement);
          }
        };
        const result = await callback(tx);
        return `${result}:${options.maxWait}:${options.timeout}`;
      }
    };

    const result = await runCriticalTransaction(
      prisma as never,
      async () => "ok",
      {
        lockTimeoutMs: 1234,
        statementTimeoutMs: 5678,
        maxWaitMs: 111,
        timeoutMs: 222
      }
    );

    expect(statements).toEqual([
      "SET LOCAL lock_timeout = '1234ms'",
      "SET LOCAL statement_timeout = '5678ms'"
    ]);
    expect(result).toBe("ok:111:222");
  });
});
