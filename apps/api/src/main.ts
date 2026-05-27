import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AppConfigService } from "./config/app-config.service.js";
import { RedactingNestLogger } from "./runtime/redacting-nest-logger.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });
  app.useLogger(new RedactingNestLogger());
  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

void bootstrap();
