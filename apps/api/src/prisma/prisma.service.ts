import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AppConfigService } from "../config/app-config.service.js";

export type DatabaseReadiness =
  | {
      status: "ready";
      latencyMs: number;
      serverTime: string;
    }
  | {
      status: "unready";
      latencyMs: number;
      errorCode: "DATABASE_UNAVAILABLE";
    };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      datasources: {
        db: {
          url: config.databaseUrl
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async checkReadiness(): Promise<DatabaseReadiness> {
    const startedAt = Date.now();

    try {
      const [result] = await this.$queryRaw<Array<{ server_time: Date }>>`
        SELECT now() AS server_time
      `;
      return {
        status: "ready",
        latencyMs: Date.now() - startedAt,
        serverTime: result?.server_time.toISOString() ?? new Date().toISOString()
      };
    } catch {
      return {
        status: "unready",
        latencyMs: Date.now() - startedAt,
        errorCode: "DATABASE_UNAVAILABLE"
      };
    }
  }
}
