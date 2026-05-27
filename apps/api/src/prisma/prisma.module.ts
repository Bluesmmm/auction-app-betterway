import { Global, Module } from "@nestjs/common";
import { AppConfigModule } from "../config/app-config.module.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [PrismaService],
  exports: [PrismaService]
})
export class PrismaModule {}
