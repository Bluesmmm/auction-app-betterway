import type { LoggerService } from "@nestjs/common";
import { StructuredLogger } from "./structured-logger.js";

export class RedactingNestLogger implements LoggerService {
  private readonly logger = new StructuredLogger();

  log(message: unknown, context?: string): void {
    this.write("info", message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write("error", message, context, { trace });
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  private write(
    level: "debug" | "info" | "warn" | "error",
    message: unknown,
    context?: string,
    extraPayload?: Record<string, unknown>
  ): void {
    const serialized = this.logger.serialize({
      level,
      event: context ?? "nest.runtime",
      payload: {
        message,
        ...extraPayload
      }
    });

    if (level === "error") {
      console.error(serialized);
      return;
    }

    console.log(serialized);
  }
}
